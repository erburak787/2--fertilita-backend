// RevenueCat REST API v1 wrapper — ported from Habit Tracker.
// Docs: https://www.revenuecat.com/docs/api-v1

import { env } from '../env';

const REVENUECAT_API_URL = 'https://api.revenuecat.com/v1';

export interface RevenueCatEntitlement {
  expires_date: string | null;
  grace_period_expires_date: string | null;
  product_identifier: string;
  purchase_date: string;
  original_purchase_date: string;
  period_type: 'normal' | 'trial' | 'intro';
  store: 'app_store' | 'play_store' | 'stripe' | 'promotional';
  is_sandbox: boolean;
  unsubscribe_detected_at: string | null;
  billing_issue_detected_at: string | null;
  will_renew: boolean;
}

export interface RevenueCatSubscription {
  expires_date: string;
  grace_period_expires_date: string | null;
  product_identifier: string;
  purchase_date: string;
  original_purchase_date: string;
  period_type: 'normal' | 'trial' | 'intro';
  store: 'app_store' | 'play_store' | 'stripe' | 'promotional';
  is_sandbox: boolean;
  unsubscribe_detected_at: string | null;
  billing_issue_detected_at: string | null;
  auto_resume_date: string | null;
  will_renew: boolean;
}

export interface RevenueCatSubscriber {
  original_app_user_id: string;
  original_application_version: string | null;
  original_purchase_date: string | null;
  first_seen: string;
  last_seen: string;
  management_url: string | null;
  non_subscriptions: Record<string, any[]>;
  entitlements: Record<string, RevenueCatEntitlement>;
  subscriptions: Record<string, RevenueCatSubscription>;
}

export interface RevenueCatSubscriberResponse {
  request_date: string;
  request_date_ms: number;
  subscriber: RevenueCatSubscriber;
}

export function isRevenueCatConfigured(): boolean {
  return !!(env.REVENUECAT_API_KEY_V1 && env.REVENUECAT_API_KEY_V1.length > 0);
}

export async function getSubscriberInfo(appUserId: string): Promise<RevenueCatSubscriberResponse> {
  if (!isRevenueCatConfigured()) {
    throw new Error('RevenueCat API key not configured');
  }

  const response = await fetch(
    `${REVENUECAT_API_URL}/subscribers/${encodeURIComponent(appUserId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${env.REVENUECAT_API_KEY_V1}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('[RevenueCat] API error:', response.status, error);
    throw new Error(`RevenueCat API error: ${response.status}`);
  }

  return response.json() as Promise<RevenueCatSubscriberResponse>;
}

export function getActiveEntitlement(
  subscriberInfo: RevenueCatSubscriberResponse
): RevenueCatEntitlement | null {
  const entitlements = subscriberInfo?.subscriber?.entitlements;
  if (!entitlements) return null;

  const now = new Date();
  for (const entitlement of Object.values(entitlements)) {
    if (entitlement.expires_date === null || new Date(entitlement.expires_date) > now) {
      return entitlement;
    }
  }
  return null;
}

export function hasActiveEntitlement(subscriberInfo: RevenueCatSubscriberResponse): boolean {
  return getActiveEntitlement(subscriberInfo) !== null;
}

export function determineSubscriptionStatus(
  subscriberInfo: RevenueCatSubscriberResponse
): 'none' | 'trial' | 'active' | 'expired' | 'cancelled' | 'grace_period' {
  const entitlement = getActiveEntitlement(subscriberInfo);
  if (!entitlement) return 'none';
  if (entitlement.billing_issue_detected_at) return 'grace_period';
  if (entitlement.period_type === 'trial') return 'trial';
  if (entitlement.unsubscribe_detected_at && !entitlement.will_renew) return 'cancelled';
  return 'active';
}

export function determinePlanType(
  subscriberInfo: RevenueCatSubscriberResponse
): 'weekly' | 'annual' | null {
  const entitlement = getActiveEntitlement(subscriberInfo);
  if (!entitlement) return null;
  const productId = entitlement.product_identifier.toLowerCase();
  if (productId.includes('annual') || productId.includes('yearly')) return 'annual';
  return 'weekly';
}

export async function verifySubscription(appUserId: string): Promise<{
  hasAccess: boolean;
  status: 'none' | 'trial' | 'active' | 'expired' | 'cancelled' | 'grace_period';
  planType: 'weekly' | 'annual' | null;
  expiresAt: string | null;
  gracePeriodExpiresAt: string | null;
  willRenew: boolean;
  billingIssueDetectedAt: string | null;
  isTrialActive: boolean;
  isSandbox: boolean;
  entitlementIds: string[];
}> {
  const subscriberInfo = await getSubscriberInfo(appUserId);
  const entitlement = getActiveEntitlement(subscriberInfo);

  if (!entitlement) {
    return {
      hasAccess: false,
      status: 'none',
      planType: null,
      expiresAt: null,
      gracePeriodExpiresAt: null,
      willRenew: false,
      billingIssueDetectedAt: null,
      isTrialActive: false,
      isSandbox: false,
      entitlementIds: [],
    };
  }

  const entitlementIds = Object.entries(subscriberInfo.subscriber.entitlements)
    .filter(([, e]) => e.expires_date === null || new Date(e.expires_date) > new Date())
    .map(([id]) => id);

  return {
    hasAccess: true,
    status: determineSubscriptionStatus(subscriberInfo),
    planType: determinePlanType(subscriberInfo),
    expiresAt: entitlement.expires_date,
    gracePeriodExpiresAt: entitlement.grace_period_expires_date,
    willRenew: entitlement.will_renew,
    billingIssueDetectedAt: entitlement.billing_issue_detected_at,
    isTrialActive: entitlement.period_type === 'trial',
    isSandbox: entitlement.is_sandbox,
    entitlementIds,
  };
}
