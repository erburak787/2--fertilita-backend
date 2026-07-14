import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ApiError } from '../../utils/errors';
import { t } from '../../utils/i18n';
import { authRateLimiter } from '../../middleware/rateLimit.middleware';
import { adminJwtRoute } from '../../middleware/admin-jwt.middleware';
import { adminLoginSchema, buildAdminPublic } from '../../schemas/admin.schema';
import {
  loginAdmin,
  refreshAdminToken,
  logoutAdmin,
} from '../../services/admin-auth.service';
import type { AdminVariables, BaseVariables } from '../../types/context';

const adminAuth = new Hono<{ Variables: BaseVariables }>();

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[admin.auth]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

adminAuth.post('/login', authRateLimiter, zValidator('json', adminLoginSchema), async (c) => {
  try {
    const result = await loginAdmin(c.req.valid('json'));
    return c.json(result);
  } catch (err) { return handle(err, c); }
});

adminAuth.post(
  '/refresh',
  zValidator('json', z.object({ refreshToken: z.string().min(1) })),
  async (c) => {
    try {
      const result = await refreshAdminToken(c.req.valid('json').refreshToken);
      return c.json(result);
    } catch (err) { return handle(err, c); }
  }
);

// ---- Protected ----
const me = new Hono<{ Variables: AdminVariables }>();
me.use('/*', adminJwtRoute());

me.get('/me', (c) => {
  return c.json({ admin: buildAdminPublic(c.get('admin')) });
});

me.post(
  '/logout',
  zValidator('json', z.object({ refreshToken: z.string().optional() })),
  async (c) => {
    try {
      const admin = c.get('admin');
      await logoutAdmin(admin._id, c.req.valid('json').refreshToken);
      return c.json({ success: true });
    } catch (err) { return handle(err, c); }
  }
);

adminAuth.route('/', me);

export { adminAuth as adminAuthRoutes };
