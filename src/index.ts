import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { env } from './env';
import { connectToDatabase } from './db/index';
import { createIndexes } from './db/indexes';
import { i18nMiddleware } from './middleware/i18n.middleware';
import { apiRoutes } from './routes';
import { adminRoutes } from './routes/admin';
import { webhookRoutes } from './routes/webhooks';
import { wellKnownRoutes } from './routes/well-known.routes';
import { startNotificationScheduler } from './workers/notificationScheduler';
import type { BaseVariables } from './types/context';

const app = new Hono<{ Variables: BaseVariables }>();

// ---- Global middleware ----
app.use('*', logger());
app.use('*', i18nMiddleware());

const corsOrigins = env.CORS_ORIGINS === '*'
  ? '*'
  : env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);

app.use(
  '*',
  cors({
    origin: corsOrigins,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Accept-Language'],
    credentials: true,
    maxAge: 600,
  })
);

// ---- Health ----
// mongoConnected is a cheap ping so the mobile debug screen can distinguish
// "backend reachable but DB down" from "backend down entirely".
app.get('/health', async (c) => {
  let mongoConnected = false;
  try {
    const { getDb } = await import('./db/index');
    await getDb().command({ ping: 1 });
    mongoConnected = true;
  } catch {
    mongoConnected = false;
  }
  return c.json({
    ok: true,
    name: 'fertilita-backend',
    env: env.NODE_ENV,
    version: process.env.APP_VERSION ?? '0.0.0',
    commit: process.env.GIT_COMMIT ?? null,
    mongoConnected,
    time: new Date().toISOString(),
  });
});

// ---- Routes ----
app.route('/api', apiRoutes);
app.route('/admin', adminRoutes);
app.route('/webhooks', webhookRoutes);
app.route('/.well-known', wellKnownRoutes);

app.notFound((c) => c.json({ error: 'NOT_FOUND', message: 'Route not found' }, 404));

app.onError((err, c) => {
  console.error('[unhandled]', err);
  return c.json({ error: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' }, 500);
});

// ---- Bootstrap ----
async function initializeDatabase() {
  const db = await connectToDatabase();
  await createIndexes(db);
}

await initializeDatabase();
startNotificationScheduler();

const port = Number(env.PORT);
console.log(`Fertilita backend listening on http://0.0.0.0:${port} (${env.NODE_ENV})`);

export default {
  port,
  fetch: app.fetch,
  hostname: '0.0.0.0',
};
