import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ApiError } from '../utils/errors';
import { t } from '../utils/i18n';
import { protectedRoute } from '../middleware/auth.middleware';
import { passwordResetRateLimiter } from '../middleware/rateLimit.middleware';
import { getIpFromContext } from '../utils/request';
import {
  requestWishlistRedemptionSchema,
  verifyWishlistRedemptionSchema,
  confirmWishlistRedemptionSchema,
} from '../schemas/wishlistRedemption.schema';
import {
  requestWishlistRedemption,
  verifyWishlistOtp,
  confirmWishlistRedemption,
} from '../services/wishlist.service';
import type { AuthVariables, BaseVariables } from '../types/context';

const wishlist = new Hono<{ Variables: BaseVariables }>();

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[wishlist]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

// Public — no auth needed. Rate-limited to match password-reset flow.
// Always returns {success:true} to prevent enumeration.
wishlist.post(
  '/redeem/request',
  passwordResetRateLimiter,
  zValidator('json', requestWishlistRedemptionSchema),
  async (c) => {
    try {
      const { email } = c.req.valid('json');
      await requestWishlistRedemption({ email, ip: getIpFromContext(c) });
      return c.json({ success: true });
    } catch (err) {
      console.error('[wishlist] request failed', err);
      return c.json({ success: true });
    }
  },
);

wishlist.post(
  '/redeem/verify',
  passwordResetRateLimiter,
  zValidator('json', verifyWishlistRedemptionSchema),
  async (c) => {
    try {
      const result = await verifyWishlistOtp(c.req.valid('json'));
      return c.json(result);
    } catch (err) { return handle(err, c); }
  },
);

// Confirm requires the caller to be signed in (even as anon device user)
// so we can attach the RC promo entitlement to their appUserId.
const authed = new Hono<{ Variables: AuthVariables }>();
authed.use('/*', protectedRoute());

authed.post(
  '/redeem/confirm',
  passwordResetRateLimiter,
  zValidator('json', confirmWishlistRedemptionSchema),
  async (c) => {
    try {
      const { sessionToken } = c.req.valid('json');
      const result = await confirmWishlistRedemption({
        sessionToken,
        userId: c.get('userId'),
      });
      return c.json(result);
    } catch (err) { return handle(err, c); }
  },
);

wishlist.route('/', authed);

export { wishlist as wishlistRoutes };
