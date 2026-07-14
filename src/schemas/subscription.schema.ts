import { z } from 'zod';
import { TRIAL_DURATION_DAYS } from '../config/constants';

export const subscriptionPlatformSchema = z.enum(['ios', 'android', 'web']);
export type SubscriptionPlatform = z.infer<typeof subscriptionPlatformSchema>;

export const subscriptionPlanTypeSchema = z.enum(['weekly', 'annual']);
export type SubscriptionPlanType = z.infer<typeof subscriptionPlanTypeSchema>;

export const subscriptionStatusSchema = z.enum([
  'none',
  'trial',
  'active',
  'expired',
  'cancelled',
  'grace_period',
]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const subscriptionSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  status: subscriptionStatusSchema,
  planType: subscriptionPlanTypeSchema.nullable().default(null),
  platform: subscriptionPlatformSchema.nullable().default(null),
  isTrialActive: z.boolean().default(false),
  trialStartDate: z.string().nullable().default(null),
  trialEndDate: z.string().nullable().default(null),
  currentPeriodStart: z.string().nullable().default(null),
  currentPeriodEnd: z.string().nullable().default(null),
  revenueCatCustomerId: z.string().nullable().default(null),
  revenueCatSubscriptionId: z.string().nullable().default(null),
  originalTransactionId: z.string().nullable().default(null),
  lastVerifiedAt: z.string().nullable().default(null),
  willRenew: z.boolean().default(false),
  lastWebhookEvent: z.string().nullable().default(null),
  billingIssueDetectedAt: z.string().nullable().default(null),
  gracePeriodExpiresAt: z.string().nullable().default(null),
  entitlements: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const subscriptionPublicSchema = subscriptionSchema.pick({
  status: true,
  isTrialActive: true,
  trialEndDate: true,
  currentPeriodEnd: true,
  planType: true,
  willRenew: true,
  entitlements: true,
});
export type SubscriptionPublic = z.infer<typeof subscriptionPublicSchema>;

export function buildSubscriptionPublic(s: Subscription): SubscriptionPublic {
  return {
    status: s.status,
    isTrialActive: s.isTrialActive,
    trialEndDate: s.trialEndDate,
    currentPeriodEnd: s.currentPeriodEnd,
    planType: s.planType,
    willRenew: s.willRenew,
    entitlements: s.entitlements,
  };
}

export const revenueCatWebhookEventSchema = z.object({
  api_version: z.string(),
  event: z.object({
    type: z.string(),
    id: z.string(),
    app_user_id: z.string(),
    original_app_user_id: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    product_id: z.string().optional(),
    entitlement_ids: z.array(z.string()).optional(),
    period_type: z.enum(['TRIAL', 'INTRO', 'NORMAL']).optional(),
    purchased_at_ms: z.number().optional(),
    expiration_at_ms: z.number().nullable().optional(),
    store: z.enum(['APP_STORE', 'PLAY_STORE', 'STRIPE', 'PROMOTIONAL']).optional(),
    environment: z.enum(['SANDBOX', 'PRODUCTION']).optional(),
    is_family_share: z.boolean().optional(),
    price_in_purchased_currency: z.number().optional(),
    currency: z.string().optional(),
    original_transaction_id: z.string().optional(),
    takehome_percentage: z.number().optional(),
  }),
});
export type RevenueCatWebhookEvent = z.infer<typeof revenueCatWebhookEventSchema>;

export const verifyPurchaseInputSchema = z.object({
  revenueCatCustomerId: z.string().min(1),
});

export function createDefaultSubscription(userId: string): Omit<Subscription, '_id' | 'createdAt' | 'updatedAt'> {
  const now = new Date();
  const trialEnd = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
  return {
    userId,
    status: 'trial',
    planType: null,
    platform: null,
    isTrialActive: true,
    trialStartDate: now.toISOString(),
    trialEndDate: trialEnd.toISOString(),
    currentPeriodStart: null,
    currentPeriodEnd: null,
    revenueCatCustomerId: null,
    revenueCatSubscriptionId: null,
    originalTransactionId: null,
    lastVerifiedAt: now.toISOString(),
    willRenew: false,
    lastWebhookEvent: null,
    billingIssueDetectedAt: null,
    gracePeriodExpiresAt: null,
    entitlements: [],
  };
}

export function hasActiveAccess(subscription: Subscription): boolean {
  const now = Date.now();
  if (subscription.status === 'trial') {
    if (!subscription.trialEndDate) return false;
    return new Date(subscription.trialEndDate).getTime() > now;
  }
  if (subscription.status === 'active') return true;
  if (subscription.status === 'cancelled' && subscription.currentPeriodEnd) {
    return new Date(subscription.currentPeriodEnd).getTime() > now;
  }
  if (subscription.status === 'grace_period') {
    if (!subscription.gracePeriodExpiresAt) return true;
    return new Date(subscription.gracePeriodExpiresAt).getTime() > now;
  }
  return false;
}

export function getDaysRemaining(subscription: Subscription): number | undefined {
  const now = Date.now();
  if (subscription.status === 'trial' && subscription.trialEndDate) {
    const remaining = new Date(subscription.trialEndDate).getTime() - now;
    return Math.max(0, Math.ceil(remaining / (1000 * 60 * 60 * 24)));
  }
  if (subscription.currentPeriodEnd) {
    const remaining = new Date(subscription.currentPeriodEnd).getTime() - now;
    return Math.max(0, Math.ceil(remaining / (1000 * 60 * 60 * 24)));
  }
  return undefined;
}
