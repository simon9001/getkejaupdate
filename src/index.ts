/**
 * index.ts — GETKEJA API entry point
 *
 * Startup order:
 *   1. Environment validation  (fail-fast before any other import)
 *   2. Security headers
 *   3. CORS
 *   4. Development prettifier
 *   5. Request logging + Prometheus metrics  (X-Request-ID on every request)
 *   6. Rate limiting
 *   7. Ops endpoints  (/, /health, /metrics — outside /api, no rate limit)
 *   8. Application routes
 *   9. 404 handler
 *  10. Global error handler
 *  11. Cron jobs (commented — uncomment to activate)
 *  12. Server bind + startup DB check
 *  13. Process signal handlers
 */

// ─── Environment MUST load before any other import that reads process.env ───
import './config/environment.js';
import { adminRouter } from './Admin/admin.router.js';
import { serve }         from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { subscriptionsRouter } from './subscriptions/Subscriptions.router.js';

// Extend ContextVariableMap to include requestId
declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
  }
}
import { cors }          from 'hono/cors';
import { prettyJSON }    from 'hono/pretty-json';
import { secureHeaders } from 'hono/secure-headers';
import { shortStayRouter } from './shortstaymanage/Short stay.router.js';
import { env }                     from './config/environment.js';
import { logger, metrics,
         getMetrics, metricsContentType,
         trackDbQuery }            from './utils/logger.js';
import { testSupabaseConnection }  from './utils/supabase.js';

import { authRouter }  from './Auth/auth.routes.js';
import { usersRouter } from './Users/users.routes.js';
import { userRouter }    from './user/user.router.js';
import { contactRouter } from './contact/contact.router.js';

import { propertiesRouter } from './Properties/properties.routes.js';
import { landlordRouter }   from './Properties/landlord.router.js';
import { searchRouter }     from './serches/searchRoutes.js';
// import { spatialRouter }    from './Spatial/spatial.routes.js';
// import { dashboardRouter }  from './Dashboard/dashboard.routes.js';
// import { uploadRouter }     from './Upload/upload.routes.js';
import { chatRouter }       from './Chat/chat.routes.js';
import { statsRouter }      from './stats/stats.router.js';
import { statusesRouter }   from './statuses/statuses.router.js';

import { apiRateLimiter, authRateLimiter } from './middleware/rateLimiter.js';
// import cron                 from 'node-cron';
// import { scheduledCleanup } from './cron/cleanup.cron.js';

// Re-export so services can import trackDbQuery from the entry point
export { trackDbQuery };

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const API_VERSION  = '1.0.0';
const STARTUP_TIME = new Date().toISOString();
const app          = new Hono();

// ─────────────────────────────────────────────────────────────────────────────
// 1. Security headers
//    Must be first so every response — including 404s and 500s — carries the
//    correct Content-Security-Policy, X-Frame-Options, etc.
// ─────────────────────────────────────────────────────────────────────────────
app.use('*', secureHeaders());

