import { z } from 'zod';

// Two-step verified email change.
//
// Flow:
//   1. requestEmailChange       → OTP to current email
//   2. verifyCurrentEmailOtp    → sessionToken (OLD address proven)
//   3. requestNewEmailOtp       → OTP to new email  (uses sessionToken)
//   4. confirmEmailChange       → commit new email + revoke sessions
//
// Both OTP hashes and the sessionToken hash live on one record so the DB
// never stores anything the user could re-use if leaked.
export const emailChangeRequestSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  oldEmail: z.string().email(),

  // Filled in step 3.
  newEmail: z.string().email().nullable().optional(),

  // Step 1/2 — proves possession of the OLD address.
  oldEmailCodeHash: z.string().nullable(),
  oldEmailExpiresAt: z.date(),
  oldEmailAttempts: z.number().int().nonnegative().default(0),
  oldEmailVerifiedAt: z.string().nullable().optional(),

  // Step 3/4 — proves possession of the NEW address.
  newEmailCodeHash: z.string().nullable().optional(),
  newEmailExpiresAt: z.date().nullable().optional(),
  newEmailAttempts: z.number().int().nonnegative().default(0),

  // Session token issued after step 2. Client submits it to step 3 + 4.
  sessionTokenHash: z.string().nullable().optional(),
  sessionExpiresAt: z.date().nullable().optional(),

  createdAt: z.string(),
  usedAt: z.string().nullable().optional(),
  requesterIp: z.string().optional(),
});
export type EmailChangeRequest = z.infer<typeof emailChangeRequestSchema>;

// Input schemas ------------------------------------------------------------

export const verifyCurrentEmailOtpSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'auth_reset_code_invalid'),
});

export const requestNewEmailOtpSchema = z.object({
  sessionToken: z.string().min(32),
  newEmail: z.string().email().toLowerCase().trim(),
});

export const confirmEmailChangeSchema = z.object({
  sessionToken: z.string().min(32),
  code: z.string().regex(/^\d{6}$/, 'auth_reset_code_invalid'),
});
