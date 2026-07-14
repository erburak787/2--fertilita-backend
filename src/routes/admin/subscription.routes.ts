import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ApiError } from '../../utils/errors';
import { t } from '../../utils/i18n';
import { adminJwtRoute, requireRole } from '../../middleware/admin-jwt.middleware';
import { getCollections } from '../../db/collections';
import { generateId } from '../../utils/id';
import { getNow } from '../../utils/date';
import { objectIdSchema } from '../../schemas/common.schema';
import {
  buildSubscriptionPublic,
  createDefaultSubscription,
  subscriptionPlanTypeSchema,
  type Subscription,
} from '../../schemas/subscription.schema';
import { createSubscriptionEventRecord } from '../../schemas/subscriptionEvent.schema';
import { writeAudit } from '../../services/admin-user.service';
import { MAX_ADMIN_TRIAL_EXTENSION_DAYS } from '../../config/constants';
import type { AdminVariables } from '../../types/context';

const adminSubscription = new Hono<{ Variables: AdminVariables }>();
adminSubscription.use('/*', adminJwtRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[admin.subscription]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

async function ensureUser(userId: string) {
  const user = await getCollections().users.findOne({ _id: userId });
  if (!user) throw new ApiError({ code: 'NOT_FOUND', message: 'User not found' });
  return user;
}

async function ensureSubscription(userId: string): Promise<Subscription> {
  const collections = getCollections();
  const existing = await collections.subscriptions.findOne({ userId });
  if (existing) return existing;
  const now = getNow();
  const draft = createDefaultSubscription(userId);
  const doc: Subscription = { _id: generateId(), createdAt: now, updatedAt: now, ...draft };
  await collections.subscriptions.insertOne(doc);
  return doc;
}

const grantSchema = z.object({
  planType: subscriptionPlanTypeSchema.default('annual'),
  expiresAt: z.string().datetime().optional(),
  reason: z.string().max(500),
});

adminSubscription.post(
  '/:id/subscription/grant',
  requireRole('super_admin'),
  zValidator('param', z.object({ id: objectIdSchema })),
  zValidator('json', grantSchema),
  async (c) => {
    try {
      const admin = c.get('admin');
      const { id: userId } = c.req.valid('param');
      const { planType, expiresAt, reason } = c.req.valid('json');
      await ensureUser(userId);

      const collections = getCollections();
      const existing = await ensureSubscription(userId);
      const previousStatus = existing.status;
      const now = getNow();

      const update: Partial<Subscription> = {
        status: 'active',
        planType,
        isTrialActive: false,
        currentPeriodStart: now,
        currentPeriodEnd: expiresAt ?? null,
        willRenew: false,
        updatedAt: now,
        gracePeriodExpiresAt: null,
        billingIssueDetectedAt: null,
      };
      await collections.subscriptions.updateOne({ _id: existing._id }, { $set: update });

      await collections.subscriptionEvents.insertOne({
        _id: generateId(),
        ...createSubscriptionEventRecord(userId, 'admin_granted', previousStatus, 'active', 'admin', {
          subscriptionId: existing._id,
          metadata: { planType, expiresAt, reason, actorAdminId: admin._id },
        }),
      });
      await writeAudit(admin._id, admin.email, 'subscription_granted', userId, {
        planType,
        expiresAt,
        reason,
      });

      const refreshed = (await collections.subscriptions.findOne({ _id: existing._id }))!;
      return c.json({ subscription: buildSubscriptionPublic(refreshed) });
    } catch (err) { return handle(err, c); }
  }
);

adminSubscription.post(
  '/:id/subscription/revoke',
  requireRole('super_admin'),
  zValidator('param', z.object({ id: objectIdSchema })),
  zValidator('json', z.object({ reason: z.string().max(500) })),
  async (c) => {
    try {
      const admin = c.get('admin');
      const { id: userId } = c.req.valid('param');
      const { reason } = c.req.valid('json');
      await ensureUser(userId);

      const collections = getCollections();
      const existing = await collections.subscriptions.findOne({ userId });
      if (!existing) throw new ApiError({ code: 'NOT_FOUND', message: 'Subscription not found' });
      const previousStatus = existing.status;
      const now = getNow();

      await collections.subscriptions.updateOne(
        { _id: existing._id },
        {
          $set: {
            status: 'cancelled',
            isTrialActive: false,
            willRenew: false,
            currentPeriodEnd: now,
            updatedAt: now,
          },
        }
      );

      await collections.subscriptionEvents.insertOne({
        _id: generateId(),
        ...createSubscriptionEventRecord(userId, 'admin_revoked', previousStatus, 'cancelled', 'admin', {
          subscriptionId: existing._id,
          metadata: { reason, actorAdminId: admin._id },
        }),
      });
      await writeAudit(admin._id, admin.email, 'subscription_revoked', userId, { reason });

      const refreshed = (await collections.subscriptions.findOne({ _id: existing._id }))!;
      return c.json({ subscription: buildSubscriptionPublic(refreshed) });
    } catch (err) { return handle(err, c); }
  }
);

adminSubscription.post(
  '/:id/subscription/extend-trial',
  requireRole('super_admin', 'admin'),
  zValidator('param', z.object({ id: objectIdSchema })),
  zValidator(
    'json',
    z.object({
      days: z.number().int().min(1).max(MAX_ADMIN_TRIAL_EXTENSION_DAYS),
      reason: z.string().max(500),
    })
  ),
  async (c) => {
    try {
      const admin = c.get('admin');
      const { id: userId } = c.req.valid('param');
      const { days, reason } = c.req.valid('json');
      await ensureUser(userId);

      const collections = getCollections();
      const existing = await ensureSubscription(userId);
      const previousStatus = existing.status;
      const now = getNow();

      const basis = existing.trialEndDate ? new Date(existing.trialEndDate) : new Date();
      const anchor = basis.getTime() > Date.now() ? basis : new Date();
      const nextTrialEnd = new Date(anchor.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

      await collections.subscriptions.updateOne(
        { _id: existing._id },
        {
          $set: {
            status: 'trial',
            isTrialActive: true,
            trialStartDate: existing.trialStartDate ?? now,
            trialEndDate: nextTrialEnd,
            updatedAt: now,
          },
        }
      );

      await collections.subscriptionEvents.insertOne({
        _id: generateId(),
        ...createSubscriptionEventRecord(userId, 'admin_trial_extended', previousStatus, 'trial', 'admin', {
          subscriptionId: existing._id,
          metadata: { days, newTrialEnd: nextTrialEnd, reason, actorAdminId: admin._id },
        }),
      });
      await writeAudit(admin._id, admin.email, 'trial_extended', userId, {
        days,
        newTrialEnd: nextTrialEnd,
        reason,
      });

      const refreshed = (await collections.subscriptions.findOne({ _id: existing._id }))!;
      return c.json({ subscription: buildSubscriptionPublic(refreshed) });
    } catch (err) { return handle(err, c); }
  }
);

export { adminSubscription as adminSubscriptionRoutes };
