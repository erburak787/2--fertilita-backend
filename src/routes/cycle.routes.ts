import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { protectedRoute } from '../middleware/auth.middleware';
import { ApiError } from '../utils/errors';
import { t } from '../utils/i18n';
import { getCollections } from '../db/collections';
import { getNow } from '../utils/date';
import { generateId } from '../utils/id';
import { updateCycleSettingsSchema } from '../schemas/cycle.schema';
import type { AuthVariables } from '../types/context';

const cycle = new Hono<{ Variables: AuthVariables }>();
cycle.use('/*', protectedRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[cycle]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

cycle.get('/', async (c) => {
  try {
    const userId = c.get('userId');
    const settings = await getCollections().userSettings.findOne({ userId });
    return c.json({ cycle: settings?.cycle ?? null });
  } catch (err) { return handle(err, c); }
});

cycle.put('/', zValidator('json', updateCycleSettingsSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = c.req.valid('json');
    const now = getNow();
    const collections = getCollections();

    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      updates[`cycle.${k}`] = v;
    }
    updates.updatedAt = now;

    await collections.userSettings.updateOne(
      { userId },
      {
        $set: updates,
        $setOnInsert: {
          _id: generateId(),
          userId,
          locale: 'en',
          notifications: {
            pushEnabled: true,
            medicationReminders: true,
            appointmentReminders: true,
            cycleReminders: true,
          },
          privacy: { journalSyncEnabled: false, analyticsEnabled: false },
          createdAt: now,
        },
      },
      { upsert: true }
    );

    const updated = await collections.userSettings.findOne({ userId });
    return c.json({ cycle: updated?.cycle ?? null });
  } catch (err) { return handle(err, c); }
});

export { cycle as cycleRoutes };
