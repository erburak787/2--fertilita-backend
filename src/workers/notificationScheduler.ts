import { getCollections } from '../db/collections';
import { sendOpaqueToUser } from '../services/push.service';
import { NOTIFICATION_SCHEDULER_POLL_MS } from '../config/constants';
import type { NotificationSchedule } from '../schemas/notification.schema';

// Single-instance polling scheduler. Every tick, pick up rows where
// isActive=true AND nextRunAt <= now, send the push, and either advance
// nextRunAt (for recurring) or deactivate (for oneoff).
//
// If Fertilita ever runs behind a load balancer with >1 backend instance,
// swap this for BullMQ+Redis behind the same push.service interface — no
// route changes needed.

function computeNextRun(sched: NotificationSchedule, from: Date): Date | null {
  switch (sched.scheduleType) {
    case 'oneoff':
      return null;
    case 'daily': {
      const next = new Date(from);
      next.setDate(next.getDate() + 1);
      return next;
    }
    case 'weekly': {
      const next = new Date(from);
      next.setDate(next.getDate() + 7);
      return next;
    }
    case 'weekdays': {
      const next = new Date(from);
      do { next.setDate(next.getDate() + 1); }
      while (next.getDay() === 0 || next.getDay() === 6);
      return next;
    }
    case 'three_times_weekly': {
      // Mon/Wed/Fri if weekdays is unset.
      const target = sched.weekdays?.length ? sched.weekdays : [1, 3, 5];
      const next = new Date(from);
      for (let i = 0; i < 8; i++) {
        next.setDate(next.getDate() + 1);
        if (target.includes(next.getDay())) return next;
      }
      return next;
    }
  }
}

async function tick() {
  const now = new Date();
  const due = await getCollections().notificationSchedule
    .find({ isActive: true, nextRunAt: { $lte: now } })
    .limit(200)
    .toArray();

  for (const sched of due) {
    // Optimistic lock — mark lastRunAt immediately to avoid double-send if
    // the tick overlaps with the next one.
    const claimed = await getCollections().notificationSchedule.findOneAndUpdate(
      { _id: sched._id, lastRunAt: (sched.lastRunAt ?? { $in: [null, undefined] }) as any },
      { $set: { lastRunAt: now } }
    );
    if (!claimed) continue;

    try {
      await sendOpaqueToUser(sched.userId, sched.kind, { scheduleId: sched._id });
    } catch (err) {
      console.error('[scheduler] send failed', sched._id, err);
    }

    const next = computeNextRun(sched, now);
    if (next) {
      await getCollections().notificationSchedule.updateOne(
        { _id: sched._id },
        { $set: { nextRunAt: next, updatedAt: new Date().toISOString() } }
      );
    } else {
      await getCollections().notificationSchedule.updateOne(
        { _id: sched._id },
        { $set: { isActive: false, updatedAt: new Date().toISOString() } }
      );
    }
  }
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startNotificationScheduler(): void {
  if (interval) return;
  interval = setInterval(() => {
    tick().catch((err) => console.error('[scheduler] tick error', err));
  }, NOTIFICATION_SCHEDULER_POLL_MS);
  console.log(`Notification scheduler started (poll ${NOTIFICATION_SCHEDULER_POLL_MS}ms)`);
}

export function stopNotificationScheduler(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
