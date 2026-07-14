#!/usr/bin/env bun
// Dev-only DB wipe. Drops every collection in the configured MONGODB_DB_NAME.
// Refuses to run unless NODE_ENV is 'development' OR --force is passed.
//
// Usage:
//   bun run clear-db.ts          # safe (dev only)
//   bun run clear-db.ts --force  # bypass NODE_ENV check (CI / explicit)

import { connectToDatabase, disconnectFromDatabase, getDb } from './src/db/index';
import { env } from './src/env';

async function main() {
  const force = process.argv.includes('--force');
  if (env.NODE_ENV !== 'development' && !force) {
    console.error(`Refusing to wipe DB in NODE_ENV=${env.NODE_ENV}. Pass --force to override.`);
    process.exit(1);
  }

  await connectToDatabase();
  const db = getDb();

  const collections = await db.listCollections().toArray();
  console.log(`Dropping ${collections.length} collection(s) in ${env.MONGODB_DB_NAME}...`);

  for (const { name } of collections) {
    await db.collection(name).drop().catch((err) => {
      console.error(`Failed to drop ${name}:`, err.message);
    });
    console.log(`  dropped: ${name}`);
  }

  await disconnectFromDatabase();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
