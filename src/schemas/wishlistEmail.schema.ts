import { z } from 'zod';

// A pre-approved email that may redeem exactly one free year.
// Uploaded by admin (CSV or single entry). Redemption is gated by OTP sent
// to THIS email — prevents code sharing entirely.
export const wishlistEmailSchema = z.object({
  _id: z.string(),
  email: z.string().email().toLowerCase(),
  addedBy: z.string(),               // adminId
  addedAt: z.string(),

  // Set on successful redemption. Once populated, this row is spent.
  redeemedAt: z.string().nullable().optional(),
  redeemedByUserId: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),   // redeemedAt + 365d

  // 30/15/0-day reminders (see wishlist-expiry.worker.ts).
  remindersSent: z
    .object({
      day30: z.boolean().default(false),
      day15: z.boolean().default(false),
      day0: z.boolean().default(false),
    })
    .default({ day30: false, day15: false, day0: false }),
});
export type WishlistEmail = z.infer<typeof wishlistEmailSchema>;

// Admin input --------------------------------------------------------------
export const addWishlistEmailSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
});

export const bulkAddWishlistEmailSchema = z.object({
  emails: z.array(z.string()).min(1).max(5000),
});
