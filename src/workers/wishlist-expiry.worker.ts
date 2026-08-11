import { getCollections } from '../db/collections';
import { sendWishlistReminderEmail } from '../services/email.service';
import { sendWishlistAccessEndingPush } from '../services/push.service';
import type { AppLocale } from '../config/constants';

// Wishlist expiry reminder worker. Users who redeemed the wishlist promo get
// 1 free year of `premium` (see wishlist.service.ts). RevenueCat auto-expires
// the promotional entitlement on the server side; this worker's job is to
// nudge the user 30 / 15 / 0 days out so the expiry isn't a surprise.
//
// Copy is fully opaque per Fertilita's post-Dobbs constraint (see
// utils/notifications.ts) — no fertility / cycle / health references anywhere.
//
// Idempotency: `wishlistEmails.remindersSent.dayN` is flipped to true after
// dispatch, so re-running the worker never double-notifies. The N-day window
// is (now + (N-1)*24h, now + N*24h] so any given expiry falls into exactly
// one bucket per daily run.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const WINDOWS = [
  { days: 30 as const, flagKey: 'remindersSent.day30' as const, flagField: 'day30' as const },
  { days: 15 as const, flagKey: 'remindersSent.day15' as const, flagField: 'day15' as const },
  { days: 0 as const,  flagKey: 'remindersSent.day0'  as const, flagField: 'day0'  as const },
];

async function resolveUserLocale(userId: string | null | undefined): Promise<AppLocale | undefined> {
  if (!userId) return undefined;
  const user = await getCollections().users.findOne({ _id: userId });
  return user?.locale;
}

async function processWindow(daysOut: 30 | 15 | 0): Promise<number> {
  const collections = getCollections();
  const now = Date.now();

  // (N-1)*24h < expiresAt <= N*24h from now. Day-0 special case: everything
  // that expires within the next 24h and hasn't been notified yet.
  const upper = new Date(now + daysOut * MS_PER_DAY).toISOString();
  const lower = daysOut === 0
    ? new Date(now).toISOString()
    : new Date(now + (daysOut - 1) * MS_PER_DAY).toISOString();

  const flagPath = `remindersSent.day${daysOut}`;

  const candidates = await collections.wishlistEmails
    .find({
      redeemedAt: { $ne: null },
      expiresAt: { $gt: lower, $lte: upper },
      [flagPath]: { $ne: true },
    } as any)
    .toArray();

  let dispatched = 0;

  for (const wl of candidates) {
    try {
      const locale = await resolveUserLocale(wl.redeemedByUserId ?? null);

      // Push first (may be a no-op if the user has no active tokens), email
      // always — email is the durable channel and the address is guaranteed
      // to exist since it was the redemption gate.
      if (wl.redeemedByUserId) {
        await sendWishlistAccessEndingPush(wl.redeemedByUserId, daysOut);
      }
      await sendWishlistReminderEmail({ to: wl.email, daysLeft: daysOut, locale });

      await collections.wishlistEmails.updateOne(
        { _id: wl._id },
        { $set: { [flagPath]: true } }
      );
      dispatched++;
    } catch (err) {
      // Leave the flag unset so the next run retries this row. Errors are
      // logged but do not abort the batch — one bad email must not block
      // reminders for other users.
      console.error(
        `[wishlist-expiry] dispatch failed for ${wl.email} (day${daysOut})`,
        err
      );
    }
  }

  return dispatched;
}

export async function runWishlistExpiryReminders(): Promise<{
  sent30: number;
  sent15: number;
  sent0: number;
}> {
  const [sent30, sent15, sent0] = await Promise.all(
    WINDOWS.map((w) => processWindow(w.days))
  ) as [number, number, number];

  console.log(
    `[wishlist-expiry] run complete — sent30=${sent30} sent15=${sent15} sent0=${sent0}`
  );
  return { sent30, sent15, sent0 };
}

// ── Scheduling ────────────────────────────────────────────────────────────
// No cron dependency in package.json, so we piggyback on the same setInterval
// pattern used by notificationScheduler.ts. Ticks once per 24h. First run is
// offset by RUN_OFFSET_MS so a fresh boot doesn't hammer the DB immediately
// alongside index creation + notification scheduler warm-up.
//
// TODO: replace with proper cron scheduler (e.g. BullMQ + Redis or an
// external trigger) once Fertilita runs behind >1 backend instance — the
// setInterval approach would double-dispatch on multi-instance deploys.

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RUN_OFFSET_MS = 60_000;

let interval: ReturnType<typeof setInterval> | null = null;
let firstRunTimer: ReturnType<typeof setTimeout> | null = null;

export function startWishlistExpiryWorker(): void {
  if (interval || firstRunTimer) return;

  firstRunTimer = setTimeout(() => {
    firstRunTimer = null;
    runWishlistExpiryReminders().catch((err) =>
      console.error('[wishlist-expiry] first run failed', err)
    );
    interval = setInterval(() => {
      runWishlistExpiryReminders().catch((err) =>
        console.error('[wishlist-expiry] tick failed', err)
      );
    }, TICK_INTERVAL_MS);
  }, RUN_OFFSET_MS);

  console.log(
    `Wishlist expiry worker started (first run in ${RUN_OFFSET_MS}ms, then every ${TICK_INTERVAL_MS}ms)`
  );
}

export function stopWishlistExpiryWorker(): void {
  if (firstRunTimer) {
    clearTimeout(firstRunTimer);
    firstRunTimer = null;
  }
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
