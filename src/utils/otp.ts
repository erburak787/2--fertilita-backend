import { createHash, randomBytes, randomInt } from 'crypto';

export const OTP_LIFETIME_MS = 15 * 60 * 1000;
export const SESSION_LIFETIME_MS = 5 * 60 * 1000;
export const SESSION_TOKEN_BYTES = 32;
export const MAX_OTP_ATTEMPTS = 5;

export function hashString(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('hex');
}
