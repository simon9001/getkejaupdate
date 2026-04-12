import { rateLimiter } from 'hono-rate-limiter'
// Removed duplicate import of Context

// Extract IP safely
const getClientIP = (c: Context) => {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  )
}

// General API rate limit
export const apiRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  limit: 100,
  keyGenerator: (c) => getClientIP(c),
})

// Strict auth limiter
export const authRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,
  keyGenerator: (c) => getClientIP(c),
})
/**
 * rate-limit.middleware.ts
 *
 * Lightweight, configurable rate limiter for Hono.
 * Uses an in-memory store by default — swap `MemoryStore` for an
 * Upstash/Redis store later without changing any call-sites.
 *
 * Usage:
 *   import { rateLimit } from '../middleware/rate-limit.middleware.js';
 *   authRouter.post('/login', rateLimit({ windowMs: 60_000, max: 10 }), ...)
 */

import type { Context, MiddlewareHandler, Next } from 'hono';

// ---------------------------------------------------------------------------
// Store interface — lets you swap in Redis / Upstash later
// ---------------------------------------------------------------------------
export interface RateLimitStore {
  /** Increment the counter for `key`, return the new count and the window expiry. */
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
  /** Optional: clean up expired keys (called periodically). */
  prune?(): void;
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------
interface Entry {
  count: number;
  resetAt: number;
}

export class MemoryStore implements RateLimitStore {
  private map = new Map<string, Entry>();

  async increment(key: string, windowMs: number) {
    const now = Date.now();
    const entry = this.map.get(key);

    if (!entry || entry.resetAt <= now) {
      const resetAt = now + windowMs;
      this.map.set(key, { count: 1, resetAt });
      return { count: 1, resetAt };
    }

    entry.count += 1;
    return { count: entry.count, resetAt: entry.resetAt };
  }

  prune() {
    const now = Date.now();
    for (const [key, entry] of this.map.entries()) {
      if (entry.resetAt <= now) this.map.delete(key);
    }
  }
}

// Singleton in-memory store shared across all limiter instances unless overridden.
const defaultStore = new MemoryStore();
// Prune stale entries every 5 minutes to prevent unbounded memory growth.
setInterval(() => defaultStore.prune?.(), 5 * 60 * 1_000).unref?.();

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
export interface RateLimitOptions {
  /** Time window in milliseconds. Default: 60_000 (1 min). */
  windowMs?: number;
  /** Maximum requests per window per key. Default: 20. */
  max?: number;
  /**
   * How to derive the rate-limit key from a request.
   * Default: IP address from x-forwarded-for / x-real-ip headers.
   */
  keyFn?: (c: Context) => string;
  /** Message returned when the limit is exceeded. */
  message?: string;
  /** Error code returned when the limit is exceeded. */
  code?: string;
  /** Pluggable store. Defaults to the shared MemoryStore. */
  store?: RateLimitStore;
  /**
   * When true, also apply a per-email sub-limit using the `email`
   * field from the request body. Useful for forgot-password & resend-verification
   * to prevent email-bombing a single address even from many IPs.
   * The email limit shares the same `max` and `windowMs`.
   */
  limitByEmail?: boolean;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------
export function rateLimit(options: RateLimitOptions = {}): MiddlewareHandler {
  const {
    windowMs = 60_000,
    max = 20,
    message = 'Too many requests. Please try again later.',
    code = 'RATE_LIMIT_EXCEEDED',
    store = defaultStore,
    keyFn = (c) =>
      (c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown')
        .split(',')[0]
        .trim(),
    limitByEmail = false,
  } = options;

  return async (c: Context, next: Next) => {
    // --- IP-based check ---
    const ipKey = `rl:ip:${c.req.path}:${keyFn(c)}`;
    const { count: ipCount, resetAt } = await store.increment(ipKey, windowMs);

    if (ipCount > max) {
      return c.json(
        { message, code },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((resetAt - Date.now()) / 1_000)) },
        },
      );
    }

    // --- Optional per-email check ---
    if (limitByEmail) {
      try {
        const raw = await c.req.raw.clone().json().catch(() => null);
        const email: string | undefined = raw?.email;

        if (email) {
          const emailKey = `rl:email:${c.req.path}:${email.toLowerCase()}`;
          const { count: emailCount, resetAt: emailReset } = await store.increment(
            emailKey,
            windowMs,
          );

          if (emailCount > max) {
            return c.json(
              { message, code },
              {
                status: 429,
                headers: {
                  'Retry-After': String(Math.ceil((emailReset - Date.now()) / 1_000)),
                },
              },
            );
          }
        }
      } catch {
        // Non-JSON body — skip email check silently.
      }
    }

    await next();
  };
}