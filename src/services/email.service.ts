import { env } from '../env';
import type { AppLocale } from '../config/constants';

// Transport-agnostic email service. Real transport (Resend / Postmark / SES)
// is plugged in via env: EMAIL_TRANSPORT + provider-specific keys. In dev,
// falls back to console.log so the reset flow can be exercised end-to-end
// without a real inbox.

export interface SendPasswordResetEmailParams {
  to: string;
  displayName?: string;
  code: string;
  locale?: AppLocale;
}

interface EmailBody {
  subject: string;
  text: string;
  html: string;
}

// OTP flow — email carries a 6-digit code the user types back into the app.
// Kept simple on purpose: no deep-link, no domain dependency. Once the
// client verifies fertilita.app in Resend + configures universal links,
// this template can be swapped for a hybrid (code + tap-to-open) template.
function buildResetBody(params: SendPasswordResetEmailParams): EmailBody {
  const locale = params.locale ?? 'en';
  const code = params.code;
  const greeting = params.displayName ? params.displayName : (locale === 'de' ? 'Hallo' : 'Hello');
  const codeHtml =
    `<p style="font-size:28px;font-weight:600;letter-spacing:6px;margin:16px 0">${code}</p>`;

  if (locale === 'de') {
    return {
      subject: `Fertilita — Dein Bestätigungscode: ${code}`,
      text: `${greeting},\n\nDein Code zum Zurücksetzen des Passworts:\n\n${code}\n\nDer Code ist 15 Minuten gültig. Wenn du das nicht angefordert hast, kannst du diese Nachricht ignorieren.`,
      html: `<p>${greeting},</p><p>Dein Code zum Zurücksetzen des Passworts:</p>${codeHtml}<p>Der Code ist 15 Minuten gültig. Wenn du das nicht angefordert hast, kannst du diese Nachricht ignorieren.</p>`,
    };
  }

  return {
    subject: `Fertilita — Your verification code: ${code}`,
    text: `${greeting},\n\nYour password reset code:\n\n${code}\n\nThis code is valid for 15 minutes. If you didn't request this, you can safely ignore this message.`,
    html: `<p>${greeting},</p><p>Your password reset code:</p>${codeHtml}<p>This code is valid for 15 minutes. If you didn't request this, you can safely ignore this message.</p>`,
  };
}

async function callResend(from: string, to: string, body: EmailBody, apiKey: string): Promise<Response> {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject: body.subject, text: body.text, html: body.html }),
  });
}

async function sendViaResend(to: string, body: EmailBody): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const fallbackFrom = process.env.FALLBACK_EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error('EMAIL_TRANSPORT=resend requires RESEND_API_KEY and EMAIL_FROM');
  }

  let res = await callResend(from, to, body, apiKey);

  // If the primary `from` domain isn't verified yet, Resend returns 403
  // validation_error. Fall back to onboarding@resend.dev so dev testing
  // works even before DNS propagation. In production, do NOT fall back —
  // silently switching senders would mask a misconfiguration.
  if (res.status === 403 && fallbackFrom && env.NODE_ENV !== 'production') {
    const errBody = await res.text().catch(() => '');
    console.warn(
      `[email] Primary sender "${from}" rejected by Resend (likely unverified domain). ` +
      `Falling back to "${fallbackFrom}". Response: ${errBody.slice(0, 200)}`
    );
    res = await callResend(fallbackFrom, to, body, apiKey);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend send failed (${res.status}): ${text.slice(0, 200)}`);
  }

  // Log the Resend message id in dev so we can trace delivery in the
  // Resend dashboard when a user says "I didn't get the email".
  if (env.NODE_ENV !== 'production') {
    const json = await res.clone().json().catch(() => null) as { id?: string } | null;
    if (json?.id) console.log(`[email] Resend accepted (id=${json.id}) to=${to}`);
  }
}

async function sendViaConsole(to: string, body: EmailBody): Promise<void> {
  console.log('───────── [email:console] ─────────');
  console.log(`To:      ${to}`);
  console.log(`Subject: ${body.subject}`);
  console.log(body.text);
  console.log('───────────────────────────────────');
}

export interface SendEmailChangeCodeParams {
  to: string;
  displayName?: string;
  code: string;
  locale?: AppLocale;
  step: 'current' | 'new';
}

function buildEmailChangeCodeBody(params: SendEmailChangeCodeParams): EmailBody {
  const locale = params.locale ?? 'en';
  const code = params.code;
  const greeting = params.displayName ? params.displayName : (locale === 'de' ? 'Hallo' : 'Hello');
  const codeHtml =
    `<p style="font-size:28px;font-weight:600;letter-spacing:6px;margin:16px 0">${code}</p>`;

  if (locale === 'de') {
    return {
      subject: `Fertilita — Bestätigungscode: ${code}`,
      text: `${greeting},\n\nDein Bestätigungscode:\n\n${code}\n\nDer Code ist 15 Minuten gültig. Wenn du das nicht angefordert hast, kannst du diese Nachricht ignorieren.`,
      html: `<p>${greeting},</p><p>Dein Bestätigungscode:</p>${codeHtml}<p>Der Code ist 15 Minuten gültig. Wenn du das nicht angefordert hast, kannst du diese Nachricht ignorieren.</p>`,
    };
  }

  return {
    subject: `Fertilita — Your verification code: ${code}`,
    text: `${greeting},\n\nYour verification code:\n\n${code}\n\nThis code is valid for 15 minutes. If you didn't request this, you can safely ignore this message.`,
    html: `<p>${greeting},</p><p>Your verification code:</p>${codeHtml}<p>This code is valid for 15 minutes. If you didn't request this, you can safely ignore this message.</p>`,
  };
}

