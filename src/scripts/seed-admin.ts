#!/usr/bin/env bun
// Seed the first admin user. Reads ADMIN_EMAIL + ADMIN_PASSWORD from env
// (or args), validates strength, and inserts. Idempotent: if the email
// already exists, the script exits non-zero with a clear message.
//
// Usage:
//   bun run src/scripts/seed-admin.ts
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='Strong123' bun run src/scripts/seed-admin.ts
//   bun run src/scripts/seed-admin.ts --email=you@example.com --password='Strong123' --role=super_admin

import { connectToDatabase, disconnectFromDatabase } from '../db/index';
import { createIndexes } from '../db/indexes';
import { createAdmin } from '../services/admin-auth.service';
import { validatePasswordStrength } from '../utils/password';
import { adminRoleSchema } from '../schemas/admin.schema';

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
  const displayName = args.name ?? process.env.ADMIN_NAME;
  const roleInput = args.role ?? process.env.ADMIN_ROLE ?? 'super_admin';

  if (!email || !password) {
    console.error('Missing ADMIN_EMAIL or ADMIN_PASSWORD (env or --email/--password).');
    process.exit(1);
  }

  const role = adminRoleSchema.parse(roleInput);
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    console.error(`Password too weak: ${strength.reason}`);
    process.exit(1);
  }

  const db = await connectToDatabase();
  await createIndexes(db);

  try {
    const admin = await createAdmin({ email, password, displayName, role });
    console.log(`Created admin ${admin.email} (id=${admin._id}, role=${admin.role})`);
  } finally {
    await disconnectFromDatabase();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
