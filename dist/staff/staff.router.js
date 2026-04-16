/**
 * staff.router.ts
 *
 * Staff/moderator routes for GETKEJA.
 *
 * All routes require: authenticate + requireStaff (staff or super_admin)
 *
 * Staff permissions:
 *   - READ: most platform data
 *   - MODERATE: ID verifications, disputes, reviews, messages, flagged properties
 *   - MANAGE USERS: suspend/unsuspend
 *
 * Staff CANNOT:
 *   - Modify fee config, subscription plans, or approve ad campaigns
 *   - Permanently delete users or change role assignments
 *   - Access revenue analytics (admin-only)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ROUTE SUMMARY:
 *
 * OVERVIEW
 *   GET  /api/staff/kpi                              → moderation queue counts
 *
 * MODERATION
 *   GET  /api/staff/moderation/verifications         → pending ID verifications
 *   POST /api/staff/moderation/verifications/:id/approve
 *   POST /api/staff/moderation/verifications/:id/reject
 *
 *   GET  /api/staff/moderation/disputes              → open disputes
 *   POST /api/staff/moderation/disputes/:id/resolve
 *
 *   GET  /api/staff/moderation/reviews               → fraud review queue
 *   POST /api/staff/moderation/reviews/:id/approve
 *   POST /api/staff/moderation/reviews/:id/reject
 *
 *   GET  /api/staff/moderation/messages              → reported messages
 *   PATCH /api/staff/moderation/messages/:reportId/resolve
 *   DELETE /api/staff/moderation/messages/:messageId
 *
 *   GET  /api/staff/properties/pending-review        → flagged properties
 *   POST /api/staff/properties/:id/approve
 *   POST /api/staff/properties/:id/reject
 *   POST /api/staff/properties/:id/flag
 *
 * USERS
 *   GET  /api/staff/users                            → paginated user list
 *   GET  /api/staff/users/:id                        → user details
 *   POST /api/staff/users/:id/suspend
 *   POST /api/staff/users/:id/unsuspend
 *
 * READ-ONLY
 *   GET  /api/staff/properties                       → property list
 *   GET  /api/staff/properties/:id                   → property details
 *   GET  /api/staff/bookings/short-stay              → short-stay bookings
 *   GET  /api/staff/bookings/long-term               → long-term bookings
 *   GET  /api/staff/reviews                          → review list
 *   GET  /api/staff/audit                            → audit log
 */
import { Hono } from 'hono';
import { authenticate } from '../middleware/auth.middleware.js';
import { staffController } from './staff.controller.js';
const staffRouter = new Hono();
// ─────────────────────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────────────────────
/** Staff or super_admin role required */
const requireStaff = async (c, next) => {
    const roles = (c.get('user')?.roles ?? []);
    if (!roles.includes('super_admin') && !roles.includes('staff')) {
        return c.json({ message: 'Forbidden: staff access required', code: 'FORBIDDEN' }, 403);
    }
    await next();
};
// Apply auth + staff guard to every route
staffRouter.use('*', authenticate, requireStaff);
// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /api/staff/kpi
 * Staff-focused KPI: moderation queue counts + platform health metrics.
 */
staffRouter.get('/kpi', (c) => staffController.getKpiSnapshot(c));
// ─────────────────────────────────────────────────────────────────────────────
// MODERATION: ID VERIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────
staffRouter.get('/moderation/verifications', (c) => staffController.getPendingVerifications(c));
staffRouter.post('/moderation/verifications/:id/approve', (c) => staffController.approveVerification(c));
staffRouter.post('/moderation/verifications/:id/reject', (c) => staffController.rejectVerification(c));
// ─────────────────────────────────────────────────────────────────────────────
// MODERATION: DISPUTES
// ─────────────────────────────────────────────────────────────────────────────
staffRouter.get('/moderation/disputes', (c) => staffController.getOpenDisputes(c));
staffRouter.post('/moderation/disputes/:id/resolve', (c) => staffController.resolveDispute(c));
// ─────────────────────────────────────────────────────────────────────────────
// MODERATION: REVIEWS (fraud queue)
// ─────────────────────────────────────────────────────────────────────────────
staffRouter.get('/moderation/reviews', (c) => staffController.getFraudReviewQueue(c));
staffRouter.post('/moderation/reviews/:id/approve', (c) => staffController.approveReview(c));
staffRouter.post('/moderation/reviews/:id/reject', (c) => staffController.rejectReview(c));
// ─────────────────────────────────────────────────────────────────────────────
// MODERATION: MESSAGES
// ─────────────────────────────────────────────────────────────────────────────
staffRouter.get('/moderation/messages', (c) => staffController.getReportedMessages(c));
staffRouter.patch('/moderation/messages/:reportId/resolve', (c) => staffController.resolveMessageReport(c));
staffRouter.delete('/moderation/messages/:messageId', (c) => staffController.deleteMessage(c));
// ─────────────────────────────────────────────────────────────────────────────
// MODERATION: PROPERTIES
// ─────────────────────────────────────────────────────────────────────────────
staffRouter.get('/properties/pending-review', (c) => staffController.getPropertiesPendingReview(c));
staffRouter.post('/properties/:id/approve', (c) => staffController.approveProperty(c));
staffRouter.post('/properties/:id/reject', (c) => staffController.rejectProperty(c));
staffRouter.post('/properties/:id/flag', (c) => staffController.flagProperty(c));
// ─────────────────────────────────────────────────────────────────────────────
// USER MANAGEMENT (staff can suspend/unsuspend)
// ─────────────────────────────────────────────────────────────────────────────
staffRouter.get('/users', (c) => staffController.getUsers(c));
staffRouter.get('/users/:id', (c) => staffController.getUserById(c));
staffRouter.post('/users/:id/suspend', (c) => staffController.suspendUser(c));
staffRouter.post('/users/:id/unsuspend', (c) => staffController.unsuspendUser(c));
// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY VIEWS
// ─────────────────────────────────────────────────────────────────────────────
staffRouter.get('/properties', (c) => staffController.getProperties(c));
staffRouter.get('/properties/:id', (c) => staffController.getPropertyById(c));
staffRouter.get('/bookings/short-stay', (c) => staffController.getShortStayBookings(c));
staffRouter.get('/bookings/long-term', (c) => staffController.getLongTermBookings(c));
staffRouter.get('/reviews', (c) => staffController.getReviews(c));
staffRouter.get('/audit', (c) => staffController.getAuditLog(c));
export { staffRouter };
