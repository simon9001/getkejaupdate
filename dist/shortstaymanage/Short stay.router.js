/**
 * short-stay.router.ts
 *
 * Route map:
 *
 *  Public (no auth):
 *    GET  /api/short-stay/availability/:propertyId   → date availability check
 *    GET  /api/short-stay/calendar/:propertyId        → full calendar with blocked dates
 *    GET  /api/short-stay/quote/:propertyId           → price breakdown before booking
 *    GET  /api/short-stay/reviews/:propertyId         → published property reviews
 *
 *  Authenticated — any role:
 *    POST /api/short-stay/bookings                    → create booking + initiate payment
 *    GET  /api/short-stay/bookings/:id                → get booking detail
 *    GET  /api/short-stay/bookings/my/guest           → my bookings as a guest
 *    GET  /api/short-stay/bookings/my/host            → my bookings as a host
 *    POST /api/short-stay/bookings/:id/cancel         → cancel booking
 *    POST /api/short-stay/bookings/:id/checkin        → self check-in or check-out
 *    POST /api/short-stay/bookings/:id/confirm-checkin → host confirms guest arrival
 *    POST /api/short-stay/reviews/property            → guest reviews property
 *    POST /api/short-stay/reviews/guest               → host reviews guest
 *    POST /api/short-stay/reviews/:reviewId/reply     → host replies to a review
 *    POST /api/short-stay/disputes                    → raise a dispute
 *
 *  Admin (super_admin | staff):
 *    GET   /api/short-stay/admin/bookings             → all bookings (paginated)
 *    GET   /api/short-stay/admin/disputes             → open disputes
 *    PATCH /api/short-stay/admin/disputes/:id/resolve → resolve dispute
 *    PATCH /api/short-stay/admin/reviews/:id/flag     → flag a review
 *    DELETE /api/short-stay/admin/reviews/:id         → remove a review
 *
 * Route ordering:
 *   Named paths (/my/guest, /my/host, /admin/*) declared BEFORE /:id wildcards.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { authenticate } from '../middleware/auth.middleware.js';
import { shortStayController } from './Short stay.controller.js';
import { createBookingSchema, cancelBookingSchema, checkinSchema, submitPropertyReviewSchema, submitGuestReviewSchema, raiseDisputeSchema, resolveDisputeSchema, } from '../types/short-stay.types.js';
const shortStayRouter = new Hono();
// ─────────────────────────────────────────────────────────────────────────────
// Admin guard
// ─────────────────────────────────────────────────────────────────────────────
const requireAdmin = async (c, next) => {
    const roles = (c.get('user')?.roles ?? []);
    if (!roles.includes('super_admin') && !roles.includes('staff')) {
        return c.json({ message: 'Forbidden: admin role required', code: 'FORBIDDEN' }, 403);
    }
    await next();
};
// ─────────────────────────────────────────────────────────────────────────────
// 1. Public routes (no auth)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /api/short-stay/availability/:propertyId?check_in=YYYY-MM-DD&check_out=YYYY-MM-DD
 * Fast availability check — returns { available, blockedDates, reason }
 */
shortStayRouter.get('/availability/:propertyId', (c) => shortStayController.checkAvailability(c));
/**
 * GET /api/short-stay/calendar/:propertyId?start=YYYY-MM-DD&end=YYYY-MM-DD
 * Full calendar view — bookings, host-blocked dates, pricing overrides.
 * Default window: today → +90 days.
 */
shortStayRouter.get('/calendar/:propertyId', (c) => shortStayController.getCalendar(c));
/**
 * GET /api/short-stay/quote/:propertyId?check_in=&check_out=&guests=1
 * Full price breakdown before the guest commits.
 * Returns: subtotal, cleaning fee, platform fee, total, host payout, policy.
 */
shortStayRouter.get('/quote/:propertyId', (c) => shortStayController.getPriceQuote(c));
/**
 * GET /api/short-stay/reviews/:propertyId?page=1&limit=20
 * Published guest reviews + aggregate rating stats.
 */
shortStayRouter.get('/reviews/:propertyId', (c) => shortStayController.getPropertyReviews(c));
// ─────────────────────────────────────────────────────────────────────────────
// 2. Authenticated — named booking paths BEFORE /:id wildcard
// ─────────────────────────────────────────────────────────────────────────────
shortStayRouter.get('/bookings/my/guest', authenticate, (c) => shortStayController.getMyGuestBookings(c));
shortStayRouter.get('/bookings/my/host', authenticate, (c) => shortStayController.getMyHostBookings(c));
/**
 * POST /api/short-stay/bookings
 *
 * Body:
 * {
 *   "property_id":      "uuid",
 *   "check_in_date":    "2025-07-01",
 *   "check_out_date":   "2025-07-05",
 *   "guests_count":     2,
 *   "payment_method":   "mpesa",
 *   "mpesa_phone":      "+254712345678",
 *   "special_requests": "Early check-in if possible",
 *   "guest_name":       "Jane Mwangi",
 *   "guest_phone":      "+254712345678"
 * }
 *
 * Flow:
 *   1. Availability verified
 *   2. Price quoted server-side
 *   3. Payment initiated (M-Pesa STK Push in production)
 *   4. On success: booking confirmed, dates blocked, funds held in escrow
 */
