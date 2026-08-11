import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ApiError } from '../utils/errors';
import { t } from '../utils/i18n';
import { extractAuthContext, protectedRoute } from '../middleware/auth.middleware';
import { authRateLimiter, authInitRateLimiter, passwordResetRateLimiter } from '../middleware/rateLimit.middleware';
import { getIpFromContext } from '../utils/request';
import { buildUserDsarExport } from '../services/dataExport.service';
import {
  signUpEmailSchema,
  signInEmailSchema,
  oauthSignInSchema,
  refreshTokenInputSchema,
  updateProfileSchema,
  initAnonymousInputSchema,
  buildUserPublic,
} from '../schemas/user.schema';
import {
  initAnonymousUser,
  signUpWithEmail,
  signInWithEmail,
  signInWithOAuth,
  refreshAccessToken,
  signOut,
  deleteAccount,
} from '../services/auth.service';
import {
  requestPasswordReset,
  verifyPasswordResetOtp,
  confirmPasswordReset,
} from '../services/passwordReset.service';
import {
  requestPasswordResetSchema,
  verifyPasswordResetSchema,
  confirmPasswordResetSchema,
} from '../schemas/passwordReset.schema';
import {
  requestEmailChange,
  verifyCurrentEmailOtp,
  requestNewEmailOtp,
  confirmEmailChange,
} from '../services/emailChange.service';
import {
  verifyCurrentEmailOtpSchema,
  requestNewEmailOtpSchema,
  confirmEmailChangeSchema,
} from '../schemas/emailChange.schema';
import { getCollections } from '../db/collections';
import { getNow } from '../utils/date';
import { generateId } from '../utils/id';
import { saveOnboardingAnswersInputSchema } from '../schemas/onboarding.schema';
import type { AuthVariables, BaseVariables } from '../types/context';

const auth = new Hono<{ Variables: BaseVariables }>();

function handle(err: unknown, c: any) {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.getStatusCode() as 400);
  }
  console.error('[auth]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: t(c, 'error_internal') }, 500);
}

// First-launch anonymous device auth. Uses a dedicated, generous limiter
// (authInitRateLimiter) because /init is idempotent + deviceId-scoped —
// no credential brute-force surface — and every sign-out re-triggers it.
auth.post('/init', authInitRateLimiter, zValidator('json', initAnonymousInputSchema), async (c) => {
  try {
    const result = await initAnonymousUser(c.req.valid('json'));
    return c.json(result, 201);
  } catch (err) { return handle(err, c); }
});

// If the incoming request already carries a valid anonymous Bearer token,
// resolve its userId so the service can upgrade in place instead of
// creating a second row for the same person.
async function anonymousUpgradeCandidate(c: any): Promise<string | undefined> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return undefined;
  const ctx = await extractAuthContext(authHeader);
  if (ctx.user?.isAnonymous) return ctx.userId ?? undefined;
  return undefined;
}

auth.post('/signup/email', authRateLimiter, zValidator('json', signUpEmailSchema), async (c) => {
  try {
    const body = c.req.valid('json');
    const anonymousUserId = await anonymousUpgradeCandidate(c);
    const result = await signUpWithEmail({ ...body, anonymousUserId });
    return c.json(result, 201);
  } catch (err) { return handle(err, c); }
});

auth.post('/signin/email', authRateLimiter, zValidator('json', signInEmailSchema), async (c) => {
  try {
    const body = c.req.valid('json');
    const anonymousUserId = await anonymousUpgradeCandidate(c);
    const result = await signInWithEmail({ ...body, anonymousUserId });
    return c.json(result);
  } catch (err) { return handle(err, c); }
});

auth.post('/signin/oauth', authRateLimiter, zValidator('json', oauthSignInSchema), async (c) => {
  try {
    const body = c.req.valid('json');
    const anonymousUserId = await anonymousUpgradeCandidate(c);
    const result = await signInWithOAuth({ ...body, anonymousUserId });
    return c.json(result);
  } catch (err) { return handle(err, c); }
});

auth.post('/refresh', zValidator('json', refreshTokenInputSchema), async (c) => {
  try {
    const result = await refreshAccessToken(c.req.valid('json'));
    return c.json(result);
  } catch (err) { return handle(err, c); }
});

auth.post('/signout', zValidator('json', refreshTokenInputSchema), async (c) => {
  try {
    await signOut(c.req.valid('json'));
    return c.json({ success: true });
  } catch (err) { return handle(err, c); }
});

// ---- Password reset (OTP flow) ----
// Three endpoints:
//   /request → always {success:true}, silently sends a 6-digit code by email
//              when the account exists (no enumeration leak).
//   /verify  → user submits email + code; on match returns a short-lived
//              opaque sessionToken. Wrong code returns 400 (with attempt
//              counter) — this DOES leak "an email is on the reset flow"
//              but only after the request step, which itself doesn't leak.
//   /confirm → user submits sessionToken + new password; server rotates
//              the password and revokes all sessions.
// All three share `passwordResetRateLimiter` (3/hour per IP by default).

