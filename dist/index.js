// Load env first
import './config/environment.js';
import cron from 'node-cron';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prettyJSON } from 'hono/pretty-json';
import { secureHeaders } from 'hono/secure-headers';
import { env } from './config/environment.js';
import { logger, metrics, getMetrics, metricsContentType, trackDbQuery } from './utils/logger.js';
import { testSupabaseConnection } from './utils/supabase.js';
import { authRouter } from './Auth/auth.routes.js';
import { propertiesRouter } from './Properties/properties.routes.js';
import { spatialRouter } from './Spatial/spatial.routes.js';
import { dashboardRouter } from './Dashboard/dashboard.routes.js';
import { usersRouter } from './Users/users.routes.js';
import { apiRateLimiter, authRateLimiter } from './middleware/rateLimiter.js';
import { scheduledCleanup } from './cron/cleanup.cron.js';
const app = new Hono();
// ---------------------------
// Metrics & Monitoring
// ---------------------------
// Prometheus metrics endpoint
app.get('/metrics', async (c) => {
    try {
        const metricsData = await getMetrics();
        return c.text(metricsData, 200, {
            'Content-Type': metricsContentType,
        });
    }
    catch (error) {
        logger.error({ error }, 'Failed to generate metrics');
        return c.text('Failed to generate metrics', 500);
    }
});
// ---------------------------
// Cron Jobs with Metrics
// ---------------------------
cron.schedule('0 * * * *', async () => {
    const start = Date.now();
    logger.info('⏰ Running hourly cleanup check...');
    try {
        await scheduledCleanup();
        metrics.cleanupOperations.inc({ operation: 'hourly-cleanup', status: 'success' });
        logger.info('✅ Hourly cleanup completed successfully');
    }
    catch (error) {
        metrics.cleanupOperations.inc({ operation: 'hourly-cleanup', status: 'failure' });
        logger.error({ error }, '❌ Hourly cleanup failed');
    }
    const duration = (Date.now() - start) / 1000;
    logger.info({
        operation: 'hourly-cleanup',
        duration: `${duration}s`,
        timestamp: new Date().toISOString()
    }, 'Cron job completed');
});
// Test Supabase on startup
testSupabaseConnection().catch(error => {
    logger.error({ error }, '❌ Supabase connection failed');
});
// ---------------------------
// Global Middleware
// ---------------------------
app.use('*', secureHeaders());
app.use('*', cors({
    origin: env.frontendUrl,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));
if (env.nodeEnv === 'development') {
    app.use('*', prettyJSON());
}
// Metrics and logging middleware
app.use('*', async (c, next) => {
    const start = Date.now();
    metrics.activeConnections.inc();
    try {
        await next();
        const duration = (Date.now() - start) / 1000;
        const status = c.res.status;
        // Update metrics
        metrics.httpRequestsTotal.inc({
            method: c.req.method,
            path: c.req.path,
            status: status.toString()
        });
        metrics.httpRequestDuration.observe({ method: c.req.method, path: c.req.path }, duration);
        // Detailed logging
        const logEntry = {
            timestamp: new Date().toISOString(),
            method: c.req.method,
            path: c.req.path,
            status: status,
            duration: `${(duration * 1000).toFixed(0)}ms`,
            ip: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown',
            userAgent: c.req.header('user-agent') ?? 'unknown',
            referer: c.req.header('referer') ?? 'direct',
            requestId: crypto.randomUUID(),
        };
        // Log to console with different levels based on status
        if (status >= 500) {
            logger.error(logEntry, 'Request failed');
        }
        else if (status >= 400) {
            logger.warn(logEntry, 'Request warning');
        }
        else {
            logger.info(logEntry, 'Request completed');
        }
        // Audit log for specific operations
        if (c.req.path.includes('/auth/')) {
            logger.info({
                ...logEntry,
                userId: c.get('user')?.userId,
                email: c.get('user')?.email,
            }, 'Auth operation');
        }
    }
    catch (error) {
        logger.error({ error }, 'Request failed');
        throw error;
    }
    finally {
        metrics.activeConnections.dec();
    }
});
// Database query timing middleware (to be used in services)
export { trackDbQuery };
// ---------------------------
// Routes
// ---------------------------
app.get('/', (c) => {
    logger.info('Root endpoint accessed');
    return c.json({
        message: 'Welcome to GETKEJA API!',
        environment: env.nodeEnv,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
    });
});
app.get('/health', (c) => {
    const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: env.nodeEnv,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
    };
    logger.debug(healthData, 'Health check');
    return c.json(healthData);
});
app.get('/metrics/health', (c) => {
    return c.json({
        status: 'ok',
        metrics: {
            totalRequests: 'Available at /metrics',
            activeConnections: 'Available at /metrics',
        },
    });
});
// ---------------------------
// Rate Limiting
// ---------------------------
app.use('/api/*', apiRateLimiter);
app.use('/api/auth/*', authRateLimiter);
// ---------------------------
// Routes
// ---------------------------
app.route('api/auth', authRouter);
app.route('api/properties', propertiesRouter);
app.route('api/spatial', spatialRouter);
app.route('api/dashboard', dashboardRouter);
app.route('api/users', usersRouter);
// ---------------------------
// Error Handling
// ---------------------------
app.onError((err, c) => {
    const errorId = crypto.randomUUID();
    logger.error({
        errorId,
        message: err.message,
        stack: env.nodeEnv === 'development' ? err.stack : undefined,
        path: c.req.path,
        method: c.req.method,
        timestamp: new Date().toISOString(),
    }, 'Internal Server Error');
    return c.json({
        message: 'Internal Server Error',
        errorId,
        error: env.nodeEnv === 'development' ? err.message : undefined,
    }, 500);
});
// Not Found
app.notFound((c) => {
    logger.warn({
        path: c.req.path,
        method: c.req.method,
    }, 'Route not found');
    return c.json({
        message: 'Route not found',
        path: c.req.path,
    }, 404);
});
// ---------------------------
// Start Server
// ---------------------------
const port = env.port;
serve({
    fetch: app.fetch,
    port,
}, (info) => {
    logger.info({
        port: info.port,
        environment: env.nodeEnv,
        url: `http://localhost:${info.port}`,
        metrics: `http://localhost:${info.port}/metrics`,
        timestamp: new Date().toISOString(),
    }, '🚀 Server started successfully');
    // Log startup banner
    console.log(`
╔══════════════════════════════════════════════════════════╗
║                   🏠 GETKEJA API                         ║
╠══════════════════════════════════════════════════════════╣
║  Environment: ${env.nodeEnv.padEnd(30)} ║
║  Port: ${port.toString().padEnd(34)} ║
║  URL: http://localhost:${port}/                          ║
║  Metrics: http://localhost:${port}/metrics               ║
║  Health: http://localhost:${port}/health                 ║
║  Started: ${new Date().toLocaleString().padEnd(29)} ║
╚══════════════════════════════════════════════════════════╝
  `);
});
// ---------------------------
// Graceful Shutdown
// ---------------------------
process.on('SIGTERM', () => {
    logger.info('🛑 SIGTERM received, shutting down gracefully...');
    process.exit(0);
});
process.on('SIGINT', () => {
    logger.info('🛑 SIGINT received, shutting down gracefully...');
    process.exit(0);
});
process.on('uncaughtException', (error) => {
    logger.error({
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
    }, '💥 Uncaught Exception');
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    logger.error({
        reason,
        promise,
        timestamp: new Date().toISOString(),
    }, '💥 Unhandled Rejection');
});
export default app;
