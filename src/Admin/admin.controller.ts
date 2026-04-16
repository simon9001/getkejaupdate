/**
 * to future dev
 * admin.controller.ts
 *
 * Thin HTTP adapter — validates input, calls adminService, returns
 * consistent JSON. All business logic lives in admin.service.ts.
 * Existing module controllers (users, properties, subscriptions, short-stay,
 * reviews) handle their own mutations — this controller only adds
 * dashboard-specific read endpoints and cross-module aggregations.
 */

import type { Context } from 'hono';
import { adminService } from './adminService.js';
import { logger }       from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Error mapper
// ─────────────────────────────────────────────────────────────────────────────
function resolveStatus(err: Error): 400 | 403 | 404 | 422 | 500 {
  const msg = err.message.toLowerCase();
  if (msg.includes('not found'))                       return 404;
  if (msg.includes('forbidden'))                       return 403;
  if (msg.includes('invalid') || msg.includes('must')) return 400;
  if (msg.includes('cannot')  || msg.includes('only')) return 422;
  return 500;
}

function fail(c: Context, err: unknown, code: string) {
  const error  = err instanceof Error ? err : new Error(String(err));
  const status = resolveStatus(error);
  logger.error({ requestId: c.get('requestId'), code, message: error.message }, 'admin.error');
  return c.json({ message: error.message || 'Request failed', code }, status);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: parse date range from query params, defaulting to current month
// ─────────────────────────────────────────────────────────────────────────────
function parseDateRange(c: Context): { from: string; to: string } {
  const q   = c.req.query();
  const now = new Date();
  const to   = q.to   ?? now.toISOString();
  const from = q.from ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  return { from, to };
}

// =============================================================================
// AdminController
// =============================================================================
export class AdminController {

  // ─────────────────────────────────────────────────────────────────────────
  // OVERVIEW
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/kpi
   * Top-row KPI cards: users, properties, revenue, moderation queues.
   * Used as the dashboard home endpoint — all counts in one call.
   */
  async getKpiSnapshot(c: Context) {
    try {
      const data = await adminService.getKpiSnapshot();
      return c.json({ ...data, code: 'KPI_FETCHED' });
    } catch (err) { return fail(c, err, 'KPI_FETCH_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REVENUE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/revenue/breakdown?from=&to=
   * Full revenue breakdown by stream (listing fees, viewing fees,
   * subscriptions, short-stay platform fees) for a date range.
   */
  async getRevenueBreakdown(c: Context) {
    try {
      const { from, to } = parseDateRange(c);
      const data = await adminService.getRevenueBreakdown(from, to);
      return c.json({ ...data, code: 'REVENUE_BREAKDOWN_FETCHED' });
    } catch (err) { return fail(c, err, 'REVENUE_BREAKDOWN_FAILED'); }
  }

  /**
   * GET /api/admin/revenue/series?days=30
   * Daily revenue time series for charting (uses vw_daily_revenue view).
   */
  async getDailyRevenueSeries(c: Context) {
    try {
      const days = Math.min(365, Number(c.req.query('days')) || 30);
      const data = await adminService.getDailyRevenueSeries(days);
      return c.json({ ...data, code: 'REVENUE_SERIES_FETCHED' });
    } catch (err) { return fail(c, err, 'REVENUE_SERIES_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // USERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/users/stats
   * Aggregate counts by account_status, auth_provider, role.
   */
  async getUserStats(c: Context) {
    try {
      const data = await adminService.getUserStats();
      return c.json({ ...data, code: 'USER_STATS_FETCHED' });
    } catch (err) { return fail(c, err, 'USER_STATS_FAILED'); }
  }

  /**
   * GET /api/admin/users/:id/activity
   * Full activity profile for one user: sessions, bookings, reviews, audit log.
   */
  async getUserActivityProfile(c: Context) {
    try {
      const userId = c.req.param('id');
      const data   = await adminService.getUserActivityProfile(userId);
      return c.json({ profile: data, code: 'USER_PROFILE_FETCHED' });
    } catch (err) { return fail(c, err, 'USER_PROFILE_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PROPERTIES
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/properties/pending?page=&limit=
   * Listings with status='pending_review' awaiting staff approval.
   */
  async getPendingListings(c: Context) {
    try {
      const page  = Number(c.req.query('page'))  || 1;
      const limit = Math.min(100, Number(c.req.query('limit')) || 20);
      const data  = await adminService.getPendingListings(page, limit);
      return c.json({ ...data, code: 'PENDING_LISTINGS_FETCHED' });
    } catch (err) { return fail(c, err, 'PENDING_LISTINGS_FAILED'); }
  }

  /**
   * PATCH /api/admin/properties/:id/approve
   * Approve a pending listing — sets status to 'available'.
   */
  async approveListing(c: Context) {
    try {
      const user       = c.get('user');
      const propertyId = c.req.param('id');
      await adminService.approveListing(propertyId, user.userId);
      return c.json({ message: 'Listing approved and published', code: 'LISTING_APPROVED' });
    } catch (err) { return fail(c, err, 'LISTING_APPROVE_FAILED'); }
  }

  /**
   * PATCH /api/admin/properties/:id/reject
   * Reject a pending listing — returns it to 'draft' for editing.
   * Body: { reason: string }
   */
  async rejectListing(c: Context) {
    try {
      const user       = c.get('user');
      const propertyId = c.req.param('id');
      const body       = await c.req.json() as { reason?: string };
      const reason     = body.reason ?? 'No reason provided';
      await adminService.rejectListing(propertyId, user.userId, reason);
      return c.json({ message: 'Listing rejected and returned to owner', code: 'LISTING_REJECTED' });
    } catch (err) { return fail(c, err, 'LISTING_REJECT_FAILED'); }
  }

  /**
   * GET /api/admin/properties/stats
   * Breakdown by category, status, type, featured, boosts, avg score.
   */
  async getPropertyStats(c: Context) {
    try {
      const data = await adminService.getPropertyStats();
      return c.json({ ...data, code: 'PROPERTY_STATS_FETCHED' });
    } catch (err) { return fail(c, err, 'PROPERTY_STATS_FAILED'); }
  }

  /**
   * GET /api/admin/properties/attention?page=&limit=
   * Listings missing media, pricing, or location — need follow-up.
   */
  async getPropertiesNeedingAttention(c: Context) {
    try {
      const page  = Number(c.req.query('page'))  || 1;
      const limit = Math.min(100, Number(c.req.query('limit')) || 20);
      const data  = await adminService.getPropertiesNeedingAttention(page, limit);
      return c.json({ ...data, code: 'ATTENTION_PROPERTIES_FETCHED' });
    } catch (err) { return fail(c, err, 'ATTENTION_PROPERTIES_FAILED'); }
  }

  /**
   * GET /api/admin/properties/top?limit=20
   * Top listings by visibility score.
   */
  async getTopListings(c: Context) {
    try {
      const limit = Math.min(50, Number(c.req.query('limit')) || 20);
      const data  = await adminService.getTopListings(limit);
      return c.json({ listings: data, code: 'TOP_LISTINGS_FETCHED' });
    } catch (err) { return fail(c, err, 'TOP_LISTINGS_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BOOKINGS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/bookings/stats
   * Aggregate counts across short-stay + long-term + visits.
   */
  async getBookingStats(c: Context) {
    try {
      const data = await adminService.getBookingStats();
      return c.json({ ...data, code: 'BOOKING_STATS_FETCHED' });
    } catch (err) { return fail(c, err, 'BOOKING_STATS_FAILED'); }
  }

  /**
   * GET /api/admin/bookings/short-stay?page=&limit=&status=&fromDate=&toDate=
   * Paginated list of all short-stay bookings across the platform.
   */
  async listShortStayBookings(c: Context) {
    try {
      const q     = c.req.query();
      const page  = Number(q.page)  || 1;
      const limit = Math.min(100, Number(q.limit) || 20);
      const data  = await adminService.listAllShortStayBookings(page, limit, {
        status:   q.status,
        fromDate: q.from_date,
        toDate:   q.to_date,
      });
      return c.json({ ...data, code: 'SS_BOOKINGS_FETCHED' });
    } catch (err) { return fail(c, err, 'SS_BOOKINGS_FAILED'); }
  }

  /**
   * GET /api/admin/bookings/long-term?page=&limit=&status=
   * Paginated list of all long-term booking applications.
   */
  async listLongTermBookings(c: Context) {
    try {
      const q     = c.req.query();
      const page  = Number(q.page)  || 1;
      const limit = Math.min(100, Number(q.limit) || 20);
      const data  = await adminService.listAllLongTermBookings(page, limit, { status: q.status });
      return c.json({ ...data, code: 'LT_BOOKINGS_FETCHED' });
    } catch (err) { return fail(c, err, 'LT_BOOKINGS_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MODERATION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/moderation/verifications?page=&limit=
   * Pending ID verification documents.
   */
  async getPendingVerifications(c: Context) {
    try {
      const page   = Number(c.req.query('page'))  || 1;
      const limit  = Math.min(100, Number(c.req.query('limit')) || 20);
      const status = c.req.query('status') || 'pending';
      const data   = await adminService.getPendingVerifications(page, limit, status);
      return c.json({ ...data, code: 'VERIFICATIONS_FETCHED' });
    } catch (err) { return fail(c, err, 'VERIFICATIONS_FAILED'); }
  }

  /**
   * PATCH /api/admin/moderation/verifications/:id/approve
   * Approve an ID verification and grant the user the requested role.
   */
  async approveVerification(c: Context) {
    try {
      const user           = c.get('user');
      const verificationId = c.req.param('id');
      const data           = await adminService.approveVerification(verificationId, user.userId);
      return c.json({ message: 'Verification approved and role assigned', ...data, code: 'VERIFICATION_APPROVED' });
    } catch (err) { return fail(c, err, 'VERIFICATION_APPROVE_FAILED'); }
  }

  /**
   * PATCH /api/admin/moderation/verifications/:id/reject
   * Reject an ID verification with a reason.
   * Body: { reason: string }
   */
  async rejectVerification(c: Context) {
    try {
      const user           = c.get('user');
      const verificationId = c.req.param('id');
      const body           = await c.req.json() as { reason?: string };
      const reason         = body.reason ?? 'No reason provided';
      await adminService.rejectVerification(verificationId, user.userId, reason);
      return c.json({ message: 'Verification rejected', code: 'VERIFICATION_REJECTED' });
    } catch (err) { return fail(c, err, 'VERIFICATION_REJECT_FAILED'); }
  }

  /**
   * GET /api/admin/moderation/disputes?page=&limit=
   * Open short-stay disputes awaiting admin resolution.
   */
  async getOpenDisputes(c: Context) {
    try {
      const page  = Number(c.req.query('page'))  || 1;
      const limit = Math.min(100, Number(c.req.query('limit')) || 20);
      const data  = await adminService.getOpenDisputes(page, limit);
      return c.json({ ...data, code: 'DISPUTES_FETCHED' });
    } catch (err) { return fail(c, err, 'DISPUTES_FAILED'); }
  }

  /**
   * GET /api/admin/moderation/reviews?page=&limit=
   * Reviews held for moderation (high-confidence fraud signals).
   */
  async getFraudReviewQueue(c: Context) {
    try {
      const page  = Number(c.req.query('page'))  || 1;
      const limit = Math.min(100, Number(c.req.query('limit')) || 20);
      const data  = await adminService.getFraudReviewQueue(page, limit);
      return c.json({ ...data, code: 'FRAUD_QUEUE_FETCHED' });
    } catch (err) { return fail(c, err, 'FRAUD_QUEUE_FAILED'); }
  }

  /**
   * GET /api/admin/moderation/messages?page=&limit=
   * Reported messages awaiting review.
   */
  async getReportedMessages(c: Context) {
    try {
      const page  = Number(c.req.query('page'))  || 1;
      const limit = Math.min(100, Number(c.req.query('limit')) || 20);
      const data  = await adminService.getReportedMessages(page, limit);
      return c.json({ ...data, code: 'REPORTED_MESSAGES_FETCHED' });
    } catch (err) { return fail(c, err, 'REPORTED_MESSAGES_FAILED'); }
  }

  /**
   * PATCH /api/admin/moderation/messages/:reportId/resolve
   * Mark a message report as reviewed.
   */
  async resolveMessageReport(c: Context) {
    try {
      const user     = c.get('user');
      const reportId = c.req.param('reportId');
      const data     = await adminService.resolveMessageReport(reportId, user.userId);
      return c.json({ ...data, code: 'REPORT_RESOLVED' });
    } catch (err) { return fail(c, err, 'REPORT_RESOLVE_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUBSCRIPTIONS & PLANS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/subscriptions/stats
   * Total subscribers, by-status breakdown, by-plan breakdown, past-due count.
   */
  async getSubscriptionStats(c: Context) {
    try {
      const data = await adminService.getSubscriptionStats();
      return c.json({ ...data, code: 'SUBSCRIPTION_STATS_FETCHED' });
    } catch (err) { return fail(c, err, 'SUBSCRIPTION_STATS_FAILED'); }
  }

  /**
   * GET /api/admin/subscriptions/plans
   * All plans with live active + total subscriber counts.
   */
  async listSubscriptionPlans(c: Context) {
    try {
      const data = await adminService.listSubscriptionPlans();
      return c.json({ plans: data, code: 'PLANS_FETCHED' });
    } catch (err) { return fail(c, err, 'PLANS_FETCH_FAILED'); }
  }

  /**
   * PATCH /api/admin/subscriptions/plans/:id
   * Update plan pricing, limits, or active state.
   *
   * Body (all fields optional):
   * {
   *   "price_monthly_kes": 599,
   *   "viewing_unlocks_per_month": 15,
   *   "is_active": true
   * }
   */
  async updateSubscriptionPlan(c: Context) {
    try {
      const user   = c.get('user');
      const planId = c.req.param('id');
      const body   = await c.req.json();
      await adminService.updateSubscriptionPlan(planId, user.userId, body);
      return c.json({ message: 'Plan updated', code: 'PLAN_UPDATED' });
    } catch (err) { return fail(c, err, 'PLAN_UPDATE_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FEE CONFIGURATION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/fees
   * All fee_config, viewing_fee_config, listing_fee_tiers, boost_packages.
   */
  async getFeeConfig(c: Context) {
    try {
      const data = await adminService.getFeeConfig();
      return c.json({ ...data, code: 'FEE_CONFIG_FETCHED' });
    } catch (err) { return fail(c, err, 'FEE_CONFIG_FAILED'); }
  }

  /**
   * PATCH /api/admin/fees/config/:key
   * Update a single fee_config entry by config_key.
   * Body: { "value": 5 }
   */
  async updateFeeConfigEntry(c: Context) {
    try {
      const user      = c.get('user');
      const configKey = c.req.param('key');
      const { value } = await c.req.json() as { value: number };
      if (typeof value !== 'number') {
        return c.json({ message: 'value must be a number', code: 'INVALID_VALUE' }, 400);
      }
      await adminService.updateFeeConfigEntry(configKey, value, user.userId);
      return c.json({ message: `Fee config '${configKey}' updated to ${value}`, code: 'FEE_CONFIG_UPDATED' });
    } catch (err) { return fail(c, err, 'FEE_CONFIG_UPDATE_FAILED'); }
  }

  /**
   * PATCH /api/admin/fees/viewing/:id
   * Update a viewing_fee_config row.
   */
  async updateViewingFee(c: Context) {
    try {
      const user  = c.get('user');
      const feeId = c.req.param('id');
      const body  = await c.req.json();
      await adminService.updateViewingFee(feeId, body, user.userId);
      return c.json({ message: 'Viewing fee updated', code: 'VIEWING_FEE_UPDATED' });
    } catch (err) { return fail(c, err, 'VIEWING_FEE_UPDATE_FAILED'); }
  }

  /**
   * PATCH /api/admin/fees/boosts/:id
   * Update a boost_packages row.
   */
  async updateBoostPackage(c: Context) {
    try {
      const user      = c.get('user');
      const packageId = c.req.param('id');
      const body      = await c.req.json();
      await adminService.updateBoostPackage(packageId, body, user.userId);
      return c.json({ message: 'Boost package updated', code: 'BOOST_UPDATED' });
    } catch (err) { return fail(c, err, 'BOOST_UPDATE_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEARCH ANALYTICS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/search/analytics?days=30
   * Total searches, avg results, zero-result queries, top areas/types.
   */
  async getSearchAnalytics(c: Context) {
    try {
      const days = Math.min(365, Number(c.req.query('days')) || 30);
      const data = await adminService.getSearchAnalytics(days);
      return c.json({ ...data, code: 'SEARCH_ANALYTICS_FETCHED' });
    } catch (err) { return fail(c, err, 'SEARCH_ANALYTICS_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SECURITY AUDIT LOG
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/audit?page=&limit=&event_type=&user_id=&from=&to=
   * Full security audit log with filters.
   */
  async getAuditLog(c: Context) {
    try {
      const q     = c.req.query();
      const page  = Number(q.page)  || 1;
      const limit = Math.min(200, Number(q.limit) || 50);
      const data  = await adminService.getAuditLog(page, limit, {
        eventType: q.event_type,
        userId:    q.user_id,
        fromDate:  q.from,
        toDate:    q.to,
      });
      return c.json({ ...data, code: 'AUDIT_LOG_FETCHED' });
    } catch (err) { return fail(c, err, 'AUDIT_LOG_FAILED'); }
  }

  /**
   * GET /api/admin/audit/breakdown?days=7
   * Count of each audit event type in the last N days.
   */
  async getAuditBreakdown(c: Context) {
    try {
      const days = Math.min(90, Number(c.req.query('days')) || 7);
      const data = await adminService.getAuditEventBreakdown(days);
      return c.json({ ...data, code: 'AUDIT_BREAKDOWN_FETCHED' });
    } catch (err) { return fail(c, err, 'AUDIT_BREAKDOWN_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AD CAMPAIGNS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/ads/stats
   * Platform-wide campaign spend, impressions, clicks, CTR.
   */
  async getAdStats(c: Context) {
    try {
      const data = await adminService.getAdCampaignStats();
      return c.json({ ...data, code: 'AD_STATS_FETCHED' });
    } catch (err) { return fail(c, err, 'AD_STATS_FAILED'); }
  }

  /**
   * GET /api/admin/ads?page=&limit=&status=
   * Paginated campaign list.
   */
  async listAdCampaigns(c: Context) {
    try {
      const q      = c.req.query();
      const page   = Number(q.page)  || 1;
      const limit  = Math.min(100, Number(q.limit) || 20);
      const data   = await adminService.listAdCampaigns(page, limit, q.status);
      return c.json({ ...data, code: 'ADS_FETCHED' });
    } catch (err) { return fail(c, err, 'ADS_FETCH_FAILED'); }
  }

  /**
   * PATCH /api/admin/ads/:id/approve
   * Approve a campaign that's pending_approval → active.
   */
  async approveAdCampaign(c: Context) {
    try {
      const user = c.get('user');
      const id   = c.req.param('id');
      await adminService.approveAdCampaign(id, user.userId);
      return c.json({ message: 'Campaign approved and set to active', code: 'CAMPAIGN_APPROVED' });
    } catch (err) { return fail(c, err, 'CAMPAIGN_APPROVE_FAILED'); }
  }

  /**
   * PATCH /api/admin/ads/:id/pause
   */
  async pauseAdCampaign(c: Context) {
    try {
      const id = c.req.param('id');
      await adminService.pauseAdCampaign(id);
      return c.json({ message: 'Campaign paused', code: 'CAMPAIGN_PAUSED' });
    } catch (err) { return fail(c, err, 'CAMPAIGN_PAUSE_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REVIEWS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/reviews/stats
   * Published, held, rejected counts + avg rating + fraud signal breakdown.
   */
  async getReviewStats(c: Context) {
    try {
      const data = await adminService.getReviewStats();
      return c.json({ ...data, code: 'REVIEW_STATS_FETCHED' });
    } catch (err) { return fail(c, err, 'REVIEW_STATS_FAILED'); }
  }
}

export const adminController = new AdminController();