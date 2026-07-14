import jwt from 'jsonwebtoken';
import { env } from '../env';

export interface AccessTokenPayload {
  sub: string;
  email?: string | null;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: 'refresh';
}

export interface DecodedToken {
  sub: string;
  email?: string;
  jti?: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid duration format: ${duration}`);
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 60 * 60;
    case 'd': return value * 60 * 60 * 24;
    default: throw new Error(`Unknown duration unit: ${unit}`);
  }
}

export function generateAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
  return jwt.sign(
    { ...payload, type: 'access' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: parseDuration(env.JWT_ACCESS_EXPIRES_IN) }
  );
}

export function generateRefreshToken(userId: string, tokenId: string): string {
  return jwt.sign(
    { sub: userId, jti: tokenId, type: 'refresh' },
    env.JWT_REFRESH_SECRET,
    { expiresIn: parseDuration(env.JWT_REFRESH_EXPIRES_IN) }
  );
}

export function verifyAccessToken(token: string): DecodedToken | null {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as DecodedToken;
    return decoded.type === 'access' ? decoded : null;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): DecodedToken | null {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as DecodedToken;
    return decoded.type === 'refresh' ? decoded : null;
  } catch {
    return null;
  }
}

export function getAccessTokenExpiresIn(): number {
  return parseDuration(env.JWT_ACCESS_EXPIRES_IN);
}

export function getRefreshTokenExpiresIn(): number {
  return parseDuration(env.JWT_REFRESH_EXPIRES_IN);
}

export function getRefreshTokenExpirationDate(): Date {
  return new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES_IN) * 1000);
}
