import { createHash, randomBytes, randomInt } from 'crypto';
import { getCollections } from '../db/collections';
import { generateId } from '../utils/id';
import { getNow } from '../utils/date';
import { hashPassword, validatePasswordStrength } from '../utils/password';
import { ApiError } from '../utils/errors';
import { signOutAll } from './auth.service';
import { sendPasswordResetEmail } from './email.service';

// OTP lifetime — short by design. Users can always request a new code.
const OTP_LIFETIME_MS = 15 * 60 * 1000; // 15 minutes
// Session token issued after successful OTP verify — even shorter, because
// by this point the user is on the "choose a new password" screen already.
const SESSION_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TOKEN_BYTES = 32; // 256 bits — 64-char hex

// After MAX_OTP_ATTEMPTS wrong entries the code is dead. Prevents an
// attacker who learns a valid email from brute-forcing the 1-in-1M code.
const MAX_OTP_ATTEMPTS = 5;

function hashString(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

// 6-digit numeric code, uniformly distributed. Leading zeros preserved.
function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

// Public API ---------------------------------------------------------------

// ⚠️  Do NOT reveal whether the email exists. The endpoint always returns
// success to prevent user enumeration. Only send the email if the account
// exists and is not soft-deleted.
export async function requestPasswordReset(params: {
  email: string;
  ip?: string;
}): Promise<void> {
  const collections = getCollections();
  const user = await collections.users.findOne({
    email: params.email,
    deletedAt: { $in: [null, undefined] } as any,
  });

  if (!user || !user.passwordHash) {
    // OAuth-only accounts have no passwordHash → nothing to reset. Return
    // success anyway; do not leak the account state.
    return;
  }

  // Invalidate any prior unused records for this user — one live OTP at a
  // time. Also clears any half-verified sessionTokenHash so it can't be
  // reused after the user re-requests.
  await collections.passwordResetTokens.updateMany(
    { userId: user._id, usedAt: { $in: [null, undefined] } as any },
    {
      $set: {
        usedAt: getNow(),
        codeHash: null as any,
        sessionTokenHash: null as any,
      },
    }
  );

  const code = generateOtpCode();
  const codeHash = hashString(code);
  const now = new Date();

  await collections.passwordResetTokens.insertOne({
    _id: generateId(),
    userId: user._id,
    codeHash,
    email: user.email ?? params.email,
    expiresAt: new Date(now.getTime() + OTP_LIFETIME_MS),
    attempts: 0,
    sessionTokenHash: null,
    sessionExpiresAt: null,
    verifiedAt: null,
    createdAt: getNow(),
    usedAt: null,
    requesterIp: params.ip,
  });

  await sendPasswordResetEmail({
    to: user.email ?? params.email,
    displayName: user.displayName,
    code,
    locale: user.locale,
  });
}

// Verifies the OTP for the given email and, on success, issues an opaque
// session token that the client will submit to /confirm along with the new
// password. The session token is single-use and short-lived.
export async function verifyPasswordResetOtp(params: {
  email: string;
  code: string;
}): Promise<{ sessionToken: string }> {
  const collections = getCollections();

  // Look up the most recent unused record for this email. We deliberately
  // don't fail-fast on "no such record" vs "wrong code" — both return the
  // same error to preserve enumeration protection.
  const record = await collections.passwordResetTokens.findOne(
    {
      email: params.email,
      usedAt: { $in: [null, undefined] } as any,
    },
    { sort: { createdAt: -1 } as any },
  );

  if (!record || !record.codeHash) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_code_invalid' });
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_code_expired' });
  }
  if ((record.attempts ?? 0) >= MAX_OTP_ATTEMPTS) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_code_invalid' });
  }

  const codeHash = hashString(params.code);
  if (codeHash !== record.codeHash) {
    await collections.passwordResetTokens.updateOne(
      { _id: record._id },
      { $inc: { attempts: 1 } as any }
    );
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_code_invalid' });
  }

  // Success — swap the code hash for a fresh session-token hash. The code
  // itself is now dead. The session token is what /confirm expects.
  const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString('hex');
  const sessionTokenHash = hashString(sessionToken);
  const now = new Date();
  await collections.passwordResetTokens.updateOne(
    { _id: record._id },
    {
      $set: {
        codeHash: null as any,
        sessionTokenHash,
        sessionExpiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
        verifiedAt: getNow(),
      },
    }
  );

  return { sessionToken };
}

export async function confirmPasswordReset(params: {
  sessionToken: string;
  password: string;
}): Promise<void> {
  const strength = validatePasswordStrength(params.password);
  if (!strength.ok) {
    throw new ApiError({ code: 'BAD_REQUEST', message: strength.reason });
  }

  const collections = getCollections();
  const sessionTokenHash = hashString(params.sessionToken);

  const record = await collections.passwordResetTokens.findOne({ sessionTokenHash });
  if (!record || record.usedAt) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_session_invalid' });
  }
  if (!record.sessionExpiresAt || record.sessionExpiresAt.getTime() < Date.now()) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_session_expired' });
  }

  const user = await collections.users.findOne({
    _id: record.userId,
    deletedAt: { $in: [null, undefined] } as any,
  });
  if (!user) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_session_invalid' });
  }

  const now = getNow();
  await collections.users.updateOne(
    { _id: user._id },
    { $set: { passwordHash: await hashPassword(params.password), updatedAt: now } }
  );

  // Single-use session — mark spent so a stolen sessionToken can't be
  // replayed even within its 5-minute window.
  await collections.passwordResetTokens.updateOne(
    { _id: record._id },
    { $set: { usedAt: now, sessionTokenHash: null as any } }
  );

  // Invalidate all existing sessions — anyone still holding an old refresh
  // token after a password reset should be forced to re-authenticate.
  await signOutAll(user._id);
}
