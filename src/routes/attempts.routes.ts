import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { protectedRoute } from '../middleware/auth.middleware';
import { ApiError } from '../utils/errors';
import { t } from '../utils/i18n';
import { getCollections } from '../db/collections';
import { generateId } from '../utils/id';
import { getNow } from '../utils/date';
import { objectIdSchema, paginationSchema } from '../schemas/common.schema';
import { createAttemptSchema, updateAttemptSchema, type Attempt } from '../schemas/attempt.schema';
import { MAX_ATTEMPTS_PER_USER } from '../config/constants';
import type { AuthVariables } from '../types/context';

const attempts = new Hono<{ Variables: AuthVariables }>();
attempts.use('/*', protectedRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[attempts]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

attempts.get('/', zValidator('query', paginationSchema), async (c) => {
  try {
    const { page, limit } = c.req.valid('query');
    const userId = c.get('userId');
    const collections = getCollections();
    const filter = { userId, deletedAt: { $in: [null, undefined] } as any };
    const [items, total] = await Promise.all([
      collections.attempts
        .find(filter)
        .sort({ startDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      collections.attempts.countDocuments(filter),
    ]);
    return c.json({ items, total, page, limit });
  } catch (err) { return handle(err, c); }
});

attempts.post('/', zValidator('json', createAttemptSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = c.req.valid('json');
    const collections = getCollections();

    const existing = await collections.attempts.findOne({ userId, clientId: body.clientId });
    if (existing) {
      return c.json({ attempt: existing, idempotent: true });
    }

    const count = await collections.attempts.countDocuments({ userId, deletedAt: { $in: [null, undefined] } as any });
    if (count >= MAX_ATTEMPTS_PER_USER) {
      throw new ApiError({ code: 'UNPROCESSABLE_ENTITY', message: 'attempt_limit_reached' });
    }

    const now = getNow();
    const doc: Attempt = {
      _id: generateId(),
      userId,
      ...body,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await collections.attempts.insertOne(doc);
    return c.json({ attempt: doc }, 201);
  } catch (err) { return handle(err, c); }
});

attempts.get('/:id', zValidator('param', z.object({ id: objectIdSchema })), async (c) => {
  try {
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const doc = await getCollections().attempts.findOne({
      _id: id,
      userId,
      deletedAt: { $in: [null, undefined] } as any,
    });
    if (!doc) throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });
    return c.json({ attempt: doc });
  } catch (err) { return handle(err, c); }
});

attempts.put(
  '/:id',
  zValidator('param', z.object({ id: objectIdSchema })),
  zValidator('json', updateAttemptSchema),
  async (c) => {
    try {
      const userId = c.get('userId');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const now = getNow();
      const result = await getCollections().attempts.findOneAndUpdate(
        { _id: id, userId, deletedAt: { $in: [null, undefined] } as any },
        { $set: { ...body, updatedAt: now } },
        { returnDocument: 'after' }
      );
      if (!result) throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });
      return c.json({ attempt: result });
    } catch (err) { return handle(err, c); }
  }
);

attempts.delete('/:id', zValidator('param', z.object({ id: objectIdSchema })), async (c) => {
  try {
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const result = await getCollections().attempts.updateOne(
      { _id: id, userId, deletedAt: { $in: [null, undefined] } as any },
      { $set: { deletedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });
    }
    return c.json({ success: true });
  } catch (err) { return handle(err, c); }
});

export { attempts as attemptsRoutes };