// ─────────────────────────────────────────────────────────────────────────────
// 2. CORS
// ─────────────────────────────────────────────────────────────────────────────
app.use(
  '*',
  cors({
    origin:        env.frontendUrl,
    credentials:   true,
    allowMethods:  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders:  ['Content-Type', 'Authorization'],
    exposeHeaders: ['X-Request-ID'],
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Development prettifier  (JSON indentation in browser / curl)
// ─────────────────────────────────────────────────────────────────────────────
if (env.nodeEnv === 'development') {
  app.use('*', prettyJSON());
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Request logging + Prometheus metrics
//
//    Every request receives a unique X-Request-ID that is:
//      • Stored on the Hono context so downstream handlers can reference it
//      • Returned to the client as a response header
//      • Embedded in every structured log line for that request
//
//    This is the primary audit trail mechanism — grep one X-Request-ID to
//    reconstruct the full lifecycle of any request across your log stream.
// ─────────────────────────────────────────────────────────────────────────────
app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID();
  const start     = Date.now();

  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);

  metrics.activeConnections.inc();

  try {
    await next();
  } catch (err) {
    // Count the 500 in Prometheus before re-throwing to onError()
    metrics.httpRequestsTotal.inc({
      method: c.req.method,
      path:   c.req.path,
      status: '500',
    });
    throw err;
  } finally {
    metrics.activeConnections.dec();

    const durationSec = (Date.now() - start) / 1_000;
    const status      = c.res.status;

    // Only increment if not already counted in the catch block above
    if (status !== 500) {
      metrics.httpRequestsTotal.inc({
        method: c.req.method,
        path:   c.req.path,
        status: status.toString(),
      });
    }

    metrics.httpRequestDuration.observe(
      { method: c.req.method, path: c.req.path },
      durationSec,
    );

    const logPayload = {
      requestId,
      method:     c.req.method,
      path:       c.req.path,
      status,
      durationMs: Math.round(durationSec * 1_000),
      ip:         (c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown')
                    .split(',')[0]
                    .trim(),
      userAgent:  c.req.header('user-agent') ?? 'unknown',
      referer:    c.req.header('referer')    ?? 'direct',
      // Authenticated actor — populated on protected routes, null on public ones
      userId:     c.get('user')?.userId ?? null,
      userEmail:  c.get('user')?.email  ?? null,
    };

    if      (status >= 500) logger.error(logPayload, 'HTTP 5xx');
    else if (status >= 400) logger.warn(logPayload,  'HTTP 4xx');
    else                    logger.info(logPayload,  'HTTP 2xx/3xx');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Rate limiting
//    Applied after logging so throttled requests still produce a log line.
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api/*',      apiRateLimiter);
app.use('/api/auth/*', authRateLimiter);
app.route('/api/subscriptions', subscriptionsRouter);
app.route('/api/short-stay', shortStayRouter);
app.route('/api/admin', adminRouter);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Ops endpoints  (outside /api — no rate limit, no JWT required)
// ─────────────────────────────────────────────────────────────────────────────

/** Root — version probe used by deployment pipelines and status pages */
app.get('/', (c) =>
  c.json({
    service:     'GETKEJA API',
    version:     API_VERSION,
    environment: env.nodeEnv,
    startedAt:   STARTUP_TIME,
    timestamp:   new Date().toISOString(),
  }),
);

/**
 * /health — consumed by load balancers and Kubernetes liveness / readiness probes.
 *
 *   200  →  process is alive, DB is reachable
 *   503  →  process is alive, DB is unreachable  → load balancer stops routing
 *
 * testSupabaseConnection() queries `public.users` (the correct table — it was
 * previously querying the non-existent `public.profiles`) and THROWS on failure.
 * The try/catch here converts that throw into a structured 503 JSON response
 * rather than an unhandled 500.
 */
app.get('/health', async (c) => {
  let dbStatus: 'ok' | 'error' = 'ok';

  try {
    await testSupabaseConnection();
  } catch {
    dbStatus = 'error';
  }

  const healthy = dbStatus === 'ok';

  return c.json(
    {
      status:      healthy ? 'healthy' : 'degraded',
      version:     API_VERSION,
      environment: env.nodeEnv,
      startedAt:   STARTUP_TIME,
      timestamp:   new Date().toISOString(),
      uptimeSec:   Math.floor(process.uptime()),
      checks: {
        database: dbStatus,
      },
      // Memory reported in MB — useful for detecting memory leaks over time
      memory: {
        heapUsedMb:  Math.round(process.memoryUsage().heapUsed  / 1_048_576),
        heapTotalMb: Math.round(process.memoryUsage().heapTotal / 1_048_576),
        rssMb:       Math.round(process.memoryUsage().rss       / 1_048_576),
      },
    },
    healthy ? 200 : 503,
  );
});

/**
 * /metrics — Prometheus scrape endpoint.
 *
 * ⚠️  Production: restrict access via network policy or internal-only ingress
 *     so only your Prometheus server can reach this endpoint.
 */
app.get('/metrics', async (c) => {
  try {
    return c.text(await getMetrics(), 200, { 'Content-Type': metricsContentType });
  } catch (err) {
    logger.error({ err }, 'metrics.generation.failed');
    return c.text('Failed to generate metrics', 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Application routes
// ─────────────────────────────────────────────────────────────────────────────
app.route('/api/auth',                authRouter);
app.route('/api/users',               usersRouter);
app.route('/api/user',                userRouter);
app.route('/api/contact',             contactRouter);
app.route('/api/properties',          propertiesRouter);       // public + admin routes
app.route('/api/landlord/properties', landlordRouter);         // landlord/agent/developer CRUD
app.route('/api/search',              searchRouter);           // public search (text, nearby, map)
// app.route('/api/spatial',    spatialRouter);
// app.route('/api/dashboard',  dashboardRouter);
// app.route('/api/upload',     uploadRouter);
app.route('/api/chat',       chatRouter);
app.route('/api/stats',      statsRouter);
app.route('/api/statuses',   statusesRouter);

// ─────────────────────────────────────────────────────────────────────────────
// 8. 404 handler
// ─────────────────────────────────────────────────────────────────────────────
app.notFound((c) => {
  logger.warn(
    { requestId: c.get('requestId'), method: c.req.method, path: c.req.path },
    'route.not_found',
  );
  return c.json(
    { message: 'Route not found', path: c.req.path, code: 'NOT_FOUND' },
    404,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Global error handler
//
//    • Assigns a unique errorId to every unhandled error
//    • errorId is returned to the client — they can quote it to support
//    • Full errorId → log correlation lets you find the stack trace without
//      ever exposing it publicly
//    • Stack traces are NEVER sent to clients in production
//    • userId is captured so you can answer "who triggered this?"
// ─────────────────────────────────────────────────────────────────────────────
app.onError((err, c) => {
  const errorId = crypto.randomUUID();

  logger.error(
    {
      errorId,
      requestId: c.get('requestId'),
      method:    c.req.method,
      path:      c.req.path,
      message:   err.message,
      stack:     env.nodeEnv === 'development' ? err.stack : undefined,
      userId:    c.get('user')?.userId ?? null,
      timestamp: new Date().toISOString(),
    },
    'request.unhandled_error',
  );

  return c.json(
    {
      message: 'Internal Server Error',
      code:    'SERVER_ERROR',
      errorId,
      // Detail only in development — never leak internals to production clients
      detail: env.nodeEnv === 'development' ? err.message : undefined,
    },
    500,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Cron jobs
//     Each job logs start / success / failure for full observability.
//     Uncomment and extend as needed.
// ─────────────────────────────────────────────────────────────────────────────
// cron.schedule('0 * * * *', async () => {
//   logger.info('cron.hourly_cleanup.start');
//   try {
//     await scheduledCleanup();
//     metrics.cleanupOperations.inc({ operation: 'hourly-cleanup', status: 'success' });
//     logger.info('cron.hourly_cleanup.success');
//   } catch (err) {
//     metrics.cleanupOperations.inc({ operation: 'hourly-cleanup', status: 'failure' });
//     logger.error({ err }, 'cron.hourly_cleanup.failure');
//   }
// });

// ─────────────────────────────────────────────────────────────────────────────
// 11. Server bind + startup DB check
//
//     The DB check runs AFTER the server starts accepting traffic (inside the
//     serve() callback).  This means:
//       • The process never hangs waiting for DB on startup
//       • /health immediately reflects a degraded state if DB is unreachable
//       • Load balancers see 503 and hold traffic until DB recovers
//
//     testSupabaseConnection() handles its own structured logging internally.
//     We only need to catch the thrown error here to prevent an unhandled
//     rejection — we do NOT log again (that would produce duplicate lines).
// ─────────────────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT) || env.port || 8000;

serve({ fetch: app.fetch, port }, (info) => {
  logger.info(
    {
      port:        info.port,
      environment: env.nodeEnv,
      version:     API_VERSION,
      startedAt:   STARTUP_TIME,
      url:         `http://localhost:${info.port}`,
      health:      `http://localhost:${info.port}/health`,
      metrics:     `http://localhost:${info.port}/metrics`,
    },
    'server.started',
  );

  // Human-readable banner — development only.
  // Multi-line console output is intentionally suppressed in production
  // because it breaks structured log parsers (Datadog, Loki, CloudWatch).
  if (env.nodeEnv === 'development') {
    const p = String(info.port);
    console.log([
      '',
      '╔══════════════════════════════════════════════════════════╗',
      '║                   🏠  GETKEJA API                        ║',
      '╠══════════════════════════════════════════════════════════╣',
      `║  Version:     ${API_VERSION.padEnd(37)}║`,
      `║  Environment: ${env.nodeEnv.padEnd(37)}║`,
      `║  Port:        ${p.padEnd(37)}║`,
      '║                                                          ║',
      `║  API     →  http://localhost:${p}/api            ║`,
      `║  Health  →  http://localhost:${p}/health         ║`,
      `║  Metrics →  http://localhost:${p}/metrics        ║`,
      '╚══════════════════════════════════════════════════════════╝',
      '',
    ].join('\n'));
  }

  // Startup DB connectivity check.
  // testSupabaseConnection() logs internally — we only catch here to silence
  // the unhandled rejection warning.  Do NOT add another logger.error here.
  testSupabaseConnection().catch(() => {
    // Already logged inside testSupabaseConnection() — nothing to do here.
    // /health will return 503 until the DB recovers.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Process signal handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Graceful shutdown — called on SIGTERM (Kubernetes stop) and SIGINT (Ctrl-C).
 *
 * Add teardown steps here before process.exit(0):
 *   • Close DB connection pools
 *   • Drain in-flight job queues
 *   • Flush buffered log streams
 */
function shutdown(signal: string): void {
  logger.info({ signal }, 'server.shutdown.initiated');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

/**
 * Synchronous crash — log as fatal and exit with code 1 so PM2 / Kubernetes
 * automatically restarts the pod.
 */
process.on('uncaughtException', (err: Error) => {
  logger.fatal(
    { message: err.message, stack: err.stack, timestamp: new Date().toISOString() },
    'process.uncaughtException',
  );
  process.exit(1);
});

/**
 * Unhandled promise rejection — log but do NOT exit.
 * Third-party libraries occasionally produce these for non-critical reasons.
 * Monitor the log and fix the root cause; don't let them silently pile up.
 */
process.on('unhandledRejection', (reason: unknown) => {
  logger.error(
    { reason, timestamp: new Date().toISOString() },
    'process.unhandledRejection',
  );
});

export default app;