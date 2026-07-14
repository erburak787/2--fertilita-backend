import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { apiRoutes } from '../routes';
import { i18nMiddleware } from '../middleware/i18n.middleware';
import type { BaseVariables } from '../types/context';

function buildApp() {
  const app = new Hono<{ Variables: BaseVariables }>();
  app.use('*', i18nMiddleware());
  app.route('/api', apiRoutes);
  return app;
}

describe('auth + DSAR export', () => {
  const app = buildApp();

  test('signup then DSAR export streams the caller data', async () => {
    const signupRes = await app.request('/api/auth/signup/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `dsar-${Date.now()}@example.com`,
        password: 'Passw0rd!123',
        displayName: 'DSAR Test',
      }),
    });
    expect(signupRes.status).toBe(201);
    const signupBody = (await signupRes.json()) as {
      user: { _id: string; email: string };
      accessToken: string;
      refreshToken: string;
    };
    expect(signupBody.accessToken).toBeTruthy();

    const exportRes = await app.request('/api/auth/account/export', {
      method: 'POST',
      headers: { Authorization: `Bearer ${signupBody.accessToken}` },
    });
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get('content-type')).toContain('application/json');
    const exportBody = (await exportRes.json()) as {
      exportedAt: string;
      schemaVersion: number;
      user: { _id: string; email: string };
      attempts: unknown[];
      events: unknown[];
      journalEntries: unknown[];
    };
    expect(exportBody.schemaVersion).toBe(1);
    expect(exportBody.user._id).toBe(signupBody.user._id);
    expect(exportBody.user.email).toBe(signupBody.user.email);
    expect(Array.isArray(exportBody.attempts)).toBe(true);
    expect(Array.isArray(exportBody.events)).toBe(true);
    expect(Array.isArray(exportBody.journalEntries)).toBe(true);
  });

  test('DSAR export without auth returns 401', async () => {
    const res = await app.request('/api/auth/account/export', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
