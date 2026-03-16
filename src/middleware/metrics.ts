// backend/src/middleware/metrics.ts
import type { Context, Next } from 'hono';
import { prometheusRegistry } from '../utils/logger.js';

export const metricsMiddleware = async (c: Context, next: Next) => {
  const start = Date.now();
  
  await next();
  
  const duration = Date.now() - start;
  
  // You can add custom metrics here
  c.set('requestDuration', duration);
};

export default metricsMiddleware;