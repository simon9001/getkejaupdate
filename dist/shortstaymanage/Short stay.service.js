/**
 * short-stay.service.ts
 *
 * Full Airbnb-style short-stay management service.
 *
 * Core escrow flow:
 *   1. Guest creates booking → status: pending_payment
 *   2. Guest pays via M-Pesa → payment held in escrow → status: confirmed
 *   3. Guest self-checks in OR host confirms arrival → status: checked_in
 *   4. Check-in triggers automatic host payout from escrow
 *   5. Guest checks out → status: checked_out
 *   6. 14-day review window opens for both parties
 *   7. Status → completed when review window closes
 *
 * Cancellation refund policy:
 *   flexible:        100% refund if cancelled ≥24h before check-in, 50% otherwise
 *   moderate:        100% refund if cancelled ≥5 days before, 50% otherwise
 *   strict:          50% refund if cancelled ≥7 days before, 0% otherwise
 *   non_refundable:  0% refund always
 *
 * Tables: short_stay_bookings, booking_payments, booking_checkins,
 *         booking_cancellations, property_reviews, host_reviews,
 *         short_stay_disputes, property_review_stats,
 *         availability_calendar, short_term_config, properties
 */
import { supabaseAdmin } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';
// =============================================================================
// Refund policy calculator
// =============================================================================
function calculateRefundPct(policy, nightsBeforeCheckin) {
    switch (policy) {
        case 'flexible':
            return nightsBeforeCheckin >= 1 ? 100 : 50;
        case 'moderate':
            return nightsBeforeCheckin >= 5 ? 100 : 50;
        case 'strict':
            return nightsBeforeCheckin >= 7 ? 50 : 0;
        case 'non_refundable':
            return 0;
    }
}
function nightsBetween(a, b) {
    return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}
