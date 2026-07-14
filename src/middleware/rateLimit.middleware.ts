import type { Context, Next } from 'hono';
import {
  AUTH_RATE_LIMIT_ATTEMPTS,
  AUTH_RATE_LIMIT_WINDOW_MINUTES,
  AUTH_INIT_RATE_LIMIT_ATTEMPTS,
  AUTH_INIT_RATE_LIMIT_WINDOW_MINUTES,
  PASSWORD_RESET_RATE_LIMIT_ATTEMPTS,
  PASSWORD_RESET_RATE_LIMIT_WINDOW_MINUTES,
  API_RATE_LIMIT_REQUESTS,
  API_RATE_LIMIT_WINDOW_MINUTES,
} from '../config/constants';

// In-memory rate limiter. Single-instance only — swap to Redis if we ever
// run more than one Bun process behind a load balancer.

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitRecord>();

setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of store.entries()) {
    if (rec.resetAt < now) store.delete(key);
  }
}, 5 * 60 * 1000);

export interface RateLimitOptions {
  windowMs: number;
  maxAttempts: number;
  keyPrefix?: string;
}

export function createRateLimiter(opts: RateLimitOptions) {
  const { windowMs, maxAttempts, keyPrefix = '' } = opts;
  return async (c: Context, next: Next) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let record = store.get(key);
    if (!record || record.resetAt < now) {
      record = { count: 0, resetAt: now + windowMs };
      store.set(key, record);
    }
    record.count++;

    if (record.count > maxAttempts) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      c.header('X-RateLimit-Limit', String(maxAttempts));
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset', String(Math.ceil(record.resetAt / 1000)));
      return c.json({ error: 'TOO_MANY_REQUESTS', retryAfter }, 429);
    }

    c.header('X-RateLimit-Limit', String(maxAttempts));
    c.header('X-RateLimit-Remaining', String(maxAttempts - record.count));
    c.header('X-RateLimit-Reset', String(Math.ceil(record.resetAt / 1000)));
    await next();
  };
}

export const authRateLimiter = createRateLimiter({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  maxAttempts: AUTH_RATE_LIMIT_ATTEMPTS,
  keyPrefix: 'auth',
});

export const authInitRateLimiter = createRateLimiter({
  windowMs: AUTH_INIT_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  maxAttempts: AUTH_INIT_RATE_LIMIT_ATTEMPTS,
  keyPrefix: 'auth-init',
});

export const passwordResetRateLimiter = createRateLimiter({
  windowMs: PASSWORD_RESET_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  maxAttempts: PASSWORD_RESET_RATE_LIMIT_ATTEMPTS,
  keyPrefix: 'password-reset',
});

export const apiRateLimiter = createRateLimiter({
  windowMs: API_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  maxAttempts: API_RATE_LIMIT_REQUESTS,
  keyPrefix: 'api',
});
