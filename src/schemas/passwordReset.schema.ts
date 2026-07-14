import { z } from 'zod';

// Stored password-reset record.
//
// Two hashes live on one record so both stages are protected against DB read:
//   • codeHash          — SHA-256 of the 6-digit OTP emailed to the user
//   • sessionTokenHash  — SHA-256 of the opaque token issued after successful
//                          OTP verification. That token is what the mobile
//                          client submits with the new password.
//
// The `attempts` counter guards the OTP against brute-force — after
// MAX_OTP_ATTEMPTS wrong tries the record is invalidated and the user must
// request a new code.
export const passwordResetTokenSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  codeHash: z.string(),
  email: z.string().email(),
  expiresAt: z.date(),
  attempts: z.number().int().nonnegative().default(0),
  sessionTokenHash: z.string().nullable().optional(),
  sessionExpiresAt: z.date().nullable().optional(),
  verifiedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  usedAt: z.string().nullable().optional(),
  requesterIp: z.string().optional(),
});
export type PasswordResetToken = z.infer<typeof passwordResetTokenSchema>;

// Input schemas ------------------------------------------------------------

export const requestPasswordResetSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
});

// User enters the 6-digit code from the email. Codes are numeric strings
// (leading zeros preserved) — never coerce to number.
export const verifyPasswordResetSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  code: z.string().regex(/^\d{6}$/, 'auth_reset_code_invalid'),
});

// The opaque session token replaces the old long reset token as the
// authentication material for the actual password-change step.
export const confirmPasswordResetSchema = z.object({
  sessionToken: z.string().min(32),
  password: z
    .string()
    .min(8, 'auth_password_too_short')
    .max(128, 'auth_password_too_long'),
});
