import { z } from 'zod';

// Every push body routes through buildOpaqueNotification. `kind` is
// server-only metadata; it never leaks into the visible push title/body.
export const opaqueReminderKindSchema = z.enum([
  'reminder_generic',
  'medication_reminder',
  'appointment_reminder',
  'milestone_reminder',
  'journal_reminder',
  'supportive_message',
  'test_ping',
]);
export type OpaqueReminderKind = z.infer<typeof opaqueReminderKindSchema>;

export const notificationStatusSchema = z.enum([
  'queued',
  'sent',
  'delivered',
  'failed',
  'expired',
]);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

export const notificationLogSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  kind: opaqueReminderKindSchema,
  ticketId: z.string().optional(),
  receiptId: z.string().optional(),
  status: notificationStatusSchema,
  error: z.string().optional(),
  scheduleId: z.string().optional(),
  sentAt: z.date(),
  deliveredAt: z.date().optional(),
});
export type NotificationLog = z.infer<typeof notificationLogSchema>;

export const scheduleTypeSchema = z.enum(['oneoff', 'daily', 'weekly', 'weekdays', 'three_times_weekly']);
export type ScheduleType = z.infer<typeof scheduleTypeSchema>;

export const notificationScheduleSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  kind: opaqueReminderKindSchema,
  scheduleType: scheduleTypeSchema,
  timeOfDay: z.string().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  runAt: z.date().optional(),
  lastRunAt: z.date().optional(),
  nextRunAt: z.date(),
  isActive: z.boolean().default(true),
  sourceEventId: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type NotificationSchedule = z.infer<typeof notificationScheduleSchema>;

export const broadcastNotificationSchema = z.object({
  kind: opaqueReminderKindSchema,
  userIds: z.array(z.string()).optional(),
});
