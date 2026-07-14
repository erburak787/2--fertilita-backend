import { z } from 'zod';

export const suggestionCategorySchema = z.enum([
  'feature_request',
  'improvement',
  'bug',
  'other',
]);
export type SuggestionCategory = z.infer<typeof suggestionCategorySchema>;

export const suggestionStatusSchema = z.enum([
  'new',
  'triaged',
  'planned',
  'shipped',
  'wontfix',
]);
export type SuggestionStatus = z.infer<typeof suggestionStatusSchema>;

export const suggestionSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  category: suggestionCategorySchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  status: suggestionStatusSchema.default('new'),
  adminNote: z.string().max(2000).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

export const createSuggestionSchema = z.object({
  category: suggestionCategorySchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
});

export const updateSuggestionSchema = z.object({
  status: suggestionStatusSchema,
  adminNote: z.string().max(2000).optional(),
});

export const listSuggestionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  status: suggestionStatusSchema.optional(),
});
