import { z } from 'zod';

// Ephemeral redemption record — mirrors passwordResetTokens structure.
// One-time OTP + short-lived sessionToken hash. TTL-indexed on
// sessionExpiresAt so expired rows drop out automatically.
export const wishlistRedemptionSchema = z.object({
  _id: z.string(),
  email: z.string().email().toLowerCase(),
  codeHash: z.string().nullable(),
  expiresAt: z.date(),
  attempts: z.number().int().nonnegative().default(0),
  sessionTokenHash: z.string().nullable().optional(),
  sessionExpiresAt: z.date().nullable().optional(),
  verifiedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  usedAt: z.string().nullable().optional(),
  requesterIp: z.string().optional(),
});
export type WishlistRedemption = z.infer<typeof wishlistRedemptionSchema>;

// Input schemas ------------------------------------------------------------
export const requestWishlistRedemptionSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
});

export const verifyWishlistRedemptionSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  code: z.string().regex(/^\d{6}$/, 'auth_reset_code_invalid'),
});

export const confirmWishlistRedemptionSchema = z.object({
  sessionToken: z.string().min(32),
});
