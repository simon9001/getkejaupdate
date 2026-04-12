/**
 * admin.router.ts
 *
 * All routes require: authenticate + requireAdmin (super_admin | staff).
 * A few write operations are further restricted to super_admin only
 * (fee config changes, plan pricing, campaign approval).
 *
 * ─────────────────────────────────────────────────────────────────────
 * OVERVIEW
 *   GET  /api/admin/kpi                          → all KPI cards
 *
 * REVENUE
 *   GET  /api/admin/revenue/breakdown?from=&to=  → stream breakdown
 *   GET  /api/admin/revenue/series?days=30       → daily time series
 *
 * USERS
 *   GET  /api/admin/users                        → paginated user list  (→ users.router)
 *   GET  /api/admin/users/stats                  → aggregate counts
 *   GET  /api/admin/users/:id                    → single user detail   (→ users.router)
 *   GET  /api/admin/users/:id/activity           → full activity profile
 *   PATCH /api/admin/users/:id/status            → change account status (→ users.router)
 *   PATCH /api/admin/users/:id/roles             → assign/revoke roles   (→ users.router)
 *   DELETE /api/admin/users/:id                  → soft-delete user      (→ users.router)
 *
 * PROPERTIES
 *   GET  /api/admin/properties                   → paginated list        (→ properties.router)
 *   GET  /api/admin/properties/stats             → aggregate breakdown
 *   GET  /api/admin/properties/attention         → listings needing review
 *   GET  /api/admin/properties/top               → top by search score
 *   PATCH /api/admin/properties/:id/status       → set status            (→ properties.router)
 *   PATCH /api/admin/properties/:id/featured     → toggle featured       (→ properties.router)
 *
 * BOOKINGS
 *   GET  /api/admin/bookings/stats               → cross-module summary
 *   GET  /api/admin/bookings/short-stay          → paginated SS bookings
 *   GET  /api/admin/bookings/long-term           → paginated LT bookings
 *
 * MODERATION
 *   GET  /api/admin/moderation/verifications     → pending ID verifications
 *   GET  /api/admin/moderation/disputes          → open short-stay disputes
 *   PATCH /api/admin/moderation/disputes/:id/resolve → resolve dispute   (→ short-stay.router)
 *   GET  /api/admin/moderation/reviews           → fraud review queue
 *   PATCH /api/admin/moderation/reviews/:id/moderate → approve/reject    (→ reviews.router)
 *   GET  /api/admin/moderation/messages          → reported messages
 *   PATCH /api/admin/moderation/messages/:reportId/resolve → mark reviewed
 *
 * SUBSCRIPTIONS & PLANS
 *   GET  /api/admin/subscriptions/stats          → subscriber counts
 *   GET  /api/admin/subscriptions/plans          → plans + subscriber counts
 *   PATCH /api/admin/subscriptions/plans/:id     → update plan [super_admin]
 *   GET  /api/admin/subscriptions/all            → all subscriptions     (→ subscriptions.router)
 *   PATCH /api/admin/subscriptions/:id/status    → override status       (→ subscriptions.router)
 *   POST /api/admin/subscriptions/:id/renew      → manual renewal        (→ subscriptions.router)
 *
 * FEES
 *   GET  /api/admin/fees                         → all fee config
 *   PATCH /api/admin/fees/config/:key            → update fee value      [super_admin]
 *   PATCH /api/admin/fees/viewing/:id            → update viewing fee    [super_admin]
 *   PATCH /api/admin/fees/boosts/:id             → update boost package  [super_admin]
 *
 * SEARCH ANALYTICS
 *   GET  /api/admin/search/analytics?days=30     → search query analytics
 *
 * AUDIT LOG
 *   GET  /api/admin/audit                        → full log with filters
 *   GET  /api/admin/audit/breakdown              → event type counts
 *
 * ADS
 *   GET  /api/admin/ads/stats                    → platform ad stats
 *   GET  /api/admin/ads                          → paginated campaigns
 *   PATCH /api/admin/ads/:id/approve             → approve pending campaign
 *   PATCH /api/admin/ads/:id/pause               → pause active campaign
 *
 * REVIEWS
 *   GET  /api/admin/reviews/stats                → review + fraud stats
 *
 * ─────────────────────────────────────────────────────────────────────
 * Route ordering:
 *   Named paths (/stats, /breakdown, /series, /attention, /top, /all,
 *   /plans, /config, /viewing, /boosts, /analytics, /breakdown)
 *   are ALL declared BEFORE any /:id wildcard.
 */

import { Hono }                from 'hono';
import type { MiddlewareHandler } from 'hono';
import { authenticate }          from '../middleware/auth.middleware.js';
import { adminController }       from './admin.controller.js';

const adminRouter = new Hono();

// ─────────────────────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────────────────────

/** Any admin role (super_admin OR staff) */
const requireAdmin: MiddlewareHandler = async (c, next) => {
  const roles = (c.get('user')?.roles ?? []) as string[];
  if (!roles.includes('super_admin') && !roles.includes('staff')) {
    return c.json({ message: 'Forbidden: admin access required', code: 'FORBIDDEN' }, 403);
  }
  await next();
};

