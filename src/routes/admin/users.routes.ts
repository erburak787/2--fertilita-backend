import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ApiError } from '../../utils/errors';
import { t } from '../../utils/i18n';
import { adminJwtRoute, requireRole } from '../../middleware/admin-jwt.middleware';
import { objectIdSchema } from '../../schemas/common.schema';
import {
  listUsers,
  getUserDetail,
  deleteUserCascade,
} from '../../services/admin-user.service';
import type { AdminVariables } from '../../types/context';

const adminUsers = new Hono<{ Variables: AdminVariables }>();
adminUsers.use('/*', adminJwtRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[admin.users]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

const listQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['createdAt', 'lastLoginAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

adminUsers.get('/', zValidator('query', listQuerySchema), async (c) => {
  try {
    const q = c.req.valid('query');
    const result = await listUsers({
      query: q.q,
      page: q.page,
      limit: q.limit,
      sort: q.sort,
      order: q.order,
    });
    return c.json(result);
  } catch (err) { return handle(err, c); }
});

adminUsers.get('/:id', zValidator('param', z.object({ id: objectIdSchema })), async (c) => {
  try {
    const { id } = c.req.valid('param');
    const result = await getUserDetail(id);
    return c.json(result);
  } catch (err) { return handle(err, c); }
});

adminUsers.delete(
  '/:id',
  requireRole('super_admin', 'admin'),
  zValidator('param', z.object({ id: objectIdSchema })),
  zValidator('json', z.object({ reason: z.string().max(500).optional() }).optional()),
  async (c) => {
    try {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json') ?? {};
      const admin = c.get('admin');
      const result = await deleteUserCascade({
        adminId: admin._id,
        adminEmail: admin.email,
        userId: id,
        reason: body.reason,
      });
      return c.json(result);
    } catch (err) { return handle(err, c); }
  }
);

export { adminUsers as adminUsersRoutes };
