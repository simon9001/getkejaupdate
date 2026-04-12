/**
 * subscriptions.router.ts
 *
 * Route map:
 *
 *  Public (no auth):
 *    GET  /api/subscriptions/plans          → list all active plans
 *    GET  /api/subscriptions/plans/:id      → single plan detail
 *
 *  Authenticated — any role:
 *    GET  /api/subscriptions/me                          → my current subscription
 *    GET  /api/subscriptions/me/history                  → all my past subscriptions
 *    POST /api/subscriptions/subscribe                   → subscribe to a plan
 *    POST /api/subscriptions/upgrade                     → change plan
 *    POST /api/subscriptions/cancel                      → cancel subscription
 *    GET  /api/subscriptions/viewing-fee/:propertyId     → fee preview before unlocking
 *    POST /api/subscriptions/unlock                      → unlock a property for viewing
 *    POST /api/subscriptions/book-viewing                → book a viewing slot
 *    GET  /api/subscriptions/my-unlocks                  → my viewing unlocks
 *
 *  Admin (super_admin | staff):
 *    GET   /api/subscriptions/admin/all              → all subscriptions (paginated)
 *    GET   /api/subscriptions/admin/user/:userId     → subscriptions for one user
 *    GET   /api/subscriptions/admin/revenue          → revenue summary (date range)
 *    PATCH /api/subscriptions/admin/:id/status       → override status
 *    POST  /api/subscriptions/admin/:id/renew        → manually trigger renewal
 *
 * Route ordering:
 *   Named paths (/me, /me/history, /plans, /admin/*) are declared BEFORE
 *   any /:id wildcard to prevent path conflicts.
 */

import { Hono }       from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z }          from 'zod';
import type { MiddlewareHandler } from 'hono';

import { authenticate }             from '../middleware/auth.middleware.js';
import { subscriptionsController }  from './Subscriptions.controller.js';
import {
  subscribePlanSchema,
  cancelSubscriptionSchema,
  adminSetStatusSchema,
  unlockPropertySchema,
  bookViewingSchema,
} from '../types/Subscription.types.js';

const subscriptionsRouter = new Hono();

// ─────────────────────────────────────────────────────────────────────────────
// Role guard — admin only
// ─────────────────────────────────────────────────────────────────────────────
const requireAdmin: MiddlewareHandler = async (c, next) => {
  const roles = (c.get('user')?.roles ?? []) as string[];
  if (!roles.includes('super_admin') && !roles.includes('staff')) {
    return c.json(
      { message: 'Forbidden: admin role required', code: 'FORBIDDEN' },
      403,
    );
  }
  await next();
};

// ─────────────────────────────────────────────────────────────────────────────
// Extra validation schemas (simple bodies)
// ─────────────────────────────────────────────────────────────────────────────

