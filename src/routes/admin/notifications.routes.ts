import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ApiError } from '../../utils/errors';
import { t } from '../../utils/i18n';
import { adminJwtRoute, requireRole } from '../../middleware/admin-jwt.middleware';
import { getCollections } from '../../db/collections';
import { sendOpaqueBatch } from '../../services/push.service';
import { writeAudit } from '../../services/admin-user.service';
import { broadcastNotificationSchema } from '../../schemas/notification.schema';
import type { AdminVariables } from '../../types/context';

const adminNotifications = new Hono<{ Variables: AdminVariables }>();
adminNotifications.use('/*', adminJwtRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[admin.notifications]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

adminNotifications.post(
  '/broadcast',
  requireRole('super_admin'),
  zValidator('json', broadcastNotificationSchema),
  async (c) => {
    try {
      const body = c.req.valid('json');
      const admin = c.get('admin');

      let userIds = body.userIds;
      if (!userIds || userIds.length === 0) {
        const users = await getCollections().users
          .find(
            { deletedAt: { $in: [null, undefined] } as any },
            { projection: { _id: 1 } }
          )
          .toArray();
        userIds = users.map((u) => u._id);
      }

      const result = await sendOpaqueBatch(userIds, body.kind);
      await writeAudit(admin._id, admin.email, 'push_broadcast', null, {
        kind: body.kind,
        targetCount: userIds.length,
        ...result,
      });
      return c.json({ success: true, targetCount: userIds.length, ...result });
    } catch (err) { return handle(err, c); }
  }
);

export { adminNotifications as adminNotificationsRoutes };
