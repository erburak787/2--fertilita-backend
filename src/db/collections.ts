import type { Collection } from 'mongodb';
import { getDb } from './index';
import type { User, RefreshToken } from '../schemas/user.schema';
import type { PasswordResetToken } from '../schemas/passwordReset.schema';
import type { EmailChangeRequest } from '../schemas/emailChange.schema';
import type { WishlistEmail } from '../schemas/wishlistEmail.schema';
import type { WishlistRedemption } from '../schemas/wishlistRedemption.schema';
import type { Attempt } from '../schemas/attempt.schema';
import type { AppEventDoc } from '../schemas/event.schema';
import type { JournalEntry } from '../schemas/journal.schema';
import type { KnowledgeArticle } from '../schemas/knowledge.schema';
import type { UserSettings } from '../schemas/settings.schema';
import type { PushToken } from '../schemas/pushToken.schema';
import type { Admin, AdminAuditLog } from '../schemas/admin.schema';
import type { AiRequestLog } from '../schemas/ai.schema';
import type { Document as UserDocument } from '../schemas/document.schema';
import type {
  NotificationLog,
  NotificationSchedule,
} from '../schemas/notification.schema';
import type { SupportMessage } from '../schemas/supportMessage.schema';
import type { ShareCode, ShareGrant } from '../schemas/share.schema';
import type { Subscription } from '../schemas/subscription.schema';
import type { SubscriptionEvent } from '../schemas/subscriptionEvent.schema';
import type { WebhookEvent } from '../schemas/webhookEvent.schema';
import type { Suggestion } from '../schemas/suggestion.schema';
import type { OnboardingAnswers } from '../schemas/onboarding.schema';

export interface Collections {
  users: Collection<User>;
  refreshTokens: Collection<RefreshToken>;
  passwordResetTokens: Collection<PasswordResetToken>;
  emailChangeRequests: Collection<EmailChangeRequest>;
  wishlistEmails: Collection<WishlistEmail>;
  wishlistRedemptions: Collection<WishlistRedemption>;
  attempts: Collection<Attempt>;
  events: Collection<AppEventDoc>;
  journalEntries: Collection<JournalEntry>;
  knowledgeArticles: Collection<KnowledgeArticle>;
  userSettings: Collection<UserSettings>;
  pushTokens: Collection<PushToken>;
  admins: Collection<Admin>;
  adminAuditLog: Collection<AdminAuditLog>;
  aiRequestLogs: Collection<AiRequestLog>;
  documents: Collection<UserDocument>;
  notificationLog: Collection<NotificationLog>;
  notificationSchedule: Collection<NotificationSchedule>;
  supportMessages: Collection<SupportMessage>;
  shareCodes: Collection<ShareCode>;
  shareGrants: Collection<ShareGrant>;
  subscriptions: Collection<Subscription>;
  subscriptionEvents: Collection<SubscriptionEvent>;
  webhookEvents: Collection<WebhookEvent>;
  suggestions: Collection<Suggestion>;
  onboardingAnswers: Collection<OnboardingAnswers>;
}

let collections: Collections | null = null;

export function getCollections(): Collections {
  if (collections) return collections;

  const db = getDb();

  collections = {
    users: db.collection<User>('users'),
    refreshTokens: db.collection<RefreshToken>('refreshTokens'),
    passwordResetTokens: db.collection<PasswordResetToken>('passwordResetTokens'),
    emailChangeRequests: db.collection<EmailChangeRequest>('emailChangeRequests'),
    wishlistEmails: db.collection<WishlistEmail>('wishlistEmails'),
    wishlistRedemptions: db.collection<WishlistRedemption>('wishlistRedemptions'),
    attempts: db.collection<Attempt>('attempts'),
    events: db.collection<AppEventDoc>('events'),
    journalEntries: db.collection<JournalEntry>('journalEntries'),
    knowledgeArticles: db.collection<KnowledgeArticle>('knowledgeArticles'),
    userSettings: db.collection<UserSettings>('userSettings'),
    pushTokens: db.collection<PushToken>('pushTokens'),
    admins: db.collection<Admin>('admins'),
    adminAuditLog: db.collection<AdminAuditLog>('adminAuditLog'),
    aiRequestLogs: db.collection<AiRequestLog>('aiRequestLogs'),
    documents: db.collection<UserDocument>('documents'),
    notificationLog: db.collection<NotificationLog>('notificationLog'),
    notificationSchedule: db.collection<NotificationSchedule>('notificationSchedule'),
    supportMessages: db.collection<SupportMessage>('supportMessages'),
    shareCodes: db.collection<ShareCode>('shareCodes'),
    shareGrants: db.collection<ShareGrant>('shareGrants'),
    subscriptions: db.collection<Subscription>('subscriptions'),
    subscriptionEvents: db.collection<SubscriptionEvent>('subscriptionEvents'),
    webhookEvents: db.collection<WebhookEvent>('webhookEvents'),
    suggestions: db.collection<Suggestion>('suggestions'),
    onboardingAnswers: db.collection<OnboardingAnswers>('onboardingAnswers'),
  };

  return collections;
}