// =============================================================================
// ShortStayService
// =============================================================================
export class ShortStayService {
    // ─────────────────────────────────────────────────────────────────────────
    // AVAILABILITY CHECK
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Check if a property is available for the requested dates.
     * Blocks on: existing confirmed/checked_in bookings AND host-blocked calendar dates.
     */
    async checkAvailability(propertyId, checkIn, checkOut) {
        // Check existing confirmed bookings that overlap
        const { data: conflicts } = await supabaseAdmin
            .from('short_stay_bookings')
            .select('id, check_in_date, check_out_date, status, booking_ref')
            .eq('property_id', propertyId)
            .in('status', ['confirmed', 'checked_in'])
            .lt('check_in_date', checkOut)
            .gt('check_out_date', checkIn);
        if (conflicts && conflicts.length > 0) {
            return { available: false, blockedDates: [], reason: 'Dates are already booked' };
        }
        // Check host-blocked calendar entries
        const { data: calendarBlocks } = await supabaseAdmin
            .from('availability_calendar')
            .select('date_from, date_to, status')
            .eq('property_id', propertyId)
            .in('status', ['booked', 'blocked_owner'])
            .lt('date_from', checkOut)
            .gt('date_to', checkIn);
        if (calendarBlocks && calendarBlocks.length > 0) {
            return {
                available: false,
                blockedDates: calendarBlocks.map((b) => `${b.date_from} – ${b.date_to}`),
                reason: 'Dates are blocked by the host',
            };
        }
        // Validate against short_term_config advance booking rules
        const { data: config } = await supabaseAdmin
            .from('short_term_config')
            .select('min_advance_booking_hours, max_advance_booking_days, max_guests')
            .eq('property_id', propertyId)
            .maybeSingle();
        if (config) {
            const hoursUntilCheckin = (new Date(checkIn).getTime() - Date.now()) / (1000 * 60 * 60);
            if (hoursUntilCheckin < (config.min_advance_booking_hours ?? 2)) {
                return {
                    available: false,
                    blockedDates: [],
                    reason: `Minimum ${config.min_advance_booking_hours}h advance booking required`,
                };
            }
            const daysUntilCheckin = hoursUntilCheckin / 24;
            if (daysUntilCheckin > (config.max_advance_booking_days ?? 365)) {
                return {
                    available: false,
                    blockedDates: [],
                    reason: `Cannot book more than ${config.max_advance_booking_days} days in advance`,
                };
            }
        }
        return { available: true, blockedDates: [] };
    }
    /**
     * Get property availability calendar for a date range (public).
     */
    async getAvailabilityCalendar(propertyId, startDate, endDate) {
        const [bookings, calendarBlocks, config] = await Promise.all([
            supabaseAdmin
                .from('short_stay_bookings')
                .select('check_in_date, check_out_date, status')
                .eq('property_id', propertyId)
                .in('status', ['confirmed', 'checked_in'])
                .gte('check_out_date', startDate)
                .lte('check_in_date', endDate),
            supabaseAdmin
                .from('availability_calendar')
                .select('date_from, date_to, status, price_override')
                .eq('property_id', propertyId)
                .gte('date_to', startDate)
                .lte('date_from', endDate),
            supabaseAdmin
                .from('short_term_config')
                .select('price_per_night, price_per_weekend, cancellation_policy')
                .eq('property_id', propertyId)
                .maybeSingle(),
        ]);
        return {
            bookings: (bookings.data ?? []).map((b) => ({ from: b.check_in_date, to: b.check_out_date, status: b.status })),
            calendar_blocks: calendarBlocks.data ?? [],
            base_price: config.data?.price_per_night ?? null,
            weekend_price: config.data?.price_per_weekend ?? null,
            policy: config.data?.cancellation_policy ?? 'moderate',
        };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // PRICING QUOTE
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Calculate the full price breakdown for a booking before the guest commits.
     */
    async getPriceQuote(propertyId, checkIn, checkOut, guestsCount) {
        const nights = nightsBetween(checkIn, checkOut);
        if (nights <= 0)
            throw new Error('check_out_date must be after check_in_date');
        const { data: property } = await supabaseAdmin
            .from('properties')
            .select('id, status, listing_category, created_by')
            .eq('id', propertyId)
            .is('deleted_at', null)
            .maybeSingle();
        if (!property)
            throw new Error('Property not found');
        if (property.listing_category !== 'short_term_rent') {
            throw new Error('This property is not available for short-term stays');
        }
        const { data: config } = await supabaseAdmin
            .from('short_term_config')
            .select(`
        price_per_night, price_per_weekend, price_per_event,
        cleaning_fee, damage_deposit,
        platform_fee_pct, host_payout_pct,
        max_guests, cancellation_policy
      `)
            .eq('property_id', propertyId)
            .maybeSingle();
        if (!config?.price_per_night)
            throw new Error('Property pricing not configured');
        if (guestsCount > (config.max_guests ?? 99)) {
            throw new Error(`This property allows a maximum of ${config.max_guests} guests`);
        }
        // Compute weekend vs weekday pricing per night
        let subtotal = 0;
        const pricePerNight = config.price_per_night;
        const weekendPrice = config.price_per_weekend ?? pricePerNight;
        for (let i = 0; i < nights; i++) {
            const d = new Date(checkIn);
            d.setDate(d.getDate() + i);
            const dow = d.getDay(); // 0=Sun, 6=Sat
            subtotal += dow === 0 || dow === 6 ? weekendPrice : pricePerNight;
        }
        const cleaningFee = config.cleaning_fee ?? 0;
        const damageDeposit = config.damage_deposit ?? 0;
        const platformFeePct = config.platform_fee_pct ?? 10;
        const platformFee = Math.round((subtotal * platformFeePct) / 100);
        const totalCharged = subtotal + cleaningFee + platformFee;
        const hostPayout = subtotal + cleaningFee - Math.round((subtotal * (100 - (config.host_payout_pct ?? 90))) / 100);
        const { available, reason } = await this.checkAvailability(propertyId, checkIn, checkOut);
        return {
            property_id: propertyId,
            check_in_date: checkIn,
            check_out_date: checkOut,
            nights,
            guests_count: guestsCount,
            available,
            unavailable_reason: reason ?? null,
            pricing: {
                price_per_night_kes: pricePerNight,
                weekend_price_kes: weekendPrice,
                subtotal_kes: subtotal,
                cleaning_fee_kes: cleaningFee,
                damage_deposit_kes: damageDeposit,
                platform_fee_kes: platformFee,
                platform_fee_pct: platformFeePct,
                total_charged_kes: totalCharged,
                host_payout_kes: hostPayout,
            },
            cancellation_policy: config.cancellation_policy,
        };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // CREATE BOOKING + INITIATE PAYMENT
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Create a booking and initiate payment.
     * On payment success: booking → confirmed, funds → escrow, calendar blocked.
     */
    async createBooking(guestUserId, input) {
        const { property_id, check_in_date, check_out_date, guests_count, special_requests, payment_method, mpesa_phone, guest_name, guest_phone, } = input;
        // Quote + availability in one shot
        const quote = await this.getPriceQuote(property_id, check_in_date, check_out_date, guests_count);
        if (!quote.available) {
            throw new Error(`Property is not available: ${quote.unavailable_reason}`);
        }
        // Fetch host user_id
        const { data: property } = await supabaseAdmin
            .from('properties')
            .select('created_by')
            .eq('id', property_id)
            .single();
        if (!property?.created_by)
            throw new Error('Property host not found');
        const { data: config } = await supabaseAdmin
            .from('short_term_config')
            .select('cancellation_policy')
            .eq('property_id', property_id)
            .single();
        // ── Create booking row ────────────────────────────────────────────────
        const { data: booking, error: bookingErr } = await supabaseAdmin
            .from('short_stay_bookings')
            .insert({
            property_id,
            guest_user_id: guestUserId,
            host_user_id: property.created_by,
            check_in_date,
            check_out_date,
            guests_count,
            price_per_night_kes: quote.pricing.price_per_night_kes,
            subtotal_kes: quote.pricing.subtotal_kes,
            cleaning_fee_kes: quote.pricing.cleaning_fee_kes,
            damage_deposit_kes: quote.pricing.damage_deposit_kes,
            platform_fee_kes: quote.pricing.platform_fee_kes,
            total_charged_kes: quote.pricing.total_charged_kes,
            host_payout_kes: quote.pricing.host_payout_kes,
            status: 'pending_payment',
            cancellation_policy: config?.cancellation_policy ?? 'moderate',
            special_requests: special_requests ?? null,
            guest_name: guest_name ?? null,
            guest_phone: guest_phone ?? null,
        })
            .select('id, booking_ref, total_charged_kes')
            .single();
        if (bookingErr || !booking) {
            throw new Error(`Failed to create booking: ${bookingErr?.message}`);
        }
        logger.info({ bookingId: booking.id, guestUserId, propertyId: property_id }, 'booking.created');
        // ── Initiate payment ─────────────────────────────────────────────────
        const paymentRef = await this._initiatePayment({
            bookingId: booking.id,
            guestUserId,
            amountKes: quote.pricing.total_charged_kes,
            paymentMethod: payment_method,
            mpesaPhone: mpesa_phone,
            description: `Booking ${booking.booking_ref} – ${quote.nights} nights`,
        });
        // ── On successful payment, confirm booking and block calendar ────────
        // In production, this happens in a payment webhook callback.
        // For now we simulate immediate success.
        await this._onPaymentSuccess(booking.id, paymentRef, quote);
        return this.getBookingById(booking.id, guestUserId);
    }
    /**
     * Called by the payment webhook (or simulation) when guest payment succeeds.
     * Moves booking to confirmed, records ledger entry, blocks calendar.
     */
    async _onPaymentSuccess(bookingId, paymentRef, quote) {
        // Update booking status
        await supabaseAdmin
            .from('short_stay_bookings')
            .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
            .eq('id', bookingId);
        // Record guest_charge ledger entry (held in escrow)
        await supabaseAdmin.from('booking_payments').insert({
            booking_id: bookingId,
            role: 'guest_charge',
            amount_kes: quote.pricing.total_charged_kes,
            status: 'held_escrow',
            payment_method: 'mpesa',
            mpesa_transaction_id: paymentRef,
            held_since: new Date().toISOString(),
        });
        // Record platform fee ledger entry (retained)
        await supabaseAdmin.from('booking_payments').insert({
            booking_id: bookingId,
            role: 'platform_fee',
            amount_kes: quote.pricing.platform_fee_kes,
            status: 'held_escrow',
            payment_method: 'mpesa',
            held_since: new Date().toISOString(),
        });
        // Block dates in availability_calendar
        const { data: booking } = await supabaseAdmin
            .from('short_stay_bookings')
            .select('property_id, check_in_date, check_out_date, booking_ref')
            .eq('id', bookingId)
            .single();
        if (booking) {
            await supabaseAdmin.from('availability_calendar').insert({
                property_id: booking.property_id,
                date_from: booking.check_in_date,
                date_to: booking.check_out_date,
                status: 'booked',
                booking_ref: booking.booking_ref,
            });
        }
        logger.info({ bookingId, paymentRef }, 'booking.confirmed.payment_received');
    }
    // ─────────────────────────────────────────────────────────────────────────
    // CHECK-IN / CHECK-OUT + ESCROW RELEASE
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Record a check-in or check-out event.
     *
     * Check-in flow:
     *   1. Guest records self check-in (checkin_type: guest_self) → verified: false
     *   2. Host or admin confirms → verified: true → payout triggered
     *
     * OR:
     *   Host directly records host_confirmed → verified: true immediately → payout triggered
     *
     * Payout is ONLY released when verified = true.
     */
    async recordCheckin(bookingId, performedBy, input) {
        const { event_type, checkin_type, latitude, longitude, location_accuracy_m, proof_photo_url, notes } = input;
        // Fetch booking
        const { data: booking, error: bookErr } = await supabaseAdmin
            .from('short_stay_bookings')
            .select('id, property_id, guest_user_id, host_user_id, status, check_in_date, check_out_date, host_payout_kes, booking_ref')
            .eq('id', bookingId)
            .maybeSingle();
        if (bookErr || !booking)
            throw new Error('Booking not found');
        // Validate allowed state transitions
        if (event_type === 'check_in' && booking.status !== 'confirmed') {
            throw new Error(`Cannot check in: booking status is '${booking.status}'`);
        }
        if (event_type === 'check_out' && booking.status !== 'checked_in') {
            throw new Error(`Cannot check out: booking status is '${booking.status}'`);
        }
        // Validate who can perform the action
        const isGuest = performedBy === booking.guest_user_id;
        const isHost = performedBy === booking.host_user_id;
        if (!isGuest && !isHost) {
            // Admin path — checked by caller
        }
        // Auto-verify if host or admin is doing the check-in
        const autoVerify = checkin_type === 'host_confirmed' ||
            checkin_type === 'admin_override' ||
            isHost;
        const { data: checkinRow, error: checkinErr } = await supabaseAdmin
            .from('booking_checkins')
            .insert({
            bookingId,
            event_type,
            checkin_type,
            performed_by: performedBy,
            verified: autoVerify,
            verified_at: autoVerify ? new Date().toISOString() : null,
            verified_by: autoVerify ? performedBy : null,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
            location_accuracy_m: location_accuracy_m ?? null,
            proof_photo_url: proof_photo_url ?? null,
            notes: notes ?? null,
            payout_triggered: false,
        })
            .select('id, verified')
            .single();
        if (checkinErr)
            throw new Error(`Failed to record ${event_type}: ${checkinErr.message}`);
        // Update booking status
        const newStatus = event_type === 'check_in' ? 'checked_in' : 'checked_out';
        await supabaseAdmin
            .from('short_stay_bookings')
            .update({ status: newStatus })
            .eq('id', bookingId);
        // ── ESCROW RELEASE ────────────────────────────────────────────────────
        // Release host payout when check-in is verified
        if (event_type === 'check_in' && autoVerify) {
            await this._releaseHostPayout(booking, checkinRow.id);
        }
        logger.info({ bookingId, eventType: event_type, performedBy, autoVerify }, 'booking.checkin.recorded');
        return { success: true, event_type, verified: autoVerify, booking_status: newStatus };
    }
    /**
     * Host or admin confirms a guest's self-reported check-in.
     * This is the trigger for escrow release if not already released.
     */
    async confirmCheckin(bookingId, confirmedBy) {
        const { data: checkinRow } = await supabaseAdmin
            .from('booking_checkins')
            .select('id, payout_triggered, verified')
            .eq('booking_id', bookingId)
            .eq('event_type', 'check_in')
            .maybeSingle();
        if (!checkinRow)
            throw new Error('No check-in record found for this booking');
        if (checkinRow.verified)
            throw new Error('Check-in is already verified');
        await supabaseAdmin
            .from('booking_checkins')
            .update({ verified: true, verified_at: new Date().toISOString(), verified_by: confirmedBy })
            .eq('id', checkinRow.id);
        if (!checkinRow.payout_triggered) {
            const { data: booking } = await supabaseAdmin
                .from('short_stay_bookings')
                .select('id, property_id, guest_user_id, host_user_id, status, check_in_date, check_out_date, host_payout_kes, booking_ref')
                .eq('id', bookingId)
                .single();
            if (booking) {
                await this._releaseHostPayout(booking, checkinRow.id);
            }
        }
        logger.info({ bookingId, confirmedBy }, 'booking.checkin.confirmed');
        return { success: true, message: 'Check-in confirmed. Host payout has been released.' };
    }
    /**
     * Internal: release host payout from escrow.
     * Creates a host_payout ledger entry and marks the guest_charge as released.
     */
    async _releaseHostPayout(booking, checkinId) {
        const now = new Date().toISOString();
        // Create host_payout ledger entry
        const payoutRef = await this._simulatePayout({
            recipientUserId: booking.host_user_id,
            amountKes: booking.host_payout_kes,
            bookingRef: booking.booking_ref,
        });
        await supabaseAdmin.from('booking_payments').insert({
            booking_id: booking.id,
            role: 'host_payout',
            amount_kes: booking.host_payout_kes,
            status: 'released',
            payment_method: 'mpesa',
            gateway_reference: payoutRef,
            recipient_user_id: booking.host_user_id,
            held_since: null,
            released_at: now,
            release_trigger: 'check_in_confirmed',
            completed_at: now,
        });
        // Mark the guest_charge escrow row as released
        await supabaseAdmin
            .from('booking_payments')
            .update({ status: 'released', released_at: now, release_trigger: 'check_in_confirmed' })
            .eq('booking_id', booking.id)
            .eq('role', 'guest_charge');
        // Mark payout triggered on the check-in row
        await supabaseAdmin
            .from('booking_checkins')
            .update({ payout_triggered: true, payout_triggered_at: now })
            .eq('id', checkinId);
        logger.info({ bookingId: booking.id, hostId: booking.host_user_id, amount: booking.host_payout_kes }, 'booking.payout.released');
    }
    // ─────────────────────────────────────────────────────────────────────────
    // CANCELLATION + REFUND
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Cancel a booking and compute the refund based on the property's
     * cancellation policy and how far in advance the cancellation is made.
     *
     * - Guest cancellation: refund per policy
     * - Host cancellation:  100% refund always + host penalty fee
     */
    async cancelBooking(bookingId, cancelledByUserId, input) {
        const { data: booking } = await supabaseAdmin
            .from('short_stay_bookings')
            .select('id, property_id, guest_user_id, host_user_id, status, check_in_date, total_charged_kes, platform_fee_kes, cancellation_policy, booking_ref')
            .eq('id', bookingId)
            .maybeSingle();
        if (!booking)
            throw new Error('Booking not found');
        const cancellableStatuses = ['pending_payment', 'confirmed'];
        if (!cancellableStatuses.includes(booking.status)) {
            throw new Error(`Cannot cancel a booking with status '${booking.status}'`);
        }
        const isGuest = cancelledByUserId === booking.guest_user_id;
        const isHost = cancelledByUserId === booking.host_user_id;
        if (!isGuest && !isHost)
            throw new Error('Forbidden: you are not part of this booking');
        // Calculate refund
        const nightsBeforeCheckin = nightsBetween(new Date().toISOString().split('T')[0], booking.check_in_date);
        let refundPct;
        let newStatus;
        let platformFeeRefunded = 0;
        if (isHost) {
            // Host cancels → 100% refund + penalty
            refundPct = 100;
            newStatus = 'cancelled_host';
            platformFeeRefunded = booking.platform_fee_kes;
        }
        else {
            refundPct = calculateRefundPct(booking.cancellation_policy, nightsBeforeCheckin);
            newStatus = 'cancelled_guest';
        }
        const refundAmount = Math.round((booking.total_charged_kes * refundPct) / 100);
        // Update booking
        await supabaseAdmin
            .from('short_stay_bookings')
            .update({ status: newStatus, cancelled_at: new Date().toISOString() })
            .eq('id', bookingId);
        // Record cancellation
        const { data: cancellation } = await supabaseAdmin
            .from('booking_cancellations')
            .insert({
            booking_id: bookingId,
            cancelled_by: cancelledByUserId,
            cancelled_by_role: isGuest ? 'guest' : 'host',
            reason: input.reason,
            nights_before_checkin: nightsBeforeCheckin,
            policy_applied: booking.cancellation_policy,
            refund_pct: refundPct,
            refund_amount_kes: refundAmount,
            platform_fee_refunded: platformFeeRefunded,
            refund_status: 'pending',
        })
            .select('id')
            .single();
        // Unblock calendar
        await supabaseAdmin
            .from('availability_calendar')
            .delete()
            .eq('property_id', booking.property_id)
            .eq('booking_ref', booking.booking_ref);
        // Process refund (simulate)
        if (refundAmount > 0 && booking.status !== 'pending_payment') {
            const refundRef = await this._simulateRefund({
                bookingId,
                guestUserId: booking.guest_user_id,
                amountKes: refundAmount,
                bookingRef: booking.booking_ref,
            });
            await supabaseAdmin.from('booking_payments').insert({
                booking_id: bookingId,
                role: 'refund_guest',
                amount_kes: refundAmount,
                status: 'released',
                payment_method: 'mpesa',
                gateway_reference: refundRef,
                recipient_user_id: booking.guest_user_id,
                released_at: new Date().toISOString(),
                release_trigger: `cancellation_${isGuest ? 'guest' : 'host'}`,
                completed_at: new Date().toISOString(),
            });
            if (cancellation?.id) {
                await supabaseAdmin
                    .from('booking_cancellations')
                    .update({ refund_status: 'released', refund_mpesa_ref: refundRef, processed_at: new Date().toISOString() })
                    .eq('id', cancellation.id);
            }
        }
        logger.info({ bookingId, cancelledBy: isGuest ? 'guest' : 'host', refundPct, refundAmount }, 'booking.cancelled');
        return {
            success: true,
            booking_ref: booking.booking_ref,
            status: newStatus,
            refund_pct: refundPct,
            refund_amount_kes: refundAmount,
            policy_applied: booking.cancellation_policy,
            nights_before_checkin: nightsBeforeCheckin,
        };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // BOOKING READ METHODS
    // ─────────────────────────────────────────────────────────────────────────
    async getBookingById(bookingId, requestingUserId) {
        const { data, error } = await supabaseAdmin
            .from('short_stay_bookings')
            .select(`
        id, booking_ref, property_id, guest_user_id, host_user_id,
        check_in_date, check_out_date, nights, guests_count,
        price_per_night_kes, subtotal_kes, cleaning_fee_kes,
        damage_deposit_kes, platform_fee_kes, total_charged_kes, host_payout_kes,
        status, cancellation_policy, requested_at, confirmed_at,
        cancelled_at, completed_at, special_requests, guest_name, guest_phone,
        properties ( id, title, listing_type, property_locations ( county, area, estate_name ) ),
        booking_checkins ( id, event_type, checkin_type, verified, verified_at, recorded_at ),
        booking_payments ( role, amount_kes, status, initiated_at, completed_at )
      `)
            .eq('id', bookingId)
            .maybeSingle();
        if (error || !data)
            throw new Error('Booking not found');
        // Strip sensitive host payout info for guests
        if (requestingUserId === data.guest_user_id) {
            const { host_payout_kes, ...safeData } = data;
            return safeData;
        }
        return data;
    }
    async getMyBookingsAsGuest(userId, query) {
        const { page, limit, status, from_date, to_date } = query;
        const from = (page - 1) * limit;
        let q = supabaseAdmin
            .from('short_stay_bookings')
            .select(`
        id, booking_ref, property_id, check_in_date, check_out_date,
        nights, guests_count, total_charged_kes, status, requested_at, confirmed_at,
        properties ( id, title, property_locations ( county, area ), property_media ( url, thumbnail_url, is_cover, sort_order ) )
      `, { count: 'exact' })
            .eq('guest_user_id', userId)
            .order('requested_at', { ascending: false })
            .range(from, from + limit - 1);
        if (status)
            q = q.eq('status', status);
        if (from_date)
            q = q.gte('check_in_date', from_date);
        if (to_date)
            q = q.lte('check_out_date', to_date);
        const { data, count, error } = await q;
        if (error)
            throw new Error(`Failed to fetch bookings: ${error.message}`);
        return { bookings: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async getMyBookingsAsHost(userId, query) {
        const { page, limit, status, from_date, to_date } = query;
        const from = (page - 1) * limit;
        let q = supabaseAdmin
            .from('short_stay_bookings')
            .select(`
        id, booking_ref, property_id, check_in_date, check_out_date,
        nights, guests_count, total_charged_kes, host_payout_kes, status, requested_at,
        confirmed_at, guest_name, guest_phone, special_requests,
        properties ( id, title )
      `, { count: 'exact' })
            .eq('host_user_id', userId)
            .order('check_in_date', { ascending: true })
            .range(from, from + limit - 1);
        if (status)
            q = q.eq('status', status);
        if (from_date)
            q = q.gte('check_in_date', from_date);
        if (to_date)
            q = q.lte('check_out_date', to_date);
        const { data, count, error } = await q;
        if (error)
            throw new Error(`Failed to fetch host bookings: ${error.message}`);
        return { bookings: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // REVIEWS
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Submit a property review (guest reviews property after checkout).
     * Only allowed within 14 days of checkout.
     */
    async submitPropertyReview(guestUserId, input) {
        const { booking_id, ...ratings } = input;
        const { data: booking } = await supabaseAdmin
            .from('short_stay_bookings')
            .select('id, property_id, guest_user_id, host_user_id, status, check_out_date')
            .eq('id', booking_id)
            .maybeSingle();
        if (!booking)
            throw new Error('Booking not found');
        if (booking.guest_user_id !== guestUserId)
            throw new Error('Forbidden: this is not your booking');
        const allowedStatuses = ['checked_out', 'completed'];
        if (!allowedStatuses.includes(booking.status)) {
            throw new Error('Reviews can only be submitted after checkout');
        }
        // 14-day review window
        const daysSinceCheckout = nightsBetween(booking.check_out_date, new Date().toISOString().split('T')[0]);
        if (daysSinceCheckout > 14) {
            throw new Error('Review window has closed (14 days after checkout)');
        }
        // Check for duplicate
        const { data: existing } = await supabaseAdmin
            .from('property_reviews')
            .select('id')
            .eq('booking_id', booking_id)
            .maybeSingle();
        if (existing)
            throw new Error('You have already reviewed this stay');
        const { data: review, error } = await supabaseAdmin
            .from('property_reviews')
            .insert({
            booking_id,
            property_id: booking.property_id,
            reviewer_user_id: guestUserId,
            host_user_id: booking.host_user_id,
            rating_overall: ratings.rating_overall,
            rating_cleanliness: ratings.rating_cleanliness ?? null,
            rating_accuracy: ratings.rating_accuracy ?? null,
            rating_communication: ratings.rating_communication ?? null,
            rating_location: ratings.rating_location ?? null,
            rating_value: ratings.rating_value ?? null,
            review_text: ratings.review_text ?? null,
            status: 'published', // auto-publish; add moderation if needed
            published_at: new Date().toISOString(),
        })
            .select()
            .single();
        if (error)
            throw new Error(`Failed to submit review: ${error.message}`);
        logger.info({ bookingId: booking_id, guestUserId }, 'review.property.submitted');
        return review;
    }
    /**
     * Submit a guest review (host reviews guest).
     */
    async submitGuestReview(hostUserId, input) {
        const { booking_id, ...ratings } = input;
        const { data: booking } = await supabaseAdmin
            .from('short_stay_bookings')
            .select('id, guest_user_id, host_user_id, status, check_out_date')
            .eq('id', booking_id)
            .maybeSingle();
        if (!booking)
            throw new Error('Booking not found');
        if (booking.host_user_id !== hostUserId)
            throw new Error('Forbidden: this is not your listing');
        const allowedStatuses = ['checked_out', 'completed'];
        if (!allowedStatuses.includes(booking.status)) {
            throw new Error('Reviews can only be submitted after checkout');
        }
        const daysSinceCheckout = nightsBetween(booking.check_out_date, new Date().toISOString().split('T')[0]);
        if (daysSinceCheckout > 14)
            throw new Error('Review window has closed (14 days after checkout)');
        const { data: existing } = await supabaseAdmin
            .from('host_reviews')
            .select('id')
            .eq('booking_id', booking_id)
            .maybeSingle();
        if (existing)
            throw new Error('You have already reviewed this guest');
        const { data: review, error } = await supabaseAdmin
            .from('host_reviews')
            .insert({
            booking_id,
            reviewer_user_id: hostUserId,
            guest_user_id: booking.guest_user_id,
            rating_overall: ratings.rating_overall,
            rating_communication: ratings.rating_communication ?? null,
            rating_cleanliness: ratings.rating_cleanliness ?? null,
            rating_rules: ratings.rating_rules ?? null,
            review_text: ratings.review_text ?? null,
            would_host_again: ratings.would_host_again ?? null,
            status: 'published',
            published_at: new Date().toISOString(),
        })
            .select()
            .single();
        if (error)
            throw new Error(`Failed to submit guest review: ${error.message}`);
        return review;
    }
    /**
     * Host adds a public reply to a guest review.
     */
    async replyToReview(reviewId, hostUserId, reply) {
        const { data: review } = await supabaseAdmin
            .from('property_reviews')
            .select('id, host_user_id, host_reply')
            .eq('id', reviewId)
            .maybeSingle();
        if (!review)
            throw new Error('Review not found');
        if (review.host_user_id !== hostUserId)
            throw new Error('Forbidden: this is not your listing');
        if (review.host_reply)
            throw new Error('You have already replied to this review');
        const { error } = await supabaseAdmin
            .from('property_reviews')
            .update({ host_reply: reply, host_replied_at: new Date().toISOString() })
            .eq('id', reviewId);
        if (error)
            throw new Error(`Failed to post reply: ${error.message}`);
        return { success: true };
    }
    /**
     * Get all published reviews for a property.
     */
    async getPropertyReviews(propertyId, page = 1, limit = 20) {
        const from = (page - 1) * limit;
        const { data, count, error } = await supabaseAdmin
            .from('property_reviews')
            .select(`
        id, rating_overall, rating_cleanliness, rating_accuracy,
        rating_communication, rating_location, rating_value,
        review_text, host_reply, host_replied_at, submitted_at,
        users!reviewer_user_id ( id, user_profiles ( full_name, display_name, avatar_url ) )
      `, { count: 'exact' })
            .eq('property_id', propertyId)
            .eq('status', 'published')
            .order('submitted_at', { ascending: false })
            .range(from, from + limit - 1);
        if (error)
            throw new Error(`Failed to fetch reviews: ${error.message}`);
        const { data: stats } = await supabaseAdmin
            .from('property_review_stats')
            .select('*')
            .eq('property_id', propertyId)
            .maybeSingle();
        return {
            reviews: data ?? [],
            total: count ?? 0,
            page, limit,
            pages: Math.ceil((count ?? 0) / limit),
            stats: stats ?? null,
        };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // DISPUTES
    // ─────────────────────────────────────────────────────────────────────────
    async raiseDispute(raisedByUserId, input) {
        const { booking_id, reason, description, evidence_urls } = input;
        const { data: booking } = await supabaseAdmin
            .from('short_stay_bookings')
            .select('id, guest_user_id, host_user_id, status')
            .eq('id', booking_id)
            .maybeSingle();
        if (!booking)
            throw new Error('Booking not found');
        const isGuest = raisedByUserId === booking.guest_user_id;
        const isHost = raisedByUserId === booking.host_user_id;
        if (!isGuest && !isHost)
            throw new Error('Forbidden: you are not part of this booking');
        const { data: dispute, error } = await supabaseAdmin
            .from('short_stay_disputes')
            .insert({
            booking_id,
            raised_by: raisedByUserId,
            raised_by_role: isGuest ? 'guest' : 'host',
            against_user_id: isGuest ? booking.host_user_id : booking.guest_user_id,
            reason,
            description,
            evidence_urls: evidence_urls ?? null,
            status: 'open',
        })
            .select()
            .single();
        if (error)
            throw new Error(`Failed to raise dispute: ${error.message}`);
        // Move booking to disputed status
        await supabaseAdmin
            .from('short_stay_bookings')
            .update({ status: 'disputed' })
            .eq('id', booking_id);
        logger.info({ bookingId: booking_id, raisedByUserId }, 'dispute.raised');
        return dispute;
    }
    async resolveDispute(disputeId, adminUserId, input) {
        const { status, resolution_notes, refund_amount_kes } = input;
        const { data: dispute } = await supabaseAdmin
            .from('short_stay_disputes')
            .select('id, booking_id, status')
            .eq('id', disputeId)
            .maybeSingle();
        if (!dispute)
            throw new Error('Dispute not found');
        if (dispute.status === 'resolved_guest' || dispute.status === 'resolved_host') {
            throw new Error('Dispute already resolved');
        }
        await supabaseAdmin
            .from('short_stay_disputes')
            .update({
            status,
            resolved_by: adminUserId,
            resolution_notes,
            refund_amount_kes: refund_amount_kes ?? null,
            resolved_at: new Date().toISOString(),
        })
            .eq('id', disputeId);
        // Process admin-determined refund if applicable
        if (refund_amount_kes && refund_amount_kes > 0) {
            const { data: booking } = await supabaseAdmin
                .from('short_stay_bookings')
                .select('guest_user_id, booking_ref')
                .eq('id', dispute.booking_id)
                .single();
            if (booking) {
                await supabaseAdmin.from('booking_payments').insert({
                    booking_id: dispute.booking_id,
                    role: 'refund_guest',
                    amount_kes: refund_amount_kes,
                    status: 'released',
                    payment_method: 'mpesa',
                    recipient_user_id: booking.guest_user_id,
                    released_at: new Date().toISOString(),
                    release_trigger: 'admin_dispute_resolution',
                    completed_at: new Date().toISOString(),
                });
            }
        }
        // Update booking to completed
        await supabaseAdmin
            .from('short_stay_bookings')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', dispute.booking_id);
        logger.info({ disputeId, adminUserId, status }, 'dispute.resolved');
        return { success: true, status, refund_amount_kes };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // ADMIN
    // ─────────────────────────────────────────────────────────────────────────
    async getAllBookingsAdmin(query) {
        const { page, limit, status } = query;
        const from = (page - 1) * limit;
        let q = supabaseAdmin
            .from('short_stay_bookings')
            .select(`
        id, booking_ref, property_id, guest_user_id, host_user_id,
        check_in_date, check_out_date, nights, total_charged_kes,
        host_payout_kes, status, requested_at,
        properties ( id, title )
      `, { count: 'exact' })
            .order('requested_at', { ascending: false })
            .range(from, from + limit - 1);
        if (status)
            q = q.eq('status', status);
        const { data, count, error } = await q;
        if (error)
            throw new Error(`Failed to fetch admin bookings: ${error.message}`);
        return { bookings: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async getOpenDisputes(page = 1, limit = 20) {
        const from = (page - 1) * limit;
        const { data, count, error } = await supabaseAdmin
            .from('short_stay_disputes')
            .select('*, short_stay_bookings ( booking_ref, check_in_date, check_out_date )', { count: 'exact' })
            .in('status', ['open', 'under_review'])
            .order('raised_at', { ascending: true })
            .range(from, from + limit - 1);
        if (error)
            throw new Error(`Failed to fetch disputes: ${error.message}`);
        return { disputes: data ?? [], total: count ?? 0, page, limit };
    }
    async adminFlagReview(reviewId, reason) {
        const { error } = await supabaseAdmin
            .from('property_reviews')
            .update({ status: 'flagged', flagged_reason: reason })
            .eq('id', reviewId);
        if (error)
            throw new Error(`Failed to flag review: ${error.message}`);
        return { success: true };
    }
    async adminRemoveReview(reviewId) {
        const { error } = await supabaseAdmin
            .from('property_reviews')
            .update({ status: 'removed' })
            .eq('id', reviewId);
        if (error)
            throw new Error(`Failed to remove review: ${error.message}`);
        return { success: true };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // Payment / payout stubs (replace with real M-Pesa Daraja)
    // ─────────────────────────────────────────────────────────────────────────
    async _initiatePayment(opts) {
        const ref = `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        logger.info({ ...opts, ref }, 'payment.initiated.simulated');
        return ref;
        /*
         * Replace with:
         * const res = await mpesaClient.stkPush({ phoneNumber: opts.mpesaPhone, amount: Math.ceil(opts.amountKes), ... });
         * return res.CheckoutRequestID;
         */
    }
    async _simulatePayout(opts) {
        const ref = `POUT-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        logger.info({ ...opts, ref }, 'payout.simulated');
        return ref;
    }
    async _simulateRefund(opts) {
        const ref = `REF-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        logger.info({ ...opts, ref }, 'refund.simulated');
        return ref;
    }
}
export const shortStayService = new ShortStayService();
