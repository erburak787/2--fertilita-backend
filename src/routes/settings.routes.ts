import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { protectedRoute } from '../middleware/auth.middleware';
import { ApiError } from '../utils/errors';
import { t } from '../utils/i18n';
import { getCollections } from '../db/collections';
import { generateId } from '../utils/id';
import { getNow } from '../utils/date';
import { updateUserSettingsSchema } from '../schemas/settings.schema';
import { registerPushTokenSchema } from '../schemas/pushToken.schema';
import type { AuthVariables } from '../types/context';

const settings = new Hono<{ Variables: AuthVariables }>();
settings.use('/*', protectedRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[settings]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

settings.get('/', async (c) => {
  try {
    const userId = c.get('userId');
    const doc = await getCollections().userSettings.findOne({ userId });
    return c.json({ settings: doc });
  } catch (err) { return handle(err, c); }
});

settings.put('/', zValidator('json', updateUserSettingsSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = c.req.valid('json');
    const now = getNow();
    const collections = getCollections();

    const setOps: Record<string, unknown> = { updatedAt: now };
    if (body.locale !== undefined) setOps.locale = body.locale;
    if (body.notifications) {
      for (const [k, v] of Object.entries(body.notifications)) {
        setOps[`notifications.${k}`] = v;
      }
    }
    if (body.privacy) {
      for (const [k, v] of Object.entries(body.privacy)) {
        setOps[`privacy.${k}`] = v;
      }
    }

    await collections.userSettings.updateOne(
      { userId },
      {
        $set: setOps,
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
    return c.json({ settings: updated });
  } catch (err) { return handle(err, c); }
});

settings.post('/push-token', zValidator('json', registerPushTokenSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = c.req.valid('json');
    const now = getNow();
    await getCollections().pushTokens.updateOne(
      { userId, expoPushToken: body.expoPushToken },
      {
        $set: {
          platform: body.platform,
          isActive: true,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: generateId(),
          userId,
          expoPushToken: body.expoPushToken,
          createdAt: now,
        },
      },
      { upsert: true }
    );
    return c.json({ success: true });
  } catch (err) { return handle(err, c); }
});

settings.delete('/push-token', zValidator('json', z.object({ expoPushToken: z.string() })), async (c) => {
  try {
    const userId = c.get('userId');
    const body = c.req.valid('json');
    await getCollections().pushTokens.updateOne(
      { userId, expoPushToken: body.expoPushToken },
      { $set: { isActive: false, updatedAt: getNow() } }
    );
    return c.json({ success: true });
  } catch (err) { return handle(err, c); }
});

// Weekly liveness ping from the mobile app so we can distinguish "phone
// off / uninstalled" from "token still valid". Bumps updatedAt only.
settings.post(
  '/push-token/heartbeat',
  zValidator('json', z.object({ expoPushToken: z.string() })),
  async (c) => {
    try {
      const userId = c.get('userId');
      const body = c.req.valid('json');
      await getCollections().pushTokens.updateOne(
        { userId, expoPushToken: body.expoPushToken, isActive: true },
        { $set: { updatedAt: getNow() } }
      );
      return c.json({ success: true });
    } catch (err) { return handle(err, c); }
  }
);

export { settings as settingsRoutes };
