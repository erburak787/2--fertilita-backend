import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { protectedRoute } from '../middleware/auth.middleware';
import { ApiError } from '../utils/errors';
import { t } from '../utils/i18n';
import { getCollections } from '../db/collections';
import { generateId } from '../utils/id';
import { getNow } from '../utils/date';
import { reflectionInputSchema, affirmationQuerySchema } from '../schemas/ai.schema';
import type { AuthVariables } from '../types/context';

// Stub implementations. The mobile client already calls these endpoints
// (see services/ai/* in fertilita-app) — we return 501 with a stable shape
// so swapping in a real LLM later is a service-layer change only.

const ai = new Hono<{ Variables: AuthVariables }>();
ai.use('/*', protectedRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[ai]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

async function logRequest(userId: string, endpoint: 'reflect' | 'affirmation') {
  await getCollections().aiRequestLogs.insertOne({
    _id: generateId(),
    userId,
    endpoint,
    status: 'stub',
    createdAt: getNow(),
  });
}

ai.post('/reflect', zValidator('json', reflectionInputSchema), async (c) => {
  try {
    await logRequest(c.get('userId'), 'reflect');
    return c.json(
      { error: 'NOT_IMPLEMENTED', message: t(c, 'error_not_implemented') },
      501
    );
  } catch (err) { return handle(err, c); }
});

ai.get('/affirmation', zValidator('query', affirmationQuerySchema), async (c) => {
  try {
    await logRequest(c.get('userId'), 'affirmation');
    return c.json(
      { error: 'NOT_IMPLEMENTED', message: t(c, 'error_not_implemented') },
      501
    );
  } catch (err) { return handle(err, c); }
});

export { ai as aiRoutes };
