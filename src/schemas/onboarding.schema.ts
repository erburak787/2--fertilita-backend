import { z } from 'zod';

// Mirrors the mobile app's OnboardingProvider fields. The mobile currently persists
// these only to AsyncStorage; this collection is the server-side source of truth
// so answers survive reinstalls and device changes.

export const ageRangeSchema = z.enum(['18-24', '25-29', '30-34', '35-37', '38-40', '41+']);
export const treatmentContextSchema = z.enum([
  'preparing',
  'in_treatment',
  'between_attempts',
  'considering',
  'not_sure',
]);
export const moodLevelSchema = z.number().int().min(1).max(5);

export const onboardingAnswersSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  ageRange: ageRangeSchema.optional(),
  treatmentContext: treatmentContextSchema.optional(),
  moodLevel: moodLevelSchema.optional(),
  allowReflections: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;

export const saveOnboardingAnswersInputSchema = z.object({
  ageRange: ageRangeSchema.optional(),
  treatmentContext: treatmentContextSchema.optional(),
  moodLevel: moodLevelSchema.optional(),
  allowReflections: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
});

export type SaveOnboardingAnswersInput = z.infer<typeof saveOnboardingAnswersInputSchema>;
