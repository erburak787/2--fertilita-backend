import { Hono } from 'hono';
import { timingSafeEqual } from 'crypto';
import { env } from '../env';
import { getCollections } from '../db/collections';
import { generateId } from '../utils/id';
import { createWebhookEventRecord } from '../schemas/webhookEvent.schema';
import {
  createSubscriptionEventRecord,
  mapWebhookToEventType,
} from '../schemas/subscriptionEvent.schema';
import { GRACE_PERIOD_DAYS } from '../config/constants';
import type { BaseVariables } from '../types/context';

const webhooks = new Hono<{ Variables: BaseVariables }>();

// RevenueCat webhook. Auth is via bearer secret in the Authorization header,
// timing-safe compared. Idempotent by RC eventId.
webhooks.post('/revenuecat', async (c) => {
  let eventId: string | undefined;
  let appUserId: string | undefined;
  let eventType: string | undefined;

  try {
    if (!env.REVENUECAT_WEBHOOK_SECRET) {
      console.error('[webhook.rc] REVENUECAT_WEBHOOK_SECRET not configured');
      return c.json({ error: 'Server misconfigured' }, 500);
    }

    const authHeader = c.req.header('Authorization') ?? '';
    const secretBuffer = Buffer.from(env.REVENUECAT_WEBHOOK_SECRET);
    const headerBuffer = Buffer.from(authHeader);
    const isValid =
      secretBuffer.length === headerBuffer.length &&
      timingSafeEqual(secretBuffer, headerBuffer);
    if (!isValid) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const event = body?.event ?? {};
    eventId = event.id;
    appUserId = event.original_app_user_id || event.app_user_id;
    eventType = event.type;

    const collections = getCollections();
    const nowIso = new Date().toISOString();

    // Idempotency: claim the eventId. If the insert fails (duplicate key),
    // we've already processed (or are processing) this event.
    if (eventId) {
      try {
        await collections.webhookEvents.insertOne({
          _id: generateId(),
          ...createWebhookEventRecord(eventId, eventType || 'UNKNOWN', appUserId || 'UNKNOWN', 'processing'),
        });
      } catch {
        return c.json({ received: true, duplicate: true });
      }
    }

    if (env.NODE_ENV === 'production' && event.environment === 'SANDBOX') {
      if (eventId) {
        await collections.webhookEvents.updateOne(
          { eventId },
          { $set: { status: 'processed', processedAt: nowIso } }
        );
      }
      return c.json({ received: true, ignored: 'sandbox' });
    }

    const sub = await collections.subscriptions.findOne({ revenueCatCustomerId: appUserId });
    if (!sub) {
      if (eventId) {
        await collections.webhookEvents.updateOne(
          { eventId },
          { $set: { status: 'failed', error: 'Subscription not found', processedAt: nowIso } }
        );
      }
      return c.json({ received: true, warning: 'Subscription not found' });
    }

    const previousStatus = sub.status;

    let status: 'none' | 'trial' | 'active' | 'expired' | 'cancelled' | 'grace_period' = 'none';
    let planType: 'weekly' | 'annual' | null = null;
    let shouldUpdate = true;
    const update: Record<string, any> = {
      lastVerifiedAt: nowIso,
      lastWebhookEvent: eventType,
      updatedAt: nowIso,
    };

    if (event.product_id) {
      const pid = String(event.product_id).toLowerCase();
      planType = pid.includes('annual') || pid.includes('yearly') ? 'annual' : 'weekly';
    }

    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE':
      case 'UNCANCELLATION':
        status = event.period_type === 'TRIAL' ? 'trial' : 'active';
        break;
      case 'CANCELLATION':
        status = 'cancelled';
        break;
      case 'EXPIRATION':
        status = 'expired';
        break;
      case 'BILLING_ISSUE':
      case 'BILLING_ISSUES':
        status = 'grace_period';
        update.billingIssueDetectedAt = nowIso;
        update.gracePeriodExpiresAt = event.expiration_at_ms
          ? new Date(event.expiration_at_ms).toISOString()
          : new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
        break;
      case 'SUBSCRIBER_ALIAS':
        shouldUpdate = false;
        break;
      case 'TRANSFER':
        if (Array.isArray(event.transferred_to) && event.transferred_to[0]) {
          update.revenueCatCustomerId = event.transferred_to[0];
        }
        break;
      case 'SUBSCRIPTION_PAUSED':
        status = 'cancelled';
        break;
      case 'SUBSCRIPTION_EXTENDED':
      case 'TEMPORARY_ENTITLEMENT_GRANT':
      case 'NON_RENEWING_PURCHASE':
        status = 'active';
        break;
      default:
        console.log('[webhook.rc] Unhandled event type', event.type);
        shouldUpdate = false;
    }

    if (shouldUpdate) {
      update.status = status;
      if (planType) update.planType = planType;
      update.isTrialActive = event.period_type === 'TRIAL';
      if (event.expiration_at_ms) {
        update.currentPeriodEnd = new Date(event.expiration_at_ms).toISOString();
      }
      if (event.original_transaction_id) {
        update.originalTransactionId = event.original_transaction_id;
      }
      update.revenueCatCustomerId = appUserId;
      if (status !== 'grace_period') {
        update.billingIssueDetectedAt = null;
        update.gracePeriodExpiresAt = null;
      }

      await collections.subscriptions.updateOne({ _id: sub._id }, { $set: update });

      await collections.subscriptionEvents.insertOne({
        _id: generateId(),
        ...createSubscriptionEventRecord(
          sub.userId,
          mapWebhookToEventType(event.type),
          previousStatus,
          status,
          'webhook',
          {
            subscriptionId: sub._id,
            revenueCatEventId: eventId,
            revenueCatEventType: event.type,
            metadata: {
              productId: event.product_id,
              periodType: event.period_type,
              environment: event.environment,
            },
          }
        ),
      });
    }

    if (eventId) {
      await collections.webhookEvents.updateOne(
        { eventId },
        {
          $set: {
            status: 'processed',
            processedAt: nowIso,
            rawPayload: {
              type: event.type,
              product_id: event.product_id,
              period_type: event.period_type,
            },
          },
        }
      );
    }

    return c.json({ received: true, processed: shouldUpdate });
  } catch (err) {
    console.error('[webhook.rc] processing error', err);
    if (eventId) {
      try {
        await getCollections().webhookEvents.updateOne(
          { eventId },
          {
            $set: {
              status: 'failed',
              error: err instanceof Error ? err.message : 'Unknown error',
              processedAt: new Date().toISOString(),
            },
          }
        );
      } catch (logErr) {
        console.error('[webhook.rc] failed to record failure', logErr);
      }
    }
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

export { webhooks as webhookRoutes };
