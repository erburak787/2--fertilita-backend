import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { env } from '../env';
import { getCollections } from '../db/collections';
import { generateId } from '../utils/id';
import { buildOpaqueNotification } from '../utils/notifications';
import type { OpaqueReminderKind } from '../schemas/notification.schema';
import type { AppLocale } from '../config/constants';

let expo: Expo | null = null;
function getExpo(): Expo {
  if (expo) return expo;
  expo = new Expo(env.EXPO_ACCESS_TOKEN ? { accessToken: env.EXPO_ACCESS_TOKEN } : undefined);
  return expo;
}

async function getActiveTokensForUser(userId: string): Promise<string[]> {
  const tokens = await getCollections().pushTokens
    .find({ userId, isActive: true })
    .toArray();
  return tokens.map((t) => t.expoPushToken).filter(Expo.isExpoPushToken);
}

async function getUserLocale(userId: string): Promise<AppLocale | undefined> {
  const settings = await getCollections().userSettings.findOne({ userId });
  return settings?.locale;
}

async function logDelivery(params: {
  userId: string;
  kind: OpaqueReminderKind;
  ticketId?: string;
  status: 'sent' | 'failed';
  error?: string;
  scheduleId?: string;
}) {
  await getCollections().notificationLog.insertOne({
    _id: generateId(),
    userId: params.userId,
    kind: params.kind,
    ticketId: params.ticketId,
    status: params.status,
    error: params.error,
    scheduleId: params.scheduleId,
    sentAt: new Date(),
  });
}

export async function sendOpaqueToUser(
  userId: string,
  kind: OpaqueReminderKind,
  opts: { scheduleId?: string } = {}
): Promise<{ sent: number; failed: number }> {
  const tokens = await getActiveTokensForUser(userId);
  if (tokens.length === 0) return { sent: 0, failed: 0 };

  const locale = await getUserLocale(userId);
  const { title, body } = buildOpaqueNotification(locale, kind);

  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    title,
    body,
    sound: 'default',
    priority: 'high',
    data: { kind },
  }));

  const chunks = getExpo().chunkPushNotifications(messages);
  let sent = 0;
  let failed = 0;

  for (const chunk of chunks) {
    let tickets: ExpoPushTicket[] = [];
    try {
      tickets = await getExpo().sendPushNotificationsAsync(chunk);
    } catch (err: any) {
      failed += chunk.length;
      await logDelivery({
        userId, kind, status: 'failed',
        error: err?.message ?? 'expo_push_send_failed', scheduleId: opts.scheduleId,
      });
      continue;
    }
    for (const ticket of tickets) {
      if (ticket.status === 'ok') {
        sent++;
        await logDelivery({
          userId, kind, status: 'sent',
          ticketId: ticket.id, scheduleId: opts.scheduleId,
        });
      } else {
        failed++;
        await logDelivery({
          userId, kind, status: 'failed',
          error: ticket.message, scheduleId: opts.scheduleId,
        });
        // Deactivate the token if Expo says it's no longer valid.
        if (ticket.details?.error === 'DeviceNotRegistered') {
          const badToken = (chunk[tickets.indexOf(ticket)] as ExpoPushMessage).to;
          const tokenStr = Array.isArray(badToken) ? badToken[0] : badToken;
          if (tokenStr) {
            await getCollections().pushTokens.updateMany(
              { expoPushToken: tokenStr },
              { $set: { isActive: false, updatedAt: new Date().toISOString() } }
            );
          }
        }
      }
    }
  }

  return { sent, failed };
}

// Wishlist expiry reminder push. Deliberately does NOT route through
// buildOpaqueNotification: that helper collapses all `kind`s to a single
// "Time for your reminder." string, but the client wants an explicit
// countdown here. Copy is still fully opaque — no fertility/cycle/health
// references — per Fertilita's post-Dobbs constraint.
function buildAccessEndingBody(locale: AppLocale | undefined, daysLeft: 30 | 15 | 0): string {
  const l: AppLocale = locale ?? 'en';
  if (l === 'de') {
    if (daysLeft === 30) return 'Dein Zugang endet in 30 Tagen.';
    if (daysLeft === 15) return 'Dein Zugang endet in 15 Tagen.';
    return 'Dein Zugang endet heute.';
  }
  if (daysLeft === 30) return 'Your access ends in 30 days.';
  if (daysLeft === 15) return 'Your access ends in 15 days.';
  return 'Your access ends today.';
}

export async function sendWishlistAccessEndingPush(
  userId: string,
  daysLeft: 30 | 15 | 0
): Promise<{ sent: number; failed: number }> {
  const tokens = await getActiveTokensForUser(userId);
  if (tokens.length === 0) return { sent: 0, failed: 0 };

  const locale = await getUserLocale(userId);
  const title = 'Reminder from Fertilita';
  const body = buildAccessEndingBody(locale, daysLeft);
  // Server-side routing tag only; never surfaces in the notification UI.
  const kind: OpaqueReminderKind = 'reminder_generic';

  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    title,
    body,
    sound: 'default',
    priority: 'high',
    data: { kind, reason: 'wishlist_expiry', daysLeft },
  }));

  const chunks = getExpo().chunkPushNotifications(messages);
  let sent = 0;
  let failed = 0;

  for (const chunk of chunks) {
    let tickets: ExpoPushTicket[] = [];
    try {
      tickets = await getExpo().sendPushNotificationsAsync(chunk);
    } catch (err: any) {
      failed += chunk.length;
      await logDelivery({
        userId, kind, status: 'failed',
        error: err?.message ?? 'expo_push_send_failed',
      });
      continue;
    }
    for (const ticket of tickets) {
      if (ticket.status === 'ok') {
        sent++;
        await logDelivery({ userId, kind, status: 'sent', ticketId: ticket.id });
      } else {
        failed++;
        await logDelivery({ userId, kind, status: 'failed', error: ticket.message });
        if (ticket.details?.error === 'DeviceNotRegistered') {
          const badToken = (chunk[tickets.indexOf(ticket)] as ExpoPushMessage).to;
          const tokenStr = Array.isArray(badToken) ? badToken[0] : badToken;
          if (tokenStr) {
            await getCollections().pushTokens.updateMany(
              { expoPushToken: tokenStr },
              { $set: { isActive: false, updatedAt: new Date().toISOString() } }
            );
          }
        }
      }
    }
  }

  return { sent, failed };
}

export async function sendOpaqueBatch(
  userIds: string[],
  kind: OpaqueReminderKind
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const userId of userIds) {
    const r = await sendOpaqueToUser(userId, kind);
    sent += r.sent;
    failed += r.failed;
  }
  return { sent, failed };
}
