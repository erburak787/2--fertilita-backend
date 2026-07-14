import { z } from 'zod';

const isProduction = process.env.NODE_ENV === 'production';

const envSchema = z.object({
  // Server
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // MongoDB — EU-region cluster (see README §Compliance)
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().default('fertilita'),

  // JWT (user)
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('1h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // JWT (admin) — separate secret from user JWT
  ADMIN_JWT_SECRET: z.string().min(32, 'ADMIN_JWT_SECRET must be at least 32 characters'),
  ADMIN_JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  ADMIN_JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // OAuth: Apple (required in production)
  APPLE_CLIENT_ID: isProduction
    ? z.string().min(1, 'APPLE_CLIENT_ID is required in production')
    : z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),

  // OAuth: Google
  GOOGLE_CLIENT_ID_IOS: isProduction
    ? z.string().min(1, 'GOOGLE_CLIENT_ID_IOS is required in production')
    : z.string().optional(),
  GOOGLE_CLIENT_ID_ANDROID: z.string().optional(),
  GOOGLE_CLIENT_ID_WEB: isProduction
    ? z.string().min(1, 'GOOGLE_CLIENT_ID_WEB is required in production')
    : z.string().optional(),

  // Expo Push (opaque copy only — see notifications helper)
  EXPO_ACCESS_TOKEN: z.string().optional(),

  // Cloudflare R2 (S3-compatible) — required for the documents feature.
  // Optional in dev so /health and non-doc routes still boot without R2 creds.
  R2_ACCOUNT_ID: isProduction
    ? z.string().min(1, 'R2_ACCOUNT_ID is required in production')
    : z.string().optional(),
  R2_ACCESS_KEY_ID: isProduction
    ? z.string().min(1, 'R2_ACCESS_KEY_ID is required in production')
    : z.string().optional(),
  R2_SECRET_ACCESS_KEY: isProduction
    ? z.string().min(1, 'R2_SECRET_ACCESS_KEY is required in production')
    : z.string().optional(),
  R2_BUCKET: isProduction
    ? z.string().min(1, 'R2_BUCKET is required in production')
    : z.string().optional(),

  // RevenueCat — required to run subscription features in production.
  REVENUECAT_API_KEY_V1: isProduction
    ? z.string().min(1, 'REVENUECAT_API_KEY_V1 is required in production')
    : z.string().optional(),
  REVENUECAT_WEBHOOK_SECRET: isProduction
    ? z.string().min(1, 'REVENUECAT_WEBHOOK_SECRET is required in production')
    : z.string().optional(),

  // CORS — required in production
  CORS_ORIGINS: isProduction
    ? z.string().min(1, 'CORS_ORIGINS is required in production')
    : z.string().default('*'),

  // Universal Links / App Links.
  // - IOS_APP_ID   : "<TEAM_ID>.<BUNDLE_ID>", e.g. "ABCDE12345.app.rork.fertilita-foundation"
  // - ANDROID_PACKAGE_NAME : must match app.json android.package
  // - ANDROID_SHA256_CERT_FINGERPRINTS : comma-separated SHA-256 fingerprints
  //   from `keytool -list -v -keystore …`. Include both debug and release
  //   fingerprints for smoother testing.
  IOS_APP_ID: z.string().optional(),
  ANDROID_PACKAGE_NAME: z.string().optional(),
  ANDROID_SHA256_CERT_FINGERPRINTS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment variables:');
    console.error(parsed.error.format());
    process.exit(1);
  }
  return parsed.data;
}

export const env = validateEnv();
