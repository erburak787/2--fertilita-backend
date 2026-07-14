import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../config/constants';
import { cycleSettingsSchema } from './cycle.schema';

export const notificationSettingsSchema = z.object({
  pushEnabled: z.boolean().default(true),
  medicationReminders: z.boolean().default(true),
  appointmentReminders: z.boolean().default(true),
  cycleReminders: z.boolean().default(true),
  // Opaque-copy enforcement happens server-side; this is just a user toggle.
  quietHoursStart: z.string().optional(),
  quietHoursEnd: z.string().optional(),
});

export const privacySettingsSchema = z.object({
  // Journal entries only sync when this is true. Default OFF.
  journalSyncEnabled: z.boolean().default(false),
  // Allow anonymized usage analytics. Default OFF for GDPR Art. 9 data.
  analyticsEnabled: z.boolean().default(false),
});

export const userSettingsSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  locale: z.enum(SUPPORTED_LOCALES).default('en'),
  cycle: cycleSettingsSchema.optional(),
  notifications: notificationSettingsSchema,
  privacy: privacySettingsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export const updateUserSettingsSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  notifications: notificationSettingsSchema.partial().optional(),
  privacy: privacySettingsSchema.partial().optional(),
});
