import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { protectedRoute } from '../middleware/auth.middleware';
import { ApiError } from '../utils/errors';
import { t } from '../utils/i18n';
import { getCollections } from '../db/collections';
import { generateId } from '../utils/id';
import { getNow } from '../utils/date';
import {
  buildSubscriptionPublic,
  createDefaultSubscription,
  hasActiveAccess,
  type Subscription,
} from '../schemas/subscription.schema';
import { createSubscriptionEventRecord } from '../schemas/subscriptionEvent.schema';
import { TRIAL_DURATION_DAYS } from '../config/constants';
import {
  isRevenueCatConfigured,
  verifySubscription,
} from '../services/revenuecat.service';
import type { AuthVariables } from '../types/context';

const subscription = new Hono<{ Variables: AuthVariables }>();
subscription.use('/*', protectedRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[subscription]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

async function loadSubscription(userId: string): Promise<Subscription | null> {
  return getCollections().subscriptions.findOne({ userId });
}

async function ensureSubscription(userId: string): Promise<Subscription> {
  const existing = await loadSubscription(userId);
  if (existing) return existing;

  const now = getNow();
  const draft = createDefaultSubscription(userId);
  const doc: Subscription = { _id: generateId(), createdAt: now, updatedAt: now, ...draft };
  await getCollections().subscriptions.insertOne(doc);
  return doc;
}

subscription.get('/status', async (c) => {
  try {
    const userId = c.get('userId');
    const sub = await loadSubscription(userId);
    if (!sub) {
      return c.json({
        status: 'none' as const,
        planType: null,
        isTrialActive: false,
        trialEndDate: null,
        currentPeriodEnd: null,
        willRenew: false,
        entitlements: [] as string[],
        hasAccess: false,
      });
    }
    return c.json({ ...buildSubscriptionPublic(sub), hasAccess: hasActiveAccess(sub) });
  } catch (err) { return handle(err, c); }
});

subscription.post(
  '/sync',
  zValidator('json', z.object({ revenueCatCustomerId: z.string().min(1) })),
  async (c) => {
    try {
      const userId = c.get('userId');
      const { revenueCatCustomerId } = c.req.valid('json');
      const collections = getCollections();
      const now = getNow();

      const existing = await ensureSubscription(userId);
      const previousStatus = existing.status;

      if (!isRevenueCatConfigured()) {
        // Dev fallback: record the customer id, don't touch entitlement.
        await collections.subscriptions.updateOne(
          { _id: existing._id },
          { $set: { revenueCatCustomerId, lastVerifiedAt: now, updatedAt: now } }
        );
        const refreshed = await loadSubscription(userId);
        return c.json({
          ...buildSubscriptionPublic(refreshed!),
          hasAccess: hasActiveAccess(refreshed!),
        });
      }

      const rc = await verifySubscription(revenueCatCustomerId);
      const update: Partial<Subscription> = {
        revenueCatCustomerId,
        lastVerifiedAt: now,
        updatedAt: now,
        willRenew: rc.willRenew,
        entitlements: rc.entitlementIds,
      };

      if (rc.hasAccess) {
        update.status = rc.status;
        update.planType = rc.planType;
        update.isTrialActive = rc.isTrialActive;
        update.currentPeriodEnd = rc.expiresAt;
        update.gracePeriodExpiresAt = rc.gracePeriodExpiresAt;
        update.billingIssueDetectedAt = rc.billingIssueDetectedAt;
      } else if (!hasActiveAccess(existing)) {
        // Only demote to 'none' if the local DB isn't already granting access
        // (protects against transient RC misses).
        update.status = 'none';
        update.isTrialActive = false;
      }

      await collections.subscriptions.updateOne({ _id: existing._id }, { $set: update });
      const refreshed = (await loadSubscription(userId))!;

      if (previousStatus !== refreshed.status) {
        await collections.subscriptionEvents.insertOne({
          _id: generateId(),
          ...createSubscriptionEventRecord(
            userId,
            'purchase_verified',
            previousStatus,
            refreshed.status,
            'client',
            {
              subscriptionId: refreshed._id,
              metadata: { planType: refreshed.planType, revenueCatCustomerId },
            }
          ),
        });
      }

      return c.json({
        ...buildSubscriptionPublic(refreshed),
        hasAccess: hasActiveAccess(refreshed),
      });
    } catch (err) { return handle(err, c); }
  }
);

subscription.post('/start-trial', async (c) => {
  try {
    const userId = c.get('userId');
    const collections = getCollections();
    const existing = await loadSubscription(userId);
    const now = getNow();

    if (existing && existing.trialStartDate) {
      throw new ApiError({ code: 'CONFLICT', message: 'Trial already started' });
    }
    if (existing && hasActiveAccess(existing)) {
      throw new ApiError({ code: 'CONFLICT', message: 'Subscription already active' });
    }

    const nowMs = Date.now();
    const trialEnd = new Date(nowMs + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const trialStart = new Date(nowMs).toISOString();

    const previousStatus = existing?.status ?? 'none';

    if (existing) {
      await collections.subscriptions.updateOne(
        { _id: existing._id },
        {
          $set: {
            status: 'trial',
            isTrialActive: true,
            trialStartDate: trialStart,
            trialEndDate: trialEnd,
            updatedAt: now,
          },
        }
      );
    } else {
      const draft = createDefaultSubscription(userId);
      await collections.subscriptions.insertOne({
        _id: generateId(),
        createdAt: now,
        updatedAt: now,
        ...draft,
        trialStartDate: trialStart,
        trialEndDate: trialEnd,
      });
    }

    const refreshed = (await loadSubscription(userId))!;
    await collections.subscriptionEvents.insertOne({
      _id: generateId(),
      ...createSubscriptionEventRecord(userId, 'trial_started', previousStatus, 'trial', 'client', {
        subscriptionId: refreshed._id,
      }),
    });

    return c.json({
      ...buildSubscriptionPublic(refreshed),
      hasAccess: hasActiveAccess(refreshed),
    });
  } catch (err) { return handle(err, c); }
});

export { subscription as subscriptionRoutes };