shortStayRouter.post('/bookings', authenticate, zValidator('json', createBookingSchema), (c) => shortStayController.createBooking(c));
shortStayRouter.get('/bookings/:id', authenticate, (c) => shortStayController.getBooking(c));
/**
 * POST /api/short-stay/bookings/:id/cancel
 * Body: { "reason": "Change of plans" }
 *
 * Refund is calculated automatically from the property's cancellation policy
 * and how many days before check-in the cancellation is made.
 */
shortStayRouter.post('/bookings/:id/cancel', authenticate, zValidator('json', cancelBookingSchema), (c) => shortStayController.cancelBooking(c));
/**
 * POST /api/short-stay/bookings/:id/checkin
 *
 * Used for both check-in and check-out events.
 * Body:
 * {
 *   "event_type":    "check_in",           // or "check_out"
 *   "checkin_type":  "guest_self",         // guest_self | host_confirmed | admin_override
 *   "latitude":      -1.2921,              // optional GPS proof
 *   "longitude":     36.8219,
 *   "proof_photo_url": "https://res.cloudinary.com/...",
 *   "notes":         "Arrived safely"
 * }
 *
 * Escrow release:
 *   - host_confirmed or host-performed check-in → payout released immediately
 *   - guest_self check-in → payout held until host confirms (POST /confirm-checkin)
 */
shortStayRouter.post('/bookings/:id/checkin', authenticate, zValidator('json', checkinSchema), (c) => shortStayController.recordCheckin(c));
/**
 * POST /api/short-stay/bookings/:id/confirm-checkin
 * Host or admin confirms a guest's self-check-in → triggers escrow release.
 */
shortStayRouter.post('/bookings/:id/confirm-checkin', authenticate, (c) => shortStayController.confirmCheckin(c));
// ─────────────────────────────────────────────────────────────────────────────
// 3. Reviews
// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /api/short-stay/reviews/property
 * Guest reviews a property after checkout (14-day window).
 */
shortStayRouter.post('/reviews/property', authenticate, zValidator('json', submitPropertyReviewSchema), (c) => shortStayController.submitPropertyReview(c));
/**
 * POST /api/short-stay/reviews/guest
 * Host reviews a guest after checkout (14-day window).
 */
shortStayRouter.post('/reviews/guest', authenticate, zValidator('json', submitGuestReviewSchema), (c) => shortStayController.submitGuestReview(c));
/**
 * POST /api/short-stay/reviews/:reviewId/reply
 * Host posts a public reply to a guest review (one reply per review).
 */
shortStayRouter.post('/reviews/:reviewId/reply', authenticate, (c) => shortStayController.replyToReview(c));
// ─────────────────────────────────────────────────────────────────────────────
// 4. Disputes
// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /api/short-stay/disputes
 * Either party can raise a dispute during or after a stay.
 */
shortStayRouter.post('/disputes', authenticate, zValidator('json', raiseDisputeSchema), (c) => shortStayController.raiseDispute(c));
// ─────────────────────────────────────────────────────────────────────────────
// 5. Admin routes (super_admin | staff only)
// ─────────────────────────────────────────────────────────────────────────────
shortStayRouter.get('/admin/bookings', authenticate, requireAdmin, (c) => shortStayController.getAllBookingsAdmin(c));
shortStayRouter.get('/admin/disputes', authenticate, requireAdmin, (c) => shortStayController.getOpenDisputes(c));
/**
 * PATCH /api/short-stay/admin/disputes/:id/resolve
 * Body: { "status": "resolved_guest" | "resolved_host", "resolution_notes": "...", "refund_amount_kes": 2000 }
 */
shortStayRouter.patch('/admin/disputes/:id/resolve', authenticate, requireAdmin, zValidator('json', resolveDisputeSchema), (c) => shortStayController.resolveDispute(c));
/** PATCH /api/short-stay/admin/reviews/:id/flag */
shortStayRouter.patch('/admin/reviews/:id/flag', authenticate, requireAdmin, (c) => shortStayController.flagReview(c));
/** DELETE /api/short-stay/admin/reviews/:id */
shortStayRouter.delete('/admin/reviews/:id', authenticate, requireAdmin, (c) => shortStayController.removeReview(c));
export { shortStayRouter };
