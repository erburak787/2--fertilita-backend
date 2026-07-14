import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ApiError } from '../utils/errors';
import { t } from '../utils/i18n';
import { getCollections } from '../db/collections';
import { knowledgeListQuerySchema } from '../schemas/knowledge.schema';
import { DEFAULT_LOCALE, type AppLocale } from '../config/constants';
import type { BaseVariables } from '../types/context';

const knowledge = new Hono<{ Variables: BaseVariables }>();

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[knowledge]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

function localize(article: any, locale: AppLocale) {
  const i18n = article.i18n ?? {};
  const en = i18n.en;
  const chosen = i18n[locale] ?? en;
  return {
    id: article._id,
    slug: article.slug,
    categoryId: article.categoryId,
    tags: article.tags,
    readingTime: article.readingTime,
    order: article.order,
    title: chosen?.title ?? en?.title ?? '',
    preview: chosen?.preview ?? en?.preview ?? '',
    content: chosen?.content ?? en?.content ?? '',
  };
}

knowledge.get('/articles', zValidator('query', knowledgeListQuerySchema), async (c) => {
  try {
    const q = c.req.valid('query');
    const locale = (c.get('locale') as AppLocale | undefined) ?? DEFAULT_LOCALE;
    const filter: Record<string, unknown> = { published: true };
    if (q.category) filter.categoryId = q.category;
    if (q.tag) filter.tags = q.tag;

    const items = await getCollections().knowledgeArticles
      .find(filter)
      .sort({ categoryId: 1, order: 1 })
      .toArray();

    const matches = q.q
      ? items.filter((a) => {
          const haystack = `${a.i18n.en?.title ?? ''} ${a.i18n[locale]?.title ?? ''}`.toLowerCase();
          return haystack.includes(q.q!.toLowerCase());
        })
      : items;

    return c.json({ items: matches.map((a) => localize(a, locale)) });
  } catch (err) { return handle(err, c); }
});

knowledge.get('/articles/:slug', zValidator('param', z.object({ slug: z.string() })), async (c) => {
  try {
    const { slug } = c.req.valid('param');
    const locale = (c.get('locale') as AppLocale | undefined) ?? DEFAULT_LOCALE;
    const doc = await getCollections().knowledgeArticles.findOne({ slug, published: true });
    if (!doc) throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });
    return c.json({ article: localize(doc, locale) });
  } catch (err) { return handle(err, c); }
});

export { knowledge as knowledgeRoutes };
