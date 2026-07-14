import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { env } from '../env';

// Minimal /health smoke test — mirrors src/index.ts wiring without booting the
// full server. If this fails, env validation or the base Hono handler broke.

describe('GET /health', () => {
  const app = new Hono();
  app.get('/health', (c) =>
    c.json({ ok: true, name: 'fertilita-backend', env: env.NODE_ENV, time: new Date().toISOString() })
  );

  test('returns ok payload', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; env: string };
    expect(body.ok).toBe(true);
    expect(body.env).toBe('test');
  });
});
