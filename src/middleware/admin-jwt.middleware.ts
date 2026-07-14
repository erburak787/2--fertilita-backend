import type { Context as HonoContext, Next } from 'hono';
import { verifyAdminAccessToken } from '../utils/adminJwt';
import { getCollections } from '../db/collections';
import type { AdminRole } from '../schemas/admin.schema';
import type { AdminVariables } from '../types/context';

type AdminCtx = HonoContext<{ Variables: AdminVariables }>;

export function adminJwtRoute() {
  return async (c: AdminCtx, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'UNAUTHORIZED', message: 'Missing admin token' }, 401);
    }

    const token = authHeader.slice(7);
    const decoded = verifyAdminAccessToken(token);
    if (!decoded) {
      return c.json({ error: 'UNAUTHORIZED', message: 'Invalid or expired admin token' }, 401);
    }

    const admins = getCollections().admins;
    const admin = await admins.findOne({ _id: decoded.sub, isActive: true });
    if (!admin) {
      return c.json({ error: 'UNAUTHORIZED', message: 'Admin not found or inactive' }, 401);
    }

    c.set('admin', admin);
    await next();
  };
}

export function requireRole(...roles: AdminRole[]) {
  return async (c: AdminCtx, next: Next) => {
    const admin = c.get('admin');
    if (!admin) return c.json({ error: 'UNAUTHORIZED' }, 401);
    if (!roles.includes(admin.role)) {
      return c.json({ error: 'FORBIDDEN', message: 'Insufficient role' }, 403);
    }
    await next();
  };
}
