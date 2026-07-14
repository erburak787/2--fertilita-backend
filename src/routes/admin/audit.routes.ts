import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ApiError } from '../../utils/errors';
import { t } from '../../utils/i18n';
import { adminJwtRoute } from '../../middleware/admin-jwt.middleware';
import { getCollections } from '../../db/collections';
import { adminAuditActionSchema } from '../../schemas/admin.schema';
import type { AdminVariables } from '../../types/context';

const adminAudit = new Hono<{ Variables: AdminVariables }>();
adminAudit.use('/*', adminJwtRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[admin.audit]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

const querySchema = z.object({
  adminId: z.string().optional(),
  targetUserId: z.string().optional(),
  action: adminAuditActionSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

adminAudit.get('/', zValidator('query', querySchema), async (c) => {
  try {
    const q = c.req.valid('query');
    const filter: Record<string, unknown> = {};
    if (q.adminId) filter.adminId = q.adminId;
    if (q.targetUserId) filter.targetUserId = q.targetUserId;
    if (q.action) filter.action = q.action;
    if (q.from || q.to) {
      const range: Record<string, string> = {};
      if (q.from) range.$gte = q.from;
      if (q.to) range.$lte = q.to;
      filter.createdAt = range;
    }

    const skip = (q.page - 1) * q.limit;
    const [items, total] = await Promise.all([
      getCollections().adminAuditLog
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(q.limit)
        .toArray(),
      getCollections().adminAuditLog.countDocuments(filter),
    ]);

    return c.json({ items, total, page: q.page, limit: q.limit });
  } catch (err) { return handle(err, c); }
});

export { adminAudit as adminAuditRoutes };
