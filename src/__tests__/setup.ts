// Test bootstrap. Runs before any test file thanks to bunfig.toml's
// [test].preload. Boots mongodb-memory-server via top-level await so the
// URI is set before src/env.ts is imported. Also injects required-in-prod
// secrets so env.ts validation passes.

import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll } from 'bun:test';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_ACCESS_SECRET = 'test-'.padEnd(40, 'x');
process.env.JWT_REFRESH_SECRET = 'refresh-'.padEnd(40, 'x');
process.env.ADMIN_JWT_SECRET = 'admin-'.padEnd(40, 'x');
process.env.MONGODB_DB_NAME = 'fertilita-test';
process.env.CORS_ORIGINS = '*';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();

const { connectToDatabase, disconnectFromDatabase } = await import('../db/index');
const { createIndexes } = await import('../db/indexes');
const db = await connectToDatabase();
await createIndexes(db);

afterAll(async () => {
  await disconnectFromDatabase();
  await mongod.stop();
});
