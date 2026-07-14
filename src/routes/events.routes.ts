import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { protectedRoute } from '../middleware/auth.middleware';
import { ApiError } from '../utils/errors';
import { t } from '../utils/i18n';
import { getCollections } from '../db/collections';
import { generateId } from '../utils/id';
import { getNow } from '../utils/date';
import { objectIdSchema, localDateSchema } from '../schemas/common.schema';
import {
  createEventSchema,
  updateEventSchema,
  eventCategorySchema,
  eventSourceSchema,
  type AppEventDoc,
} from '../schemas/event.schema';
import type { OpaqueReminderKind } from '../schemas/notification.schema';
import type { AuthVariables } from '../types/context';

const REMINDER_CATEGORIES = new Set(['medication', 'appointment']);

function kindForCategory(category: string): OpaqueReminderKind {
  if (category === 'medication') return 'medication_reminder';
  if (category === 'appointment') return 'appointment_reminder';
  return 'reminder_generic';
}

function parseRunAt(date: string, time?: string | null): Date | null {
  const hhmm = time && /^\d{2}:\d{2}$/.test(time) ? time : '09:00';
  const iso = `${date}T${hhmm}:00`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

async function reconcileReminderSchedule(userId: string, ev: AppEventDoc): Promise<void> {
  const collections = getCollections();
  const wants =
    ev.reminderEnabled &&
    REMINDER_CATEGORIES.has(ev.category) &&
    !ev.completed &&
    !ev.deletedAt;

  const existing = await collections.notificationSchedule.findOne({ sourceEventId: ev._id });

  if (!wants) {
    if (existing?.isActive) {
      await collections.notificationSchedule.updateOne(
        { _id: existing._id },
        { $set: { isActive: false, updatedAt: new Date().toISOString() } }
      );
    }
    return;
  }

  const runAt = parseRunAt(ev.date, ev.reminderTime ?? ev.time);
  if (!runAt) return;
  const nowIso = new Date().toISOString();

  if (existing) {
    await collections.notificationSchedule.updateOne(
      { _id: existing._id },
      {
        $set: {
          kind: kindForCategory(ev.category),
          scheduleType: 'oneoff',
          runAt,
          nextRunAt: runAt,
          isActive: true,
          updatedAt: nowIso,
        },
      }
    );
    return;
  }

  await collections.notificationSchedule.insertOne({
    _id: generateId(),
    userId,
    kind: kindForCategory(ev.category),
    scheduleType: 'oneoff',
    runAt,
    nextRunAt: runAt,
    isActive: true,
    sourceEventId: ev._id,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

const events = new Hono<{ Variables: AuthVariables }>();
events.use('/*', protectedRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[events]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

const listQuerySchema = z.object({
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  attemptId: z.string().optional(),
  source: eventSourceSchema.optional(),
  category: eventCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

events.get('/', zValidator('query', listQuerySchema), async (c) => {
  try {
    const q = c.req.valid('query');
    const userId = c.get('userId');
    const filter: Record<string, unknown> = {
      userId,
      deletedAt: { $in: [null, undefined] } as any,
    };
    if (q.attemptId) filter.attemptId = q.attemptId;
    if (q.source) filter.source = q.source;
    if (q.category) filter.category = q.category;
    if (q.from || q.to) {
      const date: Record<string, string> = {};
      if (q.from) date.$gte = q.from;
      if (q.to) date.$lte = q.to;
      filter.date = date;
    }
    const items = await getCollections().events
      .find(filter)
      .sort({ date: 1, time: 1 })
      .limit(q.limit)
      .toArray();
    return c.json({ items });
  } catch (err) { return handle(err, c); }
});

events.post('/', zValidator('json', createEventSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = c.req.valid('json');
    const collections = getCollections();

    const existing = await collections.events.findOne({ userId, clientId: body.clientId });
    if (existing) return c.json({ event: existing, idempotent: true });

    const now = getNow();
    const doc: AppEventDoc = {
      _id: generateId(),
      userId,
      ...body,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await collections.events.insertOne(doc);
    await reconcileReminderSchedule(userId, doc);
    return c.json({ event: doc }, 201);
  } catch (err) { return handle(err, c); }
});

events.put(
  '/:id',
  zValidator('param', z.object({ id: objectIdSchema })),
  zValidator('json', updateEventSchema),
  async (c) => {
    try {
      const userId = c.get('userId');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const result = await getCollections().events.findOneAndUpdate(
        { _id: id, userId, deletedAt: { $in: [null, undefined] } as any },
        { $set: { ...body, updatedAt: getNow() } },
        { returnDocument: 'after' }
      );
      if (!result) throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });
      await reconcileReminderSchedule(userId, result as AppEventDoc);
      return c.json({ event: result });
    } catch (err) { return handle(err, c); }
  }
);

events.delete('/:id', zValidator('param', z.object({ id: objectIdSchema })), async (c) => {
  try {
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const result = await getCollections().events.updateOne(
      { _id: id, userId, deletedAt: { $in: [null, undefined] } as any },
      { $set: { deletedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });
    }
    await getCollections().notificationSchedule.updateOne(
      { sourceEventId: id, isActive: true },
      { $set: { isActive: false, updatedAt: new Date().toISOString() } }
    );
    return c.json({ success: true });
  } catch (err) { return handle(err, c); }
});

export { events as eventsRoutes };
