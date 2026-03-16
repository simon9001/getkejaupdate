// backend/src/utils/logger.ts
import pino from 'pino';
import client from 'prom-client';
import { env } from '../config/environment.js';
// Initialize Prometheus registry
export const prometheusRegistry = new client.Registry();
// Add default metrics
client.collectDefaultMetrics({
    register: prometheusRegistry,
    prefix: 'getkeja_',
});
// Create Pino logger instance
export const logger = pino({
    level: env.logLevel || 'info',
    transport: env.isDevelopment
        ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
            },
        }
        : undefined,
    base: {
        service: 'getkeja-api',
        env: env.nodeEnv,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
});
// Create a child logger for specific modules
export const createModuleLogger = (module) => {
    return logger.child({ module });
};
// Custom Prometheus metrics
export const metrics = {
    httpRequestsTotal: new client.Counter({
        name: 'getkeja_http_requests_total',
        help: 'Total number of HTTP requests',
        labelNames: ['method', 'path', 'status'],
        registers: [prometheusRegistry],
    }),
    httpRequestDuration: new client.Histogram({
        name: 'getkeja_http_request_duration_seconds',
        help: 'HTTP request duration in seconds',
        labelNames: ['method', 'path'],
        buckets: [0.1, 0.5, 1, 2, 5],
        registers: [prometheusRegistry],
    }),
    activeConnections: new client.Gauge({
        name: 'getkeja_http_active_connections',
        help: 'Number of active connections',
        registers: [prometheusRegistry],
    }),
    dbQueryDuration: new client.Histogram({
        name: 'getkeja_db_query_duration_seconds',
        help: 'Database query duration in seconds',
        labelNames: ['operation', 'table'],
        buckets: [0.05, 0.1, 0.5, 1, 2],
        registers: [prometheusRegistry],
    }),
    dbQueryTotal: new client.Counter({
        name: 'getkeja_db_queries_total',
        help: 'Total number of database queries',
        labelNames: ['operation', 'table', 'status'],
        registers: [prometheusRegistry],
    }),
    authAttempts: new client.Counter({
        name: 'getkeja_auth_attempts_total',
        help: 'Total number of authentication attempts',
        labelNames: ['type', 'status'],
        registers: [prometheusRegistry],
    }),
    userRegistrations: new client.Counter({
        name: 'getkeja_user_registrations_total',
        help: 'Total number of user registrations',
        labelNames: ['status'],
        registers: [prometheusRegistry],
    }),
    emailDeliveries: new client.Counter({
        name: 'getkeja_email_deliveries_total',
        help: 'Total number of email deliveries',
        labelNames: ['type', 'status'],
        registers: [prometheusRegistry],
    }),
    cleanupOperations: new client.Counter({
        name: 'getkeja_cleanup_operations_total',
        help: 'Total number of cleanup operations',
        labelNames: ['operation', 'status'],
        registers: [prometheusRegistry],
    }),
    activeUsers: new client.Gauge({
        name: 'getkeja_active_users',
        help: 'Number of active users',
        registers: [prometheusRegistry],
    }),
    verifiedUsers: new client.Gauge({
        name: 'getkeja_verified_users',
        help: 'Number of verified users',
        registers: [prometheusRegistry],
    }),
    unverifiedUsers: new client.Gauge({
        name: 'getkeja_unverified_users',
        help: 'Number of unverified users',
        registers: [prometheusRegistry],
    }),
};
// Audit logger for security events
export const auditLogger = {
    log: (event, details) => {
        const auditEntry = {
            timestamp: new Date().toISOString(),
            event,
            ...details,
        };
        logger.info(auditEntry, `AUDIT: ${event}`);
        // In production, you might want to write to a separate audit file
        if (env.isProduction) {
            // You could add a separate file transport here
        }
    },
};
// Database query logger with metrics
export const trackDbQuery = async (operation, table, queryFn, query) => {
    const start = Date.now();
    try {
        const result = await queryFn();
        const duration = (Date.now() - start) / 1000;
        // Record metrics
        metrics.dbQueryDuration.observe({ operation, table }, duration);
        metrics.dbQueryTotal.inc({ operation, table, status: 'success' });
        // Log query in development
        if (env.isDevelopment && query) {
            logger.debug({ operation, table, duration: `${duration}s`, query }, 'Database query');
        }
        else {
            logger.debug({ operation, table, duration: `${duration}s` }, 'Database query');
        }
        return result;
    }
    catch (error) {
        const duration = (Date.now() - start) / 1000;
        // Record failure metrics
        metrics.dbQueryTotal.inc({ operation, table, status: 'failure' });
        logger.error({
            operation,
            table,
            duration: `${duration}s`,
            error: error instanceof Error ? error.message : String(error),
            query: env.isDevelopment ? query : undefined,
        }, 'Database query failed');
        throw error;
    }
};
// Export a function to get metrics in Prometheus format
export const getMetrics = async () => {
    return await prometheusRegistry.metrics();
};
// Export metrics content type
export const metricsContentType = prometheusRegistry.contentType;
// Initialize any gauges that need to be set
export const initializeMetrics = () => {
    // Set initial values for gauges
    metrics.activeConnections.set(0);
    metrics.activeUsers.set(0);
    metrics.verifiedUsers.set(0);
    metrics.unverifiedUsers.set(0);
    logger.info('✅ Prometheus metrics initialized');
};
// Call initialize
initializeMetrics();
export default logger;
