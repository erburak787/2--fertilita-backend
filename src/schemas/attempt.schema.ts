import { z } from 'zod';

// Backend stores the rich nested attempt blob as-is. Source of truth is the
// mobile client (`domain/timeline/types.ts`). We validate identity/timestamps
// strictly and accept the nested medical data as opaque JSON — keeps the API
// surface from churning every time the client adds a treatment-specific field.

export const attemptTypeSchema = z.enum([
  'IVF',
  'ICSI',
  'MiniIVF',
  'DuoStim',
  'FET',
  'IUI',
  'EggDonation',
  'Other',
]);
export type AttemptType = z.infer<typeof attemptTypeSchema>;

export const attemptStatusSchema = z.enum([
  // Legacy
  'in_progress',
  'awaiting_results',
  'negative',
  'positive',
  'chemical',
  'ectopic',
  'miscarriage',
  'ongoing',
  'unknown',
  // Simplified
  'awaiting_result',
  'positive_result',
  'ongoing_pregnancy',
  'no_pregnancy_this_cycle',
  'biochemical_pregnancy',
  'ectopic_pregnancy',
  'pregnancy_loss',
]);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;

const sectionsSchema = z.record(z.string(), z.any());

const attemptSyncSchema = z.object({
  clientId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  treatmentType: attemptTypeSchema,
  clinic: z.string().max(200).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: attemptStatusSchema.optional(),
  sections: sectionsSchema,
  dashboardVisibility: z.enum(['visible', 'hidden']).optional(),
  clientCreatedAt: z.string(),
  clientUpdatedAt: z.string(),
});

export const createAttemptSchema = attemptSyncSchema;
export const updateAttemptSchema = attemptSyncSchema.partial().extend({
  clientUpdatedAt: z.string(),
});

export interface Attempt {
  _id: string;
  userId: string;
  clientId: string;
  title: string;
  treatmentType: AttemptType;
  clinic?: string;
  startDate?: string;
  endDate?: string;
  status?: AttemptStatus;
  sections: Record<string, unknown>;
  dashboardVisibility?: 'visible' | 'hidden';
  clientCreatedAt: string;
  clientUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: Date | null;
}
