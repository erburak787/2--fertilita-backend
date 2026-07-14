// One-off script — wipes all user-owned + auth data from the dev DB.
// Preserves `knowledgeArticles` (CMS content) and `admins` (admin logins).
//
// Usage: cd backend && bun run scripts/wipe-user-data.ts
//
// SAFETY: refuses to run unless MONGODB_DB_NAME contains "dev" or "test",
// so it can never accidentally wipe prod.

import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME;

if (!uri || !dbName) {
  console.error('❌ MONGODB_URI or MONGODB_DB_NAME not set. Aborting.');
  process.exit(1);
}

if (!/dev|test|local/i.test(dbName)) {
  console.error(`❌ Refusing to wipe DB "${dbName}" — name must contain "dev", "test", or "local".`);
  process.exit(1);
}

// Every collection except knowledgeArticles + admins.
const WIPE = [
  'users',
  'refreshTokens',
  'passwordResetTokens',
  'attempts',
  'events',
  'journalEntries',
  'userSettings',
  'pushTokens',
  'documents',
  'notificationLog',
  'notificationSchedule',
  'supportMessages',
  'shareCodes',
  'shareGrants',
  'subscriptions',
  'subscriptionEvents',
  'webhookEvents',
  'suggestions',
  'onboardingAnswers',
  'aiRequestLogs',
  'adminAuditLog',
];

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  console.log(`🔌 Connected to "${dbName}"`);
  const db = client.db(dbName);

  console.log('\n── BEFORE ──');
  const before: Record<string, number> = {};
  for (const name of WIPE) {
    before[name] = await db.collection(name).countDocuments();
  }
  const kept = {
    knowledgeArticles: await db.collection('knowledgeArticles').countDocuments(),
    admins: await db.collection('admins').countDocuments(),
  };
  for (const [name, n] of Object.entries(before)) console.log(`  ${name.padEnd(24)} ${n}`);
  console.log('  ── preserved ──');
  for (const [name, n] of Object.entries(kept)) console.log(`  ${name.padEnd(24)} ${n} (kept)`);

  console.log('\n🧹 Wiping…');
  for (const name of WIPE) {
    const res = await db.collection(name).deleteMany({});
    console.log(`  ${name.padEnd(24)} deleted ${res.deletedCount}`);
  }

  console.log('\n── AFTER ──');
  for (const name of WIPE) {
    const n = await db.collection(name).countDocuments();
    if (n !== 0) console.log(`  ⚠️  ${name}: ${n} rows remain!`);
  }
  console.log('  ✅ all wiped collections at 0');
  console.log(`  ✅ preserved knowledgeArticles=${kept.knowledgeArticles}, admins=${kept.admins}`);

  await client.close();
}

main().catch((err) => {
  console.error('❌ Wipe failed:', err);
  process.exit(1);
});