/** Restricted to super_admin only (fee changes, plan pricing, campaign approval) */
const requireSuperAdmin: MiddlewareHandler = async (c, next) => {
  const roles = (c.get('user')?.roles ?? []) as string[];
  if (!roles.includes('super_admin')) {
    return c.json({ message: 'Forbidden: super_admin role required', code: 'FORBIDDEN' }, 403);
  }
  await next();
};

// Apply auth + admin guard to every route in this router
adminRouter.use('*', authenticate, requireAdmin);

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/kpi
 *
 * Returns all top-level KPI cards in a single response:
 *   users.total, users.new_30d
 *   properties.total, properties.active
 *   short_stay_bookings.total, long_term_bookings.active
 *   revenue.all_time_kes, revenue.month_kes
 *   moderation.pending_id_verifications, open_disputes, fraud_signals
 *   subscriptions.active, visits.pending_confirmation
 */
adminRouter.get('/kpi', (c) => adminController.getKpiSnapshot(c));

// ─────────────────────────────────────────────────────────────────────────────
// REVENUE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/revenue/breakdown?from=2025-01-01T00:00:00Z&to=2025-01-31T23:59:59Z
 *
 * Breaks revenue into four streams:
 *   listing_fees_kes, viewing_fees_kes, subscriptions_kes, short_stay_fees_kes
 * Also returns by-tier breakdown for listing fees and by-plan for subscriptions.
 * Defaults to current calendar month when from/to are omitted.
 */
adminRouter.get('/revenue/breakdown', (c) => adminController.getRevenueBreakdown(c));

/**
 * GET /api/admin/revenue/series?days=30
 *
 * Day-by-day revenue from vw_daily_revenue view.
 * Returns an array: [{ day, listing_fee, viewing_fee, subscription }, ...]
 */
adminRouter.get('/revenue/series', (c) => adminController.getDailyRevenueSeries(c));

// ─────────────────────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/users/stats
 * Aggregate counts: by_status, by_provider, by_role, new_this_month, verified_ids_total.
 */
adminRouter.get('/users/stats', (c) => adminController.getUserStats(c));

/**
 * GET /api/admin/users/:id/activity
 *
 * Full activity profile for one user:
 *   user row + profiles + roles + verifications
 *   recent sessions (last 5)
 *   owned properties (last 5)
 *   short-stay bookings as guest + host (last 5 each)
 *   long-term bookings as tenant + landlord (last 5 each)
 *   reviews given (last 10)
 *   active subscription
 *   recent audit log (last 20 events)
 */
adminRouter.get('/users/:id/activity', (c) => adminController.getUserActivityProfile(c));

// ─────────────────────────────────────────────────────────────────────────────
// PROPERTIES
// ─────────────────────────────────────────────────────────────────────────────

adminRouter.get('/properties/stats',     (c) => adminController.getPropertyStats(c));
adminRouter.get('/properties/attention', (c) => adminController.getPropertiesNeedingAttention(c));
adminRouter.get('/properties/top',       (c) => adminController.getTopListings(c));
adminRouter.get('/properties/pending',   (c) => adminController.getPendingListings(c));

/** PATCH /api/admin/properties/:id/approve — approve pending listing */
adminRouter.patch('/properties/:id/approve', (c) => adminController.approveListing(c));

/** PATCH /api/admin/properties/:id/reject — reject listing with reason */
adminRouter.patch('/properties/:id/reject',  (c) => adminController.rejectListing(c));

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/bookings/stats
 *
 * Unified booking stats:
 *   short_stay: { total, new_this_month, active, cancelled, disputed, escrow_held_kes, payouts_released_kes }
 *   long_term:  { total, pending, active, terminated }
 *   visits:     { pending_confirmation, completed_total, no_shows_total }
 */
adminRouter.get('/bookings/stats',      (c) => adminController.getBookingStats(c));

/**
 * GET /api/admin/bookings/short-stay?status=confirmed&from_date=2025-06-01&to_date=2025-06-30&page=1&limit=20
 *
 * Includes joined property title, location, guest and host user info.
 */
adminRouter.get('/bookings/short-stay', (c) => adminController.listShortStayBookings(c));

/**
 * GET /api/admin/bookings/long-term?status=pending_review&page=1&limit=20
 *
 * Includes tenant cover letter, agreed terms, property info.
 */
adminRouter.get('/bookings/long-term',  (c) => adminController.listLongTermBookings(c));

// ─────────────────────────────────────────────────────────────────────────────
// MODERATION
// Named paths before /:id wildcards
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/admin/moderation/verifications */
adminRouter.get('/moderation/verifications', (c) => adminController.getPendingVerifications(c));

/** PATCH /api/admin/moderation/verifications/:id/approve — approve ID verification */
adminRouter.patch('/moderation/verifications/:id/approve', (c) => adminController.approveVerification(c));

