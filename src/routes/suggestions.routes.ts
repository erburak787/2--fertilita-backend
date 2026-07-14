import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { protectedRoute } from '../middleware/auth.middleware';
import { passwordResetRateLimiter } from '../middleware/rateLimit.middleware';
import { ApiError } from '../utils/errors';
import { t } from '../utils/i18n';
import { getCollections } from '../db/collections';
import { generateId } from '../utils/id';
import { getNow } from '../utils/date';
import {
  createSuggestionSchema,
  type Suggestion,
} from '../schemas/suggestion.schema';
import type { AuthVariables } from '../types/context';

const suggestions = new Hono<{ Variables: AuthVariables }>();
suggestions.use('/*', protectedRoute());

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[suggestions]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

// Suggestions are text submissions; rate-limit at the same rate as password
// reset (3/hr per IP) to keep the feedback signal usable and prevent spam.
suggestions.post(
  '/',
  passwordResetRateLimiter,
  zValidator('json', createSuggestionSchema),
  async (c) => {
    try {
      const userId = c.get('userId');
      const body = c.req.valid('json');
      const now = getNow();
      const doc: Suggestion = {
        _id: generateId(),
        userId,
        category: body.category,
        title: body.title.trim(),
        body: body.body.trim(),
        status: 'new',
        createdAt: now,
        updatedAt: now,
      };
      await getCollections().suggestions.insertOne(doc);
      return c.json({ suggestion: doc }, 201);
    } catch (err) { return handle(err, c); }
  }
);

export { suggestions as suggestionsRoutes };