const revenueDateSchema = z.object({
  from: z.string().date('from must be YYYY-MM-DD').optional(),
  to:   z.string().date('to must be YYYY-MM-DD').optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Public routes  (no auth)
// ─────────────────────────────────────────────────────────────────────────────

subscriptionsRouter.get(
  '/plans',
  (c) => subscriptionsController.getPlans(c),
);

subscriptionsRouter.get(
  '/plans/:id',
  (c) => subscriptionsController.getPlanById(c),
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Self-service routes  (authenticated — any role)
//    IMPORTANT: all named paths declared before any /:id wildcard
// ─────────────────────────────────────────────────────────────────────────────

subscriptionsRouter.get(
  '/me',
  authenticate,
  (c) => subscriptionsController.getMySubscription(c),
);

subscriptionsRouter.get(
  '/me/history',
  authenticate,
  (c) => subscriptionsController.getMyHistory(c),
);

subscriptionsRouter.get(
  '/my-unlocks',
  authenticate,
  (c) => subscriptionsController.getMyUnlocks(c),
);

/**
 * GET /api/subscriptions/viewing-fee/:propertyId
 *
 * Preview the viewing fee for a property before committing to unlock it.
 * Takes the user's subscription credits into account — returns fee_kes: 0
 * if the unlock would be free (credit or subscriber perk).
 */
subscriptionsRouter.get(
  '/viewing-fee/:propertyId',
  authenticate,
  (c) => subscriptionsController.getViewingFee(c),
);

/**
 * POST /api/subscriptions/subscribe
 *
 * Body:
 * {
 *   "plan_id":        "uuid",
 *   "billing_cycle":  "monthly" | "annual",
 *   "payment_method": "mpesa" | "card" | "bank_transfer",
 *   "mpesa_phone":    "+254712345678"  // required when payment_method = "mpesa"
 * }
 */
subscriptionsRouter.post(
  '/subscribe',
  authenticate,
  zValidator('json', subscribePlanSchema),
  (c) => subscriptionsController.subscribe(c),
);

/**
 * POST /api/subscriptions/upgrade
 *
 * Same body as /subscribe.
 * Cancels the current plan and subscribes to the new one atomically.
 */
subscriptionsRouter.post(
  '/upgrade',
  authenticate,
  zValidator('json', subscribePlanSchema),
  (c) => subscriptionsController.upgradePlan(c),
);

/**
 * POST /api/subscriptions/cancel
 *
 * Body: { "reason": "optional string" }
 * Access continues until renews_at — no immediate revocation.
 */
subscriptionsRouter.post(
  '/cancel',
  authenticate,
  zValidator('json', cancelSubscriptionSchema),
  (c) => subscriptionsController.cancelSubscription(c),
);

/**
 * POST /api/subscriptions/unlock
 *
 * Body:
 * {
 *   "property_id":    "uuid",
 *   "payment_method": "mpesa",
 *   "mpesa_phone":    "+254712345678"
 * }
 *
 * If the user has subscription credits, one is deducted and fee = 0.
 * Idempotent — re-calling for an already-unlocked property returns 200.
 */
subscriptionsRouter.post(
  '/unlock',
  authenticate,
  zValidator('json', unlockPropertySchema),
  (c) => subscriptionsController.unlockProperty(c),
);

/**
 * POST /api/subscriptions/book-viewing
 *
 * Body:
 * {
 *   "property_id":      "uuid",
 *   "viewing_datetime": "2025-06-15T10:00:00.000Z"
 * }
 *
 * Requires the property to already be unlocked by this user.
 */
subscriptionsRouter.post(
  '/book-viewing',
  authenticate,
  zValidator('json', bookViewingSchema),
  (c) => subscriptionsController.bookViewing(c),
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Admin routes  (super_admin | staff)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/subscriptions/admin/all?page=1&limit=20&status=active
 */
subscriptionsRouter.get(
  '/admin/all',
  authenticate,
  requireAdmin,
  (c) => subscriptionsController.getAllSubscriptions(c),
);

/**
 * GET /api/subscriptions/admin/revenue?from=2025-01-01&to=2025-01-31
 */
subscriptionsRouter.get(
  '/admin/revenue',
  authenticate,
  requireAdmin,
  zValidator('query', revenueDateSchema),
  (c) => subscriptionsController.getRevenueSummary(c),
);

/**
 * GET /api/subscriptions/admin/user/:userId
 */
subscriptionsRouter.get(
  '/admin/user/:userId',
  authenticate,
  requireAdmin,
  (c) => subscriptionsController.getUserSubscriptions(c),
);

/**
 * PATCH /api/subscriptions/admin/:id/status
 * Body: { "status": "active" | "cancelled" | "past_due" | "expired", "reason"?: "..." }
 */
subscriptionsRouter.patch(
  '/admin/:id/status',
  authenticate,
  requireAdmin,
  zValidator('json', adminSetStatusSchema),
  (c) => subscriptionsController.adminSetStatus(c),
);

/**
 * POST /api/subscriptions/admin/:id/renew
 * Manually trigger a renewal attempt for a subscription.
 */
subscriptionsRouter.post(
  '/admin/:id/renew',
  authenticate,
  requireAdmin,
  (c) => subscriptionsController.adminTriggerRenewal(c),
);

export { subscriptionsRouter };