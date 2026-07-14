import type { Context, Next } from 'hono';
import { parseAcceptLanguage } from '../utils/i18n';

export function i18nMiddleware() {
  return async (c: Context, next: Next) => {
    const header = c.req.header('Accept-Language');
    c.set('locale', parseAcceptLanguage(header));
    await next();
  };
}
