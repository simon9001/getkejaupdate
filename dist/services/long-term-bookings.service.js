/**
 * long-term-bookings.service.ts
 *
 * Tables: long_term_bookings
 *
 * Tenancy lifecycle:
 *   pending_review → approved → deposit_paid → active → notice_given → terminated
 *                 ↘ rejected
 *
 * Business rules:
 *   - Only one active tenancy per property at a time (unique index in DB)
 *   - Agreed rent/deposit are locked at approval — never taken from client
 *   - Notice period defaults to 30 days (configurable per property in future)
 *   - Both parties can give notice; the earlier date wins
 */
import { supabaseAdmin } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';
export class LongTermBookingsService {
    // ─────────────────────────────────────────────────────────────────────────
    // APPLY
    // ─────────────────────────────────────────────────────────────────────────
    async applyForTenancy(tenantUserId, input) {
        const { property_id, desired_move_in, ...rest } = input;
        // Verify property
        const { data: property } = await supabaseAdmin
            .from('properties')
            .select('id, status, listing_category, created_by')
            .eq('id', property_id)
            .is('deleted_at', null)
            .maybeSingle();
        if (!property)
            throw new Error('Property not found');
        if (!['long_term_rent'].includes(property.listing_category)) {
            throw new Error('Long-term booking applications are only for long_term_rent listings');
        }
        if (property.status !== 'available')
            throw new Error('Property is not available');
        if (property.created_by === tenantUserId)
            throw new Error('Cannot apply for your own property');
        // Check for existing pending/active application from this tenant
        const { data: existingApp } = await supabaseAdmin
            .from('long_term_bookings')
            .select('id, status')
            .eq('property_id', property_id)
            .eq('tenant_user_id', tenantUserId)
            .in('status', ['pending_review', 'approved', 'deposit_paid', 'active'])
            .maybeSingle();
        if (existingApp) {
            throw new Error(`You already have an active application (status: ${existingApp.status}) for this property`);
        }
        const { data: booking, error } = await supabaseAdmin
            .from('long_term_bookings')
            .insert({
            property_id,
            tenant_user_id: tenantUserId,
            landlord_user_id: property.created_by,
            desired_move_in,
            lease_duration_months: rest.lease_duration_months,
            occupants_count: rest.occupants_count,
            has_pets: rest.has_pets,
            pets_description: rest.pets_description ?? null,
            employment_status: rest.employment_status ?? null,
            monthly_income_kes: rest.monthly_income_kes ?? null,
            cover_letter: rest.cover_letter ?? null,
            id_document_url: rest.id_document_url ?? null,
            status: 'pending_review',
        })
            .select('id, booking_ref, status, desired_move_in')
            .single();
        if (error)
            throw new Error(`Failed to submit application: ${error.message}`);
        logger.info({ bookingId: booking.id, tenantUserId, propertyId: property_id }, 'lt_booking.applied');
        return booking;
    }
    // ─────────────────────────────────────────────────────────────────────────
    // APPROVE / REJECT (landlord)
    // ─────────────────────────────────────────────────────────────────────────
    async approveApplication(bookingId, landlordUserId, input) {
        const booking = await this._fetchAndAssertLandlord(bookingId, landlordUserId);
        if (booking.status !== 'pending_review') {
            throw new Error(`Cannot approve an application with status '${booking.status}'`);
        }
        const moveIn = new Date(input.agreed_move_in_date);
        const leaseEnd = new Date(moveIn);
        leaseEnd.setMonth(leaseEnd.getMonth() + input.lease_duration_months);
        const { error } = await supabaseAdmin
            .from('long_term_bookings')
            .update({
            status: 'approved',
            agreed_monthly_rent_kes: input.agreed_monthly_rent_kes,
            agreed_deposit_kes: input.agreed_deposit_kes,
            agreed_move_in_date: input.agreed_move_in_date,
            lease_duration_months: input.lease_duration_months,
            lease_start_date: input.agreed_move_in_date,
            lease_end_date: leaseEnd.toISOString().split('T')[0],
            updated_at: new Date().toISOString(),
        })
            .eq('id', bookingId);
        if (error)
            throw new Error(`Failed to approve application: ${error.message}`);
        logger.info({ bookingId, landlordUserId }, 'lt_booking.approved');
        return { success: true, message: 'Application approved. Waiting for tenant to pay deposit.' };
    }
    async rejectApplication(bookingId, landlordUserId, reason) {
        const booking = await this._fetchAndAssertLandlord(bookingId, landlordUserId);
        if (booking.status !== 'pending_review') {
            throw new Error(`Cannot reject an application with status '${booking.status}'`);
        }
        await supabaseAdmin
            .from('long_term_bookings')
            .update({ status: 'rejected', rejection_reason: reason, updated_at: new Date().toISOString() })
            .eq('id', bookingId);
        logger.info({ bookingId, landlordUserId }, 'lt_booking.rejected');
        return { success: true };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // PAY DEPOSIT (tenant)
    // ─────────────────────────────────────────────────────────────────────────
    async payDeposit(bookingId, tenantUserId, input) {
        const booking = await this._fetchAndAssertTenant(bookingId, tenantUserId);
        if (booking.status !== 'approved') {
            throw new Error(`Deposit can only be paid for approved applications (current: ${booking.status})`);
        }
        // Validate amount matches agreed deposit (10% tolerance for fees)
        const tolerance = booking.agreed_deposit_kes * 0.10;
        if (Math.abs(input.amount_paid_kes - booking.agreed_deposit_kes) > tolerance) {
            throw new Error(`Amount paid (KES ${input.amount_paid_kes}) does not match the agreed deposit (KES ${booking.agreed_deposit_kes})`);
        }
        const paymentRef = input.mpesa_ref ?? `DEP-${Date.now()}`;
        await supabaseAdmin
            .from('long_term_bookings')
            .update({
            status: 'deposit_paid',
            deposit_paid_at: new Date().toISOString(),
            deposit_mpesa_ref: paymentRef,
            deposit_amount_paid_kes: input.amount_paid_kes,
            updated_at: new Date().toISOString(),
        })
            .eq('id', bookingId);
        // Mark the property as 'let'
        await supabaseAdmin
            .from('properties')
            .update({ status: 'let', updated_at: new Date().toISOString() })
            .eq('id', booking.property_id);
        logger.info({ bookingId, tenantUserId, amount: input.amount_paid_kes }, 'lt_booking.deposit_paid');
        return { success: true, booking_ref: booking.booking_ref, payment_ref: paymentRef };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // ACTIVATE (landlord confirms tenant moved in)
    // ─────────────────────────────────────────────────────────────────────────
    async activateTenancy(bookingId, landlordUserId) {
        const booking = await this._fetchAndAssertLandlord(bookingId, landlordUserId);
        if (booking.status !== 'deposit_paid') {
            throw new Error(`Cannot activate tenancy with status '${booking.status}'`);
        }
        await supabaseAdmin
            .from('long_term_bookings')
            .update({ status: 'active', updated_at: new Date().toISOString() })
            .eq('id', bookingId);
        logger.info({ bookingId, landlordUserId }, 'lt_booking.activated');
        return { success: true };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // GIVE NOTICE (either party)
    // ─────────────────────────────────────────────────────────────────────────
    async giveNotice(bookingId, userId, noticeDate, reason) {
        const { data: booking } = await supabaseAdmin
            .from('long_term_bookings')
            .select('id, tenant_user_id, landlord_user_id, status, property_id')
            .eq('id', bookingId)
            .maybeSingle();
        if (!booking)
            throw new Error('Booking not found');
        this._assertParticipant(booking, userId);
        if (booking.status !== 'active') {
            throw new Error(`Cannot give notice on a tenancy with status '${booking.status}'`);
        }
        if (new Date(noticeDate) < new Date()) {
            throw new Error('Notice date cannot be in the past');
        }
        await supabaseAdmin
            .from('long_term_bookings')
            .update({
            status: 'notice_given',
            notice_given_at: noticeDate,
            notice_given_by: userId,
            termination_reason: reason,
            updated_at: new Date().toISOString(),
        })
            .eq('id', bookingId);
        logger.info({ bookingId, userId, noticeDate }, 'lt_booking.notice_given');
        return { success: true };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // TERMINATE (admin or landlord after notice period)
    // ─────────────────────────────────────────────────────────────────────────
    async terminateTenancy(bookingId, userId, terminationDate, reason) {
        const { data: booking } = await supabaseAdmin
            .from('long_term_bookings')
            .select('id, tenant_user_id, landlord_user_id, status, property_id')
            .eq('id', bookingId)
            .maybeSingle();
        if (!booking)
            throw new Error('Booking not found');
        this._assertParticipant(booking, userId);
        if (!['active', 'notice_given'].includes(booking.status)) {
            throw new Error(`Cannot terminate a tenancy with status '${booking.status}'`);
        }
        await supabaseAdmin
            .from('long_term_bookings')
            .update({
            status: 'terminated',
            termination_date: terminationDate,
            termination_reason: reason,
            updated_at: new Date().toISOString(),
        })
            .eq('id', bookingId);
        // Make property available again
        await supabaseAdmin
            .from('properties')
            .update({ status: 'available', updated_at: new Date().toISOString() })
            .eq('id', booking.property_id);
        logger.info({ bookingId, userId }, 'lt_booking.terminated');
        return { success: true };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // READ
    // ─────────────────────────────────────────────────────────────────────────
    async getBookingById(bookingId, requestingUserId) {
        const { data, error } = await supabaseAdmin
            .from('long_term_bookings')
            .select(`
        id, booking_ref, property_id, tenant_user_id, landlord_user_id,
        desired_move_in, lease_duration_months, occupants_count, has_pets,
        pets_description, employment_status, cover_letter,
        agreed_monthly_rent_kes, agreed_deposit_kes, agreed_move_in_date,
        lease_start_date, lease_end_date,
        deposit_paid_at, deposit_amount_paid_kes,
        status, rejection_reason, notice_given_at,
        termination_date, lease_document_url, created_at, updated_at,
        properties ( id, title, listing_type,
          property_locations ( county, area, estate_name ),
          property_pricing ( monthly_rent, deposit_months ) )
      `)
            .eq('id', bookingId)
            .maybeSingle();
        if (error || !data)
            throw new Error('Booking not found');
        this._assertParticipant(data, requestingUserId);
        return data;
    }
    async getMyApplicationsAsTenant(tenantUserId, status) {
        let q = supabaseAdmin
            .from('long_term_bookings')
            .select(`
        id, booking_ref, status, desired_move_in, agreed_monthly_rent_kes,
        agreed_deposit_kes, lease_start_date, lease_end_date,
        deposit_paid_at, created_at,
        properties ( id, title,
          property_locations ( county, area ),
          property_media ( url, thumbnail_url, is_cover ) )
      `)
            .eq('tenant_user_id', tenantUserId)
            .order('created_at', { ascending: false });
        if (status)
            q = q.eq('status', status);
        const { data, error } = await q;
        if (error)
            throw new Error(`Failed to fetch applications: ${error.message}`);
        return data ?? [];
    }
    async getMyApplicationsAsLandlord(landlordUserId, status) {
        let q = supabaseAdmin
            .from('long_term_bookings')
            .select(`
        id, booking_ref, status, desired_move_in, lease_duration_months,
        occupants_count, has_pets, employment_status, monthly_income_kes,
        cover_letter, created_at,
        properties ( id, title ),
        tenant:users!tenant_user_id ( id,
          user_profiles ( full_name, display_name, avatar_url, county, whatsapp_number ) )
      `)
            .eq('landlord_user_id', landlordUserId)
            .order('created_at', { ascending: false });
        if (status)
            q = q.eq('status', status);
        const { data, error } = await q;
        if (error)
            throw new Error(`Failed to fetch landlord applications: ${error.message}`);
        return data ?? [];
    }
    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────
    async _fetchAndAssertLandlord(bookingId, landlordUserId) {
        const { data } = await supabaseAdmin
            .from('long_term_bookings')
            .select('id, booking_ref, property_id, tenant_user_id, landlord_user_id, status, agreed_deposit_kes')
            .eq('id', bookingId)
            .maybeSingle();
        if (!data)
            throw new Error('Booking not found');
        if (data.landlord_user_id !== landlordUserId)
            throw new Error('Forbidden: you are not the landlord on this booking');
        return data;
    }
    async _fetchAndAssertTenant(bookingId, tenantUserId) {
        const { data } = await supabaseAdmin
            .from('long_term_bookings')
            .select('id, booking_ref, property_id, tenant_user_id, landlord_user_id, status, agreed_deposit_kes')
            .eq('id', bookingId)
            .maybeSingle();
        if (!data)
            throw new Error('Booking not found');
        if (data.tenant_user_id !== tenantUserId)
            throw new Error('Forbidden: you are not the tenant on this booking');
        return data;
    }
    _assertParticipant(booking, userId) {
        if (booking.tenant_user_id !== userId && booking.landlord_user_id !== userId) {
            throw new Error('Forbidden: you are not part of this booking');
        }
    }
}
export const longTermBookingsService = new LongTermBookingsService();