async function dispatch(to: string, body: EmailBody, contextLabel: string): Promise<void> {
  const transport = (process.env.EMAIL_TRANSPORT ?? 'console').toLowerCase();
  try {
    if (transport === 'resend') {
      await sendViaResend(to, body);
    } else {
      if (env.NODE_ENV === 'production') {
        throw new Error('EMAIL_TRANSPORT is not configured for production');
      }
      await sendViaConsole(to, body);
    }
  } catch (err) {
    if (env.NODE_ENV === 'production') {
      console.error(`[email] ${contextLabel} send failed`, err);
    } else {
      console.error(`[email] ❌ ${contextLabel} send failed:`, err);
      console.error('[email]    to=%s transport=%s from=%s', to, transport, process.env.EMAIL_FROM);
    }
  }
}

export async function sendEmailChangeCode(params: SendEmailChangeCodeParams): Promise<void> {
  const body = buildEmailChangeCodeBody(params);
  await dispatch(params.to, body, `email change code (${params.step})`);
}

// Notification to OLD address after commit. Opaque copy per Fertilita's
// post-Dobbs constraint — no fertility/health context in the notice.
export async function sendEmailChangedNotification(params: {
  to: string;
  displayName?: string;
  locale?: AppLocale;
}): Promise<void> {
  const locale = params.locale ?? 'en';
  const greeting = params.displayName ? params.displayName : (locale === 'de' ? 'Hallo' : 'Hello');
  const body: EmailBody = locale === 'de'
    ? {
        subject: 'Fertilita — Deine E-Mail-Adresse wurde geändert',
        text: `${greeting},\n\nDie mit deinem Konto verknüpfte E-Mail-Adresse wurde geändert. Wenn du das warst, brauchst du nichts weiter zu tun. Falls nicht, kontaktiere uns umgehend.`,
        html: `<p>${greeting},</p><p>Die mit deinem Konto verknüpfte E-Mail-Adresse wurde geändert. Wenn du das warst, brauchst du nichts weiter zu tun. Falls nicht, kontaktiere uns umgehend.</p>`,
      }
    : {
        subject: 'Fertilita — Your email address was changed',
        text: `${greeting},\n\nThe email address on your account was changed. If this was you, no further action is needed. If not, please contact us right away.`,
        html: `<p>${greeting},</p><p>The email address on your account was changed. If this was you, no further action is needed. If not, please contact us right away.</p>`,
      };
  await dispatch(params.to, body, 'email-changed notice');
}

// ── Wishlist redemption OTP ─────────────────────────────────────────────
export interface SendWishlistCodeParams {
  to: string;
  code: string;
  locale?: AppLocale;
}

// Wishlist expiry reminders (30 / 15 / 0 days out). Opaque copy per Fertilita's
// post-Dobbs constraint — never reference cycle, fertility, pregnancy, or
// health. Neutral "access is ending" framing only.
export interface SendWishlistReminderEmailParams {
  to: string;
  daysLeft: 30 | 15 | 0;
  locale?: AppLocale;
}

