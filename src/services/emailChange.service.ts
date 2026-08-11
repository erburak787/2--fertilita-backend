import { getCollections } from '../db/collections';
import { generateId } from '../utils/id';
import { getNow } from '../utils/date';
import { ApiError } from '../utils/errors';
import { signOutAll } from './auth.service';
import {
  sendEmailChangeCode,
  sendEmailChangedNotification,
} from './email.service';
import {
  hashString,
  generateOtpCode,
  generateSessionToken,
  OTP_LIFETIME_MS,
  SESSION_LIFETIME_MS,
  MAX_OTP_ATTEMPTS,
} from '../utils/otp';

// Step 1 — OTP to current email.
export async function requestEmailChange(params: {
  userId: string;
  ip?: string;
}): Promise<void> {
  const collections = getCollections();
  const user = await collections.users.findOne({
    _id: params.userId,
    deletedAt: { $in: [null, undefined] } as any,
  });
  if (!user || !user.email) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_no_email_on_account' });
  }

  // Invalidate any prior unused records — one live change flow per user.
  await collections.emailChangeRequests.updateMany(
    { userId: user._id, usedAt: { $in: [null, undefined] } as any },
    {
      $set: {
        usedAt: getNow(),
        oldEmailCodeHash: null as any,
        newEmailCodeHash: null as any,
        sessionTokenHash: null as any,
      },
    }
  );

  const code = generateOtpCode();
  const now = new Date();

  await collections.emailChangeRequests.insertOne({
    _id: generateId(),
    userId: user._id,
    oldEmail: user.email,
    newEmail: null,
    oldEmailCodeHash: hashString(code),
    oldEmailExpiresAt: new Date(now.getTime() + OTP_LIFETIME_MS),
    oldEmailAttempts: 0,
    oldEmailVerifiedAt: null,
    newEmailCodeHash: null,
    newEmailExpiresAt: null,
    newEmailAttempts: 0,
    sessionTokenHash: null,
    sessionExpiresAt: null,
    createdAt: getNow(),
    usedAt: null,
    requesterIp: params.ip,
  });

  await sendEmailChangeCode({
    to: user.email,
    displayName: user.displayName,
    code,
    locale: user.locale,
    step: 'current',
  });
}

// Step 2 — verify OLD email OTP; issue sessionToken.
export async function verifyCurrentEmailOtp(params: {
  userId: string;
  code: string;
}): Promise<{ sessionToken: string }> {
  const collections = getCollections();

  const record = await collections.emailChangeRequests.findOne(
    {
      userId: params.userId,
      usedAt: { $in: [null, undefined] } as any,
    },
    { sort: { createdAt: -1 } as any },
  );

  if (!record || !record.oldEmailCodeHash) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_code_invalid' });
  }
  if (record.oldEmailExpiresAt.getTime() < Date.now()) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_code_expired' });
  }
  if ((record.oldEmailAttempts ?? 0) >= MAX_OTP_ATTEMPTS) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_code_invalid' });
  }

  if (hashString(params.code) !== record.oldEmailCodeHash) {
    await collections.emailChangeRequests.updateOne(
      { _id: record._id },
      { $inc: { oldEmailAttempts: 1 } as any }
    );
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_code_invalid' });
  }

  const sessionToken = generateSessionToken();
  const now = new Date();
  await collections.emailChangeRequests.updateOne(
    { _id: record._id },
    {
      $set: {
        oldEmailCodeHash: null as any,
        oldEmailVerifiedAt: getNow(),
        sessionTokenHash: hashString(sessionToken),
        sessionExpiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
      },
    }
  );

  return { sessionToken };
}

// Step 3 — user submits NEW email; we send OTP there.
export async function requestNewEmailOtp(params: {
  sessionToken: string;
  newEmail: string;
}): Promise<void> {
  const collections = getCollections();
  const sessionTokenHash = hashString(params.sessionToken);

  const record = await collections.emailChangeRequests.findOne({ sessionTokenHash });
  if (!record || record.usedAt) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_session_invalid' });
  }
  if (!record.sessionExpiresAt || record.sessionExpiresAt.getTime() < Date.now()) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_session_expired' });
  }
  if (params.newEmail === record.oldEmail) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_new_email_same' });
  }

  const existing = await collections.users.findOne({
    email: params.newEmail,
    deletedAt: { $in: [null, undefined] } as any,
  });
  if (existing) {
    throw new ApiError({ code: 'CONFLICT', message: 'auth_email_taken' });
  }

  const code = generateOtpCode();
  const now = new Date();

  await collections.emailChangeRequests.updateOne(
    { _id: record._id },
    {
      $set: {
        newEmail: params.newEmail,
        newEmailCodeHash: hashString(code),
        newEmailExpiresAt: new Date(now.getTime() + OTP_LIFETIME_MS),
        newEmailAttempts: 0,
      },
    }
  );

  // Fetch user for locale/displayName.
  const user = await collections.users.findOne({ _id: record.userId });

  await sendEmailChangeCode({
    to: params.newEmail,
    displayName: user?.displayName,
    code,
    locale: user?.locale,
    step: 'new',
  });
}

// Step 4 — verify NEW email OTP + commit.
export async function confirmEmailChange(params: {
  sessionToken: string;
  code: string;
}): Promise<void> {
  const collections = getCollections();
  const sessionTokenHash = hashString(params.sessionToken);

  const record = await collections.emailChangeRequests.findOne({ sessionTokenHash });
  if (!record || record.usedAt) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_session_invalid' });
  }
  if (!record.sessionExpiresAt || record.sessionExpiresAt.getTime() < Date.now()) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_session_expired' });
  }
  if (!record.newEmail || !record.newEmailCodeHash || !record.newEmailExpiresAt) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_session_invalid' });
  }
  if (record.newEmailExpiresAt.getTime() < Date.now()) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_code_expired' });
  }
  if ((record.newEmailAttempts ?? 0) >= MAX_OTP_ATTEMPTS) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_code_invalid' });
  }

  if (hashString(params.code) !== record.newEmailCodeHash) {
    await collections.emailChangeRequests.updateOne(
      { _id: record._id },
      { $inc: { newEmailAttempts: 1 } as any }
    );
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_code_invalid' });
  }

  // Race-safety: re-check newEmail not taken by a concurrent signup.
  const taken = await collections.users.findOne({
    email: record.newEmail,
    deletedAt: { $in: [null, undefined] } as any,
  });
  if (taken && taken._id !== record.userId) {
    throw new ApiError({ code: 'CONFLICT', message: 'auth_email_taken' });
  }

  const now = getNow();
  await collections.users.updateOne(
    { _id: record.userId },
    { $set: { email: record.newEmail, isEmailVerified: true, updatedAt: now } as any }
  );

  await collections.emailChangeRequests.updateOne(
    { _id: record._id },
    { $set: { usedAt: now, sessionTokenHash: null as any } }
  );

  // Revoke every existing session — user must sign in again with the new
  // email address on every device.
  await signOutAll(record.userId);

  // Notify OLD address that a change happened. Opaque copy — no data leak
  // beyond "your account changed" (see email.service.ts).
  const user = await collections.users.findOne({ _id: record.userId });
  await sendEmailChangedNotification({
    to: record.oldEmail,
    displayName: user?.displayName,
    locale: user?.locale,
  });
}
