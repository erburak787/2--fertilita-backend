import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { protectedRoute } from '../middleware/auth.middleware';
import { ApiError } from '../utils/errors';
import { t } from '../utils/i18n';
import { getCollections } from '../db/collections';
import { objectIdSchema } from '../schemas/common.schema';
import {
  createShareInviteSchema,
  redeemShareCodeSchema,
} from '../schemas/share.schema';
import {
  createShareInvite,
  redeemShareCode,
  requireActiveGrantForPartner,
} from '../services/share.service';
import type { AuthVariables } from '../types/context';

const share = new Hono<{ Variables: AuthVariables }>();
share.use('/*', protectedRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[share]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

share.post('/invite', zValidator('json', createShareInviteSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = c.req.valid('json');
    const { code, expiresAt } = await createShareInvite({
      ownerId: userId,
      scope: body.scope,
      expiresInHours: body.expiresInHours,
    });
    return c.json({ code, expiresAt: expiresAt.toISOString(), scope: body.scope }, 201);
  } catch (err) { return handle(err, c); }
});

share.post('/redeem', zValidator('json', redeemShareCodeSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const { code } = c.req.valid('json');
    const grant = await redeemShareCode({ partnerId: userId, code });
    return c.json({
      grant: {
        id: grant._id,
        ownerId: grant.ownerId,
        scope: grant.scope,
        expiresAt: grant.expiresAt.toISOString(),
      },
    });
  } catch (err) { return handle(err, c); }
});

share.get('/grants', async (c) => {
  try {
    const userId = c.get('userId');
    const collections = getCollections();
    const activeFilter = { revokedAt: { $in: [null, undefined] } as any };

    const [owned, received] = await Promise.all([
      collections.shareGrants
        .find({ ownerId: userId, ...activeFilter })
        .sort({ createdAt: -1 })
        .toArray(),
      collections.shareGrants
        .find({ partnerId: userId, ...activeFilter })
        .sort({ createdAt: -1 })
        .toArray(),
    ]);

    return c.json({
      owned: owned.map((g) => ({
        id: g._id,
        partnerId: g.partnerId,
        scope: g.scope,
        expiresAt: g.expiresAt.toISOString(),
        createdAt: g.createdAt,
      })),
      received: received.map((g) => ({
        id: g._id,
        ownerId: g.ownerId,
        scope: g.scope,
        expiresAt: g.expiresAt.toISOString(),
        createdAt: g.createdAt,
      })),
    });
  } catch (err) { return handle(err, c); }
});

share.delete('/grants/:id', zValidator('param', z.object({ id: objectIdSchema })), async (c) => {
  try {
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const result = await getCollections().shareGrants.updateOne(
      {
        _id: id,
        $or: [{ ownerId: userId }, { partnerId: userId }],
        revokedAt: { $in: [null, undefined] } as any,
      },
      { $set: { revokedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });
    }
    return c.json({ success: true });
  } catch (err) { return handle(err, c); }
});

// ---- Read-only projections ----
// Journal is NEVER shared, regardless of scope or owner privacy setting.

share.get('/view/:grantId/journey', zValidator('param', z.object({ grantId: objectIdSchema })), async (c) => {
  try {
    const userId = c.get('userId');
    const { grantId } = c.req.valid('param');
    const grant = await requireActiveGrantForPartner({
      grantId,
      partnerId: userId,
      neededScope: 'journey',
    });
    const collections = getCollections();
    const [attempts, events] = await Promise.all([
      collections.attempts
        .find({ userId: grant.ownerId, deletedAt: { $in: [null, undefined] } as any })
        .sort({ startDate: -1 })
        .toArray(),
      collections.events
        .find({
          userId: grant.ownerId,
          source: 'journey',
          deletedAt: { $in: [null, undefined] } as any,
        })
        .sort({ date: 1, time: 1 })
        .toArray(),
    ]);
    return c.json({
      attempts: attempts.map((a) => ({ ...a, userId: undefined })),
      events: events.map((e) => ({ ...e, userId: undefined, notes: undefined })),
    });
  } catch (err) { return handle(err, c); }
});

share.get('/view/:grantId/calendar', zValidator('param', z.object({ grantId: objectIdSchema })), async (c) => {
  try {
    const userId = c.get('userId');
    const { grantId } = c.req.valid('param');
    const grant = await requireActiveGrantForPartner({
      grantId,
      partnerId: userId,
      neededScope: 'calendar',
    });
    const events = await getCollections().events
      .find({
        userId: grant.ownerId,
        deletedAt: { $in: [null, undefined] } as any,
      })
      .sort({ date: 1, time: 1 })
      .toArray();
    return c.json({
      events: events.map((e) => ({ ...e, userId: undefined, notes: undefined })),
    });
  } catch (err) { return handle(err, c); }
});

export { share as shareRoutes };
