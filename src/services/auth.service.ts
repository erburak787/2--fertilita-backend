import { getCollections } from '../db/collections';
import { generateId, generateOpaqueToken } from '../utils/id';
import { getNow } from '../utils/date';
import {
  generateAccessToken,
  generateRefreshToken,
  getAccessTokenExpiresIn,
  getRefreshTokenExpirationDate,
  verifyRefreshToken,
} from '../utils/jwt';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../utils/password';
import { ApiError } from '../utils/errors';
import { verifyOAuthToken, OAuthError } from './oauth.service';
import { buildUserPublic, type User, type AuthProvider, type LinkableProvider, type UserPublic } from '../schemas/user.schema';
import type { AppLocale } from '../config/constants';

interface AuthResult {
  user: UserPublic;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

async function issueTokens(user: User): Promise<AuthResult> {
  const collections = getCollections();
  const jti = generateOpaqueToken();
  const accessToken = generateAccessToken({ sub: user._id, email: user.email ?? undefined });
  const refreshToken = generateRefreshToken(user._id, jti);

  await collections.refreshTokens.insertOne({
    _id: generateId(),
    userId: user._id,
    token: jti,
    expiresAt: getRefreshTokenExpirationDate(),
    createdAt: getNow(),
    revokedAt: null,
  });

  return {
    user: buildUserPublic(user),
    accessToken,
    refreshToken,
    expiresIn: getAccessTokenExpiresIn(),
  };
}

async function bootstrapUserSettings(userId: string, locale: AppLocale | undefined) {
  const collections = getCollections();
  const now = getNow();
  await collections.userSettings.updateOne(
    { userId },
    {
      $setOnInsert: {
        _id: generateId(),
        userId,
        locale: locale ?? 'en',
        notifications: {
          pushEnabled: true,
          medicationReminders: true,
          appointmentReminders: true,
          cycleReminders: true,
        },
        privacy: {
          journalSyncEnabled: false,
          analyticsEnabled: false,
        },
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}

// ---------- Anonymous device auth ----------
// First app-launch flow: create (or restore) a device-bound anonymous user
// so onboarding answers, cycle data, events etc. always land on a real
// backend row. Later, /link/email or /link/oauth upgrades the same _id into
// a full account without any data migration.

export async function initAnonymousUser(params: {
  deviceId: string;
  locale?: AppLocale;
}): Promise<AuthResult & { isNewUser: boolean }> {
  const collections = getCollections();
  const now = getNow();

  // Returning device? Reuse the row. deletedAt filter matters: if the user
  // deleted their account, /init on the same device should create a fresh
  // one, not resurrect the tombstone.
  let user = await collections.users.findOne({
    deviceId: params.deviceId,
    deletedAt: { $in: [null, undefined] } as any,
  });
  let isNewUser = false;

  if (user) {
    await collections.users.updateOne(
      { _id: user._id },
      { $set: { lastLoginAt: now, updatedAt: now } },
    );
    user = { ...user, lastLoginAt: now, updatedAt: now };
  } else {
    const newUser: User = {
      _id: generateId(),
      email: null,
      isEmailVerified: false,
      locale: params.locale,
      provider: 'anonymous',
      linkedProviders: [],
      isAnonymous: true,
      deviceId: params.deviceId,
      onboardingCompleted: false,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };

    try {
      await collections.users.insertOne(newUser);
      user = newUser;
      isNewUser = true;
    } catch (err: any) {
      // Race: two /init calls for the same deviceId at the same time. The
      // unique sparse index rejects the second insert with E11000; refetch
      // the winner instead of failing the client.
      if (err?.code === 11000) {
        const existing = await collections.users.findOne({ deviceId: params.deviceId });
        if (!existing) throw err;
        user = existing;
      } else {
        throw err;
      }
    }

    if (isNewUser) {
      await bootstrapUserSettings(user._id, params.locale);
    }
  }

  const tokens = await issueTokens(user);
  return { ...tokens, isNewUser };
}

// ---------- Email auth ----------

export async function signUpWithEmail(params: {
  email: string;
  password: string;
  displayName?: string;
  locale?: AppLocale;
  // When the request already has a valid anonymous session, upgrade that
  // user in place instead of creating a fresh row. Passed by the route
  // layer after verifying the Bearer token belongs to an anonymous user.
  anonymousUserId?: string;
}): Promise<AuthResult> {
  const strength = validatePasswordStrength(params.password);
  if (!strength.ok) {
    throw new ApiError({ code: 'BAD_REQUEST', message: strength.reason });
  }

  const collections = getCollections();

  if (params.anonymousUserId) {
    return linkAnonymousToEmail({
      userId: params.anonymousUserId,
      email: params.email,
      password: params.password,
      displayName: params.displayName,
      locale: params.locale,
    });
  }

  const existing = await collections.users.findOne({ email: params.email });
  if (existing) {
    throw new ApiError({ code: 'CONFLICT', message: 'auth_email_in_use' });
  }

  const now = getNow();
  const user: User = {
    _id: generateId(),
    email: params.email,
    passwordHash: await hashPassword(params.password),
    isEmailVerified: false,
    displayName: params.displayName,
    locale: params.locale,
    provider: 'email',
    linkedProviders: ['email'],
    isAnonymous: false,
    onboardingCompleted: false,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };

  await collections.users.insertOne(user);
  await bootstrapUserSettings(user._id, params.locale);

  return issueTokens(user);
}

export async function signInWithEmail(params: {
  email: string;
  password: string;
  // When the request already has a valid anonymous Bearer, we merge that
  // anonymous user's child data into the authenticated account (best-effort)
  // so the trial-testing user doesn't lose journal / events / cycle history
  // when they sign in to an existing account.
  anonymousUserId?: string;
}): Promise<AuthResult> {
  const collections = getCollections();
  const user = await collections.users.findOne({
    email: params.email,
    deletedAt: { $in: [null, undefined] } as any,
  });
  if (!user || !user.passwordHash) {
    throw new ApiError({ code: 'UNAUTHORIZED', message: 'auth_invalid_credentials' });
  }
  const valid = await verifyPassword(params.password, user.passwordHash);
  if (!valid) {
    throw new ApiError({ code: 'UNAUTHORIZED', message: 'auth_invalid_credentials' });
  }

  const now = getNow();
  await collections.users.updateOne(
    { _id: user._id },
    { $set: { lastLoginAt: now, updatedAt: now } }
  );

  // Merge is best-effort — never fail sign-in because of a data migration
  // issue. On failure the anonymous row is left alone (still reachable via
  // deviceId on next /init) so nothing is lost.
  if (params.anonymousUserId && params.anonymousUserId !== user._id) {
    try {
      await mergeAnonymousUserInto(params.anonymousUserId, user._id);
    } catch (err) {
      console.error('[auth] anonymous merge on sign-in failed', err);
    }
  }

  return issueTokens({ ...user, lastLoginAt: now });
}

// ---------- Anonymous data merge (sign-in path) ----------
// Called when a user with an active anonymous session signs in to a
// pre-existing account. Reassigns child rows from the anonymous userId to
// the target userId, then soft-deletes the anonymous user. Target-wins on
// singleton rows (userSettings, onboardingAnswers) because the real account
// is the authoritative source; the anonymous row was scratch data on this
// device.
async function mergeAnonymousUserInto(
  anonymousUserId: string,
  targetUserId: string,
): Promise<void> {
  const collections = getCollections();
  const now = getNow();

  const anon = await collections.users.findOne({
    _id: anonymousUserId,
    deletedAt: { $in: [null, undefined] } as any,
  });
  // Defensive: only merge if it's actually an anonymous row. If the caller
  // somehow forwarded a real account's Bearer, we absolutely don't want to
  // hoover its data into a different account.
  if (!anon || !anon.isAnonymous) return;

  // Union-merge child collections: same _id per row, only userId changes,
  // so no MongoDB collisions possible.
  const setUserId = { $set: { userId: targetUserId } };
  await Promise.all([
    collections.attempts.updateMany({ userId: anonymousUserId }, setUserId),
    collections.events.updateMany({ userId: anonymousUserId }, setUserId),
    collections.journalEntries.updateMany({ userId: anonymousUserId }, setUserId),
    collections.documents.updateMany({ userId: anonymousUserId }, setUserId),
    collections.pushTokens.updateMany({ userId: anonymousUserId }, setUserId),
    collections.notificationLog.updateMany({ userId: anonymousUserId }, setUserId),
    collections.notificationSchedule.updateMany({ userId: anonymousUserId }, setUserId),
    collections.aiRequestLogs.updateMany({ userId: anonymousUserId }, setUserId),
    collections.suggestions.updateMany({ userId: anonymousUserId }, setUserId),
    collections.subscriptions.updateMany({ userId: anonymousUserId }, setUserId),
    collections.subscriptionEvents.updateMany({ userId: anonymousUserId }, setUserId),
    collections.shareCodes.updateMany({ ownerId: anonymousUserId }, { $set: { ownerId: targetUserId } }),
  ]);

  // Target-wins on singleton rows.
  const existingSettings = await collections.userSettings.findOne({ userId: targetUserId });
  if (existingSettings) {
    await collections.userSettings.deleteMany({ userId: anonymousUserId });
  } else {
    await collections.userSettings.updateMany({ userId: anonymousUserId }, setUserId);
  }

  const existingOnboarding = await collections.onboardingAnswers.findOne({ userId: targetUserId });
  if (existingOnboarding) {
    await collections.onboardingAnswers.deleteMany({ userId: anonymousUserId });
  } else {
    await collections.onboardingAnswers.updateMany({ userId: anonymousUserId }, setUserId);
  }

  // Revoke anonymous refresh tokens so old sessions can't act on the merged
  // user's behalf.
  await collections.refreshTokens.updateMany(
    { userId: anonymousUserId, revokedAt: { $in: [null, undefined] } as any },
    { $set: { revokedAt: now } },
  );

  // Soft-delete the anonymous row. Free the deviceId so a fresh /init on
  // the same device (e.g. user signs out) creates a clean anonymous row.
  await collections.users.updateOne(
    { _id: anonymousUserId },
    { $set: { deletedAt: now, deviceId: null, updatedAt: now } as any },
  );
}

// ---------- OAuth ----------

export async function signInWithOAuth(params: {
  provider: 'apple' | 'google';
  idToken: string;
  displayName?: string;
  locale?: AppLocale;
  // See signUpWithEmail — when set, we upgrade the anonymous session rather
  // than creating a new user OR switching to a pre-existing OAuth user.
  anonymousUserId?: string;
}): Promise<AuthResult> {
  let result;
  try {
    result = await verifyOAuthToken(params.provider, params.idToken);
  } catch (err) {
    if (err instanceof OAuthError) {
      throw new ApiError({ code: 'UNAUTHORIZED', message: 'auth_token_invalid' });
    }
    throw err;
  }

  const collections = getCollections();
  const providerKey: 'appleId' | 'googleId' = params.provider === 'apple' ? 'appleId' : 'googleId';
  const now = getNow();

  let user = await collections.users.findOne({ [providerKey]: result.providerId });
  if (!user) {
    user = await collections.users.findOne({ email: result.email });
  }

  // Anonymous upgrade path: the caller is already an anonymous user and no
  // pre-existing account claims this OAuth identity → upgrade in place.
  if (!user && params.anonymousUserId) {
    return linkAnonymousToOAuthVerified({
      userId: params.anonymousUserId,
      provider: params.provider,
      providerId: result.providerId,
      email: result.email,
      displayName: params.displayName ?? result.displayName,
      locale: params.locale,
    });
  }

  if (user) {
    const update: Partial<User> = { lastLoginAt: now, updatedAt: now };
    if (!(user as any)[providerKey]) (update as any)[providerKey] = result.providerId;
    if (!user.linkedProviders.includes(params.provider as LinkableProvider)) {
      update.linkedProviders = [
        ...user.linkedProviders,
        params.provider as LinkableProvider,
      ];
    }
    await collections.users.updateOne({ _id: user._id }, { $set: update });
    user = { ...user, ...update } as User;
  } else {
    const newUser: User = {
      _id: generateId(),
      email: result.email,
      isEmailVerified: true,
      displayName: params.displayName ?? result.displayName,
      locale: params.locale,
      provider: params.provider as AuthProvider,
      linkedProviders: [params.provider as LinkableProvider],
      isAnonymous: false,
      onboardingCompleted: false,
      ...(providerKey === 'appleId' ? { appleId: result.providerId } : { googleId: result.providerId }),
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };
    await collections.users.insertOne(newUser);
    await bootstrapUserSettings(newUser._id, params.locale);
    user = newUser;
  }

  return issueTokens(user);
}

// ---------- Anonymous → real account upgrade ----------
// Both functions preserve the anonymous user's `_id`. All attempts, events,
// journal entries, cycle settings, documents, push tokens etc. stay attached
// because they reference `userId` — no migration needed.

async function linkAnonymousToEmail(params: {
  userId: string;
  email: string;
  password: string;
  displayName?: string;
  locale?: AppLocale;
}): Promise<AuthResult> {
  const collections = getCollections();
  const now = getNow();

  const user = await collections.users.findOne({
    _id: params.userId,
    deletedAt: { $in: [null, undefined] } as any,
  });
  if (!user) {
    throw new ApiError({ code: 'NOT_FOUND', message: 'auth_user_not_found' });
  }
  if (!user.isAnonymous) {
    // Not anonymous → this endpoint is only for upgrades. Refuse rather than
    // silently overwrite a real account's email.
    throw new ApiError({ code: 'CONFLICT', message: 'auth_not_anonymous' });
  }

  const emailOwner = await collections.users.findOne({ email: params.email });
  if (emailOwner && emailOwner._id !== user._id) {
    throw new ApiError({ code: 'CONFLICT', message: 'auth_email_in_use' });
  }

  const updated: Partial<User> = {
    email: params.email,
    passwordHash: await hashPassword(params.password),
    displayName: params.displayName ?? user.displayName,
    locale: params.locale ?? user.locale,
    provider: 'email',
    linkedProviders: user.linkedProviders.includes('email')
      ? user.linkedProviders
      : [...user.linkedProviders, 'email'],
    isAnonymous: false,
    lastLoginAt: now,
    updatedAt: now,
  };
  await collections.users.updateOne({ _id: user._id }, { $set: updated });

  return issueTokens({ ...user, ...updated } as User);
}

async function linkAnonymousToOAuthVerified(params: {
  userId: string;
  provider: 'apple' | 'google';
  providerId: string;
  email: string | null;
  displayName?: string;
  locale?: AppLocale;
}): Promise<AuthResult> {
  const collections = getCollections();
  const now = getNow();

  const user = await collections.users.findOne({
    _id: params.userId,
    deletedAt: { $in: [null, undefined] } as any,
  });
  if (!user) {
    throw new ApiError({ code: 'NOT_FOUND', message: 'auth_user_not_found' });
  }
  if (!user.isAnonymous) {
    throw new ApiError({ code: 'CONFLICT', message: 'auth_not_anonymous' });
  }

  const providerKey: 'appleId' | 'googleId' = params.provider === 'apple' ? 'appleId' : 'googleId';
  const updated: Partial<User> = {
    email: params.email ?? user.email ?? null,
    isEmailVerified: params.email ? true : user.isEmailVerified,
    displayName: params.displayName ?? user.displayName,
    locale: params.locale ?? user.locale,
    provider: params.provider as AuthProvider,
    linkedProviders: user.linkedProviders.includes(params.provider as LinkableProvider)
      ? user.linkedProviders
      : [...user.linkedProviders, params.provider as LinkableProvider],
    isAnonymous: false,
    ...(providerKey === 'appleId' ? { appleId: params.providerId } : { googleId: params.providerId }),
    lastLoginAt: now,
    updatedAt: now,
  };
  await collections.users.updateOne({ _id: user._id }, { $set: updated });

  return issueTokens({ ...user, ...updated } as User);
}

// ---------- Refresh / sign-out ----------

export async function refreshAccessToken(params: { refreshToken: string }): Promise<AuthResult> {
  const decoded = verifyRefreshToken(params.refreshToken);
  if (!decoded || !decoded.jti) {
    throw new ApiError({ code: 'UNAUTHORIZED', message: 'auth_token_invalid' });
  }

  const collections = getCollections();
  const stored = await collections.refreshTokens.findOne({ token: decoded.jti });
  if (!stored || stored.revokedAt) {
    throw new ApiError({ code: 'UNAUTHORIZED', message: 'auth_token_invalid' });
  }

  const user = await collections.users.findOne({
    _id: decoded.sub,
    deletedAt: { $in: [null, undefined] } as any,
  });
  if (!user) {
    throw new ApiError({ code: 'UNAUTHORIZED', message: 'auth_token_invalid' });
  }

  // Rotate refresh token: revoke the old one, issue a new pair.
  await collections.refreshTokens.updateOne(
    { _id: stored._id },
    { $set: { revokedAt: getNow() } }
  );

  return issueTokens(user);
}

export async function signOut(params: { refreshToken: string }): Promise<void> {
  const decoded = verifyRefreshToken(params.refreshToken);
  if (!decoded || !decoded.jti) return;
  await getCollections().refreshTokens.updateOne(
    { token: decoded.jti },
    { $set: { revokedAt: getNow() } }
  );
}

export async function signOutAll(userId: string): Promise<void> {
  await getCollections().refreshTokens.updateMany(
    { userId, revokedAt: { $in: [null, undefined] } as any },
    { $set: { revokedAt: getNow() } }
  );
}

// ---------- Account deletion ----------
// Soft-delete the user immediately, cascade-hard-delete all linked data,
// then hard-delete the user record. The 7-day TTL on `deletedAt` is the
// safety net in case the cascade is ever interrupted.

export async function deleteAccount(userId: string): Promise<void> {
  const { deleteObject } = await import('./objectStorage.service');
  const collections = getCollections();
  const now = new Date();

  await collections.users.updateOne({ _id: userId }, { $set: { deletedAt: now } });

  // Purge R2 objects for documents belonging to this user before deleting rows.
  const userDocs = await collections.documents.find({ userId }).toArray();
  await Promise.allSettled(userDocs.map((d) => deleteObject(d.storageKey)));

  await Promise.all([
    collections.attempts.deleteMany({ userId }),
    collections.events.deleteMany({ userId }),
    collections.journalEntries.deleteMany({ userId }),
    collections.userSettings.deleteMany({ userId }),
    collections.pushTokens.deleteMany({ userId }),
    collections.refreshTokens.deleteMany({ userId }),
    collections.aiRequestLogs.deleteMany({ userId }),
    collections.documents.deleteMany({ userId }),
    collections.notificationLog.deleteMany({ userId }),
    collections.notificationSchedule.deleteMany({ userId }),
    collections.shareCodes.deleteMany({ ownerId: userId }),
    collections.shareGrants.deleteMany({ $or: [{ ownerId: userId }, { partnerId: userId }] }),
    collections.subscriptions.deleteMany({ userId }),
    collections.subscriptionEvents.deleteMany({ userId }),
    collections.suggestions.deleteMany({ userId }),
    collections.onboardingAnswers.deleteMany({ userId }),
  ]);

  await collections.users.deleteOne({ _id: userId });
}
