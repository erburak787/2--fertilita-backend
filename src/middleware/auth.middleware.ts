import type { Context as HonoContext, Next } from 'hono';
import { verifyAccessToken } from '../utils/jwt';
import { getCollections } from '../db/collections';
import { t } from '../utils/i18n';
import type { User } from '../schemas/user.schema';

export interface ExtractedAuth {
  user: User | null;
  userId: string | null;
}

export async function extractAuthContext(authHeader: string | undefined): Promise<ExtractedAuth> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { user: null, userId: null };
  }

  const token = authHeader.slice(7);
  const decoded = verifyAccessToken(token);
  if (!decoded) return { user: null, userId: null };

  try {
    const collections = getCollections();
    const user = await collections.users.findOne({
      _id: decoded.sub,
      deletedAt: { $in: [null, undefined] } as any,
    });
    if (!user) return { user: null, userId: null };
    return { user, userId: user._id };
  } catch (error) {
    console.error('[extractAuthContext]', error);
    return { user: null, userId: null };
  }
}

export function protectedRoute() {
  return async (c: HonoContext, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'UNAUTHORIZED', message: t(c, 'error_unauthorized') }, 401);
    }
    const auth = await extractAuthContext(authHeader);
    if (!auth.user || !auth.userId) {
      return c.json({ error: 'UNAUTHORIZED', message: t(c, 'auth_token_invalid') }, 401);
    }
    c.set('user', auth.user);
    c.set('userId', auth.userId);
    await next();
  };
}
