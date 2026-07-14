import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function validatePasswordStrength(password: string): { ok: true } | { ok: false; reason: string } {
  if (password.length < 8) return { ok: false, reason: 'password_too_short' };
  if (password.length > 128) return { ok: false, reason: 'password_too_long' };
  if (!/[a-z]/.test(password)) return { ok: false, reason: 'password_needs_lowercase' };
  if (!/[A-Z]/.test(password)) return { ok: false, reason: 'password_needs_uppercase' };
  if (!/\d/.test(password)) return { ok: false, reason: 'password_needs_digit' };
  return { ok: true };
}
