import { getCollections } from '../db/collections';
import { ApiError } from '../utils/errors';
import { generateId } from '../utils/id';
import { getNow } from '../utils/date';
import { deleteObject } from './objectStorage.service';
import type { AdminAuditAction } from '../schemas/admin.schema';

export type UserSortField = 'createdAt' | 'lastLoginAt';
export type SortOrder = 'asc' | 'desc';

export interface UserListParams {
  query?: string;
  page: number;
  limit: number;
  sort?: UserSortField;
  order?: SortOrder;
}

export async function writeAudit(
  adminId: string,
  adminEmail: string,
  action: AdminAuditAction,
  targetUserId: string | null,
  metadata?: Record<string, any>
) {
  await getCollections().adminAuditLog.insertOne({
    _id: generateId(),
    adminId,
    adminEmail,
    action,
    targetUserId,
    metadata,
    createdAt: getNow(),
  });
}

export async function listUsers(params: UserListParams) {
  const collections = getCollections();
  const skip = (params.page - 1) * params.limit;

  const match: Record<string, unknown> = {
    deletedAt: { $in: [null, undefined] } as any,
  };
  if (params.query && params.query.trim()) {
    const q = params.query.trim();
    match.$or = [
      { email: { $regex: q, $options: 'i' } },
      { displayName: { $regex: q, $options: 'i' } },
    ];
  }

  const sortField = params.sort ?? 'createdAt';
  const sortDir = params.order === 'asc' ? 1 : -1;
  const sortStage: Record<string, 1 | -1> = { [sortField]: sortDir };
  if (sortField !== 'createdAt') sortStage.createdAt = -1;

  const [items, total] = await Promise.all([
    collections.users
      .find(match, { projection: { passwordHash: 0 } })
      .sort(sortStage)
      .skip(skip)
      .limit(params.limit)
      .toArray(),
    collections.users.countDocuments(match),
  ]);

  return {
    items,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.max(1, Math.ceil(total / params.limit)),
  };
}

export async function getUserDetail(userId: string) {
  const collections = getCollections();
  const user = await collections.users.findOne(
    { _id: userId },
    { projection: { passwordHash: 0 } }
  );
  if (!user) throw new ApiError({ code: 'NOT_FOUND', message: 'User not found' });

  const activeFilter = { userId, deletedAt: { $in: [null, undefined] } as any };
  const [attemptsCount, eventsCount, journalCount, documentsCount, subscription, settings] = await Promise.all([
    collections.attempts.countDocuments(activeFilter),
    collections.events.countDocuments(activeFilter),
    collections.journalEntries.countDocuments(activeFilter),
    collections.documents.countDocuments(activeFilter),
    collections.subscriptions.findOne({ userId }),
    collections.userSettings.findOne({ userId }),
  ]);

  return {
    user,
    settings,
    subscription,
    stats: {
      attemptsCount,
      eventsCount,
      journalCount,
      documentsCount,
    },
  };
}

export async function deleteUserCascade(params: {
  adminId: string;
  adminEmail: string;
  userId: string;
  reason?: string;
}) {
  const collections = getCollections();
  const user = await collections.users.findOne({ _id: params.userId });
  if (!user) throw new ApiError({ code: 'NOT_FOUND', message: 'User not found' });

  const userId = params.userId;

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

  await writeAudit(params.adminId, params.adminEmail, 'user_deleted', userId, {
    reason: params.reason,
    email: user.email,
  });

  return { success: true };
}
