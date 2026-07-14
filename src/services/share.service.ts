import { createHash, randomBytes } from 'crypto';
import { getCollections } from '../db/collections';
import { generateId } from '../utils/id';
import { ApiError } from '../utils/errors';
import type {
  ShareCode,
  ShareGrant,
  ShareScope,
} from '../schemas/share.schema';

// XXXX-XXXX-XXXX using an unambiguous alphabet (no I/O/0/1). 12 groups of the
// 32-char alphabet gives ~60 bits of entropy — enough for short-lived codes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateShareCodePlaintext(): string {
  const groups: string[] = [];
  for (let g = 0; g < 3; g++) {
    let chunk = '';
    const bytes = randomBytes(4);
    for (let i = 0; i < 4; i++) {
      chunk += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
    }
    groups.push(chunk);
  }
  return groups.join('-');
}

function hashCode(plain: string): string {
  return createHash('sha256').update(plain.toUpperCase()).digest('hex');
}

function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

export async function createShareInvite(params: {
  ownerId: string;
  scope: ShareScope;
  expiresInHours: number;
}): Promise<{ code: string; expiresAt: Date }> {
  const plaintext = generateShareCodePlaintext();
  const codeHash = hashCode(plaintext);
  const expiresAt = new Date(Date.now() + params.expiresInHours * 3_600_000);

  const doc: ShareCode = {
    _id: generateId(),
    ownerId: params.ownerId,
    codeHash,
    scope: params.scope,
    expiresAt,
    redeemedAt: null,
    redeemedByUserId: null,
    createdAt: new Date().toISOString(),
  };
  await getCollections().shareCodes.insertOne(doc);
  return { code: plaintext, expiresAt };
}

export async function redeemShareCode(params: {
  partnerId: string;
  code: string;
}): Promise<ShareGrant> {
  const normalized = normalizeCode(params.code);
  const codeHash = hashCode(normalized);
  const collections = getCollections();

  const codeDoc = await collections.shareCodes.findOne({ codeHash });
  if (!codeDoc) {
    throw new ApiError({ code: 'NOT_FOUND', message: 'Share code not found' });
  }
  if (codeDoc.redeemedAt) {
    throw new ApiError({ code: 'CONFLICT', message: 'Share code already used' });
  }
  if (codeDoc.expiresAt.getTime() < Date.now()) {
    throw new ApiError({ code: 'FORBIDDEN', message: 'Share code expired' });
  }
  if (codeDoc.ownerId === params.partnerId) {
    throw new ApiError({ code: 'BAD_REQUEST', message: 'Cannot redeem your own invite' });
  }

  const existing = await collections.shareGrants.findOne({
    ownerId: codeDoc.ownerId,
    partnerId: params.partnerId,
    revokedAt: { $in: [null, undefined] } as any,
  });
  if (existing) {
    // Still burn the code so it can't be reused.
    await collections.shareCodes.updateOne(
      { _id: codeDoc._id },
      { $set: { redeemedAt: new Date(), redeemedByUserId: params.partnerId } }
    );
    return existing;
  }

  const grant: ShareGrant = {
    _id: generateId(),
    ownerId: codeDoc.ownerId,
    partnerId: params.partnerId,
    scope: codeDoc.scope,
    expiresAt: codeDoc.expiresAt,
    revokedAt: null,
    createdAt: new Date().toISOString(),
  };

  await collections.shareGrants.insertOne(grant);
  await collections.shareCodes.updateOne(
    { _id: codeDoc._id },
    { $set: { redeemedAt: new Date(), redeemedByUserId: params.partnerId } }
  );
  return grant;
}

export async function requireActiveGrantForPartner(params: {
  grantId: string;
  partnerId: string;
  neededScope: 'journey' | 'calendar';
}): Promise<ShareGrant> {
  const grant = await getCollections().shareGrants.findOne({ _id: params.grantId });
  if (!grant || grant.partnerId !== params.partnerId) {
    throw new ApiError({ code: 'NOT_FOUND', message: 'Share not found' });
  }
  if (grant.revokedAt) {
    throw new ApiError({ code: 'FORBIDDEN', message: 'Share revoked' });
  }
  if (grant.expiresAt.getTime() < Date.now()) {
    throw new ApiError({ code: 'FORBIDDEN', message: 'Share expired' });
  }
  const includes =
    grant.scope === 'journey+calendar' ||
    grant.scope === params.neededScope;
  if (!includes) {
    throw new ApiError({ code: 'FORBIDDEN', message: 'Share scope excludes this view' });
  }
  return grant;
}
