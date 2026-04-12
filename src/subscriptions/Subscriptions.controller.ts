/**
 * subscriptions.controller.ts
 *
 * Thin HTTP adapter — validates input, calls the service, returns
 * consistent JSON responses.  All business logic lives in the service.
 */

import type { Context } from 'hono';
import { subscriptionsService } from './Subscriptions.service.js';
import { logger }                from '../utils/logger.js';
import type { SubscriptionStatus } from '../types/Subscription.types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Error → HTTP status mapping (same pattern as properties module)
// ─────────────────────────────────────────────────────────────────────────────
function resolveStatus(err: Error): 400 | 403 | 404 | 409 | 422 | 500 {
  const msg = err.message.toLowerCase();
  if (msg.includes('not found'))                        return 404;
  if (msg.includes('forbidden') || msg.includes('unauthorized')) return 403;
  if (msg.includes('already') || msg.includes('already on this plan')) return 409;
  if (msg.includes('expired') || msg.includes('past due'))       return 422;
  if (
    msg.includes('required') ||
    msg.includes('invalid')  ||
    msg.includes('must be')  ||
    msg.includes('not available')
  ) return 400;
  return 500;
}

function fail(c: Context, err: unknown, code: string) {
  const error  = err instanceof Error ? err : new Error(String(err));
  const status = resolveStatus(error);

  logger.error(
    { requestId: c.get('requestId'), code, message: error.message },
    'subscriptions.controller.error',
  );

  return c.json({ message: error.message || 'Request failed', code }, status);
}

// =============================================================================
// SubscriptionsController
// =============================================================================
export class SubscriptionsController {

  // ─────────────────────────────────────────────────────────────────────────
  // PLANS
  // ─────────────────────────────────────────────────────────────────────────

  /** GET /api/subscriptions/plans */
  async getPlans(c: Context) {
    try {
      const plans = await subscriptionsService.getPlans();
      return c.json({ plans, total: plans.length, code: 'PLANS_FETCHED' });
    } catch (err) {
      return fail(c, err, 'PLANS_FETCH_FAILED');
    }
  }

