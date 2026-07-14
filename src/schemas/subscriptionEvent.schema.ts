import { z } from 'zod';

export const subscriptionEventTypeSchema = z.enum([
  'created',
  'trial_started',
  'trial_expired',
  'purchase_verified',
  'renewed',
  'cancelled',
  'expired',
  'restored',
  'grace_period_started',
  'grace_period_expired',
  'billing_issue',
  'transferred',
  'self_healed',
  'admin_updated',
  'admin_granted',
  'admin_revoked',
  'admin_trial_extended',
]);
export type SubscriptionEventType = z.infer<typeof subscriptionEventTypeSchema>;

export const subscriptionEventSourceSchema = z.enum([
  'client',
  'webhook',
  'system',
  'admin',
  'restore',
]);
export type SubscriptionEventSource = z.infer<typeof subscriptionEventSourceSchema>;

export const subscriptionEventSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  subscriptionId: z.string().optional(),
  eventType: subscriptionEventTypeSchema,
  previousStatus: z.string().nullable(),
  newStatus: z.string(),
  source: subscriptionEventSourceSchema,
  revenueCatEventId: z.string().optional(),
  revenueCatEventType: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  createdAt: z.string(),
});
export type SubscriptionEvent = z.infer<typeof subscriptionEventSchema>;

export function createSubscriptionEventRecord(
  userId: string,
  eventType: SubscriptionEventType,
  previousStatus: string | null,
  newStatus: string,
  source: SubscriptionEventSource,
  options?: {
    subscriptionId?: string;
    revenueCatEventId?: string;
    revenueCatEventType?: string;
    metadata?: Record<string, any>;
  }
): Omit<SubscriptionEvent, '_id'> {
  return {
    userId,
    subscriptionId: options?.subscriptionId,
    eventType,
    previousStatus,
    newStatus,
    source,
    revenueCatEventId: options?.revenueCatEventId,
    revenueCatEventType: options?.revenueCatEventType,
    metadata: options?.metadata,
    createdAt: new Date().toISOString(),
  };
}

export function mapWebhookToEventType(rcEventType: string): SubscriptionEventType {
  switch (rcEventType) {
    case 'INITIAL_PURCHASE': return 'purchase_verified';
    case 'RENEWAL': return 'renewed';
    case 'CANCELLATION': return 'cancelled';
    case 'EXPIRATION': return 'expired';
    case 'BILLING_ISSUE':
    case 'BILLING_ISSUES': return 'billing_issue';
    case 'UNCANCELLATION': return 'renewed';
    case 'PRODUCT_CHANGE': return 'purchase_verified';
    case 'TRANSFER': return 'transferred';
    default: return 'purchase_verified';
  }
}
