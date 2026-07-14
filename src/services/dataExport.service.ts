import { getCollections } from '../db/collections';
import { buildUserPublic } from '../schemas/user.schema';
import { ApiError } from '../utils/errors';

export interface DsarExport {
  exportedAt: string;
  schemaVersion: 1;
  user: ReturnType<typeof buildUserPublic>;
  settings: unknown;
  onboardingAnswers: unknown;
  attempts: unknown[];
  events: unknown[];
  journalEntries: unknown[];
  pushTokens: unknown[];
}

export async function buildUserDsarExport(userId: string): Promise<DsarExport> {
  const collections = getCollections();

  const user = await collections.users.findOne({
    _id: userId,
    deletedAt: { $in: [null, undefined] } as any,
  });
  if (!user) throw new ApiError({ code: 'NOT_FOUND', message: 'user_not_found' });

  const activeFilter = { userId, deletedAt: { $in: [null, undefined] } as any };

  const [settings, onboardingAnswers, attempts, events, journalEntries, pushTokens] = await Promise.all([
    collections.userSettings.findOne({ userId }),
    collections.onboardingAnswers.findOne({ userId }),
    collections.attempts.find(activeFilter).toArray(),
    collections.events.find(activeFilter).toArray(),
    collections.journalEntries.find(activeFilter).toArray(),
    collections.pushTokens.find({ userId }).toArray(),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    user: buildUserPublic(user),
    settings: settings ?? null,
    onboardingAnswers: onboardingAnswers ?? null,
    attempts,
    events,
    journalEntries,
    pushTokens: pushTokens.map((t) => ({
      platform: t.platform,
      isActive: t.isActive,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  };
}
