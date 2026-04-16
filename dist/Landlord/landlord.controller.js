/**
 * landlord.controller.ts
 *
 * Landlord HTTP adapter — validates input, calls landlordService.
 * Landlords can:
 *   - Manage their own properties (CRUD)
 *   - View and respond to enquiries
 *   - Manage tenancy applications
 *   - View earnings and payouts
 *   - Assign/manage caretakers and agents
 *   - Purchase boosts and manage subscriptions
 */
import { landlordService } from './landlord.service.js';
import { logger } from '../utils/logger.js';
// ─────────────────────────────────────────────────────────────────────────────
// Error mapper
// ─────────────────────────────────────────────────────────────────────────────
function resolveStatus(err) {
    const msg = err.message.toLowerCase();
    if (msg.includes('not found'))
        return 404;
    if (msg.includes('forbidden') || msg.includes('not owner'))
        return 403;
    if (msg.includes('invalid') || msg.includes('must'))
        return 400;
    if (msg.includes('cannot') || msg.includes('only'))
        return 422;
    return 500;
}
function fail(c, err, code) {
    const error = err instanceof Error ? err : new Error(String(err));
    const status = resolveStatus(error);
    logger.error({ requestId: c.get('requestId'), code, message: error.message }, 'landlord.error');
    return c.json({ message: error.message || 'Request failed', code }, status);
}
// =============================================================================
// LandlordController
// =============================================================================
export class LandlordController {
    // ─────────────────────────────────────────────────────────────────────────
    // DASHBOARD OVERVIEW
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * GET /api/landlord/dashboard
     * Main dashboard KPI cards for landlord.
     */
    async getDashboard(c) {
        try {
            const userId = c.get('user').userId;
            const data = await landlordService.getDashboardStats(userId);
            return c.json({ ...data, code: 'DASHBOARD_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'DASHBOARD_FAILED');
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // PROPERTY MANAGEMENT (CRUD)
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * GET /api/landlord/properties?page=&limit=&status=
     * List landlord's properties with pagination.
     */
    async listProperties(c) {
        try {
            const userId = c.get('user').userId;
            const page = Number(c.req.query('page')) || 1;
            const limit = Math.min(100, Number(c.req.query('limit')) || 20);
            const status = c.req.query('status');
            const data = await landlordService.listProperties(userId, page, limit, status);
            return c.json({ ...data, code: 'PROPERTIES_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'PROPERTIES_FETCH_FAILED');
        }
    }
    /**
     * GET /api/landlord/properties/:id
     * Get single property with all details.
     */
    async getProperty(c) {
        try {
            const userId = c.get('user').userId;
            const propertyId = c.req.param('id');
            const data = await landlordService.getProperty(userId, propertyId);
            return c.json({ property: data, code: 'PROPERTY_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'PROPERTY_FETCH_FAILED');
        }
    }
    /**
     * POST /api/landlord/properties
     * Create a new property listing.
     * Body: full property details (see schema)
     */
    async createProperty(c) {
        try {
            const userId = c.get('user').userId;
            const body = await c.req.json();
            const data = await landlordService.createProperty(userId, body);
            return c.json({ property: data, code: 'PROPERTY_CREATED' }, 201);
        }
        catch (err) {
            return fail(c, err, 'PROPERTY_CREATE_FAILED');
        }
    }
    /**
     * PUT /api/landlord/properties/:id
     * Update an existing property.
     */
    async updateProperty(c) {
        try {
            const userId = c.get('user').userId;
            const propertyId = c.req.param('id');
            const body = await c.req.json();
            const data = await landlordService.updateProperty(userId, propertyId, body);
            return c.json({ property: data, code: 'PROPERTY_UPDATED' });
        }
        catch (err) {
            return fail(c, err, 'PROPERTY_UPDATE_FAILED');
        }
    }
    /**
     * DELETE /api/landlord/properties/:id
     * Soft-delete a property.
     */
    async deleteProperty(c) {
        try {
            const userId = c.get('user').userId;
            const propertyId = c.req.param('id');
            await landlordService.deleteProperty(userId, propertyId);
            return c.json({ message: 'Property deleted', code: 'PROPERTY_DELETED' });
        }
        catch (err) {
            return fail(c, err, 'PROPERTY_DELETE_FAILED');
        }
    }
    /**
     * PATCH /api/landlord/properties/:id/status
     * Update property status (available/let/sold/off_market).
     * Body: { "status": "let" }
     */
    async updatePropertyStatus(c) {
        try {
            const userId = c.get('user').userId;
            const propertyId = c.req.param('id');
            const { status } = await c.req.json();
            const data = await landlordService.updatePropertyStatus(userId, propertyId, status);
            return c.json({ ...data, code: 'STATUS_UPDATED' });
        }
        catch (err) {
            return fail(c, err, 'STATUS_UPDATE_FAILED');
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // PROPERTY MEDIA
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * POST /api/landlord/properties/:id/media
     * Upload media for a property.
     * Body: { "url": "https://...", "media_type": "photo", "is_cover": false }
     */
    async addMedia(c) {
        try {
            const userId = c.get('user').userId;
            const propertyId = c.req.param('id');
            const body = await c.req.json();
            const data = await landlordService.addMedia(userId, propertyId, body);
            return c.json({ media: data, code: 'MEDIA_ADDED' }, 201);
        }
        catch (err) {
            return fail(c, err, 'MEDIA_ADD_FAILED');
        }
    }
    /**
     * DELETE /api/landlord/properties/:id/media/:mediaId
     * Delete property media.
     */
    async deleteMedia(c) {
        try {
            const userId = c.get('user').userId;
            const propertyId = c.req.param('id');
            const mediaId = c.req.param('mediaId');
            await landlordService.deleteMedia(userId, propertyId, mediaId);
            return c.json({ message: 'Media deleted', code: 'MEDIA_DELETED' });
        }
        catch (err) {
            return fail(c, err, 'MEDIA_DELETE_FAILED');
        }
    }
    /**
     * PATCH /api/landlord/properties/:id/media/:mediaId/cover
     * Set a media item as cover photo.
     */
    async setCoverPhoto(c) {
        try {
            const userId = c.get('user').userId;
            const propertyId = c.req.param('id');
            const mediaId = c.req.param('mediaId');
            const data = await landlordService.setCoverPhoto(userId, propertyId, mediaId);
            return c.json({ ...data, code: 'COVER_SET' });
        }
        catch (err) {
            return fail(c, err, 'COVER_SET_FAILED');
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // TENANT MANAGEMENT (Long-term bookings)
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * GET /api/landlord/tenancies?page=&limit=&status=
     * List all tenancy applications for landlord's properties.
     */
    async listTenancies(c) {
        try {
            const userId = c.get('user').userId;
            const page = Number(c.req.query('page')) || 1;
            const limit = Math.min(100, Number(c.req.query('limit')) || 20);
            const status = c.req.query('status');
            const data = await landlordService.listTenancies(userId, page, limit, status);
            return c.json({ ...data, code: 'TENANCIES_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'TENANCIES_FETCH_FAILED');
        }
    }
    /**
     * GET /api/landlord/tenancies/:id
     * Get single tenancy application details.
     */
    async getTenancy(c) {
        try {
            const userId = c.get('user').userId;
            const tenancyId = c.req.param('id');
            const data = await landlordService.getTenancy(userId, tenancyId);
            return c.json({ tenancy: data, code: 'TENANCY_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'TENANCY_FETCH_FAILED');
        }
    }
    /**
     * POST /api/landlord/tenancies/:id/approve
     * Approve a tenancy application.
     * Body: { "agreed_monthly_rent": 25000, "agreed_deposit": 50000, "lease_start_date": "2024-01-01" }
     */
    async approveTenancy(c) {
        try {
            const userId = c.get('user').userId;
            const tenancyId = c.req.param('id');
            const body = await c.req.json();
            const data = await landlordService.approveTenancy(userId, tenancyId, body);
            return c.json({ ...data, code: 'TENANCY_APPROVED' });
        }
        catch (err) {
            return fail(c, err, 'TENANCY_APPROVE_FAILED');
        }
    }
    /**
     * POST /api/landlord/tenancies/:id/reject
     * Reject a tenancy application.
     * Body: { "reason": "Credit check failed" }
     */
    async rejectTenancy(c) {
        try {
            const userId = c.get('user').userId;
            const tenancyId = c.req.param('id');
            const { reason } = await c.req.json();
            const data = await landlordService.rejectTenancy(userId, tenancyId, reason);
            return c.json({ ...data, code: 'TENANCY_REJECTED' });
        }
        catch (err) {
            return fail(c, err, 'TENANCY_REJECT_FAILED');
        }
    }
    /**
     * POST /api/landlord/tenancies/:id/terminate
     * Terminate an active tenancy.
     * Body: { "termination_date": "2024-12-31", "reason": "Tenant moved out" }
     */
    async terminateTenancy(c) {
        try {
            const userId = c.get('user').userId;
            const tenancyId = c.req.param('id');
            const body = await c.req.json();
            const data = await landlordService.terminateTenancy(userId, tenancyId, body);
            return c.json({ ...data, code: 'TENANCY_TERMINATED' });
        }
        catch (err) {
            return fail(c, err, 'TENANCY_TERMINATE_FAILED');
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // SHORT-STAY BOOKINGS
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * GET /api/landlord/short-stay/bookings?page=&limit=&status=
     * List short-stay bookings for landlord's properties.
     */
    async listShortStayBookings(c) {
        try {
            const userId = c.get('user').userId;
            const page = Number(c.req.query('page')) || 1;
            const limit = Math.min(100, Number(c.req.query('limit')) || 20);
            const status = c.req.query('status');
            const data = await landlordService.listShortStayBookings(userId, page, limit, status);
            return c.json({ ...data, code: 'SS_BOOKINGS_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'SS_BOOKINGS_FETCH_FAILED');
        }
    }
    /**
     * GET /api/landlord/short-stay/bookings/:id
     * Get single short-stay booking details.
     */
    async getShortStayBooking(c) {
        try {
            const userId = c.get('user').userId;
            const bookingId = c.req.param('id');
            const data = await landlordService.getShortStayBooking(userId, bookingId);
            return c.json({ booking: data, code: 'SS_BOOKING_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'SS_BOOKING_FETCH_FAILED');
        }
    }
    /**
     * PATCH /api/landlord/short-stay/bookings/:id/status
     * Update booking status (confirm, cancel, mark checked-in/out).
     * Body: { "status": "confirmed" }
     */
    async updateShortStayBookingStatus(c) {
        try {
            const userId = c.get('user').userId;
            const bookingId = c.req.param('id');
            const { status } = await c.req.json();
            const data = await landlordService.updateShortStayBookingStatus(userId, bookingId, status);
            return c.json({ ...data, code: 'SS_BOOKING_STATUS_UPDATED' });
        }
        catch (err) {
            return fail(c, err, 'SS_BOOKING_STATUS_UPDATE_FAILED');
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // VISIT SCHEDULES (viewings)
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * GET /api/landlord/visits?page=&limit=&status=
     * List property viewing requests.
     */
    async listVisits(c) {
        try {
            const userId = c.get('user').userId;
            const page = Number(c.req.query('page')) || 1;
            const limit = Math.min(100, Number(c.req.query('limit')) || 20);
            const status = c.req.query('status');
            const data = await landlordService.listVisits(userId, page, limit, status);
            return c.json({ ...data, code: 'VISITS_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'VISITS_FETCH_FAILED');
        }
    }
    /**
     * PATCH /api/landlord/visits/:id/confirm
     * Confirm a viewing request.
     * Body: { "confirmed_datetime": "2024-01-15T14:00:00Z" }
     */
    async confirmVisit(c) {
        try {
            const userId = c.get('user').userId;
            const visitId = c.req.param('id');
            const { confirmed_datetime } = await c.req.json();
            const data = await landlordService.confirmVisit(userId, visitId, confirmed_datetime);
            return c.json({ ...data, code: 'VISIT_CONFIRMED' });
        }
        catch (err) {
            return fail(c, err, 'VISIT_CONFIRM_FAILED');
        }
    }
    /**
     * PATCH /api/landlord/visits/:id/reschedule
     * Propose a reschedule.
     * Body: { "proposed_datetime": "2024-01-16T15:00:00Z", "reason": "Conflict" }
     */
    async rescheduleVisit(c) {
        try {
            const userId = c.get('user').userId;
            const visitId = c.req.param('id');
            const { proposed_datetime, reason } = await c.req.json();
            const data = await landlordService.rescheduleVisit(userId, visitId, proposed_datetime, reason);
            return c.json({ ...data, code: 'VISIT_RESCHEDULED' });
        }
        catch (err) {
            return fail(c, err, 'VISIT_RESCHEDULE_FAILED');
        }
    }
    /**
     * PATCH /api/landlord/visits/:id/cancel
     * Cancel a viewing.
     * Body: { "reason": "Property no longer available" }
     */
    async cancelVisit(c) {
        try {
            const userId = c.get('user').userId;
            const visitId = c.req.param('id');
            const { reason } = await c.req.json();
            const data = await landlordService.cancelVisit(userId, visitId, reason);
            return c.json({ ...data, code: 'VISIT_CANCELLED' });
        }
        catch (err) {
            return fail(c, err, 'VISIT_CANCEL_FAILED');
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // ENQUIRIES & MESSAGES
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * GET /api/landlord/conversations?page=&limit=
     * List all conversations for landlord's properties.
     */
    async listConversations(c) {
        try {
            const userId = c.get('user').userId;
            const page = Number(c.req.query('page')) || 1;
            const limit = Math.min(100, Number(c.req.query('limit')) || 20);
            const data = await landlordService.listConversations(userId, page, limit);
            return c.json({ ...data, code: 'CONVERSATIONS_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'CONVERSATIONS_FETCH_FAILED');
        }
    }
    /**
     * GET /api/landlord/conversations/:id/messages
     * Get all messages in a conversation.
     */
    async getMessages(c) {
        try {
            const userId = c.get('user').userId;
            const conversationId = c.req.param('id');
            const data = await landlordService.getMessages(userId, conversationId);
            return c.json({ messages: data, code: 'MESSAGES_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'MESSAGES_FETCH_FAILED');
        }
    }
    /**
     * POST /api/landlord/conversations/:id/messages
     * Send a message in a conversation.
     * Body: { "body": "Hello, when can you view?" }
     */
    async sendMessage(c) {
        try {
            const userId = c.get('user').userId;
            const conversationId = c.req.param('id');
            const { body, type } = await c.req.json();
            const data = await landlordService.sendMessage(userId, conversationId, body, type || 'text');
            return c.json({ message: data, code: 'MESSAGE_SENT' }, 201);
        }
        catch (err) {
            return fail(c, err, 'MESSAGE_SEND_FAILED');
        }
    }
    /**
     * PATCH /api/landlord/conversations/:id/read
     * Mark conversation as read.
     */
    async markConversationRead(c) {
        try {
            const userId = c.get('user').userId;
            const conversationId = c.req.param('id');
            await landlordService.markConversationRead(userId, conversationId);
            return c.json({ message: 'Conversation marked as read', code: 'CONVERSATION_READ' });
        }
        catch (err) {
            return fail(c, err, 'CONVERSATION_READ_FAILED');
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // TEAM MANAGEMENT (Caretakers & Agents)
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * GET /api/landlord/team?property_id=
     * List caretakers/agents assigned to landlord's properties.
     */
    async listTeamMembers(c) {
        try {
            const userId = c.get('user').userId;
            const propertyId = c.req.query('property_id');
            const data = await landlordService.listTeamMembers(userId, propertyId);
            return c.json({ team: data, code: 'TEAM_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'TEAM_FETCH_FAILED');
        }
    }
    /**
     * POST /api/landlord/team/caretaker
     * Assign a caretaker to a property or building.
     * Body: { "caretaker_user_id": "uuid", "property_id": "uuid", "can_collect_rent": true }
     */
    async assignCaretaker(c) {
        try {
            const userId = c.get('user').userId;
            const body = await c.req.json();
            const data = await landlordService.assignCaretaker(userId, body);
            return c.json({ assignment: data, code: 'CARETAKER_ASSIGNED' }, 201);
        }
        catch (err) {
            return fail(c, err, 'CARETAKER_ASSIGN_FAILED');
        }
    }
    /**
     * POST /api/landlord/team/agent
     * Assign an agent to a property.
     * Body: { "agent_user_id": "uuid", "property_id": "uuid", "commission_rate_pct": 10 }
     */
    async assignAgent(c) {
        try {
            const userId = c.get('user').userId;
            const body = await c.req.json();
            const data = await landlordService.assignAgent(userId, body);
            return c.json({ assignment: data, code: 'AGENT_ASSIGNED' }, 201);
        }
        catch (err) {
            return fail(c, err, 'AGENT_ASSIGN_FAILED');
        }
    }
    /**
     * DELETE /api/landlord/team/:assignmentId
     * Remove a team member assignment.
     */
    async removeTeamMember(c) {
        try {
            const userId = c.get('user').userId;
            const assignmentId = c.req.param('assignmentId');
            await landlordService.removeTeamMember(userId, assignmentId);
            return c.json({ message: 'Team member removed', code: 'TEAM_MEMBER_REMOVED' });
        }
        catch (err) {
            return fail(c, err, 'TEAM_MEMBER_REMOVE_FAILED');
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // REVENUE & PAYOUTS
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * GET /api/landlord/revenue/summary?period=month
     * Revenue summary (short-stay payouts, long-term rent collected).
     */
    async getRevenueSummary(c) {
        try {
            const userId = c.get('user').userId;
            const period = (c.req.query('period') || 'month');
            const data = await landlordService.getRevenueSummary(userId, period);
            return c.json({ ...data, code: 'REVENUE_SUMMARY_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'REVENUE_SUMMARY_FAILED');
        }
    }
    /**
     * GET /api/landlord/revenue/transactions?page=&limit=
     * List all payout transactions.
     */
    async getPayoutTransactions(c) {
        try {
            const userId = c.get('user').userId;
            const page = Number(c.req.query('page')) || 1;
            const limit = Math.min(100, Number(c.req.query('limit')) || 20);
            const data = await landlordService.getPayoutTransactions(userId, page, limit);
            return c.json({ ...data, code: 'PAYOUTS_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'PAYOUTS_FETCH_FAILED');
        }
    }
    /**
     * GET /api/landlord/revenue/escrow
     * Get current escrow balance (held funds from short-stay bookings).
     */
    async getEscrowBalance(c) {
        try {
            const userId = c.get('user').userId;
            const data = await landlordService.getEscrowBalance(userId);
            return c.json({ ...data, code: 'ESCROW_BALANCE_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'ESCROW_BALANCE_FAILED');
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // BOOSTS & PROMOTIONS
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * GET /api/landlord/boosts/packages
     * List available boost packages.
     */
    async listBoostPackages(c) {
        try {
            const data = await landlordService.listBoostPackages();
            return c.json({ packages: data, code: 'BOOST_PACKAGES_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'BOOST_PACKAGES_FAILED');
        }
    }
    /**
     * POST /api/landlord/boosts
     * Purchase a boost for a property.
     * Body: { "property_id": "uuid", "package_id": "uuid" }
     */
    async purchaseBoost(c) {
        try {
            const userId = c.get('user').userId;
            const body = await c.req.json();
            const data = await landlordService.purchaseBoost(userId, body);
            return c.json({ boost: data, code: 'BOOST_PURCHASED' }, 201);
        }
        catch (err) {
            return fail(c, err, 'BOOST_PURCHASE_FAILED');
        }
    }
    /**
     * GET /api/landlord/boosts/active
     * List active boosts for landlord's properties.
     */
    async listActiveBoosts(c) {
        try {
            const userId = c.get('user').userId;
            const data = await landlordService.listActiveBoosts(userId);
            return c.json({ boosts: data, code: 'ACTIVE_BOOSTS_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'ACTIVE_BOOSTS_FAILED');
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // SUBSCRIPTION MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * GET /api/landlord/subscription
     * Get current subscription plan and usage.
     */
    async getSubscription(c) {
        try {
            const userId = c.get('user').userId;
            const data = await landlordService.getSubscription(userId);
            return c.json({ subscription: data, code: 'SUBSCRIPTION_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'SUBSCRIPTION_FETCH_FAILED');
        }
    }
    /**
     * POST /api/landlord/subscription/upgrade
     * Upgrade/downgrade subscription plan.
     * Body: { "plan_id": "uuid", "billing_cycle": "monthly" }
     */
    async changeSubscription(c) {
        try {
            const userId = c.get('user').userId;
            const body = await c.req.json();
            const data = await landlordService.changeSubscription(userId, body);
            return c.json({ subscription: data, code: 'SUBSCRIPTION_UPDATED' });
        }
        catch (err) {
            return fail(c, err, 'SUBSCRIPTION_UPDATE_FAILED');
        }
    }
    /**
     * POST /api/landlord/subscription/cancel
     * Cancel subscription at end of billing period.
     */
    async cancelSubscription(c) {
        try {
            const userId = c.get('user').userId;
            const data = await landlordService.cancelSubscription(userId);
            return c.json({ ...data, code: 'SUBSCRIPTION_CANCELLED' });
        }
        catch (err) {
            return fail(c, err, 'SUBSCRIPTION_CANCEL_FAILED');
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // REVIEWS
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * GET /api/landlord/reviews?page=&limit=
     * List reviews received for landlord's properties.
     */
    async getPropertyReviews(c) {
        try {
            const userId = c.get('user').userId;
            const page = Number(c.req.query('page')) || 1;
            const limit = Math.min(100, Number(c.req.query('limit')) || 20);
            const data = await landlordService.getPropertyReviews(userId, page, limit);
            return c.json({ ...data, code: 'REVIEWS_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'REVIEWS_FETCH_FAILED');
        }
    }
    /**
     * POST /api/landlord/reviews/:id/reply
     * Reply to a review.
     * Body: { "reply_text": "Thank you for your feedback!" }
     */
    async replyToReview(c) {
        try {
            const userId = c.get('user').userId;
            const reviewId = c.req.param('id');
            const { reply_text } = await c.req.json();
            const data = await landlordService.replyToReview(userId, reviewId, reply_text);
            return c.json({ ...data, code: 'REVIEW_REPLIED' });
        }
        catch (err) {
            return fail(c, err, 'REVIEW_REPLY_FAILED');
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // PROFILE MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * GET /api/landlord/profile
     * Get landlord profile details.
     */
    async getProfile(c) {
        try {
            const userId = c.get('user').userId;
            const data = await landlordService.getProfile(userId);
            return c.json({ profile: data, code: 'PROFILE_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'PROFILE_FETCH_FAILED');
        }
    }
    /**
     * PATCH /api/landlord/profile
     * Update landlord profile.
     * Body: { "full_name": "John Doe", "display_name": "JD Properties", ... }
     */
    async updateProfile(c) {
        try {
            const userId = c.get('user').userId;
            const body = await c.req.json();
            const data = await landlordService.updateProfile(userId, body);
            return c.json({ profile: data, code: 'PROFILE_UPDATED' });
        }
        catch (err) {
            return fail(c, err, 'PROFILE_UPDATE_FAILED');
        }
    }
    /**
     * POST /api/landlord/profile/verify
     * Submit ID for verification.
     * Body: { "id_type": "national_id", "id_number": "12345678", "id_doc_url": "https://..." }
     */
    async submitVerification(c) {
        try {
            const userId = c.get('user').userId;
            const body = await c.req.json();
            const data = await landlordService.submitVerification(userId, body);
            return c.json({ ...data, code: 'VERIFICATION_SUBMITTED' });
        }
        catch (err) {
            return fail(c, err, 'VERIFICATION_SUBMIT_FAILED');
        }
    }
}
export const landlordController = new LandlordController();
