import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ApiError } from '../utils/errors';
import { t } from '../utils/i18n';
import { getCollections } from '../db/collections';
import { listSupportMessagesQuerySchema, type SupportMessage } from '../schemas/supportMessage.schema';
import { DEFAULT_LOCALE, type AppLocale } from '../config/constants';
import type { BaseVariables } from '../types/context';

const support = new Hono<{ Variables: BaseVariables }>();

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[support]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

function pickBody(msg: SupportMessage, locale: AppLocale): string {
  const localized = (msg.i18n as Record<string, string | undefined>)[locale];
  return localized ?? msg.i18n.en;
}

function weightedShuffle(items: SupportMessage[], limit: number): SupportMessage[] {
  // Efraimidis-Spirakis weighted reservoir sample.
  const scored = items.map((it) => ({
    it,
    key: Math.pow(Math.random(), 1 / Math.max(1, it.weight)),
  }));
  scored.sort((a, b) => b.key - a.key);
  return scored.slice(0, limit).map((s) => s.it);
}

support.get('/messages', zValidator('query', listSupportMessagesQuerySchema), async (c) => {
  try {
    const q = c.req.valid('query');
    const locale = (c.get('locale') as AppLocale | undefined) ?? DEFAULT_LOCALE;

    const filter: Record<string, unknown> = { isActive: true };
    if (q.category) filter.category = q.category;
    if (q.phase) filter.phase = q.phase;

    const pool = await getCollections().supportMessages
      .find(filter)
      .limit(500)
      .toArray();

    const picked = weightedShuffle(pool, q.limit);
    return c.json({
      items: picked.map((m) => ({
        id: m._id,
        category: m.category,
        phase: m.phase ?? null,
        body: pickBody(m, locale),
      })),
    });
  } catch (err) { return handle(err, c); }
});

export { support as supportRoutes };
