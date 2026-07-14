import { z } from 'zod';

// Stubbed endpoints — return 501 NOT_IMPLEMENTED until a real LLM is wired in.
// Schemas defined day 1 so the mobile client integration is trivial later.

export const reflectionInputSchema = z.object({
  prompt: z.string().min(1).max(2000),
  attemptId: z.string().optional(),
  mood: z.enum(['low', 'neutral', 'hopeful', 'anxious']).optional(),
});

export const reflectionResponseSchema = z.object({
  text: z.string(),
  generatedAt: z.string(),
});

export const affirmationQuerySchema = z.object({
  context: z.enum(['general', 'pre_transfer', 'post_transfer', 'two_week_wait', 'loss']).optional(),
});

export const affirmationResponseSchema = z.object({
  text: z.string(),
  generatedAt: z.string(),
});

export interface AiRequestLog {
  _id: string;
  userId: string;
  endpoint: 'reflect' | 'affirmation';
  status: 'stub' | 'ok' | 'failed';
  createdAt: string;
}