function buildWishlistReminderBody(params: SendWishlistReminderEmailParams): EmailBody {
  const locale = params.locale ?? 'en';
  const { daysLeft } = params;

  if (locale === 'de') {
    if (daysLeft === 30) {
      return {
        subject: 'Fertilita — Dein Zugang endet in 30 Tagen',
        text: 'Hallo,\n\nDein Fertilita-Zugang endet in 30 Tagen. Du kannst jederzeit verlängern, um alles zu behalten, was du eingerichtet hast.',
        html: '<p>Hallo,</p><p>Dein Fertilita-Zugang endet in 30 Tagen. Du kannst jederzeit verlängern, um alles zu behalten, was du eingerichtet hast.</p>',
      };
    }
    if (daysLeft === 15) {
      return {
        subject: 'Fertilita — Dein Zugang endet in 15 Tagen',
        text: 'Hallo,\n\nDein Fertilita-Zugang endet in 15 Tagen.',
        html: '<p>Hallo,</p><p>Dein Fertilita-Zugang endet in 15 Tagen.</p>',
      };
    }
    return {
      subject: 'Fertilita — Dein Zugang endet heute',
      text: 'Hallo,\n\nDein Fertilita-Zugang endet heute.',
      html: '<p>Hallo,</p><p>Dein Fertilita-Zugang endet heute.</p>',
    };
  }

  if (daysLeft === 30) {
    return {
      subject: 'Fertilita — Your access ends in 30 days',
      text: 'Hello,\n\nYour Fertilita access ends in 30 days. Renew any time to keep everything you have.',
      html: '<p>Hello,</p><p>Your Fertilita access ends in 30 days. Renew any time to keep everything you have.</p>',
    };
  }
  if (daysLeft === 15) {
    return {
      subject: 'Fertilita — Your access ends in 15 days',
      text: 'Hello,\n\nYour Fertilita access ends in 15 days.',
      html: '<p>Hello,</p><p>Your Fertilita access ends in 15 days.</p>',
    };
  }
  return {
    subject: 'Fertilita — Your access ends today',
    text: 'Hello,\n\nYour Fertilita access ends today.',
    html: '<p>Hello,</p><p>Your Fertilita access ends today.</p>',
  };
}

export async function sendWishlistReminderEmail(
  params: SendWishlistReminderEmailParams
): Promise<void> {
  const body = buildWishlistReminderBody(params);
  await dispatch(params.to, body, `wishlist expiry reminder (day${params.daysLeft})`);
}

export async function sendWishlistRedemptionCode(params: SendWishlistCodeParams): Promise<void> {
  const locale = params.locale ?? 'en';
  const code = params.code;
  const codeHtml =
    `<p style="font-size:28px;font-weight:600;letter-spacing:6px;margin:16px 0">${code}</p>`;

  const body: EmailBody = locale === 'de'
    ? {
        subject: `Fertilita — Dein Zugangscode: ${code}`,
        text: `Hallo,\n\nDein Code zum Einlösen deines Zugangs:\n\n${code}\n\nDer Code ist 15 Minuten gültig.`,
        html: `<p>Hallo,</p><p>Dein Code zum Einlösen deines Zugangs:</p>${codeHtml}<p>Der Code ist 15 Minuten gültig.</p>`,
      }
    : {
        subject: `Fertilita — Your access code: ${code}`,
        text: `Hello,\n\nYour redemption code:\n\n${code}\n\nThis code is valid for 15 minutes.`,
        html: `<p>Hello,</p><p>Your redemption code:</p>${codeHtml}<p>This code is valid for 15 minutes.</p>`,
      };

  await dispatch(params.to, body, 'wishlist code');
}

export async function sendPasswordResetEmail(params: SendPasswordResetEmailParams): Promise<void> {
  const body = buildResetBody(params);
  const transport = (process.env.EMAIL_TRANSPORT ?? 'console').toLowerCase();

  try {
    if (transport === 'resend') {
      await sendViaResend(params.to, body);
    } else {
      if (env.NODE_ENV === 'production') {
        // Fail loudly rather than silently drop a real user's reset email.
        throw new Error('EMAIL_TRANSPORT is not configured for production');
      }
      await sendViaConsole(params.to, body);
    }
  } catch (err) {
    // Prod: swallow silently so we don't leak transport state to callers.
    // Dev: loud stack trace so `bun run dev` terminal shows the failure —
    // otherwise devs waste time wondering why the "success" toast never
    // resulted in an email arriving.
    if (env.NODE_ENV === 'production') {
      console.error('[email] password reset send failed', err);
    } else {
      console.error('[email] ❌ password reset send failed:', err);
      console.error('[email]    to=%s transport=%s from=%s', params.to, transport, process.env.EMAIL_FROM);
    }
  }
}