auth.post(
  '/password-reset/request',
  passwordResetRateLimiter,
  zValidator('json', requestPasswordResetSchema),
  async (c) => {
    try {
      const { email } = c.req.valid('json');
      await requestPasswordReset({ email, ip: getIpFromContext(c) });
      return c.json({ success: true });
    } catch (err) {
      // Even on internal error, respond success so we don't leak state.
      console.error('[auth] password reset request failed', err);
      return c.json({ success: true });
    }
  },
);

auth.post(
  '/password-reset/verify',
  passwordResetRateLimiter,
  zValidator('json', verifyPasswordResetSchema),
  async (c) => {
    try {
      const result = await verifyPasswordResetOtp(c.req.valid('json'));
      return c.json(result);
    } catch (err) { return handle(err, c); }
  },
);

auth.post(
  '/password-reset/confirm',
  passwordResetRateLimiter,
  zValidator('json', confirmPasswordResetSchema),
  async (c) => {
    try {
      await confirmPasswordReset(c.req.valid('json'));
      return c.json({ success: true });
    } catch (err) { return handle(err, c); }
  },
);

// ---- Protected routes ----
const me = new Hono<{ Variables: AuthVariables }>();
me.use('/*', protectedRoute());

me.get('/me', (c) => {
  const user = c.get('user');
  return c.json({ user: buildUserPublic(user) });
});

me.put('/me', zValidator('json', updateProfileSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = c.req.valid('json');
    const now = getNow();
    await getCollections().users.updateOne(
      { _id: userId },
      { $set: { ...body, updatedAt: now } }
    );
    const updated = await getCollections().users.findOne({ _id: userId });
    if (!updated) throw new ApiError({ code: 'NOT_FOUND', message: t(c, 'error_not_found') });
    return c.json({ user: buildUserPublic(updated) });
  } catch (err) { return handle(err, c); }
});

me.delete('/account', async (c) => {
  try {
    await deleteAccount(c.get('userId'));
    return c.json({ success: true, message: t(c, 'auth_account_deleted') });
  } catch (err) { return handle(err, c); }
});

// GDPR DSAR export. Tight rate limit — 3/hr — because payloads are heavy.
me.post('/account/export', passwordResetRateLimiter, async (c) => {
  try {
    const data = await buildUserDsarExport(c.get('userId'));
    c.header('Content-Type', 'application/json; charset=utf-8');
    c.header(
      'Content-Disposition',
      `attachment; filename="fertilita-export-${data.user._id}-${new Date().toISOString().slice(0, 10)}.json"`
    );
    return c.body(JSON.stringify(data, null, 2));
  } catch (err) { return handle(err, c); }
});

// Onboarding answers (mirrors Habit Tracker's PUT/GET pattern).
me.put(
  '/onboarding/answers',
  zValidator('json', saveOnboardingAnswersInputSchema),
  async (c) => {
    try {
      const userId = c.get('userId');
      const input = c.req.valid('json');
      const now = getNow();
      await getCollections().onboardingAnswers.updateOne(
        { userId },
        {
          $set: { ...input, updatedAt: now },
          $setOnInsert: { _id: generateId(), userId, createdAt: now },
        },
        { upsert: true },
      );
      return c.json({ success: true });
    } catch (err) { return handle(err, c); }
  },
);

me.get('/onboarding/answers', async (c) => {
  try {
    const answers = await getCollections().onboardingAnswers.findOne({ userId: c.get('userId') });
    return c.json(answers ?? null);
  } catch (err) { return handle(err, c); }
});

me.post('/onboarding/complete', async (c) => {
  try {
    const userId = c.get('userId');
    await getCollections().users.updateOne(
      { _id: userId },
      { $set: { onboardingCompleted: true, updatedAt: getNow() } },
    );
    return c.json({ success: true });
  } catch (err) { return handle(err, c); }
});

// ---- Email change (OTP on OLD + NEW address) ----
// 4-step flow — all share passwordResetRateLimiter (3/hr per IP). See
// emailChange.service.ts for the state machine.
me.post('/email/change/request', passwordResetRateLimiter, async (c) => {
  try {
    await requestEmailChange({ userId: c.get('userId'), ip: getIpFromContext(c) });
    return c.json({ success: true });
  } catch (err) { return handle(err, c); }
});

me.post(
  '/email/change/verify-current',
  passwordResetRateLimiter,
  zValidator('json', verifyCurrentEmailOtpSchema),
  async (c) => {
    try {
      const result = await verifyCurrentEmailOtp({
        userId: c.get('userId'),
        code: c.req.valid('json').code,
      });
      return c.json(result);
    } catch (err) { return handle(err, c); }
  },
);

me.post(
  '/email/change/new',
  passwordResetRateLimiter,
  zValidator('json', requestNewEmailOtpSchema),
  async (c) => {
    try {
      await requestNewEmailOtp(c.req.valid('json'));
      return c.json({ success: true });
    } catch (err) { return handle(err, c); }
  },
);

me.post(
  '/email/change/confirm',
  passwordResetRateLimiter,
  zValidator('json', confirmEmailChangeSchema),
  async (c) => {
    try {
      await confirmEmailChange(c.req.valid('json'));
      return c.json({ success: true });
    } catch (err) { return handle(err, c); }
  },
);

auth.route('/', me);

export { auth as authRoutes };
