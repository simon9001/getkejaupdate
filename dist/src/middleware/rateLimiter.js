import { rateLimiter } from 'hono-rate-limiter';
// Extract IP safely
const getClientIP = (c) => {
    return (c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
        c.req.header('x-real-ip') ||
        'unknown');
};
// General API rate limit
export const apiRateLimiter = rateLimiter({
    windowMs: 60 * 1000, // 1 minute
    limit: 100,
    keyGenerator: (c) => getClientIP(c),
});
// Strict auth limiter
export const authRateLimiter = rateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 20,
    keyGenerator: (c) => getClientIP(c),
});
