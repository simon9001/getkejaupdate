/**
 * staff.service.ts
 *
 * Staff/moderator service for GETKEJA.
 *
 * Staff permissions:
 *   - READ: users, properties, bookings, reviews, audit log
 *   - MODERATE: ID verifications, disputes, reviews, messages, flagged properties
 *   - MANAGE USERS: suspend/unsuspend (but not ban permanently or delete)
 *
 * Staff CANNOT:
 *   - Modify fee configuration
 *   - Change subscription plans
 *   - Approve ad campaigns
 *   - Delete users permanently
 *   - Change system role assignments
 */
import { supabaseAdmin } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function round2(n) {
    return Math.round(n * 100) / 100;
}
// =============================================================================
// StaffService
// =============================================================================
export class StaffService {
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 1: KPI SNAPSHOT (staff-focused)
    // ═══════════════════════════════════════════════════════════════════════════
    async getKpiSnapshot() {
        const [pendingVerifications, openDisputes, fraudQueueCount, reportedMessages, pendingProperties, suspendedUsers, totalUsers, totalProperties,] = await Promise.all([
            supabaseAdmin.from('id_verifications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
            supabaseAdmin.from('short_stay_disputes').select('id', { count: 'exact', head: true }).in('status', ['open', 'under_review']),
            supabaseAdmin.from('unified_reviews').select('id', { count: 'exact', head: true }).eq('status', 'held_for_moderation'),
            supabaseAdmin.from('message_reports').select('id', { count: 'exact', head: true }).eq('reviewed', false),
            supabaseAdmin.from('properties').select('id', { count: 'exact', head: true }).eq('status', 'off_market').is('deleted_at', null),
            supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).eq('account_status', 'suspended'),
            supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).is('deleted_at', null),
            supabaseAdmin.from('properties').select('id', { count: 'exact', head: true }).is('deleted_at', null),
        ]);
        return {
            moderation_queues: {
                pending_id_verifications: pendingVerifications.count ?? 0,
                open_disputes: openDisputes.count ?? 0,
                fraud_reviews: fraudQueueCount.count ?? 0,
                reported_messages: reportedMessages.count ?? 0,
                pending_property_review: pendingProperties.count ?? 0,
            },
            platform_health: {
                total_users: totalUsers.count ?? 0,
                suspended_users: suspendedUsers.count ?? 0,
                total_properties: totalProperties.count ?? 0,
            },
            generated_at: new Date().toISOString(),
        };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 2: ID VERIFICATION MODERATION
    // ═══════════════════════════════════════════════════════════════════════════
    async getPendingVerifications(page, limit) {
        const from = (page - 1) * limit;
        const { data, count, error } = await supabaseAdmin
            .from('id_verifications')
            .select(`
        id, doc_type, doc_number, status, submitted_at,
        front_image_url, back_image_url, selfie_url,
        users!user_id (
          id, email, phone_number, created_at,
          user_profiles ( full_name, display_name, avatar_url )
        )
      `, { count: 'exact' })
            .eq('status', 'pending')
            .order('submitted_at', { ascending: true })
            .range(from, from + limit - 1);
        if (error)
            throw new Error(`Failed to fetch verifications: ${error.message}`);
        return { verifications: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async approveVerification(verificationId, staffId) {
        // Update verification status
        const { error: updateError } = await supabaseAdmin
            .from('id_verifications')
            .update({
            status: 'approved',
            reviewed_by: staffId,
            reviewed_at: new Date().toISOString(),
        })
            .eq('id', verificationId);
        if (updateError)
            throw new Error(`Failed to approve verification: ${updateError.message}`);
        // Get user_id from verification
        const { data: verification, error: fetchError } = await supabaseAdmin
            .from('id_verifications')
            .select('user_id')
            .eq('id', verificationId)
            .single();
        if (fetchError)
            throw new Error(`Failed to fetch verification: ${fetchError.message}`);
        // Update user's role verification status if they have a role that requires verification
        await supabaseAdmin
            .from('user_roles')
            .update({ verified_at: new Date().toISOString(), verified_by: staffId })
            .eq('user_id', verification.user_id)
            .eq('is_active', true);
        // Also update landlord/agent profile verification flag
        await supabaseAdmin
            .from('landlord_profiles')
            .update({ id_verified: true })
            .eq('user_id', verification.user_id);
        await supabaseAdmin
            .from('agent_profiles')
            .update({ license_verified: true })
            .eq('user_id', verification.user_id);
        logger.info({ verificationId, staffId, userId: verification.user_id }, 'staff.verification.approved');
        return { success: true };
    }
    async rejectVerification(verificationId, staffId, reason) {
        const { error } = await supabaseAdmin
            .from('id_verifications')
            .update({
            status: 'rejected',
            reviewed_by: staffId,
            reviewed_at: new Date().toISOString(),
            rejection_reason: reason,
        })
            .eq('id', verificationId);
        if (error)
            throw new Error(`Failed to reject verification: ${error.message}`);
        logger.info({ verificationId, staffId, reason }, 'staff.verification.rejected');
        return { success: true };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 3: DISPUTE RESOLUTION
    // ═══════════════════════════════════════════════════════════════════════════
    async getOpenDisputes(page, limit) {
        const from = (page - 1) * limit;
        const { data, count, error } = await supabaseAdmin
            .from('short_stay_disputes')
            .select(`
        id, reason, description, status, raised_at, evidence_urls,
        raised_by_role, refund_amount_kes,
        short_stay_bookings (
          id, booking_ref, check_in_date, check_out_date,
          total_charged_kes, host_payout_kes,
          properties ( id, title, property_locations(county, area) )
        ),
        raised_by_user:users!raised_by ( id, email, user_profiles(full_name, avatar_url) ),
        against:users!against_user_id ( id, email, user_profiles(full_name) )
      `, { count: 'exact' })
            .in('status', ['open', 'under_review'])
            .order('raised_at', { ascending: true })
            .range(from, from + limit - 1);
        if (error)
            throw new Error(`Failed to fetch disputes: ${error.message}`);
        return { disputes: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async resolveDispute(disputeId, staffId, resolution) {
        const { resolution: action, refund_amount_kes, notes } = resolution;
        // Update dispute status
        const { error: disputeError } = await supabaseAdmin
            .from('short_stay_disputes')
            .update({
            status: action === 'dismiss' ? 'resolved_host' : 'resolved_guest',
            resolved_by: staffId,
            resolution_notes: notes,
            refund_amount_kes: refund_amount_kes ?? null,
            resolved_at: new Date().toISOString(),
        })
            .eq('id', disputeId);
        if (disputeError)
            throw new Error(`Failed to resolve dispute: ${disputeError.message}`);
        // If refund is needed, update booking status and create refund record
        if (refund_amount_kes && refund_amount_kes > 0) {
            const { data: dispute } = await supabaseAdmin
                .from('short_stay_disputes')
                .select('booking_id')
                .eq('id', disputeId)
                .single();
            if (dispute) {
                // Update booking status
                await supabaseAdmin
                    .from('short_stay_bookings')
                    .update({ status: 'disputed' })
                    .eq('id', dispute.booking_id);
                // Create refund record in booking_payments
                await supabaseAdmin
                    .from('booking_payments')
                    .insert({
                    booking_id: dispute.booking_id,
                    role: 'refund_guest',
                    amount_kes: refund_amount_kes,
                    status: 'pending',
                    payment_method: 'mpesa',
                    initiated_at: new Date().toISOString(),
                });
            }
        }
        logger.info({ disputeId, staffId, action, refund_amount_kes }, 'staff.dispute.resolved');
        return { success: true };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 4: REVIEW MODERATION
    // ═══════════════════════════════════════════════════════════════════════════
    async getFraudReviewQueue(page, limit) {
        const from = (page - 1) * limit;
        const { data, count, error } = await supabaseAdmin
            .from('unified_reviews')
            .select(`
        id, review_type, rating_overall, review_text, status,
        submitted_at, submitted_ip, account_age_days_at_submission,
        reviewer_total_reviews_at_submission,
        property:properties!property_id ( id, title, listing_category ),
        reviewer:users!reviewer_id ( id, email, user_profiles(full_name, avatar_url) ),
        reviewee:users!reviewee_id ( id, email, user_profiles(full_name) ),
        review_fraud_signals ( id, signal, confidence, detail )
      `, { count: 'exact' })
            .eq('status', 'held_for_moderation')
            .order('submitted_at', { ascending: true })
            .range(from, from + limit - 1);
        if (error)
            throw new Error(`Failed to fetch fraud queue: ${error.message}`);
        return { reviews: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async approveReview(reviewId, staffId) {
        const { error } = await supabaseAdmin
            .from('unified_reviews')
            .update({
            status: 'published',
            published_at: new Date().toISOString(),
            moderated_by: staffId,
            moderation_notes: 'Approved by staff',
        })
            .eq('id', reviewId);
        if (error)
            throw new Error(`Failed to approve review: ${error.message}`);
        logger.info({ reviewId, staffId }, 'staff.review.approved');
        return { success: true };
    }
    async rejectReview(reviewId, staffId, reason) {
        const { error } = await supabaseAdmin
            .from('unified_reviews')
            .update({
            status: 'rejected',
            moderated_by: staffId,
            moderation_notes: reason,
        })
            .eq('id', reviewId);
        if (error)
            throw new Error(`Failed to reject review: ${error.message}`);
        logger.info({ reviewId, staffId, reason }, 'staff.review.rejected');
        return { success: true };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 5: MESSAGE MODERATION
    // ═══════════════════════════════════════════════════════════════════════════
    async getReportedMessages(page, limit) {
        const from = (page - 1) * limit;
        const { data, count, error } = await supabaseAdmin
            .from('message_reports')
            .select(`
        id, reason, created_at, reviewed,
        messages (
          id, body, media_url, type, created_at,
          sender_id,
          sender:users!sender_id ( id, email, user_profiles(full_name, avatar_url) ),
          conversations ( id, property_id, participant_a, participant_b )
        ),
        reporter:users!reported_by ( id, email, user_profiles(full_name, avatar_url) )
      `, { count: 'exact' })
            .eq('reviewed', false)
            .order('created_at', { ascending: true })
            .range(from, from + limit - 1);
        if (error)
            throw new Error(`Failed to fetch reported messages: ${error.message}`);
        return { reports: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async resolveMessageReport(reportId, staffId) {
        const { error } = await supabaseAdmin
            .from('message_reports')
            .update({ reviewed: true, reviewed_by: staffId, reviewed_at: new Date().toISOString() })
            .eq('id', reportId);
        if (error)
            throw new Error(`Failed to resolve report: ${error.message}`);
        logger.info({ reportId, staffId }, 'staff.message_report.resolved');
        return { success: true };
    }
    async deleteMessage(messageId, staffId) {
        const { error } = await supabaseAdmin
            .from('messages')
            .update({ is_deleted: true, deleted_at: new Date().toISOString() })
            .eq('id', messageId);
        if (error)
            throw new Error(`Failed to delete message: ${error.message}`);
        logger.info({ messageId, staffId }, 'staff.message.deleted');
        return { success: true };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 6: PROPERTY MODERATION
    // ═══════════════════════════════════════════════════════════════════════════
    async getPropertiesPendingReview(page, limit) {
        const from = (page - 1) * limit;
        // Properties that are off_market (flagged) or missing required documents
        const { data, count, error } = await supabaseAdmin
            .from('properties')
            .select(`
        id, title, listing_category, listing_type, status, created_at,
        created_by,
        creator:users!created_by ( id, email, user_profiles(full_name) ),
        property_locations ( county, area, estate_name ),
        property_pricing ( monthly_rent, asking_price ),
        property_media ( id, is_cover, url ),
        legal_documents ( id, doc_type, verified_at )
      `, { count: 'exact' })
            .eq('status', 'off_market')
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .range(from, from + limit - 1);
        if (error)
            throw new Error(`Failed to fetch pending properties: ${error.message}`);
        // Enhance with verification status
        const enhanced = (data ?? []).map(prop => ({
            ...prop,
            has_cover_photo: (prop.property_media ?? []).some(m => m.is_cover),
            has_legal_docs: (prop.legal_documents ?? []).length > 0,
            has_pricing: !!(prop.property_pricing?.[0]?.monthly_rent ||
                prop.property_pricing?.[0]?.asking_price),
        }));
        return { properties: enhanced, total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async approveProperty(propertyId, staffId) {
        const { error } = await supabaseAdmin
            .from('properties')
            .update({
            status: 'available',
            published_at: new Date().toISOString(),
        })
            .eq('id', propertyId);
        if (error)
            throw new Error(`Failed to approve property: ${error.message}`);
        logger.info({ propertyId, staffId }, 'staff.property.approved');
        return { success: true };
    }
    async rejectProperty(propertyId, staffId, reason) {
        // Add rejection note (you may want a separate table for moderation notes)
        const { error } = await supabaseAdmin
            .from('properties')
            .update({
            status: 'off_market',
            // Store rejection reason in a metadata field or create a moderation_notes column
        })
            .eq('id', propertyId);
        if (error)
            throw new Error(`Failed to reject property: ${error.message}`);
        logger.info({ propertyId, staffId, reason }, 'staff.property.rejected');
        return { success: true };
    }
    async flagProperty(propertyId, staffId, reason) {
        const { error } = await supabaseAdmin
            .from('properties')
            .update({
            status: 'off_market',
        })
            .eq('id', propertyId);
        if (error)
            throw new Error(`Failed to flag property: ${error.message}`);
        logger.info({ propertyId, staffId, reason }, 'staff.property.flagged');
        return { success: true };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 7: USER MODERATION
    // ═══════════════════════════════════════════════════════════════════════════
    async getUsers(page, limit, filters) {
        const from = (page - 1) * limit;
        let q = supabaseAdmin
            .from('users')
            .select(`
        id, email, phone_number, account_status, auth_provider,
        email_verified, phone_verified, created_at, last_login_at,
        user_profiles ( full_name, display_name, avatar_url, county ),
        user_roles ( is_active, verified_at, roles(name, display_name) )
      `, { count: 'exact' })
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .range(from, from + limit - 1);
        if (filters.status)
            q = q.eq('account_status', filters.status);
        if (filters.search) {
            q = q.or(`email.ilike.%${filters.search}%,phone_number.ilike.%${filters.search}%`);
        }
        const { data, count, error } = await q;
        if (error)
            throw new Error(`Failed to fetch users: ${error.message}`);
        return { users: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async getUserById(userId) {
        const { data, error } = await supabaseAdmin
            .from('users')
            .select(`
        id, email, phone_number, account_status, auth_provider,
        email_verified, phone_verified, created_at, last_login_at,
        user_profiles ( full_name, display_name, avatar_url, county, whatsapp_number ),
        user_roles ( is_active, verified_at, assigned_at, roles(name, display_name) ),
        landlord_profiles ( id_type, id_verified, is_company, company_name, rating ),
        agent_profiles ( earb_license_no, license_verified, agency_name, rating, total_listings ),
        id_verifications ( doc_type, status, submitted_at, reviewed_at )
      `)
            .eq('id', userId)
            .is('deleted_at', null)
            .maybeSingle();
        if (error)
            throw new Error(`Failed to fetch user: ${error.message}`);
        if (!data)
            throw new Error('User not found');
        return data;
    }
    async suspendUser(userId, staffId, reason, days) {
        const lockedUntil = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
        const { error } = await supabaseAdmin
            .from('users')
            .update({
            account_status: 'suspended',
            locked_until: lockedUntil,
        })
            .eq('id', userId);
        if (error)
            throw new Error(`Failed to suspend user: ${error.message}`);
        // Log the action
        await supabaseAdmin
            .from('security_audit_log')
            .insert({
            user_id: userId,
            event_type: 'account_ban',
            performed_by: staffId,
            metadata: { reason, days, action: 'suspend' },
            created_at: new Date().toISOString(),
        });
        logger.info({ userId, staffId, reason, days }, 'staff.user.suspended');
        return { success: true };
    }
    async unsuspendUser(userId, staffId) {
        const { error } = await supabaseAdmin
            .from('users')
            .update({
            account_status: 'active',
            locked_until: null,
            failed_login_count: 0,
        })
            .eq('id', userId);
        if (error)
            throw new Error(`Failed to unsuspend user: ${error.message}`);
        await supabaseAdmin
            .from('security_audit_log')
            .insert({
            user_id: userId,
            event_type: 'account_ban',
            performed_by: staffId,
            metadata: { action: 'unsuspend' },
            created_at: new Date().toISOString(),
        });
        logger.info({ userId, staffId }, 'staff.user.unsuspended');
        return { success: true };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 8: READ-ONLY VIEWS
    // ═══════════════════════════════════════════════════════════════════════════
    async getProperties(page, limit, filters) {
        const from = (page - 1) * limit;
        let q = supabaseAdmin
            .from('properties')
            .select(`
        id, title, listing_category, listing_type, status,
        bedrooms, bathrooms, is_furnished, created_at,
        created_by,
        creator:users!created_by ( id, email, user_profiles(full_name) ),
        property_locations ( county, area, estate_name ),
        property_pricing ( monthly_rent, asking_price, currency ),
        property_media ( id, is_cover, url )
      `, { count: 'exact' })
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .range(from, from + limit - 1);
        if (filters.status)
            q = q.eq('status', filters.status);
        if (filters.category)
            q = q.eq('listing_category', filters.category);
        if (filters.search)
            q = q.ilike('title', `%${filters.search}%`);
        const { data, count, error } = await q;
        if (error)
            throw new Error(`Failed to fetch properties: ${error.message}`);
        return { properties: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async getPropertyById(propertyId) {
        const { data, error } = await supabaseAdmin
            .from('properties')
            .select(`
        *,
        property_locations ( * ),
        property_pricing ( * ),
        property_media ( * ),
        rooms ( * ),
        property_amenities ( * ),
        nearby_places ( * ),
        legal_documents ( * ),
        listing_search_scores ( * ),
        rental_units ( * ),
        short_term_config ( * ),
        commercial_config ( * ),
        plot_details ( * ),
        offplan_details ( * ),
        created_by_user:users!created_by ( id, email, user_profiles(full_name, phone_number) ),
        property_contacts ( * )
      `)
            .eq('id', propertyId)
            .is('deleted_at', null)
            .maybeSingle();
        if (error)
            throw new Error(`Failed to fetch property: ${error.message}`);
        if (!data)
            throw new Error('Property not found');
        return data;
    }
    async getShortStayBookings(page, limit, filters) {
        const from = (page - 1) * limit;
        let q = supabaseAdmin
            .from('short_stay_bookings')
            .select(`
        id, booking_ref, status, check_in_date, check_out_date, nights,
        guests_count, total_charged_kes, host_payout_kes, requested_at, confirmed_at,
        guest_name, guest_phone, cancellation_policy,
        properties ( id, title, property_locations(county, area) ),
        guest:users!guest_user_id ( id, email, user_profiles(full_name, phone_number) ),
        host:users!host_user_id ( id, email, user_profiles(full_name, phone_number) )
      `, { count: 'exact' })
            .order('requested_at', { ascending: false })
            .range(from, from + limit - 1);
        if (filters.status)
            q = q.eq('status', filters.status);
        if (filters.fromDate)
            q = q.gte('check_in_date', filters.fromDate);
        if (filters.toDate)
            q = q.lte('check_out_date', filters.toDate);
        const { data, count, error } = await q;
        if (error)
            throw new Error(`Failed to fetch bookings: ${error.message}`);
        return { bookings: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async getLongTermBookings(page, limit, filters) {
        const from = (page - 1) * limit;
        let q = supabaseAdmin
            .from('long_term_bookings')
            .select(`
        id, booking_ref, status, desired_move_in, agreed_monthly_rent_kes,
        agreed_deposit_kes, lease_start_date, lease_end_date,
        deposit_paid_at, created_at, cover_letter,
        properties ( id, title, property_locations(county, area) ),
        tenant:users!tenant_user_id ( id, email, user_profiles(full_name, phone_number) ),
        landlord:users!landlord_user_id ( id, email, user_profiles(full_name, phone_number) )
      `, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, from + limit - 1);
        if (filters.status)
            q = q.eq('status', filters.status);
        const { data, count, error } = await q;
        if (error)
            throw new Error(`Failed to fetch long-term bookings: ${error.message}`);
        return { bookings: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async getReviews(page, limit, filters) {
        const from = (page - 1) * limit;
        let q = supabaseAdmin
            .from('unified_reviews')
            .select(`
        id, review_type, rating_overall, rating_cleanliness, rating_communication,
        rating_accuracy, rating_value, rating_location, review_text, status,
        submitted_at, published_at,
        property:properties!property_id ( id, title ),
        reviewer:users!reviewer_id ( id, email, user_profiles(full_name, avatar_url) ),
        reviewee:users!reviewee_id ( id, email, user_profiles(full_name) )
      `, { count: 'exact' })
            .order('submitted_at', { ascending: false })
            .range(from, from + limit - 1);
        if (filters.propertyId)
            q = q.eq('property_id', filters.propertyId);
        if (filters.userId)
            q = q.eq('reviewer_id', filters.userId);
        if (filters.status)
            q = q.eq('status', filters.status);
        const { data, count, error } = await q;
        if (error)
            throw new Error(`Failed to fetch reviews: ${error.message}`);
        return { reviews: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async getAuditLog(page, limit, filters) {
        const from = (page - 1) * limit;
        let q = supabaseAdmin
            .from('security_audit_log')
            .select(`
        id, event_type, ip_address, user_agent, metadata, created_at,
        actor:users!user_id ( id, email ),
        performer:users!performed_by ( id, email )
      `, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, from + limit - 1);
        if (filters.eventType)
            q = q.eq('event_type', filters.eventType);
        if (filters.userId)
            q = q.eq('user_id', filters.userId);
        if (filters.fromDate)
            q = q.gte('created_at', filters.fromDate);
        if (filters.toDate)
            q = q.lte('created_at', filters.toDate);
        const { data, count, error } = await q;
        if (error)
            throw new Error(`Failed to fetch audit log: ${error.message}`);
        return { events: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
}
export const staffService = new StaffService();
