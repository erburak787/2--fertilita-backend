import { getCollections } from '../db/collections';
import { generateId } from '../utils/id';
import { getNow } from '../utils/date';
import { ApiError } from '../utils/errors';
import { sendWishlistRedemptionCode } from './email.service';
import { grantPromotionalEntitlement } from './revenuecat.service';
import {
  hashString,
  generateOtpCode,
  generateSessionToken,
  OTP_LIFETIME_MS,
  SESSION_LIFETIME_MS,
  MAX_OTP_ATTEMPTS,
} from '../utils/otp';

const REDEMPTION_DURATION_DAYS = 365;

// Step 1 — client submits email; server sends OTP if email is on wishlist
// AND not yet redeemed. Always returns success to prevent enumeration.
export async function requestWishlistRedemption(params: {
  email: string;
  ip?: string;
}): Promise<void> {
  const collections = getCollections();
  const wl = await collections.wishlistEmails.findOne({ email: params.email });

  if (!wl) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[wishlist] "${params.email}" is not on the wishlist`);
    }
    return;
  }
  if (wl.redeemedAt) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[wishlist] "${params.email}" already redeemed at ${wl.redeemedAt}`);
    }
    return;
  }

  // Invalidate prior unused OTPs.
  await collections.wishlistRedemptions.updateMany(
    { email: params.email, usedAt: { $in: [null, undefined] } as any },
    {
      $set: {
        usedAt: getNow(),
        codeHash: null as any,
        sessionTokenHash: null as any,
      },
    }
  );

  const code = generateOtpCode();
  const now = new Date();

  await collections.wishlistRedemptions.insertOne({
    _id: generateId(),
    email: params.email,
    codeHash: hashString(code),
    expiresAt: new Date(now.getTime() + OTP_LIFETIME_MS),
    attempts: 0,
    sessionTokenHash: null,
    sessionExpiresAt: null,
    verifiedAt: null,
    createdAt: getNow(),
    usedAt: null,
    requesterIp: params.ip,
  });

  await sendWishlistRedemptionCode({ to: params.email, code });
}

// Step 2 — verify OTP; return sessionToken.
export async function verifyWishlistOtp(params: {
  email: string;
  code: string;
}): Promise<{ sessionToken: string }> {
  const collections = getCollections();

  const record = await collections.wishlistRedemptions.findOne(
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

  if (hashString(params.code) !== record.codeHash) {
    await collections.wishlistRedemptions.updateOne(
      { _id: record._id },
      { $inc: { attempts: 1 } as any }
    );
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_code_invalid' });
  }

  const sessionToken = generateSessionToken();
  const now = new Date();
  await collections.wishlistRedemptions.updateOne(
    { _id: record._id },
    {
      $set: {
        codeHash: null as any,
        sessionTokenHash: hashString(sessionToken),
        sessionExpiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
        verifiedAt: getNow(),
      },
    }
  );

  return { sessionToken };
}

// Step 3 — grant RC promotional entitlement and mark wishlistEmail spent.
export async function confirmWishlistRedemption(params: {
  sessionToken: string;
  userId: string;
}): Promise<{ expiresAt: string }> {
  const collections = getCollections();
  const sessionTokenHash = hashString(params.sessionToken);

  const record = await collections.wishlistRedemptions.findOne({ sessionTokenHash });
  if (!record || record.usedAt) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_session_invalid' });
  }
  if (!record.sessionExpiresAt || record.sessionExpiresAt.getTime() < Date.now()) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'auth_reset_session_expired' });
  }

  const wl = await collections.wishlistEmails.findOne({ email: record.email });
  if (!wl) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'wishlist_email_not_found' });
  }
  if (wl.redeemedAt) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'wishlist_already_redeemed' });
  }

  // Grant promotional entitlement — RC handles the 1-year expiry.
  await grantPromotionalEntitlement({
    appUserId: params.userId,
    entitlementId: 'premium',
    duration: 'yearly',
  });

  const now = getNow();
  const expiresAt = new Date(
    Date.now() + REDEMPTION_DURATION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  await collections.wishlistEmails.updateOne(
    { _id: wl._id, redeemedAt: { $in: [null, undefined] } as any },
    {
      $set: {
        redeemedAt: now,
        redeemedByUserId: params.userId,
        expiresAt,
      },
    }
  );

  await collections.wishlistRedemptions.updateOne(
    { _id: record._id },
    { $set: { usedAt: now, sessionTokenHash: null as any } }
  );

  return { expiresAt };
}
