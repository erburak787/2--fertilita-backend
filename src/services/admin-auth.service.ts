import { getCollections } from '../db/collections';
import { ApiError } from '../utils/errors';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateId, generateOpaqueToken } from '../utils/id';
import { getNow } from '../utils/date';
import {
  generateAdminAccessToken,
  generateAdminRefreshToken,
  verifyAdminRefreshToken,
  getAdminAccessTokenExpiresIn,
  getAdminRefreshTokenExpirationDate,
} from '../utils/adminJwt';
import {
  buildAdminPublic,
  type Admin,
  type AdminPublic,
  type AdminRole,
} from '../schemas/admin.schema';

export interface AdminAuthResponse {
  admin: AdminPublic;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function createAdmin(params: {
  email: string;
  password: string;
  displayName?: string;
  role?: AdminRole;
}): Promise<Admin> {
  const collections = getCollections();
  const now = getNow();
  const email = params.email.toLowerCase().trim();

  const existing = await collections.admins.findOne({ email });
  if (existing) {
    throw new ApiError({ code: 'CONFLICT', message: 'Admin already exists' });
  }

  const admin: Admin = {
    _id: generateId(),
    email,
    passwordHash: await hashPassword(params.password),
    displayName: params.displayName,
    role: params.role ?? 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await collections.admins.insertOne(admin);
  return admin;
}

async function buildAuthResponse(admin: Admin): Promise<AdminAuthResponse> {
  const collections = getCollections();
  const now = getNow();

  const accessToken = generateAdminAccessToken({
    sub: admin._id,
    email: admin.email,
    role: admin.role,
  });

  const jti = generateOpaqueToken();
  const refreshToken = generateAdminRefreshToken(admin._id, jti);

  await collections.refreshTokens.insertOne({
    _id: generateId(),
    userId: `admin:${admin._id}`,
    token: jti,
    expiresAt: getAdminRefreshTokenExpirationDate(),
    createdAt: now,
    revokedAt: null,
  });

  return {
    admin: buildAdminPublic(admin),
    accessToken,
    refreshToken,
    expiresIn: getAdminAccessTokenExpiresIn(),
  };
}

export async function loginAdmin(input: { email: string; password: string }): Promise<AdminAuthResponse> {
  const collections = getCollections();
  const now = getNow();
  const email = input.email.toLowerCase().trim();

  const admin = await collections.admins.findOne({ email });
  if (!admin || !admin.isActive) {
    throw new ApiError({ code: 'UNAUTHORIZED', message: 'auth_invalid_credentials' });
  }

  const valid = await verifyPassword(input.password, admin.passwordHash);
  if (!valid) {
    throw new ApiError({ code: 'UNAUTHORIZED', message: 'auth_invalid_credentials' });
  }

  await collections.admins.updateOne(
    { _id: admin._id },
    { $set: { lastLoginAt: now, updatedAt: now } }
  );

  await collections.adminAuditLog.insertOne({
    _id: generateId(),
    adminId: admin._id,
    adminEmail: admin.email,
    action: 'admin_login',
    targetUserId: null,
    createdAt: now,
  });

  return buildAuthResponse({ ...admin, lastLoginAt: now });
}

export async function refreshAdminToken(refreshToken: string): Promise<AdminAuthResponse> {
  const decoded = verifyAdminRefreshToken(refreshToken);
  if (!decoded || !decoded.jti) {
    throw new ApiError({ code: 'UNAUTHORIZED', message: 'auth_token_invalid' });
  }

  const collections = getCollections();
  const stored = await collections.refreshTokens.findOne({ token: decoded.jti });
  if (!stored || stored.revokedAt) {
    throw new ApiError({ code: 'UNAUTHORIZED', message: 'auth_token_invalid' });
  }

  const admin = await collections.admins.findOne({ _id: decoded.sub, isActive: true });
  if (!admin) {
    throw new ApiError({ code: 'UNAUTHORIZED', message: 'auth_token_invalid' });
  }

  await collections.refreshTokens.updateOne(
    { _id: stored._id },
    { $set: { revokedAt: getNow() } }
  );

  return buildAuthResponse(admin);
}

export async function logoutAdmin(adminId: string, refreshToken?: string): Promise<void> {
  const collections = getCollections();
  if (refreshToken) {
    const decoded = verifyAdminRefreshToken(refreshToken);
    if (decoded?.jti) {
      await collections.refreshTokens.updateOne(
        { token: decoded.jti },
        { $set: { revokedAt: getNow() } }
      );
    }
  } else {
    await collections.refreshTokens.updateMany(
      { userId: `admin:${adminId}`, revokedAt: { $in: [null, undefined] } as any },
      { $set: { revokedAt: getNow() } }
    );
  }
}

export async function getAdminById(adminId: string): Promise<Admin | null> {
  return getCollections().admins.findOne({ _id: adminId });
}
