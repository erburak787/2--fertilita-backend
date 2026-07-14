import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../config/constants';

export const authProviderSchema = z.enum(['email', 'apple', 'google', 'anonymous']);
export type AuthProvider = z.infer<typeof authProviderSchema>;

// Providers that count as a real linked identity. `anonymous` never appears
// in `linkedProviders` — it's the absence of any linked identity.
export const linkableProviderSchema = z.enum(['email', 'apple', 'google']);
export type LinkableProvider = z.infer<typeof linkableProviderSchema>;

export const userSchema = z.object({
  _id: z.string(),
  email: z.string().email().nullable().optional(),
  passwordHash: z.string().optional(),
  isEmailVerified: z.boolean().default(false),
  displayName: z.string().max(120).optional(),
  avatarUrl: z.string().url().optional(),
  locale: z.enum(SUPPORTED_LOCALES).optional(),

  provider: authProviderSchema,
  linkedProviders: z.array(linkableProviderSchema).default([]),
  appleId: z.string().optional(),
  googleId: z.string().optional(),

  // Anonymous device-auth (mirrors Habit Tracker): every fresh install lands
  // here first via POST /auth/init, then optionally upgrades to email/OAuth
  // via the link/*/ flow so we keep the same _id and all user data.
  isAnonymous: z.boolean().default(false),
  deviceId: z.string().optional(),

  onboardingCompleted: z.boolean().default(false),

  createdAt: z.string(),
  updatedAt: z.string(),
  lastLoginAt: z.string().optional(),
  deletedAt: z.date().nullable().optional(),
});

export type User = z.infer<typeof userSchema>;

export const refreshTokenSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  token: z.string(),
  expiresAt: z.date(),
  createdAt: z.string(),
  revokedAt: z.string().nullable().optional(),
});

export type RefreshToken = z.infer<typeof refreshTokenSchema>;

// ---------- Public DTO (safe to return) ----------

export const userPublicSchema = userSchema.omit({
  passwordHash: true,
  deletedAt: true,
});
export type UserPublic = z.infer<typeof userPublicSchema>;

export function buildUserPublic(u: User): UserPublic {
  const { passwordHash, deletedAt, ...rest } = u;
  return rest;
}

// ---------- Auth inputs ----------

const passwordSchema = z
  .string()
  .min(8, 'auth_password_too_short')
  .max(128, 'auth_password_too_long');

export const signUpEmailSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: passwordSchema,
  displayName: z.string().max(120).optional(),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
});

export const signInEmailSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});

export const oauthSignInSchema = z.object({
  provider: z.enum(['apple', 'google']),
  idToken: z.string().min(10),
  // For Apple, name is only returned on the very first sign-in.
  displayName: z.string().max(120).optional(),
});

export const refreshTokenInputSchema = z.object({
  refreshToken: z.string().min(10),
});

export const updateProfileSchema = z.object({
  displayName: z.string().max(120).optional(),
  avatarUrl: z.string().url().optional(),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
});

export const authResponseSchema = z.object({
  user: userPublicSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});

// ---------- Anonymous init ----------

export const initAnonymousInputSchema = z.object({
  deviceId: z.string().min(8).max(128),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
});
export type InitAnonymousInput = z.infer<typeof initAnonymousInputSchema>;

// ---------- Account linking ----------
// Linking upgrades an anonymous user to a real identity, preserving _id and
// all user data. If the target identity already belongs to a different user,
// the caller decides via `strategy`: 'reject' (default) fails; 'signin' swaps
// the current session to the existing user (client discards the anonymous one).

export const linkEmailInputSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: passwordSchema,
  displayName: z.string().max(120).optional(),
});
export type LinkEmailInput = z.infer<typeof linkEmailInputSchema>;

export const linkOAuthInputSchema = z.object({
  provider: z.enum(['apple', 'google']),
  idToken: z.string().min(10),
  displayName: z.string().max(120).optional(),
});
export type LinkOAuthInput = z.infer<typeof linkOAuthInputSchema>;