/** PATCH /api/admin/moderation/verifications/:id/reject — reject ID verification */
adminRouter.patch('/moderation/verifications/:id/reject',  (c) => adminController.rejectVerification(c));

/** GET /api/admin/moderation/disputes */
adminRouter.get('/moderation/disputes',      (c) => adminController.getOpenDisputes(c));

/** GET /api/admin/moderation/reviews — fraud moderation queue */
adminRouter.get('/moderation/reviews',       (c) => adminController.getFraudReviewQueue(c));

/** GET /api/admin/moderation/messages — reported messages */
adminRouter.get('/moderation/messages',      (c) => adminController.getReportedMessages(c));

/**
 * PATCH /api/admin/moderation/messages/:reportId/resolve
 * Mark a message report as reviewed (content may be deleted separately).
 */
adminRouter.patch(
  '/moderation/messages/:reportId/resolve',
  (c) => adminController.resolveMessageReport(c),
);

// ─────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTIONS & PLANS
// ─────────────────────────────────────────────────────────────────────────────

adminRouter.get('/subscriptions/stats', (c) => adminController.getSubscriptionStats(c));
adminRouter.get('/subscriptions/plans', (c) => adminController.listSubscriptionPlans(c));

/**
 * PATCH /api/admin/subscriptions/plans/:id  [super_admin only]
 *
 * Body (all optional — send only what changes):
 * {
 *   "price_monthly_kes": 599,
 *   "viewing_unlocks_per_month": 15,
 *   "priority_support": true,
 *   "is_active": true
 * }
 */
adminRouter.patch(
  '/subscriptions/plans/:id',
  requireSuperAdmin,
  (c) => adminController.updateSubscriptionPlan(c),
);

// ─────────────────────────────────────────────────────────────────────────────
// FEE CONFIGURATION  [super_admin only for all writes]
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/admin/fees — full config for all fee tables */
adminRouter.get('/fees', (c) => adminController.getFeeConfig(c));

/**
 * PATCH /api/admin/fees/config/:key  [super_admin]
 * Body: { "value": 5 }
 * Updates fee_config by config_key (e.g. "default_search_radius_km")
 */
adminRouter.patch(
  '/fees/config/:key',
  requireSuperAdmin,
  (c) => adminController.updateFeeConfigEntry(c),
);

/**
 * PATCH /api/admin/fees/viewing/:id  [super_admin]
 * Body: { "viewing_fee_kes": 150, "free_for_subscribers": true }
 */
adminRouter.patch(
  '/fees/viewing/:id',
  requireSuperAdmin,
  (c) => adminController.updateViewingFee(c),
);

/**
 * PATCH /api/admin/fees/boosts/:id  [super_admin]
 * Body: { "price_kes": 1500, "duration_days": 10, "is_active": true }
 */
adminRouter.patch(
  '/fees/boosts/:id',
  requireSuperAdmin,
  (c) => adminController.updateBoostPackage(c),
);

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/search/analytics?days=30
 *
 * Returns:
 *   total_searches, avg_results_per_search, zero_result_count
 *   zero_result_queries (last 20 raw queries that returned nothing)
 *   top_searched_areas (top 10 by count)
 *   top_searched_types (top 10 by count)
 */
adminRouter.get('/search/analytics', (c) => adminController.getSearchAnalytics(c));

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG
// Named paths before /:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/audit/breakdown?days=7
 * Count of each event_type in the last N days.
 */
adminRouter.get('/audit/breakdown', (c) => adminController.getAuditBreakdown(c));

/**
 * GET /api/admin/audit?page=1&limit=50&event_type=login&user_id=uuid&from=&to=
 *
 * Full paginated audit log. Never delete rows from security_audit_log.
 * Max limit: 200 rows per request.
 */
adminRouter.get('/audit', (c) => adminController.getAuditLog(c));

// ─────────────────────────────────────────────────────────────────────────────
// AD CAMPAIGNS
// Named paths before /:id wildcards
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/admin/ads/stats */
adminRouter.get('/ads/stats', (c) => adminController.getAdStats(c));

/** GET /api/admin/ads?status=pending_approval&page=1 */
adminRouter.get('/ads', (c) => adminController.listAdCampaigns(c));

/**
 * PATCH /api/admin/ads/:id/approve  [super_admin]
 * Moves campaign from pending_approval → active.
 */
adminRouter.patch(
  '/ads/:id/approve',
  requireSuperAdmin,
  (c) => adminController.approveAdCampaign(c),
);

/** PATCH /api/admin/ads/:id/pause */
adminRouter.patch('/ads/:id/pause', (c) => adminController.pauseAdCampaign(c));

// ─────────────────────────────────────────────────────────────────────────────
// REVIEWS
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/admin/reviews/stats */
adminRouter.get('/reviews/stats', (c) => adminController.getReviewStats(c));

// ─────────────────────────────────────────────────────────────────────────────
export { adminRouter };