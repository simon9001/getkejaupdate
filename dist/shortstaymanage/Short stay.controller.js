/**
 * short-stay.controller.ts
 *
 * HTTP adapter for the short-stay (Airbnb-style) booking system.
 */
import { shortStayService } from './Short stay.service.js';
import { logger } from '../utils/logger.js';
function resolveStatus(err) {
    const msg = err.message.toLowerCase();
    if (msg.includes('not found'))
        return 404;
    if (msg.includes('forbidden'))
        return 403;
    if (msg.includes('already') || msg.includes('already reviewed'))
        return 409;
    if (msg.includes('not available') || msg.includes('cannot') ||
        msg.includes('window has closed') || msg.includes('past'))
        return 422;
    if (msg.includes('required') || msg.includes('invalid') ||
        msg.includes('must be') || msg.includes('in the past'))
        return 400;
    return 500;
}
function fail(c, err, code) {
    const error = err instanceof Error ? err : new Error(String(err));
    const status = resolveStatus(error);
    logger.error({ requestId: c.get('requestId'), code, message: error.message }, 'short-stay.error');
    return c.json({ message: error.message || 'Request failed', code }, status);
}
export class ShortStayController {
    // ── Availability ─────────────────────────────────────────────────────────
    /** GET /api/short-stay/availability/:propertyId?check_in=&check_out= */
    async checkAvailability(c) {
        try {
            const propertyId = c.req.param('propertyId');
            const checkIn = c.req.query('check_in');
            const checkOut = c.req.query('check_out');
            if (!checkIn || !checkOut) {
                return c.json({ message: 'check_in and check_out query params required', code: 'MISSING_DATES' }, 400);
            }
            const result = await shortStayService.checkAvailability(propertyId, checkIn, checkOut);
            return c.json({ ...result, code: 'AVAILABILITY_CHECKED' });
        }
        catch (err) {
            return fail(c, err, 'AVAILABILITY_CHECK_FAILED');
        }
    }
    /** GET /api/short-stay/calendar/:propertyId?start=&end= */
    async getCalendar(c) {
        try {
            const propertyId = c.req.param('propertyId');
            const start = c.req.query('start') ?? new Date().toISOString().split('T')[0];
            const end = c.req.query('end') ?? new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0];
            const result = await shortStayService.getAvailabilityCalendar(propertyId, start, end);
            return c.json({ ...result, code: 'CALENDAR_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'CALENDAR_FETCH_FAILED');
        }
    }
    /** GET /api/short-stay/quote/:propertyId?check_in=&check_out=&guests= */
    async getPriceQuote(c) {
        try {
            const propertyId = c.req.param('propertyId');
            const checkIn = c.req.query('check_in');
            const checkOut = c.req.query('check_out');
            const guestsCount = Number(c.req.query('guests') ?? 1);
            if (!checkIn || !checkOut) {
                return c.json({ message: 'check_in and check_out are required', code: 'MISSING_DATES' }, 400);
            }
            const quote = await shortStayService.getPriceQuote(propertyId, checkIn, checkOut, guestsCount);
            return c.json({ ...quote, code: 'QUOTE_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'QUOTE_FETCH_FAILED');
        }
    }
    // ── Bookings ──────────────────────────────────────────────────────────────
    /** POST /api/short-stay/bookings */
    async createBooking(c) {
        try {
            const user = c.get('user');
            const input = await c.req.json();
            const result = await shortStayService.createBooking(user.userId, input);
            return c.json({ message: 'Booking confirmed', code: 'BOOKING_CREATED', booking: result }, 201);
        }
        catch (err) {
            return fail(c, err, 'BOOKING_CREATE_FAILED');
        }
    }
    /** GET /api/short-stay/bookings/:id */
    async getBooking(c) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');
            const result = await shortStayService.getBookingById(id, user.userId);
            return c.json({ booking: result, code: 'BOOKING_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'BOOKING_FETCH_FAILED');
        }
    }
    /** GET /api/short-stay/bookings/my/guest */
    async getMyGuestBookings(c) {
        try {
            const user = c.get('user');
            const q = c.req.query();
            const result = await shortStayService.getMyBookingsAsGuest(user.userId, {
                page: Number(q.page) || 1,
                limit: Math.min(100, Number(q.limit) || 20),
                status: q.status,
                from_date: q.from_date,
                to_date: q.to_date,
            });
            return c.json({ ...result, code: 'GUEST_BOOKINGS_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'GUEST_BOOKINGS_FETCH_FAILED');
        }
    }
    /** GET /api/short-stay/bookings/my/host */
    async getMyHostBookings(c) {
        try {
            const user = c.get('user');
            const q = c.req.query();
            const result = await shortStayService.getMyBookingsAsHost(user.userId, {
                page: Number(q.page) || 1,
                limit: Math.min(100, Number(q.limit) || 20),
                status: q.status,
                from_date: q.from_date,
                to_date: q.to_date,
            });
            return c.json({ ...result, code: 'HOST_BOOKINGS_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'HOST_BOOKINGS_FETCH_FAILED');
        }
    }
    /** POST /api/short-stay/bookings/:id/cancel */
    async cancelBooking(c) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');
            const input = await c.req.json();
            const result = await shortStayService.cancelBooking(id, user.userId, input);
            return c.json({ ...result, code: 'BOOKING_CANCELLED' });
        }
        catch (err) {
            return fail(c, err, 'BOOKING_CANCEL_FAILED');
        }
    }
    // ── Check-in / Check-out ──────────────────────────────────────────────────
    /** POST /api/short-stay/bookings/:id/checkin */
    async recordCheckin(c) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');
            const input = await c.req.json();
            const result = await shortStayService.recordCheckin(id, user.userId, input);
            return c.json({ ...result, code: result.event_type === 'check_in' ? 'CHECKED_IN' : 'CHECKED_OUT' });
        }
        catch (err) {
            return fail(c, err, 'CHECKIN_FAILED');
        }
    }
    /**
     * POST /api/short-stay/bookings/:id/confirm-checkin
     * Host or admin confirms a guest's self-reported check-in → releases payout.
     */
    async confirmCheckin(c) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');
            const result = await shortStayService.confirmCheckin(id, user.userId);
            return c.json({ ...result, code: 'CHECKIN_CONFIRMED' });
        }
        catch (err) {
            return fail(c, err, 'CHECKIN_CONFIRM_FAILED');
        }
    }
    // ── Reviews ───────────────────────────────────────────────────────────────
    /** POST /api/short-stay/reviews/property */
    async submitPropertyReview(c) {
        try {
            const user = c.get('user');
            const input = await c.req.json();
            const result = await shortStayService.submitPropertyReview(user.userId, input);
            return c.json({ message: 'Review submitted', code: 'PROPERTY_REVIEW_SUBMITTED', review: result }, 201);
        }
        catch (err) {
            return fail(c, err, 'PROPERTY_REVIEW_FAILED');
        }
    }
    /** POST /api/short-stay/reviews/guest */
    async submitGuestReview(c) {
        try {
            const user = c.get('user');
            const input = await c.req.json();
            const result = await shortStayService.submitGuestReview(user.userId, input);
            return c.json({ message: 'Guest review submitted', code: 'GUEST_REVIEW_SUBMITTED', review: result }, 201);
        }
        catch (err) {
            return fail(c, err, 'GUEST_REVIEW_FAILED');
        }
    }
    /** POST /api/short-stay/reviews/:reviewId/reply */
    async replyToReview(c) {
        try {
            const user = c.get('user');
            const reviewId = c.req.param('reviewId');
            const { reply } = await c.req.json();
            if (!reply?.trim())
                return c.json({ message: 'reply is required', code: 'MISSING_REPLY' }, 400);
            const result = await shortStayService.replyToReview(reviewId, user.userId, reply);
            return c.json({ ...result, code: 'REPLY_POSTED' });
        }
        catch (err) {
            return fail(c, err, 'REPLY_FAILED');
        }
    }
    /** GET /api/short-stay/reviews/:propertyId */
    async getPropertyReviews(c) {
        try {
            const propertyId = c.req.param('propertyId');
            const page = Number(c.req.query('page')) || 1;
            const limit = Math.min(50, Number(c.req.query('limit')) || 20);
            const result = await shortStayService.getPropertyReviews(propertyId, page, limit);
            return c.json({ ...result, code: 'REVIEWS_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'REVIEWS_FETCH_FAILED');
        }
    }
    // ── Disputes ──────────────────────────────────────────────────────────────
    /** POST /api/short-stay/disputes */
    async raiseDispute(c) {
        try {
            const user = c.get('user');
            const input = await c.req.json();
            const result = await shortStayService.raiseDispute(user.userId, input);
            return c.json({ message: 'Dispute raised', code: 'DISPUTE_RAISED', dispute: result }, 201);
        }
        catch (err) {
            return fail(c, err, 'DISPUTE_RAISE_FAILED');
        }
    }
    /** PATCH /api/short-stay/admin/disputes/:id/resolve */
    async resolveDispute(c) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');
            const input = await c.req.json();
            const result = await shortStayService.resolveDispute(id, user.userId, input);
            return c.json({ ...result, code: 'DISPUTE_RESOLVED' });
        }
        catch (err) {
            return fail(c, err, 'DISPUTE_RESOLVE_FAILED');
        }
    }
    // ── Admin ─────────────────────────────────────────────────────────────────
    /** GET /api/short-stay/admin/bookings */
    async getAllBookingsAdmin(c) {
        try {
            const q = c.req.query();
            const result = await shortStayService.getAllBookingsAdmin({
                page: Number(q.page) || 1,
                limit: Math.min(100, Number(q.limit) || 20),
                status: q.status,
            });
            return c.json({ ...result, code: 'ALL_BOOKINGS_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'ALL_BOOKINGS_FETCH_FAILED');
        }
    }
    /** GET /api/short-stay/admin/disputes */
    async getOpenDisputes(c) {
        try {
            const page = Number(c.req.query('page')) || 1;
            const limit = Math.min(100, Number(c.req.query('limit')) || 20);
            const result = await shortStayService.getOpenDisputes(page, limit);
            return c.json({ ...result, code: 'DISPUTES_FETCHED' });
        }
        catch (err) {
            return fail(c, err, 'DISPUTES_FETCH_FAILED');
        }
    }
    /** PATCH /api/short-stay/admin/reviews/:id/flag */
    async flagReview(c) {
        try {
            const id = c.req.param('id');
            const { reason = '' } = await c.req.json().catch(() => ({}));
            const result = await shortStayService.adminFlagReview(id, reason);
            return c.json({ ...result, code: 'REVIEW_FLAGGED' });
        }
        catch (err) {
            return fail(c, err, 'REVIEW_FLAG_FAILED');
        }
    }
    /** DELETE /api/short-stay/admin/reviews/:id */
    async removeReview(c) {
        try {
            const id = c.req.param('id');
            const result = await shortStayService.adminRemoveReview(id);
            return c.json({ ...result, code: 'REVIEW_REMOVED' });
        }
        catch (err) {
            return fail(c, err, 'REVIEW_REMOVE_FAILED');
        }
    }
}
export const shortStayController = new ShortStayController();
