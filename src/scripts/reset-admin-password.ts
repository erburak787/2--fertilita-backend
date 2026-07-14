#!/usr/bin/env bun
// Reset an admin's password and revoke all their refresh tokens.
//
// Usage:
//   bun run src/scripts/reset-admin-password.ts --email=you@example.com --password='NewStrong123'
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='NewStrong123' bun run src/scripts/reset-admin-password.ts

import { connectToDatabase, disconnectFromDatabase } from '../db/index';
import { getCollections } from '../db/collections';
import { hashPassword, validatePasswordStrength } from '../utils/password';
import { getNow } from '../utils/date';

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    out[k] = rest.join('=');
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const email = (args.email ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = args.password ?? process.env.ADMIN_PASSWORD ?? '';

  if (!email || !password) {
    console.error('Missing ADMIN_EMAIL or ADMIN_PASSWORD (env or --email/--password).');
    process.exit(1);
  }

  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    console.error(`Password too weak: ${strength.reason}`);
    process.exit(1);
  }

  await connectToDatabase();
  const collections = getCollections();

  try {
    const admin = await collections.admins.findOne({ email });
    if (!admin) {
      console.error(`No admin found with email ${email}`);
      process.exit(1);
    }

    const now = getNow();
    const passwordHash = await hashPassword(password);

    await collections.admins.updateOne(
      { _id: admin._id },
      { $set: { passwordHash, updatedAt: now } }
    );

    const revoked = await collections.refreshTokens.updateMany(
      { userId: `admin:${admin._id}`, revokedAt: { $in: [null, undefined] } as any },
      { $set: { revokedAt: now } }
    );

    console.log(`Reset password for ${email}. Revoked ${revoked.modifiedCount} refresh token(s).`);
  } finally {
    await disconnectFromDatabase();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
