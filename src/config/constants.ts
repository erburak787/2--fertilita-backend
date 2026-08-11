// ============================================================================
// RATE LIMITING
// ============================================================================

export const AUTH_RATE_LIMIT_ATTEMPTS = 20;
export const AUTH_RATE_LIMIT_WINDOW_MINUTES = 15;

// `/auth/init` is idempotent and deviceId-scoped — it can't be used to
// brute-force credentials, so the limit is looser than credential endpoints.
// Prevents dev-loop 429s (sign in → sign out → re-init) from wedging the app.
export const AUTH_INIT_RATE_LIMIT_ATTEMPTS = 120;
export const AUTH_INIT_RATE_LIMIT_WINDOW_MINUTES = 15;

// Shared by /password-reset/{request,verify,confirm} + a couple of low-value
// endpoints. 10/hour per IP: tight enough to block spam, loose enough that a
// real user who mistypes their OTP a few times doesn't get locked out — and
// wide enough for dev iteration. Brute-forcing the OTP itself is separately
// bounded by MAX_OTP_ATTEMPTS in passwordReset.service.ts.
export const PASSWORD_RESET_RATE_LIMIT_ATTEMPTS = 10;
export const PASSWORD_RESET_RATE_LIMIT_WINDOW_MINUTES = 60;

export const API_RATE_LIMIT_REQUESTS = 100;
export const API_RATE_LIMIT_WINDOW_MINUTES = 1;

// ============================================================================
// EXTERNAL API
// ============================================================================

export const EXTERNAL_API_TIMEOUT_MS = 10_000;

// ============================================================================
// PAGINATION
// ============================================================================

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

// ============================================================================
// SOFT-DELETE TTL
//
// ⚠️  Fertilita-specific tightening. Habit Tracker has no TTL on soft-deleted
//    user data; Fertilita does because the data is GDPR Art. 9 special-
//    category health information. After 7 days, the auto-purge index drops
//    soft-deleted rows permanently. Account deletion still performs an
//    explicit cascade hard-delete on top of this.
// ============================================================================

export const SOFT_DELETE_TTL_DAYS = 7;
export const SOFT_DELETE_TTL_SECONDS = SOFT_DELETE_TTL_DAYS * 24 * 60 * 60;

// ============================================================================
// I18N
//
// Currently shipping en + de only. The i18n table is keyed by AppLocale so
// adding fr/es/pt/it/ja/ko/nl later is a JSON-only addition.
// ============================================================================

export const SUPPORTED_LOCALES = ['en', 'de'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'en';

// ============================================================================
// JOURNEY DATA
// ============================================================================

export const MAX_ATTEMPTS_PER_USER = 50;
export const MAX_EVENTS_PER_ATTEMPT = 500;
export const MAX_JOURNAL_ENTRIES_PER_USER = 5_000;

// ============================================================================
// SUBSCRIPTION
// ============================================================================

export const TRIAL_DURATION_DAYS = 7;
export const GRACE_PERIOD_DAYS = 16;
export const MAX_ADMIN_TRIAL_EXTENSION_DAYS = 90;

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export const NOTIFICATION_LOG_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const NOTIFICATION_SCHEDULER_POLL_MS = 60_000;
