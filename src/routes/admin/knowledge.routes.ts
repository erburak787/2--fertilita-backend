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
  knowledgeArticleInputSchema,
  type KnowledgeArticle,
} from '../../schemas/knowledge.schema';
import { writeAudit } from '../../services/admin-user.service';
import type { AdminVariables } from '../../types/context';

const adminKnowledge = new Hono<{ Variables: AdminVariables }>();
adminKnowledge.use('/*', adminJwtRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[admin.knowledge]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

const listQuerySchema = z.object({
  category: z.string().optional(),
  published: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

adminKnowledge.get('/articles', zValidator('query', listQuerySchema), async (c) => {
  try {
    const q = c.req.valid('query');
    const filter: Record<string, unknown> = {};
    if (q.category) filter.categoryId = q.category;
    if (q.published) filter.published = q.published === 'true';

    const skip = (q.page - 1) * q.limit;
    const [items, total] = await Promise.all([
      getCollections().knowledgeArticles
        .find(filter)
        .sort({ categoryId: 1, order: 1 })
        .skip(skip)
        .limit(q.limit)
        .toArray(),
      getCollections().knowledgeArticles.countDocuments(filter),
    ]);
    return c.json({ items, total, page: q.page, limit: q.limit });
  } catch (err) { return handle(err, c); }
});

adminKnowledge.get('/articles/:id', zValidator('param', z.object({ id: objectIdSchema })), async (c) => {
  try {
    const { id } = c.req.valid('param');
    const article = await getCollections().knowledgeArticles.findOne({ _id: id });
    if (!article) throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });
    return c.json({ article });
  } catch (err) { return handle(err, c); }
});

adminKnowledge.post(
  '/articles',
  requireRole('super_admin', 'admin'),
  zValidator('json', knowledgeArticleInputSchema),
  async (c) => {
    try {
      const admin = c.get('admin');
      const body = c.req.valid('json');
      const collections = getCollections();

      const existing = await collections.knowledgeArticles.findOne({ slug: body.slug });
      if (existing) {
        throw new ApiError({ code: 'CONFLICT', message: 'slug already exists' });
      }

      const now = getNow();
      const article: KnowledgeArticle = {
        _id: generateId(),
        slug: body.slug,
        categoryId: body.categoryId,
        tags: body.tags,
        readingTime: body.readingTime,
        order: body.order,
        published: body.published,
        i18n: body.i18n,
        createdAt: now,
        updatedAt: now,
      };
      await collections.knowledgeArticles.insertOne(article);
      await writeAudit(admin._id, admin.email, 'knowledge_article_created', null, {
        articleId: article._id,
        slug: article.slug,
      });
      return c.json({ article }, 201);
    } catch (err) { return handle(err, c); }
  }
);

adminKnowledge.put(
  '/articles/:id',
  requireRole('super_admin', 'admin'),
  zValidator('param', z.object({ id: objectIdSchema })),
  zValidator('json', knowledgeArticleInputSchema.partial()),
  async (c) => {
    try {
      const admin = c.get('admin');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const collections = getCollections();

      if (body.slug) {
        const clash = await collections.knowledgeArticles.findOne({
          slug: body.slug,
          _id: { $ne: id } as any,
        });
        if (clash) throw new ApiError({ code: 'CONFLICT', message: 'slug already exists' });
      }

      const result = await collections.knowledgeArticles.findOneAndUpdate(
        { _id: id },
        { $set: { ...body, updatedAt: getNow() } },
        { returnDocument: 'after' }
      );
      if (!result) throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });

      await writeAudit(admin._id, admin.email, 'knowledge_article_updated', null, {
        articleId: id,
        fields: Object.keys(body),
      });
      return c.json({ article: result });
    } catch (err) { return handle(err, c); }
  }
);

adminKnowledge.delete(
  '/articles/:id',
  requireRole('super_admin', 'admin'),
  zValidator('param', z.object({ id: objectIdSchema })),
  async (c) => {
    try {
      const admin = c.get('admin');
      const { id } = c.req.valid('param');
      const result = await getCollections().knowledgeArticles.deleteOne({ _id: id });
      if (result.deletedCount === 0) {
        throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });
      }
      await writeAudit(admin._id, admin.email, 'knowledge_article_deleted', null, {
        articleId: id,
      });
      return c.json({ success: true });
    } catch (err) { return handle(err, c); }
  }
);

export { adminKnowledge as adminKnowledgeRoutes };
