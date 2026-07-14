import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ApiError } from '../../utils/errors';
import { t } from '../../utils/i18n';
import { adminJwtRoute } from '../../middleware/admin-jwt.middleware';
import { getCollections } from '../../db/collections';
import type { AdminVariables } from '../../types/context';

// ⚠️ Aggregate counts only. Never expose per-user health data here.
//    Anything that could re-identify a user is out of scope for this surface.

const adminMetrics = new Hono<{ Variables: AdminVariables }>();
adminMetrics.use('/*', adminJwtRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[admin.metrics]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

adminMetrics.get('/', async (c) => {
  try {
    const collections = getCollections();
    const activeFilter = { deletedAt: { $in: [null, undefined] } as any };

    const [
      usersActive,
      usersSoftDeleted,
      attempts,
      events,
      journalEntries,
      knowledgeArticlesPublished,
      pushTokensActive,
      aiRequests,
    ] = await Promise.all([
      collections.users.countDocuments(activeFilter),
      collections.users.countDocuments({ deletedAt: { $ne: null } }),
      collections.attempts.countDocuments(activeFilter),
      collections.events.countDocuments(activeFilter),
      collections.journalEntries.countDocuments(activeFilter),
      collections.knowledgeArticles.countDocuments({ published: true }),
      collections.pushTokens.countDocuments({ isActive: true }),
      collections.aiRequestLogs.estimatedDocumentCount(),
    ]);

    return c.json({
      users: { active: usersActive, softDeleted: usersSoftDeleted },
      attempts,
      events,
      journalEntries,
      knowledgeArticlesPublished,
      pushTokensActive,
      aiRequests,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) { return handle(err, c); }
});

const signupsQuerySchema = z.object({
  range: z.enum(['7', '30', '90']).default('30'),
});

adminMetrics.get('/signups', zValidator('query', signupsQuerySchema), async (c) => {
  try {
    const { range } = c.req.valid('query');
    const days = Number(range);
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));

    // Aggregate signups per UTC day, populating empty buckets so the chart
    // draws without gaps.
    const rows = await getCollections().users
      .aggregate<{ _id: string; count: number }>([
        { $match: { createdAt: { $gte: since.toISOString() } } },
        { $group: { _id: { $substr: ['$createdAt', 0, 10] }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    const map = new Map<string, number>(rows.map((r) => [r._id, r.count]));
    const buckets: Array<{ date: string; count: number }> = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setUTCDate(since.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      buckets.push({ date: key, count: map.get(key) ?? 0 });
    }
    return c.json({ range: days, buckets });
  } catch (err) { return handle(err, c); }
});

const recentSignupsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

adminMetrics.get('/recent-signups', zValidator('query', recentSignupsQuerySchema), async (c) => {
  try {
    const { limit } = c.req.valid('query');
    const items = await getCollections().users
      .find(
        { deletedAt: { $in: [null, undefined] } as any },
        {
          projection: {
            _id: 1,
            email: 1,
            createdAt: 1,
            authProvider: 1,
            locale: 1,
          },
        }
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return c.json({ items });
  } catch (err) { return handle(err, c); }
});

export { adminMetrics as adminMetricsRoutes };
