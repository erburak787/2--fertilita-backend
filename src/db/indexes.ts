import type { Db } from 'mongodb';
import { SOFT_DELETE_TTL_SECONDS, NOTIFICATION_LOG_TTL_SECONDS } from '../config/constants';

// TTL applied to `deletedAt` on every user-data collection. Soft-deleted
// rows auto-purge after SOFT_DELETE_TTL_DAYS. This is the Fertilita-specific
// tightening — Habit Tracker keeps soft-deleted user data indefinitely.
const softDeleteTtl = { key: { deletedAt: 1 }, expireAfterSeconds: SOFT_DELETE_TTL_SECONDS };

export async function createIndexes(db: Db): Promise<void> {
  console.log('Creating database indexes...');

  await db.collection('users').createIndexes([
    { key: { email: 1 }, unique: true, partialFilterExpression: { email: { $type: 'string' } } },
    { key: { appleId: 1 }, sparse: true, unique: true },
    { key: { googleId: 1 }, sparse: true, unique: true },
    // Anonymous device auth: one user per deviceId. Sparse so pre-existing
    // real-account rows without deviceId aren't affected.
    { key: { deviceId: 1 }, sparse: true, unique: true },
    { key: { createdAt: -1 } },
    softDeleteTtl,
  ]);

  await db.collection('refreshTokens').createIndexes([
    { key: { userId: 1 } },
    { key: { token: 1 }, unique: true },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ]);

  // Drop the pre-OTP `tokenHash_1` index if it exists — the field was
  // renamed to `codeHash` (OTP flow) and the old unique-non-sparse index
  // would collide on new inserts that lack `tokenHash`.
  try {
    await db.collection('passwordResetTokens').dropIndex('tokenHash_1');
  } catch { /* index absent — first-run or already migrated */ }

  await db.collection('passwordResetTokens').createIndexes([
    // Sparse: only set on pre-verify records; the same doc later gets
    // `sessionTokenHash` set and `codeHash` cleared after successful verify.
    { key: { codeHash: 1 }, unique: true, sparse: true },
    // Look up post-verify by the opaque session token.
    { key: { sessionTokenHash: 1 }, unique: true, sparse: true },
    { key: { userId: 1, createdAt: -1 } },
    // TTL — Mongo auto-purges expired records ~60s after `expiresAt` passes.
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ]);

  await db.collection('attempts').createIndexes([
    { key: { userId: 1, deletedAt: 1, startDate: -1 } },
    { key: { userId: 1, updatedAt: -1 } },
    softDeleteTtl,
  ]);

  await db.collection('events').createIndexes([
    { key: { userId: 1, deletedAt: 1, date: 1 } },
    { key: { userId: 1, attemptId: 1, date: 1 } },
    { key: { userId: 1, type: 1, date: 1 } },
    { key: { userId: 1, updatedAt: -1 } },
    softDeleteTtl,
  ]);

  await db.collection('journalEntries').createIndexes([
    { key: { userId: 1, deletedAt: 1, createdAt: -1 } },
    { key: { userId: 1, updatedAt: -1 } },
    softDeleteTtl,
  ]);

  await db.collection('knowledgeArticles').createIndexes([
    { key: { slug: 1 }, unique: true },
    { key: { published: 1, categoryId: 1, order: 1 } },
    { key: { tags: 1 } },
  ]);

  await db.collection('userSettings').createIndexes([
    { key: { userId: 1 }, unique: true },
  ]);

  await db.collection('pushTokens').createIndexes([
    { key: { userId: 1, expoPushToken: 1 }, unique: true },
    { key: { userId: 1, isActive: 1 } },
  ]);

  await db.collection('admins').createIndexes([
    { key: { email: 1 }, unique: true },
  ]);

  await db.collection('adminAuditLog').createIndexes([
    { key: { adminId: 1, createdAt: -1 } },
    { key: { targetUserId: 1, createdAt: -1 } },
    { key: { action: 1, createdAt: -1 } },
  ]);

  await db.collection('aiRequestLogs').createIndexes([
    { key: { userId: 1, createdAt: -1 } },
    { key: { endpoint: 1, createdAt: -1 } },
    { key: { createdAt: 1 }, expireAfterSeconds: SOFT_DELETE_TTL_SECONDS },
  ]);

  await db.collection('documents').createIndexes([
    { key: { userId: 1, deletedAt: 1, createdAt: -1 } },
    { key: { userId: 1, attemptId: 1, createdAt: -1 } },
    { key: { userId: 1, category: 1, createdAt: -1 } },
    softDeleteTtl,
  ]);

  await db.collection('notificationLog').createIndexes([
    { key: { userId: 1, sentAt: -1 } },
    { key: { ticketId: 1 }, sparse: true },
    { key: { status: 1, sentAt: -1 } },
    { key: { sentAt: 1 }, expireAfterSeconds: NOTIFICATION_LOG_TTL_SECONDS },
  ]);

  await db.collection('notificationSchedule').createIndexes([
    { key: { isActive: 1, nextRunAt: 1 } },
    { key: { userId: 1, kind: 1 } },
    { key: { sourceEventId: 1 }, sparse: true },
  ]);

  await db.collection('supportMessages').createIndexes([
    { key: { category: 1, isActive: 1 } },
    { key: { phase: 1, isActive: 1 }, sparse: true },
  ]);

  await db.collection('shareCodes').createIndexes([
    { key: { codeHash: 1 }, unique: true },
    { key: { ownerId: 1, createdAt: -1 } },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ]);

  await db.collection('shareGrants').createIndexes([
    { key: { ownerId: 1, revokedAt: 1 } },
    { key: { partnerId: 1, revokedAt: 1 } },
    { key: { expiresAt: 1 } },
  ]);

  await db.collection('subscriptions').createIndexes([
    { key: { userId: 1 }, unique: true },
    { key: { status: 1 } },
    { key: { revenueCatCustomerId: 1 }, sparse: true },
  ]);

  await db.collection('subscriptionEvents').createIndexes([
    { key: { userId: 1, createdAt: -1 } },
    { key: { revenueCatEventId: 1 }, sparse: true },
  ]);

  await db.collection('webhookEvents').createIndexes([
    { key: { eventId: 1 }, unique: true },
    { key: { processedAt: -1 } },
  ]);

  await db.collection('suggestions').createIndexes([
    { key: { userId: 1, createdAt: -1 } },
    { key: { status: 1, createdAt: -1 } },
  ]);

  await db.collection('onboardingAnswers').createIndexes([
    { key: { userId: 1 }, unique: true },
  ]);

  console.log('Database indexes created successfully');
}
