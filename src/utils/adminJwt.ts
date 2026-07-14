import jwt from 'jsonwebtoken';
import { env } from '../env';
import type { AdminRole } from '../schemas/admin.schema';

export interface AdminAccessTokenPayload {
  sub: string;
  email: string;
  role: AdminRole;
  type: 'admin_access';
}

export interface AdminRefreshTokenPayload {
  sub: string;
  jti: string;
  type: 'admin_refresh';
}

export interface DecodedAdminToken {
  sub: string;
  email?: string;
  role?: AdminRole;
  jti?: string;
  type: 'admin_access' | 'admin_refresh';
  iat: number;
  exp: number;
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid duration format: ${duration}`);
  const value = parseInt(match[1]!, 10);
  switch (match[2]) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: throw new Error(`Unknown duration unit: ${match[2]}`);
  }
}

export function generateAdminAccessToken(payload: Omit<AdminAccessTokenPayload, 'type'>): string {
  return jwt.sign(
    { ...payload, type: 'admin_access' },
    env.ADMIN_JWT_SECRET,
    { expiresIn: parseDuration(env.ADMIN_JWT_ACCESS_EXPIRES_IN) }
  );
}

export function generateAdminRefreshToken(adminId: string, tokenId: string): string {
  return jwt.sign(
    { sub: adminId, jti: tokenId, type: 'admin_refresh' },
    env.ADMIN_JWT_SECRET,
    { expiresIn: parseDuration(env.ADMIN_JWT_REFRESH_EXPIRES_IN) }
  );
}

export function verifyAdminAccessToken(token: string): DecodedAdminToken | null {
  try {
    const decoded = jwt.verify(token, env.ADMIN_JWT_SECRET) as DecodedAdminToken;
    return decoded.type === 'admin_access' ? decoded : null;
  } catch {
    return null;
  }
}

export function verifyAdminRefreshToken(token: string): DecodedAdminToken | null {
  try {
    const decoded = jwt.verify(token, env.ADMIN_JWT_SECRET) as DecodedAdminToken;
    return decoded.type === 'admin_refresh' ? decoded : null;
  } catch {
    return null;
  }
}

export function getAdminAccessTokenExpiresIn(): number {
  return parseDuration(env.ADMIN_JWT_ACCESS_EXPIRES_IN);
}

export function getAdminRefreshTokenExpirationDate(): Date {
  return new Date(Date.now() + parseDuration(env.ADMIN_JWT_REFRESH_EXPIRES_IN) * 1000);
}
