import { z } from 'zod';

export const shareScopeSchema = z.enum(['journey', 'calendar', 'journey+calendar']);
export type ShareScope = z.infer<typeof shareScopeSchema>;

// Codes are stored HASHED. The plaintext is shown to the owner exactly once at
// creation. Journal entries are never included in any scope.
export const shareCodeSchema = z.object({
  _id: z.string(),
  ownerId: z.string(),
  codeHash: z.string(),
  scope: shareScopeSchema,
  expiresAt: z.date(),
  redeemedAt: z.date().nullable().optional(),
  redeemedByUserId: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type ShareCode = z.infer<typeof shareCodeSchema>;

export const shareGrantSchema = z.object({
  _id: z.string(),
  ownerId: z.string(),
  partnerId: z.string(),
  scope: shareScopeSchema,
  expiresAt: z.date(),
  revokedAt: z.date().nullable().optional(),
  createdAt: z.string(),
});
export type ShareGrant = z.infer<typeof shareGrantSchema>;

export const createShareInviteSchema = z.object({
  scope: shareScopeSchema,
  expiresInHours: z.number().int().min(24).max(720).default(168),
});

export const redeemShareCodeSchema = z.object({
  code: z.string().min(1).max(32),
});
