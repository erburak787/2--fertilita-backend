// Fertilita handles GDPR Art. 9 special-category health data. Any custom
// logging in route handlers MUST go through this helper so we never persist
// medication names, clinic names, dosages, partner identifiers, attempt IDs,
// or free-text notes into log streams.
//
// Pair with Hono's default logger() (request line only — no bodies).

const REDACT_KEYS = new Set([
  'medicationName',
  'medication',
  'medications',
  'dosage',
  'clinic',
  'clinicName',
  'doctor',
  'partnerName',
  'partnerId',
  'attemptId',
  'attemptName',
  'notes',
  'note',
  'symptoms',
  'symptom',
  'diagnosis',
  'cycleDay',
  'lastPeriodDate',
  'embryoId',
  'documentId',
  'documentName',
  'email',
  'password',
  'accessToken',
  'refreshToken',
  'idToken',
  'authorization',
]);

const REDACTED = '[redacted]';

export function redact<T>(value: T): T {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v)) as unknown as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(k)) {
        out[k] = REDACTED;
      } else if (typeof v === 'object' && v !== null) {
        out[k] = redact(v);
      } else {
        out[k] = v;
      }
    }
    return out as T;
  }
  return value;
}

export function safeLog(label: string, payload: unknown): void {
  // eslint-disable-next-line no-console
  console.log(label, redact(payload));
}

export function safeError(label: string, payload: unknown): void {
  // eslint-disable-next-line no-console
  console.error(label, redact(payload));
}
