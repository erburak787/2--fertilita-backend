import * as jose from 'jose';
import { createHash } from 'crypto';
import { env } from '../env';
import { EXTERNAL_API_TIMEOUT_MS } from '../config/constants';

export interface OAuthVerificationResult {
  email: string;
  providerId: string;
  displayName?: string;
}

export class OAuthError extends Error {
  constructor(message: string, public code: 'UNAUTHORIZED' | 'BAD_REQUEST' = 'UNAUTHORIZED') {
    super(message);
    this.name = 'OAuthError';
  }
}

interface AppleTokenPayload {
  exp?: number;
  iat?: number;
  aud?: string;
  iss?: string;
  email?: string;
  sub?: string;
  email_verified?: boolean | string;
  nonce?: string;
  nonce_supported?: boolean;
}

interface GoogleTokenPayload {
  aud?: string;
  email?: string;
  email_verified?: string | boolean;
  sub?: string;
  name?: string;
}

const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';

let appleJWKS: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
function getAppleJWKS() {
  if (!appleJWKS) appleJWKS = jose.createRemoteJWKSet(new URL(APPLE_KEYS_URL));
  return appleJWKS;
}

export async function verifyAppleToken(idToken: string, nonce?: string): Promise<OAuthVerificationResult> {
  try {
    const JWKS = getAppleJWKS();
    const verifyOptions: jose.JWTVerifyOptions = { issuer: APPLE_ISSUER };
    if (env.APPLE_CLIENT_ID) verifyOptions.audience = env.APPLE_CLIENT_ID;

    const { payload } = await jose.jwtVerify(idToken, JWKS, verifyOptions);
    const applePayload = payload as unknown as AppleTokenPayload;

    if (nonce) {
      const hashedNonce = createHash('sha256').update(nonce).digest('hex');
      if (hashedNonce !== applePayload.nonce) throw new Error('Nonce mismatch');
    }

    if (!applePayload.email || !applePayload.sub) {
      throw new Error('Missing required claims (email or sub)');
    }

    return { email: applePayload.email, providerId: applePayload.sub };
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) throw new OAuthError('Apple token expired');
    if (error instanceof jose.errors.JWTClaimValidationFailed) throw new OAuthError('Apple token validation failed');
    if (error instanceof jose.errors.JWSSignatureVerificationFailed) throw new OAuthError('Apple token signature invalid');
    throw new OAuthError('Invalid Apple sign-in token');
  }
}

export async function verifyGoogleToken(idToken: string): Promise<OAuthVerificationResult> {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`,
      { signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS) }
    );

    if (!response.ok) throw new Error('Invalid token');

    const payload = (await response.json()) as GoogleTokenPayload;

    const validAudiences = [
      env.GOOGLE_CLIENT_ID_IOS,
      env.GOOGLE_CLIENT_ID_ANDROID,
      env.GOOGLE_CLIENT_ID_WEB,
    ].filter(Boolean) as string[];

    if (validAudiences.length > 0 && payload.aud && !validAudiences.includes(payload.aud)) {
      throw new Error('Invalid audience');
    }

    if (payload.email_verified !== 'true' && payload.email_verified !== true) {
      throw new Error('Email not verified');
    }

    if (!payload.email || !payload.sub) {
      throw new Error('Missing required claims (email or sub)');
    }

    return { email: payload.email, providerId: payload.sub, displayName: payload.name };
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new OAuthError('Google sign-in request timed out');
    }
    throw new OAuthError('Invalid Google sign-in token');
  }
}

export async function verifyOAuthToken(
  provider: 'apple' | 'google',
  idToken: string,
  nonce?: string
): Promise<OAuthVerificationResult> {
  switch (provider) {
    case 'apple': return verifyAppleToken(idToken, nonce);
    case 'google': return verifyGoogleToken(idToken);
    default: throw new OAuthError(`Unsupported OAuth provider: ${provider}`, 'BAD_REQUEST');
  }
}
