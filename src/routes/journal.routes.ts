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
import {
  createJournalEntrySchema,
  updateJournalEntrySchema,
  type JournalEntry,
} from '../schemas/journal.schema';
import type { AuthVariables } from '../types/context';

const journal = new Hono<{ Variables: AuthVariables }>();
journal.use('/*', protectedRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[journal]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

// ⚠️ Privacy gate: journal data only syncs if the user has explicitly opted in
//    via `privacy.journalSyncEnabled`. Default is OFF.
async function requireJournalSyncEnabled(userId: string) {
  const settings = await getCollections().userSettings.findOne({ userId });
  if (!settings?.privacy?.journalSyncEnabled) {
    throw new ApiError({ code: 'FORBIDDEN', message: 'journal_sync_disabled' });
  }
}

journal.get('/', zValidator('query', paginationSchema), async (c) => {
  try {
    const userId = c.get('userId');
    await requireJournalSyncEnabled(userId);
    const { page, limit } = c.req.valid('query');
    const filter = { userId, deletedAt: { $in: [null, undefined] } as any };
    const [items, total] = await Promise.all([
      getCollections().journalEntries
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      getCollections().journalEntries.countDocuments(filter),
    ]);
    return c.json({ items, total, page, limit });
  } catch (err) { return handle(err, c); }
});

journal.post('/', zValidator('json', createJournalEntrySchema), async (c) => {
  try {
    const userId = c.get('userId');
    await requireJournalSyncEnabled(userId);
    const body = c.req.valid('json');
    const collections = getCollections();

    const existing = await collections.journalEntries.findOne({ userId, clientId: body.clientId });
    if (existing) return c.json({ entry: existing, idempotent: true });

    const now = getNow();
    const doc: JournalEntry = {
      _id: generateId(),
      userId,
      ...body,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await collections.journalEntries.insertOne(doc);
    return c.json({ entry: doc }, 201);
  } catch (err) { return handle(err, c); }
});

journal.put(
  '/:id',
  zValidator('param', z.object({ id: objectIdSchema })),
  zValidator('json', updateJournalEntrySchema),
  async (c) => {
    try {
      const userId = c.get('userId');
      await requireJournalSyncEnabled(userId);
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const result = await getCollections().journalEntries.findOneAndUpdate(
        { _id: id, userId, deletedAt: { $in: [null, undefined] } as any },
        { $set: { ...body, updatedAt: getNow() } },
        { returnDocument: 'after' }
      );
      if (!result) throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });
      return c.json({ entry: result });
    } catch (err) { return handle(err, c); }
  }
);

journal.delete('/:id', zValidator('param', z.object({ id: objectIdSchema })), async (c) => {
  try {
    const userId = c.get('userId');
    await requireJournalSyncEnabled(userId);
    const { id } = c.req.valid('param');
    const result = await getCollections().journalEntries.updateOne(
      { _id: id, userId, deletedAt: { $in: [null, undefined] } as any },
      { $set: { deletedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });
    }
    return c.json({ success: true });
  } catch (err) { return handle(err, c); }
});

export { journal as journalRoutes };
