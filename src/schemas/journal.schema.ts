import { z } from 'zod';

// Journal entries sync only when the user explicitly opts in (privacy default).
// The mobile client must send `syncEnabled: true` in the user's settings before
// hitting these endpoints; the route layer enforces it.

const baseJournalSchema = z.object({
  clientId: z.string().min(1).max(64),
  title: z.string().max(200).optional(),
  content: z.string().min(1).max(50_000),
  clientCreatedAt: z.string(),
  clientUpdatedAt: z.string(),
});

export const createJournalEntrySchema = baseJournalSchema;
export const updateJournalEntrySchema = baseJournalSchema.partial().extend({
  clientUpdatedAt: z.string(),
});

export interface JournalEntry {
  _id: string;
  userId: string;
  clientId: string;
  title?: string;
  content: string;
  clientCreatedAt: string;
  clientUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: Date | null;
}
