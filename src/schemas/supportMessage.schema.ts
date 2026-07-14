import { z } from 'zod';

// Mirrors the 8 mobile-side supportive-message categories.
export const supportCategorySchema = z.enum([
  'general',
  'before_treatment',
  'during_stimulation',
  'before_retrieval',
  'before_transfer',
  'two_week_wait',
  'waiting_results',
  'after_difficult',
]);
export type SupportCategory = z.infer<typeof supportCategorySchema>;

export const supportPhaseSchema = z.enum([
  'stimulation',
  'trigger',
  'retrieval',
  'embryo_development',
  'transfer',
  'two_week_wait',
  'outcome',
]);
export type SupportPhase = z.infer<typeof supportPhaseSchema>;

export const supportMessageSchema = z.object({
  _id: z.string(),
  category: supportCategorySchema,
  phase: supportPhaseSchema.optional(),
  i18n: z.object({
    en: z.string().min(1).max(500),
    de: z.string().min(1).max(500).optional(),
  }),
  weight: z.number().int().min(1).max(100).default(10),
  isActive: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SupportMessage = z.infer<typeof supportMessageSchema>;

export const listSupportMessagesQuerySchema = z.object({
  category: supportCategorySchema.optional(),
  phase: supportPhaseSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
