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

async function sendViaResend(to: string, body: EmailBody): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error('EMAIL_TRANSPORT=resend requires RESEND_API_KEY and EMAIL_FROM');
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject: body.subject, text: body.text, html: body.html }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend send failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

async function sendViaConsole(to: string, body: EmailBody): Promise<void> {
  console.log('───────── [email:console] ─────────');
  console.log(`To:      ${to}`);
  console.log(`Subject: ${body.subject}`);
  console.log(body.text);
  console.log('───────────────────────────────────');
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
    console.error('[email] password reset send failed', err);
    // Do not throw to the caller — we don't want the API to leak whether
    // the transport succeeded. The user requested reset; if delivery fails
    // they'll re-request.
  }
}
