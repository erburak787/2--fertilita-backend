import { MongoClient, type Db } from 'mongodb';
import { env } from '../env';

let client: MongoClient | null = null;
let db: Db | null = null;

// GDPR Art. 9: Fertilita's Atlas cluster must be hosted in the EU.
// The cluster region cannot be reliably inferred from the SRV URI, so
// operators must declare it via MONGODB_REGION and we whitelist it here.
// AWS eu-*, Azure {north,west}europe / francecentral / germanywestcentral /
// swedencentral / norwayeast, and GCP europe-* are accepted. UK regions
// are intentionally excluded (post-Brexit — separate adequacy assessment).
const EU_REGION_PATTERNS: readonly RegExp[] = [
  /^eu-(west|central|north|south)-\d+$/i,
  /^(northeurope|westeurope|francecentral|germanywestcentral|swedencentral|norwayeast)$/i,
  /^europe-(west|north|central|southwest)\d*$/i,
];

export function assertEuRegion(region: string | undefined): void {
  if (!region) {
    if (env.NODE_ENV === 'production') {
      throw new Error('MONGODB_REGION is required in production and must be an EU region');
    }
    if (env.NODE_ENV !== 'test') {
      console.warn('[db] MONGODB_REGION not set — skipping EU-region assertion (dev only)');
    }
    return;
  }
  const normalized = region.trim();
  const isEu = EU_REGION_PATTERNS.some((rx) => rx.test(normalized));
  if (!isEu) {
    throw new Error(
      `MONGODB_REGION "${normalized}" is not an EU region. Fertilita stores GDPR Art. 9 data ` +
        'and requires an EU-hosted cluster (Atlas region in Frankfurt, Ireland, Paris, etc.).'
    );
  }
  console.log(`[db] EU-region assertion passed: MONGODB_REGION=${normalized}`);
}

export async function connectToDatabase(): Promise<Db> {
  if (db) return db;

  assertEuRegion(env.MONGODB_REGION);

  try {
    client = new MongoClient(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 60_000,
      connectTimeoutMS: 60_000,
      socketTimeoutMS: 90_000,
      maxPoolSize: 10,
      minPoolSize: 1,
      retryWrites: true,
      retryReads: true,
    });
    await client.connect();
    db = client.db(env.MONGODB_DB_NAME);
    console.log(`Connected to MongoDB: ${env.MONGODB_DB_NAME}`);
    return db;
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    throw error;
  }
}

export async function disconnectFromDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('Disconnected from MongoDB');
  }
}

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not initialized. Call connectToDatabase() first.');
  }
  return db;
}

process.on('SIGINT', async () => {
  await disconnectFromDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await disconnectFromDatabase();
  process.exit(0);
});
