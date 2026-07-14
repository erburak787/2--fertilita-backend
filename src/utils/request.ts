import type { Context } from 'hono';

// Best-effort client IP extraction. Trusts the first hop of X-Forwarded-For;
// only used for rate-limit and audit metadata — never for authorization.
export function getIpFromContext(c: Context): string | undefined {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim();
  return c.req.header('x-real-ip') ?? undefined;
}
