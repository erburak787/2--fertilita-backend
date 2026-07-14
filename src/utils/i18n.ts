import type { Context } from 'hono';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type AppLocale } from '../config/constants';

// Structured as Record<AppLocale, Record<TKey, string>> so adding fr/es/pt/it
// /ja/ko/nl later is a JSON-only addition (no code changes).
const STRINGS = {
  en: {
    error_internal: 'Something went wrong. Please try again.',
    error_unauthorized: 'You are not authorized.',
    error_forbidden: 'You do not have permission to perform this action.',
    error_not_found: 'Not found.',
    error_bad_request: 'Invalid request.',
    error_conflict: 'This resource already exists.',
    error_too_many_requests: 'Too many requests. Please slow down.',
    error_not_implemented: 'This feature is not yet available.',
    auth_invalid_credentials: 'Invalid email or password.',
    auth_email_in_use: 'This email is already registered.',
    auth_password_too_short: 'Password must be at least 8 characters.',
    auth_password_needs_lowercase: 'Password must include a lowercase letter.',
    auth_password_needs_uppercase: 'Password must include an uppercase letter.',
    auth_password_needs_digit: 'Password must include a number.',
    auth_token_invalid: 'Sign-in token is invalid or expired.',
    auth_account_deleted: 'Account scheduled for deletion.',
    reminder_generic: 'Time for your reminder.',
  },
  de: {
    error_internal: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.',
    error_unauthorized: 'Nicht autorisiert.',
    error_forbidden: 'Du hast keine Berechtigung für diese Aktion.',
    error_not_found: 'Nicht gefunden.',
    error_bad_request: 'Ungültige Anfrage.',
    error_conflict: 'Diese Ressource existiert bereits.',
    error_too_many_requests: 'Zu viele Anfragen. Bitte langsamer.',
    error_not_implemented: 'Diese Funktion ist noch nicht verfügbar.',
    auth_invalid_credentials: 'E-Mail oder Passwort ist falsch.',
    auth_email_in_use: 'Diese E-Mail ist bereits registriert.',
    auth_password_too_short: 'Das Passwort muss mindestens 8 Zeichen lang sein.',
    auth_password_needs_lowercase: 'Das Passwort muss einen Kleinbuchstaben enthalten.',
    auth_password_needs_uppercase: 'Das Passwort muss einen Großbuchstaben enthalten.',
    auth_password_needs_digit: 'Das Passwort muss eine Zahl enthalten.',
    auth_token_invalid: 'Anmelde-Token ist ungültig oder abgelaufen.',
    auth_account_deleted: 'Konto zur Löschung vorgemerkt.',
    reminder_generic: 'Zeit für deine Erinnerung.',
  },
} as const satisfies Record<AppLocale, Record<string, string>>;

export type TranslationKey = keyof (typeof STRINGS)['en'];

export function parseAcceptLanguage(header: string | undefined): AppLocale {
  if (!header) return DEFAULT_LOCALE;
  const candidates = header
    .split(',')
    .map((part) => part.trim().split(';')[0]!.toLowerCase().split('-')[0]!)
    .filter(Boolean);
  for (const code of candidates) {
    if ((SUPPORTED_LOCALES as readonly string[]).includes(code)) return code as AppLocale;
  }
  return DEFAULT_LOCALE;
}

export function translate(locale: AppLocale, key: TranslationKey): string {
  return STRINGS[locale]?.[key] ?? STRINGS[DEFAULT_LOCALE][key];
}

export function t(c: Context, key: TranslationKey): string {
  const locale = (c.get('locale') as AppLocale | undefined) ?? DEFAULT_LOCALE;
  return translate(locale, key);
}
