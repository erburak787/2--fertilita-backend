import { Hono } from 'hono';
import { protectedRoute } from '../middleware/auth.middleware';
import { ApiError } from '../utils/errors';
import { t } from '../utils/i18n';
import { env } from '../env';
import { sendOpaqueToUser } from '../services/push.service';
import type { AuthVariables } from '../types/context';

const notifications = new Hono<{ Variables: AuthVariables }>();
notifications.use('/*', protectedRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[notifications]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

// Dev-only test endpoint. Sends an opaque ping to all of the caller's
// active tokens. Blocked in production.
notifications.post('/test', async (c) => {
  try {
    if (env.NODE_ENV === 'production') {
      throw new ApiError({ code: 'FORBIDDEN', message: 'test_push_disabled_in_prod' });
    }
    const result = await sendOpaqueToUser(c.get('userId'), 'test_ping');
    return c.json({ success: true, ...result });
  } catch (err) { return handle(err, c); }
});

export { notifications as notificationsRoutes };
