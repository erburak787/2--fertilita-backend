import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ApiError } from '../../utils/errors';
import { t } from '../../utils/i18n';
import { adminJwtRoute, requireRole } from '../../middleware/admin-jwt.middleware';
import { getCollections } from '../../db/collections';
import { generateId } from '../../utils/id';
import { getNow } from '../../utils/date';
import {
  addWishlistEmailSchema,
  bulkAddWishlistEmailSchema,
  type WishlistEmail,
} from '../../schemas/wishlistEmail.schema';
import { writeAudit } from '../../services/admin-user.service';
import type { AdminVariables } from '../../types/context';

const adminWishlist = new Hono<{ Variables: AdminVariables }>();
adminWishlist.use('/*', adminJwtRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[admin.wishlist]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

const listQuerySchema = z.object({
  filter: z.enum(['all', 'pending', 'redeemed']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().optional(),
});

adminWishlist.get('/', zValidator('query', listQuerySchema), async (c) => {
  try {
    const q = c.req.valid('query');
    const filter: Record<string, unknown> = {};
    if (q.filter === 'pending') filter.redeemedAt = { $in: [null, undefined] };
    if (q.filter === 'redeemed') filter.redeemedAt = { $exists: true, $ne: null };
    if (q.search) filter.email = { $regex: q.search, $options: 'i' };

    const skip = (q.page - 1) * q.limit;
    const [items, total] = await Promise.all([
      getCollections().wishlistEmails
        .find(filter)
        .sort({ addedAt: -1 })
        .skip(skip)
        .limit(q.limit)
        .toArray(),
      getCollections().wishlistEmails.countDocuments(filter),
    ]);

    return c.json({ items, total, page: q.page, limit: q.limit });
  } catch (err) { return handle(err, c); }
});

adminWishlist.post(
  '/',
  requireRole('admin'),
  zValidator('json', addWishlistEmailSchema),
  async (c) => {
    try {
      const { email } = c.req.valid('json');
      const admin = c.get('admin');
      const existing = await getCollections().wishlistEmails.findOne({ email });
      if (existing) {
        throw new ApiError({ code: 'CONFLICT', message: 'wishlist_email_already_added' });
      }
      const doc: WishlistEmail = {
        _id: generateId(),
        email,
        addedBy: admin._id,
        addedAt: getNow(),
        redeemedAt: null,
        redeemedByUserId: null,
        expiresAt: null,
        remindersSent: { day30: false, day15: false, day0: false },
      };
      await getCollections().wishlistEmails.insertOne(doc);
      await writeAudit(admin._id, admin.email, 'wishlist_email_added', null, {
        id: doc._id, email,
      });
      return c.json({ item: doc }, 201);
    } catch (err) { return handle(err, c); }
  },
);

// CSV upload — client parses the CSV client-side and posts `emails: string[]`.
// Keeps the backend simple + avoids multipart handling here.
adminWishlist.post(
  '/upload',
  requireRole('admin'),
  zValidator('json', bulkAddWishlistEmailSchema),
  async (c) => {
    try {
      const { emails } = c.req.valid('json');
      const admin = c.get('admin');
      const now = getNow();

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const valid: string[] = [];
      const invalid: string[] = [];
      const seen = new Set<string>();

      for (const raw of emails) {
        const email = raw.trim().toLowerCase();
        if (!email || !emailRegex.test(email)) { invalid.push(raw); continue; }
        if (seen.has(email)) continue;
        seen.add(email);
        valid.push(email);
      }

      if (valid.length === 0) {
        return c.json({ added: 0, skipped: 0, invalid: invalid.length });
      }

      const existing = await getCollections()
        .wishlistEmails.find({ email: { $in: valid } })
        .project({ email: 1 })
        .toArray();
      const existingSet = new Set(existing.map((e: any) => e.email));
      const toInsert = valid.filter((e) => !existingSet.has(e));

      if (toInsert.length > 0) {
        const docs: WishlistEmail[] = toInsert.map((email) => ({
          _id: generateId(),
          email,
          addedBy: admin._id,
          addedAt: now,
          redeemedAt: null,
          redeemedByUserId: null,
          expiresAt: null,
          remindersSent: { day30: false, day15: false, day0: false },
        }));
        await getCollections().wishlistEmails.insertMany(docs, { ordered: false });
      }

      await writeAudit(admin._id, admin.email, 'wishlist_bulk_upload', null, {
        added: toInsert.length,
        skipped: existingSet.size,
        invalid: invalid.length,
      });

      return c.json({
        added: toInsert.length,
        skipped: existingSet.size,
        invalid: invalid.length,
      });
    } catch (err) { return handle(err, c); }
  },
);

adminWishlist.delete('/:id', requireRole('admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const admin = c.get('admin');
    const doc = await getCollections().wishlistEmails.findOne({ _id: id });
    if (!doc) throw new ApiError({ code: 'NOT_FOUND', message: 'wishlist_email_not_found' });
    if (doc.redeemedAt) {
      throw new ApiError({ code: 'BAD_REQUEST', message: 'wishlist_already_redeemed' });
    }
    await getCollections().wishlistEmails.deleteOne({ _id: id });
    await writeAudit(admin._id, admin.email, 'wishlist_email_deleted', null, {
      id, email: doc.email,
    });
    return c.json({ success: true });
  } catch (err) { return handle(err, c); }
});

export { adminWishlist as adminWishlistRoutes };
