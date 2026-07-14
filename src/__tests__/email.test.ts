// Smoke tests for the email transport. Real Resend calls are stubbed via
// a fetch mock; we're just verifying the code paths, not delivery.

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { sendPasswordResetEmail } from '../services/email.service';

let originalFetch: typeof fetch;
let originalTransport: string | undefined;
let originalKey: string | undefined;
let originalFrom: string | undefined;
let logs: string[] = [];
let originalLog: typeof console.log;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalTransport = process.env.EMAIL_TRANSPORT;
  originalKey = process.env.RESEND_API_KEY;
  originalFrom = process.env.EMAIL_FROM;
  logs = [];
  originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.EMAIL_TRANSPORT = originalTransport;
  process.env.RESEND_API_KEY = originalKey;
  process.env.EMAIL_FROM = originalFrom;
  console.log = originalLog;
});

describe('email.service — console transport', () => {
  it('logs the OTP code in plaintext (dev only)', async () => {
    process.env.EMAIL_TRANSPORT = 'console';
    await sendPasswordResetEmail({
      to: 'user@example.com',
      displayName: 'Sam',
      code: '987654',
      locale: 'en',
    });
    const joined = logs.join('\n');
    expect(joined).toContain('user@example.com');
    expect(joined).toContain('verification code');
    expect(joined).toContain('987654');
  });

  it('routes German locale to the DE copy', async () => {
    process.env.EMAIL_TRANSPORT = 'console';
    await sendPasswordResetEmail({
      to: 'ute@example.com',
      code: '111111',
      locale: 'de',
    });
    const joined = logs.join('\n');
    expect(joined).toContain('Bestätigungscode');
  });
});

describe('email.service — resend transport', () => {
  it('POSTs to the Resend API with the expected payload shape', async () => {
    process.env.EMAIL_TRANSPORT = 'resend';
    process.env.RESEND_API_KEY = 'test-key';
    process.env.EMAIL_FROM = 'no-reply@fertilita.app';

    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ id: 'stub' }), { status: 200 });
    }) as unknown as typeof fetch;

    await sendPasswordResetEmail({
      to: 'user@example.com',
      code: '424242',
      locale: 'en',
    });

    expect(capturedUrl).toBe('https://api.resend.com/emails');
    expect(capturedInit?.method).toBe('POST');
    const body = JSON.parse(String(capturedInit?.body));
    expect(body.to).toBe('user@example.com');
    expect(body.from).toBe('no-reply@fertilita.app');
    expect(body.subject).toContain('verification code');
    expect(body.text).toContain('424242');
  });

  it('does not throw on Resend 4xx — enumeration protection is preserved', async () => {
    process.env.EMAIL_TRANSPORT = 'resend';
    process.env.RESEND_API_KEY = 'test-key';
    process.env.EMAIL_FROM = 'no-reply@fertilita.app';
    globalThis.fetch = mock(async () =>
      new Response('bad', { status: 400 })
    ) as unknown as typeof fetch;

    // Should NOT throw — email.service is intentionally swallowed by design.
    await sendPasswordResetEmail({
      to: 'user@example.com',
      code: '000000',
      locale: 'en',
    });
    // If we got here, the promise resolved. Assertion is the absence of throw.
    expect(true).toBe(true);
  });
});
