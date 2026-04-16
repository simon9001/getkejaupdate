/**
 * short-stay.types.ts
 *
 * All types derived from the short-stay migration tables.
 * Tables: short_stay_bookings, booking_payments, booking_checkins,
 *         booking_cancellations, property_reviews, host_reviews,
 *         short_stay_disputes, property_review_stats
 */
import { z } from 'zod';
// =============================================================================
// Zod schemas
// =============================================================================
// ── Create a booking ─────────────────────────────────────────────────────────
export const createBookingSchema = z.object({
    property_id: z.string().uuid(),
    check_in_date: z.string().date('check_in_date must be YYYY-MM-DD'),
    check_out_date: z.string().date('check_out_date must be YYYY-MM-DD'),
    guests_count: z.number().int().min(1).max(50).default(1),
    special_requests: z.string().max(500).optional(),
    payment_method: z.enum(['mpesa', 'card', 'bank_transfer']).default('mpesa'),
    mpesa_phone: z.string().regex(/^\+?254\d{9}$/).optional(),
    guest_name: z.string().max(150).optional(),
    guest_phone: z.string().regex(/^\+?[\d\s\-()]{7,15}$/).optional(),
}).refine((d) => new Date(d.check_out_date) > new Date(d.check_in_date), { message: 'check_out_date must be after check_in_date', path: ['check_out_date'] }).refine((d) => new Date(d.check_in_date) >= new Date(new Date().toISOString().split('T')[0]), { message: 'check_in_date cannot be in the past', path: ['check_in_date'] }).refine((d) => d.payment_method !== 'mpesa' || !!d.mpesa_phone, { message: 'mpesa_phone is required when payment_method is mpesa', path: ['mpesa_phone'] });
// ── Check-in / check-out ──────────────────────────────────────────────────────
export const checkinSchema = z.object({
    event_type: z.enum(['check_in', 'check_out']),
    checkin_type: z.enum(['guest_self', 'host_confirmed', 'admin_override']).default('guest_self'),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    location_accuracy_m: z.number().int().positive().optional(),
    proof_photo_url: z.string().url().optional(),
    notes: z.string().max(500).optional(),
});
// ── Cancel booking ────────────────────────────────────────────────────────────
export const cancelBookingSchema = z.object({
    reason: z.string().min(5).max(500),
});
// ── Confirm check-in (host or admin verifies guest's self-check-in) ──────────
export const confirmCheckinSchema = z.object({
    notes: z.string().max(500).optional(),
});
// ── Submit a property review ─────────────────────────────────────────────────
export const submitPropertyReviewSchema = z.object({
    booking_id: z.string().uuid(),
    rating_overall: z.number().int().min(1).max(5),
    rating_cleanliness: z.number().int().min(1).max(5).optional(),
    rating_accuracy: z.number().int().min(1).max(5).optional(),
    rating_communication: z.number().int().min(1).max(5).optional(),
    rating_location: z.number().int().min(1).max(5).optional(),
    rating_value: z.number().int().min(1).max(5).optional(),
    review_text: z.string().min(10).max(2000).optional(),
});
// ── Host reply to a review ───────────────────────────────────────────────────
export const hostReplySchema = z.object({
    reply: z.string().min(5).max(1000),
});
// ── Submit a guest review (host reviews guest) ───────────────────────────────
export const submitGuestReviewSchema = z.object({
    booking_id: z.string().uuid(),
    rating_overall: z.number().int().min(1).max(5),
    rating_communication: z.number().int().min(1).max(5).optional(),
    rating_cleanliness: z.number().int().min(1).max(5).optional(),
    rating_rules: z.number().int().min(1).max(5).optional(),
    review_text: z.string().min(10).max(2000).optional(),
    would_host_again: z.boolean().optional(),
});
// ── Raise a dispute ──────────────────────────────────────────────────────────
export const raiseDisputeSchema = z.object({
    booking_id: z.string().uuid(),
    reason: z.string().min(5).max(200),
    description: z.string().min(20).max(2000),
    evidence_urls: z.array(z.string().url()).max(10).optional(),
});
// ── Resolve a dispute (admin) ─────────────────────────────────────────────────
export const resolveDisputeSchema = z.object({
    status: z.enum(['resolved_guest', 'resolved_host', 'escalated']),
    resolution_notes: z.string().min(10).max(2000),
    refund_amount_kes: z.number().nonnegative().optional(),
});
// ── Update short_term_config extras ──────────────────────────────────────────
export const updateShortTermConfigSchema = z.object({
    cancellation_policy: z.enum(['flexible', 'moderate', 'strict', 'non_refundable']).optional(),
    check_in_instructions: z.string().max(2000).optional(),
    wifi_password: z.string().max(100).optional(),
    access_code: z.string().max(50).optional(),
    house_manual_url: z.string().url().optional(),
    min_advance_booking_hours: z.number().int().min(0).max(720).optional(),
    max_advance_booking_days: z.number().int().min(1).max(730).optional(),
});
// ── List bookings query ───────────────────────────────────────────────────────
export const listBookingsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['pending_payment', 'confirmed', 'checked_in', 'checked_out',
        'cancelled_guest', 'cancelled_host', 'disputed', 'completed']).optional(),
    from_date: z.string().date().optional(),
    to_date: z.string().date().optional(),
});
