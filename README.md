# Fertilita Backend

Hono + Bun + MongoDB backend for the Fertilita mobile app and admin console.

> Sibling to [`fertilita-app/`](../fertilita-app/) (Expo) and the planned Next 14 admin app. Forked from the Habit Tracker stack but with **own auth** (no Rork) and **fertility-domain** routes.

---

## Quick start

```bash
cd Fertilita/backend
bun install
cp .env.example .env       # then fill values manually — see §Env
bun run typecheck          # 0 errors
bun run dev                # http://localhost:3000
```

Health check: `curl http://localhost:3000/health` → `{ ok: true, ... }`

---

## Scripts

| Command                              | What it does                                                              |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `bun run dev`                        | Hot-reload server (`--watch src/index.ts`)                                |
| `bun run start`                      | Production-mode start (no watch)                                          |
| `bun run build`                      | Bundles `src/index.ts` → `dist/index.js` (Bun target, minified)           |
| `bun run typecheck`                  | `tsc --noEmit` — must pass before commit                                  |
| `bun run seed-admin`                 | Insert the first admin (reads `ADMIN_EMAIL`/`ADMIN_PASSWORD` env or args) |
| `bun run reset-admin-password`       | Reset an admin's password + revoke their refresh tokens                   |
| `bun run clear-db`                   | **Dev-only** wipe of the configured DB; refuses outside `NODE_ENV=development` unless `--force` |

---

## Architecture

```
src/
  index.ts                 # Hono bootstrap (logger → i18n → CORS → routes)
  env.ts                   # Zod-validated env at startup; process.exit(1) if invalid
  config/constants.ts      # Rate limits, TTLs, supported locales
  db/                      # MongoClient singleton, typed Collections, index creation
  middleware/              # auth, admin-jwt, i18n, rateLimit (in-memory)
  routes/                  # /api/* and /admin/*
  services/                # auth, oauth (Apple + Google), admin-auth, admin-user
  schemas/                 # Zod + types for every collection + input
  utils/                   # jwt, adminJwt, password, id, date, i18n, errors, logRedact
```

### Routes

```
GET  /health

POST /api/auth/signup/email
POST /api/auth/signin/email
POST /api/auth/signin/oauth     # provider: 'apple' | 'google'
POST /api/auth/refresh
POST /api/auth/signout
GET  /api/auth/me                (Bearer)
PUT  /api/auth/me                (Bearer)
DELETE /api/auth/account         (Bearer)  — soft-delete + cascade hard-delete

# All under /api/* require Bearer (except /knowledge/*)
/api/attempts                    CRUD, idempotent via clientId
/api/events                      CRUD, idempotent via clientId
/api/cycle                       GET/PUT cycle settings
/api/journal                     CRUD — privacy-gated (privacy.journalSyncEnabled must be true)
/api/knowledge/articles          PUBLIC — Accept-Language picks en/de
/api/ai/reflect, /api/ai/affirmation   # 501 stubs (audited)
/api/settings                    GET/PUT user settings; POST/DELETE /push-token

POST /admin/auth/login
POST /admin/auth/refresh
GET  /admin/auth/me              (Bearer admin)
POST /admin/auth/logout          (Bearer admin)
GET  /admin/users                (Bearer admin)
GET  /admin/users/:id            (Bearer admin)
DELETE /admin/users/:id          (Bearer admin, role admin|super_admin) — cascades + audit
GET  /admin/metrics              (Bearer admin) — aggregate counts only
```

---

## Env (`.env.example` ships KEYS ONLY)

All values are populated by you manually. Required keys are validated by `src/env.ts` at startup — if `JWT_ACCESS_SECRET` is blank, the process exits with a Zod error before serving traffic.

```
PORT=
NODE_ENV=

MONGODB_URI=                     # ⚠️ EU-region Atlas cluster — see §Compliance
MONGODB_DB_NAME=

JWT_ACCESS_SECRET=               # ≥32 chars
JWT_REFRESH_SECRET=              # ≥32 chars
JWT_ACCESS_EXPIRES_IN=           # e.g. 1h
JWT_REFRESH_EXPIRES_IN=          # e.g. 30d

ADMIN_JWT_SECRET=                # ≥32 chars, distinct from user JWT secrets
ADMIN_JWT_ACCESS_EXPIRES_IN=     # e.g. 15m
ADMIN_JWT_REFRESH_EXPIRES_IN=    # e.g. 7d

APPLE_CLIENT_ID=                 # iOS bundle ID — see §Apple bundle warning
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=

GOOGLE_CLIENT_ID_IOS=
GOOGLE_CLIENT_ID_ANDROID=
GOOGLE_CLIENT_ID_WEB=

EXPO_ACCESS_TOKEN=               # Server-sent push uses opaque copy only

CORS_ORIGINS=                    # comma-separated; required in production
```

**Not yet wired** (modules deferred):

- `REVENUECAT_*` — subscription module is post-MVP
- `AWS_*` / `R2_*` — document upload module is deferred for GDPR Art.9 review
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — AI endpoints are 501 stubs

---

## Compliance — read before going to production

