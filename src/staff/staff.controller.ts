/**
 * staff.controller.ts
 *
 * Staff/moderator HTTP adapter — validates input, calls staffService.
 * Staff can view all platform data but only modify moderation-related items.
 * No access to: fee configuration, subscription plans, ad campaign approval.
 */

import type { Context } from 'hono';
import { staffService } from './staffService.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Error mapper
// ─────────────────────────────────────────────────────────────────────────────
function resolveStatus(err: Error): 400 | 403 | 404 | 422 | 500 {
  const msg = err.message.toLowerCase();
  if (msg.includes('not found')) return 404;
  if (msg.includes('forbidden')) return 403;
  if (msg.includes('invalid') || msg.includes('must')) return 400;
  if (msg.includes('cannot') || msg.includes('only')) return 422;
  return 500;
}

function fail(c: Context, err: unknown, code: string) {
  const error = err instanceof Error ? err : new Error(String(err));
  const status = resolveStatus(error);
  logger.error({ requestId: c.get('requestId'), code, message: error.message }, 'staff.error');
  return c.json({ message: error.message || 'Request failed', code }, status);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: parse date range
// ─────────────────────────────────────────────────────────────────────────────
function parseDateRange(c: Context): { from: string; to: string } {
  const q = c.req.query();
  const now = new Date();
  const to = q.to ?? now.toISOString();
  const from = q.from ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  return { from, to };
}

// =============================================================================
// StaffController
// =============================================================================
export class StaffController {

  // ─────────────────────────────────────────────────────────────────────────
  // OVERVIEW (staff view — limited to moderation-relevant metrics)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/staff/kpi
   * Staff dashboard KPI cards focused on moderation queues.
   */
  async getKpiSnapshot(c: Context) {
    try {
      const data = await staffService.getKpiSnapshot();
      return c.json({ ...data, code: 'STAFF_KPI_FETCHED' });
    } catch (err) { return fail(c, err, 'STAFF_KPI_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MODERATION QUEUES (primary staff responsibility)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/staff/moderation/verifications?page=&limit=
   * Pending ID verification documents.
   */
  async getPendingVerifications(c: Context) {
    try {
      const page = Number(c.req.query('page')) || 1;
      const limit = Math.min(100, Number(c.req.query('limit')) || 20);
      const data = await staffService.getPendingVerifications(page, limit);
      return c.json({ ...data, code: 'VERIFICATIONS_FETCHED' });
    } catch (err) { return fail(c, err, 'VERIFICATIONS_FAILED'); }
  }

  /**
   * POST /api/staff/moderation/verifications/:id/approve
   * Approve an ID verification.
   */
  async approveVerification(c: Context) {
    try {
      const userId = c.get('user').userId;
      const verificationId = c.req.param('id');
      const data = await staffService.approveVerification(verificationId, userId);
      return c.json({ ...data, code: 'VERIFICATION_APPROVED' });
    } catch (err) { return fail(c, err, 'VERIFICATION_APPROVE_FAILED'); }
  }

  /**
   * POST /api/staff/moderation/verifications/:id/reject
   * Reject an ID verification with reason.
   * Body: { "reason": "Document illegible" }
   */
  async rejectVerification(c: Context) {
    try {
      const userId = c.get('user').userId;
      const verificationId = c.req.param('id');
      const { reason } = await c.req.json();
      const data = await staffService.rejectVerification(verificationId, userId, reason);
      return c.json({ ...data, code: 'VERIFICATION_REJECTED' });
    } catch (err) { return fail(c, err, 'VERIFICATION_REJECT_FAILED'); }
  }

  /**
   * GET /api/staff/moderation/disputes?page=&limit=
   * Open short-stay disputes.
   */
  async getOpenDisputes(c: Context) {
    try {
      const page = Number(c.req.query('page')) || 1;
      const limit = Math.min(100, Number(c.req.query('limit')) || 20);
      const data = await staffService.getOpenDisputes(page, limit);
      return c.json({ ...data, code: 'DISPUTES_FETCHED' });
    } catch (err) { return fail(c, err, 'DISPUTES_FAILED'); }
  }

  /**
   * POST /api/staff/moderation/disputes/:id/resolve
   * Resolve a dispute (staff decision).
   * Body: { "resolution": "refund_guest", "refund_amount_kes": 5000, "notes": "..." }
   */
  async resolveDispute(c: Context) {
    try {
      const userId = c.get('user').userId;
      const disputeId = c.req.param('id');
      const body = await c.req.json();
      const data = await staffService.resolveDispute(disputeId, userId, body);
      return c.json({ ...data, code: 'DISPUTE_RESOLVED' });
    } catch (err) { return fail(c, err, 'DISPUTE_RESOLVE_FAILED'); }
  }

  /**
   * GET /api/staff/moderation/reviews?page=&limit=
   * Reviews held for moderation (fraud signals).
   */
  async getFraudReviewQueue(c: Context) {
    try {
      const page = Number(c.req.query('page')) || 1;
      const limit = Math.min(100, Number(c.req.query('limit')) || 20);
      const data = await staffService.getFraudReviewQueue(page, limit);
      return c.json({ ...data, code: 'FRAUD_QUEUE_FETCHED' });
    } catch (err) { return fail(c, err, 'FRAUD_QUEUE_FAILED'); }
  }

  /**
   * POST /api/staff/moderation/reviews/:id/approve
   * Approve a held review → published.
   */
  async approveReview(c: Context) {
    try {
      const userId = c.get('user').userId;
      const reviewId = c.req.param('id');
      const data = await staffService.approveReview(reviewId, userId);
      return c.json({ ...data, code: 'REVIEW_APPROVED' });
    } catch (err) { return fail(c, err, 'REVIEW_APPROVE_FAILED'); }
  }

  /**
   * POST /api/staff/moderation/reviews/:id/reject
   * Reject a held review → rejected.
   * Body: { "reason": "Violates community guidelines" }
   */
  async rejectReview(c: Context) {
    try {
      const userId = c.get('user').userId;
      const reviewId = c.req.param('id');
      const { reason } = await c.req.json();
      const data = await staffService.rejectReview(reviewId, userId, reason);
      return c.json({ ...data, code: 'REVIEW_REJECTED' });
    } catch (err) { return fail(c, err, 'REVIEW_REJECT_FAILED'); }
  }

  /**
   * GET /api/staff/moderation/messages?page=&limit=
   * Reported messages.
   */
  async getReportedMessages(c: Context) {
    try {
      const page = Number(c.req.query('page')) || 1;
      const limit = Math.min(100, Number(c.req.query('limit')) || 20);
      const data = await staffService.getReportedMessages(page, limit);
      return c.json({ ...data, code: 'REPORTED_MESSAGES_FETCHED' });
    } catch (err) { return fail(c, err, 'REPORTED_MESSAGES_FAILED'); }
  }

  /**
   * POST /api/staff/moderation/messages/:reportId/resolve
   * Mark a message report as reviewed.
   */
  async resolveMessageReport(c: Context) {
    try {
      const userId = c.get('user').userId;
      const reportId = c.req.param('reportId');
      const data = await staffService.resolveMessageReport(reportId, userId);
      return c.json({ ...data, code: 'REPORT_RESOLVED' });
    } catch (err) { return fail(c, err, 'REPORT_RESOLVE_FAILED'); }
  }

  /**
   * POST /api/staff/moderation/messages/:messageId/delete
   * Soft-delete a reported message.
   */
  async deleteMessage(c: Context) {
    try {
      const userId = c.get('user').userId;
      const messageId = c.req.param('messageId');
      const data = await staffService.deleteMessage(messageId, userId);
      return c.json({ ...data, code: 'MESSAGE_DELETED' });
    } catch (err) { return fail(c, err, 'MESSAGE_DELETE_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PROPERTY MODERATION (staff can review flagged properties)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/staff/properties/pending-review?page=&limit=
   * Properties flagged for review or with missing documentation.
   */
  async getPropertiesPendingReview(c: Context) {
    try {
      const page = Number(c.req.query('page')) || 1;
      const limit = Math.min(100, Number(c.req.query('limit')) || 20);
      const data = await staffService.getPropertiesPendingReview(page, limit);
      return c.json({ ...data, code: 'PENDING_PROPERTIES_FETCHED' });
    } catch (err) { return fail(c, err, 'PENDING_PROPERTIES_FAILED'); }
  }

  /**
   * POST /api/staff/properties/:id/approve
   * Approve a property listing (makes it visible).
   */
  async approveProperty(c: Context) {
    try {
      const userId = c.get('user').userId;
      const propertyId = c.req.param('id');
      const data = await staffService.approveProperty(propertyId, userId);
      return c.json({ ...data, code: 'PROPERTY_APPROVED' });
    } catch (err) { return fail(c, err, 'PROPERTY_APPROVE_FAILED'); }
  }

  /**
   * POST /api/staff/properties/:id/reject
   * Reject a property listing with reason.
   * Body: { "reason": "Missing title deed" }
   */
  async rejectProperty(c: Context) {
    try {
      const userId = c.get('user').userId;
      const propertyId = c.req.param('id');
      const { reason } = await c.req.json();
      const data = await staffService.rejectProperty(propertyId, userId, reason);
      return c.json({ ...data, code: 'PROPERTY_REJECTED' });
    } catch (err) { return fail(c, err, 'PROPERTY_REJECT_FAILED'); }
  }

  /**
   * POST /api/staff/properties/:id/flag
   * Flag a property for review (takes offline).
   * Body: { "reason": "Suspicious listing" }
   */
  async flagProperty(c: Context) {
    try {
      const userId = c.get('user').userId;
      const propertyId = c.req.param('id');
      const { reason } = await c.req.json();
      const data = await staffService.flagProperty(propertyId, userId, reason);
      return c.json({ ...data, code: 'PROPERTY_FLAGGED' });
    } catch (err) { return fail(c, err, 'PROPERTY_FLAG_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // USER MODERATION (staff can view users, suspend/ban)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/staff/users?page=&limit=&status=&role=
   * Paginated user list with filters.
   */
  async getUsers(c: Context) {
    try {
      const q = c.req.query();
      const page = Number(q.page) || 1;
      const limit = Math.min(100, Number(q.limit) || 20);
      const data = await staffService.getUsers(page, limit, {
        status: q.status,
        role: q.role,
        search: q.search,
      });
      return c.json({ ...data, code: 'USERS_FETCHED' });
    } catch (err) { return fail(c, err, 'USERS_FETCH_FAILED'); }
  }

  /**
   * GET /api/staff/users/:id
   * Get user details.
   */
  async getUserById(c: Context) {
    try {
      const userId = c.req.param('id');
      const data = await staffService.getUserById(userId);
      return c.json({ user: data, code: 'USER_FETCHED' });
    } catch (err) { return fail(c, err, 'USER_FETCH_FAILED'); }
  }

  /**
   * POST /api/staff/users/:id/suspend
   * Suspend a user account.
   * Body: { "reason": "Spam listings", "days": 30 }
   */
  async suspendUser(c: Context) {
    try {
      const staffId = c.get('user').userId;
      const userId = c.req.param('id');
      const { reason, days } = await c.req.json();
      const data = await staffService.suspendUser(userId, staffId, reason, days);
      return c.json({ ...data, code: 'USER_SUSPENDED' });
    } catch (err) { return fail(c, err, 'USER_SUSPEND_FAILED'); }
  }

  /**
   * POST /api/staff/users/:id/unsuspend
   * Unsuspend a user account.
   */
  async unsuspendUser(c: Context) {
    try {
      const staffId = c.get('user').userId;
      const userId = c.req.param('id');
      const data = await staffService.unsuspendUser(userId, staffId);
      return c.json({ ...data, code: 'USER_UNSUSPENDED' });
    } catch (err) { return fail(c, err, 'USER_UNSUSPEND_FAILED'); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // READ-ONLY VIEWS (staff can view but not modify)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/staff/properties?page=&limit=&status=&category=
   * Paginated property list.
   */
  async getProperties(c: Context) {
    try {
      const q = c.req.query();
      const page = Number(q.page) || 1;
      const limit = Math.min(100, Number(q.limit) || 20);
      const data = await staffService.getProperties(page, limit, {
        status: q.status,
        category: q.category,
        search: q.search,
      });
      return c.json({ ...data, code: 'PROPERTIES_FETCHED' });
    } catch (err) { return fail(c, err, 'PROPERTIES_FETCH_FAILED'); }
  }

  /**
   * GET /api/staff/properties/:id
   * Get property details including all related data.
   */
  async getPropertyById(c: Context) {
    try {
      const propertyId = c.req.param('id');
      const data = await staffService.getPropertyById(propertyId);
      return c.json({ property: data, code: 'PROPERTY_FETCHED' });
    } catch (err) { return fail(c, err, 'PROPERTY_FETCH_FAILED'); }
  }

  /**
   * GET /api/staff/bookings/short-stay?page=&limit=&status=
   * View all short-stay bookings.
   */
  async getShortStayBookings(c: Context) {
    try {
      const q = c.req.query();
      const page = Number(q.page) || 1;
      const limit = Math.min(100, Number(q.limit) || 20);
      const data = await staffService.getShortStayBookings(page, limit, {
        status: q.status,
        fromDate: q.from_date,
        toDate: q.to_date,
      });
      return c.json({ ...data, code: 'SS_BOOKINGS_FETCHED' });
    } catch (err) { return fail(c, err, 'SS_BOOKINGS_FETCH_FAILED'); }
  }

  /**
   * GET /api/staff/bookings/long-term?page=&limit=&status=
   * View all long-term bookings.
   */
  async getLongTermBookings(c: Context) {
    try {
      const q = c.req.query();
      const page = Number(q.page) || 1;
      const limit = Math.min(100, Number(q.limit) || 20);
      const data = await staffService.getLongTermBookings(page, limit, { status: q.status });
      return c.json({ ...data, code: 'LT_BOOKINGS_FETCHED' });
    } catch (err) { return fail(c, err, 'LT_BOOKINGS_FETCH_FAILED'); }
  }

  /**
   * GET /api/staff/reviews?page=&limit=&property_id=&user_id=
   * View all reviews with filters.
   */
  async getReviews(c: Context) {
    try {
      const q = c.req.query();
      const page = Number(q.page) || 1;
      const limit = Math.min(100, Number(q.limit) || 20);
      const data = await staffService.getReviews(page, limit, {
        propertyId: q.property_id,
        userId: q.user_id,
        status: q.status,
      });
      return c.json({ ...data, code: 'REVIEWS_FETCHED' });
    } catch (err) { return fail(c, err, 'REVIEWS_FETCH_FAILED'); }
  }

  /**
   * GET /api/staff/audit?page=&limit=&event_type=&user_id=
   * View security audit log (read-only).
   */
  async getAuditLog(c: Context) {
    try {
      const q = c.req.query();
      const page = Number(q.page) || 1;
      const limit = Math.min(200, Number(q.limit) || 50);
      const data = await staffService.getAuditLog(page, limit, {
        eventType: q.event_type,
        userId: q.user_id,
        fromDate: q.from,
        toDate: q.to,
      });
      return c.json({ ...data, code: 'AUDIT_LOG_FETCHED' });
    } catch (err) { return fail(c, err, 'AUDIT_LOG_FAILED'); }
  }
}

export const staffController = new StaffController();