  /** GET /api/subscriptions/plans/:id */
  async getPlanById(c: Context) {
    try {
      const plan = await subscriptionsService.getPlanById(c.req.param('id'));
      return c.json({ plan, code: 'PLAN_FETCHED' });
    } catch (err) {
      return fail(c, err, 'PLAN_FETCH_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SELF — subscription management
  // ─────────────────────────────────────────────────────────────────────────

  /** GET /api/subscriptions/me */
  async getMySubscription(c: Context) {
    try {
      const user         = c.get('user');
      const subscription = await subscriptionsService.getMySubscription(user.userId);
      return c.json({
        subscription,
        has_active: subscription !== null,
        code: 'SUBSCRIPTION_FETCHED',
      });
    } catch (err) {
      return fail(c, err, 'SUBSCRIPTION_FETCH_FAILED');
    }
  }

  /** GET /api/subscriptions/me/history */
  async getMyHistory(c: Context) {
    try {
      const user    = c.get('user');
      const history = await subscriptionsService.getMySubscriptionHistory(user.userId);
      return c.json({ history, total: history.length, code: 'HISTORY_FETCHED' });
    } catch (err) {
      return fail(c, err, 'HISTORY_FETCH_FAILED');
    }
  }

  /**
   * POST /api/subscriptions/subscribe
   * Body: { plan_id, billing_cycle, payment_method, mpesa_phone? }
   */
  async subscribe(c: Context) {
    try {
      const user   = c.get('user');
      const input  = await c.req.json();
      const result = await subscriptionsService.subscribe(user.userId, input);
      return c.json(
        { message: 'Subscription created successfully', code: 'SUBSCRIBED', subscription: result },
        201,
      );
    } catch (err) {
      return fail(c, err, 'SUBSCRIBE_FAILED');
    }
  }

  /**
   * POST /api/subscriptions/upgrade
   * Body: { plan_id, billing_cycle, payment_method, mpesa_phone? }
   *
   * Cancels the current plan and creates a new one in one atomic step.
   */
  async upgradePlan(c: Context) {
    try {
      const user   = c.get('user');
      const input  = await c.req.json();
      const result = await subscriptionsService.upgradePlan(user.userId, input);
      return c.json({
        message: 'Plan changed successfully',
        code:    'PLAN_CHANGED',
        subscription: result,
      });
    } catch (err) {
      return fail(c, err, 'PLAN_CHANGE_FAILED');
    }
  }

  /**
   * POST /api/subscriptions/cancel
   * Body: { reason? }
   */
  async cancelSubscription(c: Context) {
    try {
      const user   = c.get('user');
      const input  = await c.req.json().catch(() => ({}));
      const result = await subscriptionsService.cancelSubscription(user.userId, input);
      return c.json({ ...result, code: 'SUBSCRIPTION_CANCELLED' });
    } catch (err) {
      return fail(c, err, 'CANCEL_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VIEWING UNLOCKS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/subscriptions/viewing-fee/:propertyId
   * Returns the fee a user would pay to unlock a specific property,
   * taking their subscription credits into account.
   */
  async getViewingFee(c: Context) {
    try {
      const user       = c.get('user');
      const propertyId = c.req.param('propertyId');
      const feeInfo    = await subscriptionsService.getViewingFee(user.userId, propertyId);
      return c.json({ ...feeInfo, code: 'VIEWING_FEE_FETCHED' });
    } catch (err) {
      return fail(c, err, 'VIEWING_FEE_FETCH_FAILED');
    }
  }

  /**
   * POST /api/subscriptions/unlock
   * Body: { property_id, payment_method, mpesa_phone? }
   *
   * Unlocks a property for viewing.  If the user has subscription credits,
   * deducts one — otherwise charges the viewing fee.
   */
  async unlockProperty(c: Context) {
    try {
      const user   = c.get('user');
      const input  = await c.req.json();
      const result = await subscriptionsService.unlockProperty(user.userId, input);
      return c.json(result, result.code === 'ALREADY_UNLOCKED' ? 200 : 201);
    } catch (err) {
      return fail(c, err, 'UNLOCK_FAILED');
    }
  }

  /**
   * POST /api/subscriptions/book-viewing
   * Body: { property_id, viewing_datetime }
   *
   * Books a viewing slot for a previously unlocked property.
   */
  async bookViewing(c: Context) {
    try {
      const user   = c.get('user');
      const input  = await c.req.json();
      const result = await subscriptionsService.bookViewing(user.userId, input);
      return c.json(result, 201);
    } catch (err) {
      return fail(c, err, 'BOOK_VIEWING_FAILED');
    }
  }

  /**
   * GET /api/subscriptions/my-unlocks
   * Returns all viewing unlocks for the authenticated user.
   */
  async getMyUnlocks(c: Context) {
    try {
      const user    = c.get('user');
      const unlocks = await subscriptionsService.getMyUnlocks(user.userId);
      return c.json({ unlocks, total: unlocks.length, code: 'UNLOCKS_FETCHED' });
    } catch (err) {
      return fail(c, err, 'UNLOCKS_FETCH_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ADMIN
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/subscriptions/admin/all
   * Query params: page, limit, status
   */
  async getAllSubscriptions(c: Context) {
    try {
      const q      = c.req.query();
      const page   = Math.max(1, Number(q.page)  || 1);
      const limit  = Math.min(100, Number(q.limit) || 20);
      const status = q.status as SubscriptionStatus | undefined;

      const result = await subscriptionsService.getAllSubscriptions(page, limit, status);
      return c.json({ ...result, code: 'ALL_SUBSCRIPTIONS_FETCHED' });
    } catch (err) {
      return fail(c, err, 'ALL_SUBSCRIPTIONS_FETCH_FAILED');
    }
  }

  /**
   * GET /api/subscriptions/admin/user/:userId
   * All subscriptions for a specific user.
   */
  async getUserSubscriptions(c: Context) {
    try {
      const userId = c.req.param('userId');
      const data   = await subscriptionsService.getUserSubscriptions(userId);
      return c.json({ subscriptions: data, total: data.length, code: 'USER_SUBSCRIPTIONS_FETCHED' });
    } catch (err) {
      return fail(c, err, 'USER_SUBSCRIPTIONS_FETCH_FAILED');
    }
  }

  /**
   * PATCH /api/subscriptions/admin/:id/status
   * Body: { status, reason? }
   *
   * Admin override — change subscription status directly.
   */
  async adminSetStatus(c: Context) {
    try {
      const id     = c.req.param('id');
      const input  = await c.req.json();
      const result = await subscriptionsService.adminSetStatus(id, input);
      return c.json({
        message: `Subscription status set to ${result.status}`,
        code:    'STATUS_OVERRIDDEN',
        subscription: result,
      });
    } catch (err) {
      return fail(c, err, 'STATUS_OVERRIDE_FAILED');
    }
  }

  /**
   * GET /api/subscriptions/admin/revenue
   * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD)
   */
  async getRevenueSummary(c: Context) {
    try {
      const q        = c.req.query();
      const fromDate = q.from ?? new Date(new Date().setDate(1)).toISOString().split('T')[0]; // start of month
      const toDate   = q.to   ?? new Date().toISOString().split('T')[0];                      // today

      const result = await subscriptionsService.getRevenueSummary(fromDate, toDate);
      return c.json({ ...result, code: 'REVENUE_FETCHED' });
    } catch (err) {
      return fail(c, err, 'REVENUE_FETCH_FAILED');
    }
  }

  /**
   * POST /api/subscriptions/admin/:id/renew
   * Manually trigger a renewal for a specific subscription (admin only).
   * Useful for testing or correcting past_due subscriptions.
   */
  async adminTriggerRenewal(c: Context) {
    try {
      const id = c.req.param('id');
      await subscriptionsService.renewSubscription(id);
      return c.json({ message: 'Renewal processed', code: 'RENEWAL_TRIGGERED' });
    } catch (err) {
      return fail(c, err, 'RENEWAL_TRIGGER_FAILED');
    }
  }
}

export const subscriptionsController = new SubscriptionsController();