### 1. EU data residency

Set `MONGODB_URI` to a cluster in **Frankfurt / Dublin / Paris** (or another EU region). There is no programmatic enforcement — this is operational. GDPR Art. 9 special-category health data must not cross to non-EU primaries.

### 2. Soft-delete with TTL purge

Fertility data is **soft-deleted** with `deletedAt: Date`. **Every** user-data collection has a TTL index on `deletedAt` that auto-purges rows after **7 days** (see `src/db/indexes.ts` and `SOFT_DELETE_TTL_DAYS`). This is a Fertilita-specific tightening over the Habit Tracker reference (which keeps soft-deleted user data indefinitely).

`DELETE /api/auth/account` runs:
1. Soft-delete the user row (sets `deletedAt`)
2. Cascade hard-delete dependent data (`attempts`, `events`, `journalEntries`, `userSettings`, `pushTokens`, `refreshTokens`, `aiRequestLogs`)
3. Hard-delete the user row

> ⚠️ **Pre-production action:** Have legal/privacy review this model before launch. Pure hard-delete is the safer default for Art. 9 data; the current model balances UX (undo window) against minimization.

### 3. Opaque push notifications

Server-generated push titles/bodies **must avoid** medication names, procedure names, partner identifiers, and date references. Use `src/utils/notifications.ts` → `buildOpaqueNotification()` — the helper only exports generic copy like `"Time for your reminder."`. The mobile app already enforces this client-side; the backend must match.

### 4. Log redaction

Any custom logging in route handlers **must** go through `src/utils/logRedact.ts`. It strips `medicationName`, `dosage`, `clinic`, `doctor`, `partnerName`, `attemptId`, `notes`, `symptoms`, `diagnosis`, `email`, `password`, and token fields. Hono's default `logger()` is body-blind, so unless you add custom logging this is automatic.

### 5. Locale set (day 1)

`SUPPORTED_LOCALES = ['en', 'de']`. The i18n table is structured as `Record<AppLocale, Record<TranslationKey, string>>` so adding `fr/es/pt/it/ja/ko/nl` later is a JSON edit only — no code change.

### 6. Apple bundle ID

The mobile app's [`app.json`](../fertilita-app/app.json) still uses Rork's `app.rork.fertilita-foundation` bundle. Once you re-register under your own Apple Developer account, set `APPLE_CLIENT_ID` to the new bundle ID (likely `app.fertilita.mobile` or similar) — **do not fill from the stale Rork-era bundle**.

---

## First-admin onboarding

```bash
# Option A — env
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='Strong-Password-1' bun run seed-admin

# Option B — args
bun run seed-admin -- --email=you@example.com --password='Strong-Password-1' --role=super_admin
```

Roles: `super_admin`, `admin`, `readonly`. Default is `super_admin` for the seed script.

Reset (revokes all that admin's refresh tokens):
```bash
bun run reset-admin-password -- --email=you@example.com --password='New-Password-1'
```

---

## Rate limits (in-memory, single-instance)

- `POST /api/auth/*` — 20 per 15 min per IP
- `POST /admin/auth/login` — same auth limiter
- General `/api/*` — 100 per min per IP (mounted ad-hoc; tune in `rateLimit.middleware.ts`)

If you ever horizontally scale Bun, swap the in-memory store in `src/middleware/rateLimit.middleware.ts` for Redis.

---

## Deferred modules (intentionally not built)

| Module                          | Why deferred                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Subscriptions + RevenueCat hook | Monetization undecided. Bolts on cleanly later via a self-contained route + service.                          |
| Document upload + object store  | Lab reports / ultrasound / embryology reports trigger GDPR Art. 9 + HIPAA-grade custody concerns. Needs a dedicated privacy review (encryption at rest, virus scan, signed URLs, retention). Docs stay device-local for MVP. |
| Real AI (LLM) prompts           | Mobile already calls `/api/ai/reflect` + `/api/ai/affirmation`; we return 501 with a stable shape so swapping in a real LLM is a service-layer change.|
| Tests                           | Habit Tracker has none; `bun test` can be adopted as a separate task.                                         |

---

## Deployment

- **Railway:** Uses `nixpacks.toml` + `railway.json`. `/health` is the healthcheck path.
- **Docker:** `Dockerfile` is multi-stage (`oven/bun:1`); `docker build -t fertilita-backend .` then `docker run -p 3000:3000 --env-file .env fertilita-backend`.

---

## Notable decisions

- **Own auth, no Rork.** Apple ID-token via JWKS (`jose`); Google via `tokeninfo` endpoint. 2-token system (access + refresh, refresh rotated on use; JTI stored in DB).
- **Mongo native driver** (no Mongoose). Strict types via `Collections` interface.
- **Idempotent sync.** `POST /api/attempts` and `POST /api/events` and `POST /api/journal` all dedupe on `clientId`; client may retry safely.
- **Journal privacy gate.** `/api/journal` is locked behind `privacy.journalSyncEnabled: true`. Default OFF.
- **Admin metrics surface aggregate counts only.** No per-user health data is reachable via `/admin/*` reporting endpoints.
