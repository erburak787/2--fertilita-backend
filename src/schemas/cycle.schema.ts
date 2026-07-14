import { z } from 'zod';
import { localDateSchema } from './common.schema';

export const cycleSettingsSchema = z.object({
  averageCycleLength: z.number().int().min(15).max(60).default(28),
  averagePeriodLength: z.number().int().min(1).max(15).default(5),
  lastPeriodStartDate: localDateSchema.nullable(),
  trackingEnabled: z.boolean().default(false),
});

export type CycleSettings = z.infer<typeof cycleSettingsSchema>;

export const updateCycleSettingsSchema = cycleSettingsSchema.partial();
