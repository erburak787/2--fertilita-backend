import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ApiError } from '../../utils/errors';
import { t } from '../../utils/i18n';
import { adminJwtRoute, requireRole } from '../../middleware/admin-jwt.middleware';
import { getCollections } from '../../db/collections';
import { getNow } from '../../utils/date';
import { objectIdSchema } from '../../schemas/common.schema';
import {
  listSuggestionsQuerySchema,
  updateSuggestionSchema,
} from '../../schemas/suggestion.schema';
import { writeAudit } from '../../services/admin-user.service';
import type { AdminVariables } from '../../types/context';

const adminSuggestions = new Hono<{ Variables: AdminVariables }>();
adminSuggestions.use('/*', adminJwtRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[admin.suggestions]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

adminSuggestions.get('/', zValidator('query', listSuggestionsQuerySchema), async (c) => {
  try {
    const q = c.req.valid('query');
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    const skip = (q.page - 1) * q.limit;
    const [items, total] = await Promise.all([
      getCollections().suggestions
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(q.limit)
        .toArray(),
      getCollections().suggestions.countDocuments(filter),
    ]);
    return c.json({ items, total, page: q.page, limit: q.limit });
  } catch (err) { return handle(err, c); }
});

adminSuggestions.put(
  '/:id',
  requireRole('super_admin', 'admin'),
  zValidator('param', z.object({ id: objectIdSchema })),
  zValidator('json', updateSuggestionSchema),
  async (c) => {
    try {
      const admin = c.get('admin');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const result = await getCollections().suggestions.findOneAndUpdate(
        { _id: id },
        { $set: { ...body, updatedAt: getNow() } },
        { returnDocument: 'after' }
      );
      if (!result) throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });
      await writeAudit(admin._id, admin.email, 'suggestion_updated', null, {
        suggestionId: id,
        status: body.status,
      });
      return c.json({ suggestion: result });
    } catch (err) { return handle(err, c); }
  }
);

export { adminSuggestions as adminSuggestionsRoutes };
