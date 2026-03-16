import { prometheusRegistry } from '../utils/logger.js';
export const metricsMiddleware = async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    // You can add custom metrics here
    c.set('requestDuration', duration);
};
export default metricsMiddleware;
