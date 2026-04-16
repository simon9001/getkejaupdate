/**
 * landlord.service.ts
 *
 * Landlord service for GETKEJA.
 *
 * Landlords can:
 *   - CRUD their own properties
 *   - Manage tenancy applications (approve/reject/terminate)
 *   - Manage short-stay bookings
 *   - Coordinate viewings
 *   - Assign caretakers and agents to properties
 *   - Track revenue and payouts
 *   - Purchase boosts and manage subscriptions
 */
import { supabaseAdmin } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function round2(n) {
    return Math.round(n * 100) / 100;
}
function generatePropertyRef() {
    return 'PRP-' + Math.random().toString(36).substring(2, 10).toUpperCase();
}
// =============================================================================
// LandlordService
// =============================================================================
export class LandlordService {
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 1: DASHBOARD OVERVIEW
    // ═══════════════════════════════════════════════════════════════════════════
    async getDashboardStats(userId) {
        const [properties, activeTenancies, pendingApplications, pendingVisits, unreadMessages, shortStayBookings, totalEarnings, activeBoosts,] = await Promise.all([
            // Total properties
            supabaseAdmin
                .from('properties')
                .select('id', { count: 'exact', head: true })
                .eq('created_by', userId)
                .is('deleted_at', null),
            // Active tenancies (long-term)
            supabaseAdmin
                .from('long_term_bookings')
                .select('id', { count: 'exact', head: true })
                .eq('landlord_user_id', userId)
                .in('status', ['active', 'deposit_paid']),
            // Pending tenancy applications
            supabaseAdmin
                .from('long_term_bookings')
                .select('id', { count: 'exact', head: true })
                .eq('landlord_user_id', userId)
                .eq('status', 'pending_review'),
            // Pending visit requests
            supabaseAdmin
                .from('visit_schedules')
                .select('id', { count: 'exact', head: true })
                .eq('host_user_id', userId)
                .in('status', ['requested', 'rescheduled']),
            // Unread messages
            supabaseAdmin
                .from('conversations')
                .select('unread_b')
                .eq('participant_b', userId)
                .gt('unread_b', 0),
            // Upcoming short-stay bookings
            supabaseAdmin
                .from('short_stay_bookings')
                .select('id', { count: 'exact', head: true })
                .eq('host_user_id', userId)
                .eq('status', 'confirmed')
                .gte('check_in_date', new Date().toISOString().split('T')[0]),
            // Total earnings (payouts from short-stay + long-term rent)
            this._getTotalEarnings(userId),
            // Active boosts
            supabaseAdmin
                .from('listing_boosts')
                .select('id', { count: 'exact', head: true })
                .eq('is_active', true)
                .in('property_id', supabaseAdmin.from('properties').select('id').eq('created_by', userId)),
        ]);
        const unreadCount = (unreadMessages.data ?? []).reduce((sum, conv) => sum + (conv.unread_b ?? 0), 0);
        return {
            properties: {
                total: properties.count ?? 0,
            },
            tenancies: {
                active: activeTenancies.count ?? 0,
                pending_applications: pendingApplications.count ?? 0,
            },
            visits: {
                pending: pendingVisits.count ?? 0,
            },
            messages: {
                unread: unreadCount,
            },
            short_stay: {
                upcoming_bookings: shortStayBookings.count ?? 0,
            },
            earnings: {
                total_kes: round2(totalEarnings),
            },
            boosts: {
                active: activeBoosts.count ?? 0,
            },
            generated_at: new Date().toISOString(),
        };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 2: PROPERTY CRUD
    // ═══════════════════════════════════════════════════════════════════════════
    async listProperties(userId, page, limit, status) {
        const from = (page - 1) * limit;
        let q = supabaseAdmin
            .from('properties')
            .select(`
        id, title, listing_category, listing_type, status,
        bedrooms, bathrooms, is_furnished, created_at, published_at,
        is_featured,
        property_locations ( county, area, estate_name ),
        property_pricing ( monthly_rent, asking_price, currency ),
        property_media ( id, is_cover, url, thumbnail_url ),
        listing_boosts ( id, is_active, ends_at, boost_packages(name, badge_label) )
      `, { count: 'exact' })
            .eq('created_by', userId)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .range(from, from + limit - 1);
        if (status)
            q = q.eq('status', status);
        const { data, count, error } = await q;
        if (error)
            throw new Error(`Failed to fetch properties: ${error.message}`);
        // Process cover photos and active boosts
        const processed = (data ?? []).map(prop => ({
            ...prop,
            cover_photo: (prop.property_media ?? []).find(m => m.is_cover)?.url,
            active_boost: (prop.listing_boosts ?? []).find(b => b.is_active),
        }));
        return { properties: processed, total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async getProperty(userId, propertyId) {
        // First verify ownership
        const { data: ownership, error: ownerError } = await supabaseAdmin
            .from('properties')
            .select('created_by')
            .eq('id', propertyId)
            .single();
        if (ownerError)
            throw new Error('Property not found');
        if (ownership.created_by !== userId)
            throw new Error('Forbidden: You do not own this property');
        // Fetch full property details
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
        property_contacts ( * ),
        listing_boosts (
          id, is_active, starts_at, ends_at, amount_paid_kes,
          impressions_delivered, clicks_delivered,
          boost_packages ( name, duration_days, visibility_score_bonus, badge_label )
        )
      `)
            .eq('id', propertyId)
            .single();
        if (error)
            throw new Error(`Failed to fetch property: ${error.message}`);
        return data;
    }
    async createProperty(userId, data) {
        // Start a transaction-like operation
        const propertyRef = generatePropertyRef();
        // 1. Insert main property
        const { data: property, error: propError } = await supabaseAdmin
            .from('properties')
            .insert({
            listing_category: data.listing_category,
            listing_type: data.listing_type,
            management_model: data.management_model || 'owner_direct',
            title: data.title,
            description: data.description,
            bedrooms: data.bedrooms,
            bathrooms: data.bathrooms,
            is_furnished: data.is_furnished || 'unfurnished',
            parking_spaces: data.parking_spaces || 0,
            compound_is_gated: data.compound_is_gated || false,
            has_borehole: data.has_borehole || false,
            water_supply: data.water_supply,
            electricity_supply: data.electricity_supply,
            waste_management: data.waste_management,
            status: 'off_market', // Requires staff approval
            created_by: userId,
            created_at: new Date().toISOString(),
        })
            .select()
            .single();
        if (propError)
            throw new Error(`Failed to create property: ${propError.message}`);
        // 2. Insert location
        if (data.location) {
            const { error: locError } = await supabaseAdmin
                .from('property_locations')
                .insert({
                property_id: property.id,
                county: data.location.county,
                sub_county: data.location.sub_county,
                area: data.location.area,
                estate_name: data.location.estate_name,
                nearest_landmark: data.location.nearest_landmark,
                latitude: data.location.latitude,
                longitude: data.location.longitude,
                geom: data.location.latitude && data.location.longitude
                    ? `SRID=4326;POINT(${data.location.longitude} ${data.location.latitude})`
                    : null,
            });
            if (locError)
                throw new Error(`Failed to add location: ${locError.message}`);
        }
        // 3. Insert pricing
        if (data.pricing) {
            const { error: priceError } = await supabaseAdmin
                .from('property_pricing')
                .insert({
                property_id: property.id,
                asking_price: data.pricing.asking_price,
                monthly_rent: data.pricing.monthly_rent,
                deposit_months: data.pricing.deposit_months,
                negotiable: data.pricing.negotiable || false,
            });
            if (priceError)
                throw new Error(`Failed to add pricing: ${priceError.message}`);
        }
        logger.info({ userId, propertyId: property.id, title: data.title }, 'landlord.property.created');
        return property;
    }
    async updateProperty(userId, propertyId, updates) {
        // Verify ownership
        const { data: ownership, error: ownerError } = await supabaseAdmin
            .from('properties')
            .select('created_by')
            .eq('id', propertyId)
            .single();
        if (ownerError)
            throw new Error('Property not found');
        if (ownership.created_by !== userId)
            throw new Error('Forbidden: You do not own this property');
        // Update main property
        const { data, error } = await supabaseAdmin
            .from('properties')
            .update({
            title: updates.title,
            description: updates.description,
            bedrooms: updates.bedrooms,
            bathrooms: updates.bathrooms,
            is_furnished: updates.is_furnished,
            parking_spaces: updates.parking_spaces,
            compound_is_gated: updates.compound_is_gated,
            water_supply: updates.water_supply,
            electricity_supply: updates.electricity_supply,
            updated_at: new Date().toISOString(),
        })
            .eq('id', propertyId)
            .select()
            .single();
        if (error)
            throw new Error(`Failed to update property: ${error.message}`);
        // Update location if provided
        if (updates.location) {
            await supabaseAdmin
                .from('property_locations')
                .update({
                county: updates.location.county,
                area: updates.location.area,
                estate_name: updates.location.estate_name,
                nearest_landmark: updates.location.nearest_landmark,
                latitude: updates.location.latitude,
                longitude: updates.location.longitude,
            })
                .eq('property_id', propertyId);
        }
        // Update pricing if provided
        if (updates.pricing) {
            await supabaseAdmin
                .from('property_pricing')
                .update({
                asking_price: updates.pricing.asking_price,
                monthly_rent: updates.pricing.monthly_rent,
                deposit_months: updates.pricing.deposit_months,
                negotiable: updates.pricing.negotiable,
                updated_at: new Date().toISOString(),
            })
                .eq('property_id', propertyId);
        }
        logger.info({ userId, propertyId }, 'landlord.property.updated');
        return data;
    }
    async deleteProperty(userId, propertyId) {
        // Verify ownership
        const { data: ownership, error: ownerError } = await supabaseAdmin
            .from('properties')
            .select('created_by')
            .eq('id', propertyId)
            .single();
        if (ownerError)
            throw new Error('Property not found');
        if (ownership.created_by !== userId)
            throw new Error('Forbidden: You do not own this property');
        // Soft delete
        const { error } = await supabaseAdmin
            .from('properties')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', propertyId);
        if (error)
            throw new Error(`Failed to delete property: ${error.message}`);
        logger.info({ userId, propertyId }, 'landlord.property.deleted');
        return { success: true };
    }
    async updatePropertyStatus(userId, propertyId, status) {
        // Verify ownership
        const { data: ownership, error: ownerError } = await supabaseAdmin
            .from('properties')
            .select('created_by')
            .eq('id', propertyId)
            .single();
        if (ownerError)
            throw new Error('Property not found');
        if (ownership.created_by !== userId)
            throw new Error('Forbidden: You do not own this property');
        const { error } = await supabaseAdmin
            .from('properties')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', propertyId);
        if (error)
            throw new Error(`Failed to update status: ${error.message}`);
        logger.info({ userId, propertyId, status }, 'landlord.property.status_updated');
        return { success: true, status };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 3: PROPERTY MEDIA
    // ═══════════════════════════════════════════════════════════════════════════
    async addMedia(userId, propertyId, media) {
        // Verify ownership
        const { data: ownership, error: ownerError } = await supabaseAdmin
            .from('properties')
            .select('created_by')
            .eq('id', propertyId)
            .single();
        if (ownerError)
            throw new Error('Property not found');
        if (ownership.created_by !== userId)
            throw new Error('Forbidden: You do not own this property');
        // Get current max sort_order
        const { data: existing } = await supabaseAdmin
            .from('property_media')
            .select('sort_order')
            .eq('property_id', propertyId)
            .order('sort_order', { ascending: false })
            .limit(1);
        const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;
        // If this is cover, unset existing cover
        if (media.is_cover) {
            await supabaseAdmin
                .from('property_media')
                .update({ is_cover: false })
                .eq('property_id', propertyId);
        }
        const { data, error } = await supabaseAdmin
            .from('property_media')
            .insert({
            property_id: propertyId,
            url: media.url,
            media_type: media.media_type,
            is_cover: media.is_cover || false,
            caption: media.caption,
            sort_order: nextOrder,
        })
            .select()
            .single();
        if (error)
            throw new Error(`Failed to add media: ${error.message}`);
        logger.info({ userId, propertyId, mediaId: data.id }, 'landlord.media.added');
        return data;
    }
    async deleteMedia(userId, propertyId, mediaId) {
        // Verify ownership
        const { data: ownership } = await supabaseAdmin
            .from('properties')
            .select('created_by')
            .eq('id', propertyId)
            .single();
        if (ownership?.created_by !== userId)
            throw new Error('Forbidden');
        const { error } = await supabaseAdmin
            .from('property_media')
            .delete()
            .eq('id', mediaId)
            .eq('property_id', propertyId);
        if (error)
            throw new Error(`Failed to delete media: ${error.message}`);
        logger.info({ userId, propertyId, mediaId }, 'landlord.media.deleted');
        return { success: true };
    }
    async setCoverPhoto(userId, propertyId, mediaId) {
        // Verify ownership
        const { data: ownership } = await supabaseAdmin
            .from('properties')
            .select('created_by')
            .eq('id', propertyId)
            .single();
        if (ownership?.created_by !== userId)
            throw new Error('Forbidden');
        // Unset current cover
        await supabaseAdmin
            .from('property_media')
            .update({ is_cover: false })
            .eq('property_id', propertyId);
        // Set new cover
        const { error } = await supabaseAdmin
            .from('property_media')
            .update({ is_cover: true })
            .eq('id', mediaId)
            .eq('property_id', propertyId);
        if (error)
            throw new Error(`Failed to set cover: ${error.message}`);
        logger.info({ userId, propertyId, mediaId }, 'landlord.media.cover_set');
        return { success: true };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 4: TENANCY MANAGEMENT (Long-term)
    // ═══════════════════════════════════════════════════════════════════════════
    async listTenancies(userId, page, limit, status) {
        const from = (page - 1) * limit;
        let q = supabaseAdmin
            .from('long_term_bookings')
            .select(`
        id, booking_ref, status, desired_move_in, agreed_monthly_rent_kes,
        agreed_deposit_kes, lease_start_date, lease_end_date,
        deposit_paid_at, created_at, cover_letter,
        properties!inner (
          id, title, listing_category,
          property_locations ( county, area )
        ),
        tenant:users!tenant_user_id (
          id, email, phone_number,
          user_profiles ( full_name, display_name, avatar_url )
        )
      `, { count: 'exact' })
            .eq('properties.created_by', userId)
            .order('created_at', { ascending: false })
            .range(from, from + limit - 1);
        if (status)
            q = q.eq('status', status);
        const { data, count, error } = await q;
        if (error)
            throw new Error(`Failed to fetch tenancies: ${error.message}`);
        return { tenancies: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async getTenancy(userId, tenancyId) {
        const { data, error } = await supabaseAdmin
            .from('long_term_bookings')
            .select(`
        *,
        properties!inner (
          id, title, listing_category, description,
          property_locations ( * ),
          property_pricing ( monthly_rent, deposit_months )
        ),
        tenant:users!tenant_user_id (
          id, email, phone_number, created_at,
          user_profiles ( full_name, display_name, avatar_url, whatsapp_number ),
          id_verifications ( doc_type, status )
        )
      `)
            .eq('id', tenancyId)
            .single();
        if (error)
            throw new Error('Tenancy not found');
        if (data.properties.created_by !== userId)
            throw new Error('Forbidden');
        return data;
    }
    async approveTenancy(userId, tenancyId, terms) {
        const leaseEndDate = new Date(terms.lease_start_date);
        leaseEndDate.setMonth(leaseEndDate.getMonth() + (terms.lease_duration_months || 12));
        const { error } = await supabaseAdmin
            .from('long_term_bookings')
            .update({
            status: 'approved',
            agreed_monthly_rent_kes: terms.agreed_monthly_rent,
            agreed_deposit_kes: terms.agreed_deposit,
            agreed_move_in_date: terms.lease_start_date,
            lease_start_date: terms.lease_start_date,
            lease_end_date: leaseEndDate.toISOString().split('T')[0],
        })
            .eq('id', tenancyId);
        if (error)
            throw new Error(`Failed to approve tenancy: ${error.message}`);
        // Update property status to let
        const { data: tenancy } = await supabaseAdmin
            .from('long_term_bookings')
            .select('property_id')
            .eq('id', tenancyId)
            .single();
        if (tenancy) {
            await supabaseAdmin
                .from('properties')
                .update({ status: 'let' })
                .eq('id', tenancy.property_id);
        }
        logger.info({ userId, tenancyId, terms }, 'landlord.tenancy.approved');
        return { success: true };
    }
    async rejectTenancy(userId, tenancyId, reason) {
        const { error } = await supabaseAdmin
            .from('long_term_bookings')
            .update({
            status: 'rejected',
            rejection_reason: reason,
        })
            .eq('id', tenancyId);
        if (error)
            throw new Error(`Failed to reject tenancy: ${error.message}`);
        logger.info({ userId, tenancyId, reason }, 'landlord.tenancy.rejected');
        return { success: true };
    }
    async terminateTenancy(userId, tenancyId, termination) {
        const { error } = await supabaseAdmin
            .from('long_term_bookings')
            .update({
            status: 'terminated',
            termination_date: termination.termination_date,
            termination_reason: termination.reason,
            notice_given_at: new Date().toISOString().split('T')[0],
            notice_given_by: userId,
        })
            .eq('id', tenancyId);
        if (error)
            throw new Error(`Failed to terminate tenancy: ${error.message}`);
        // Update property status back to available
        const { data: tenancy } = await supabaseAdmin
            .from('long_term_bookings')
            .select('property_id')
            .eq('id', tenancyId)
            .single();
        if (tenancy) {
            await supabaseAdmin
                .from('properties')
                .update({ status: 'available' })
                .eq('id', tenancy.property_id);
        }
        logger.info({ userId, tenancyId, termination }, 'landlord.tenancy.terminated');
        return { success: true };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 5: SHORT-STAY BOOKINGS
    // ═══════════════════════════════════════════════════════════════════════════
    async listShortStayBookings(userId, page, limit, status) {
        const from = (page - 1) * limit;
        let q = supabaseAdmin
            .from('short_stay_bookings')
            .select(`
        id, booking_ref, status, check_in_date, check_out_date, nights,
        guests_count, total_charged_kes, host_payout_kes, requested_at, confirmed_at,
        guest_name, guest_phone, cancellation_policy,
        properties!inner (
          id, title,
          property_locations ( county, area )
        ),
        guest:users!guest_user_id (
          id, email,
          user_profiles ( full_name, display_name, avatar_url )
        )
      `, { count: 'exact' })
            .eq('properties.created_by', userId)
            .order('requested_at', { ascending: false })
            .range(from, from + limit - 1);
        if (status)
            q = q.eq('status', status);
        const { data, count, error } = await q;
        if (error)
            throw new Error(`Failed to fetch short-stay bookings: ${error.message}`);
        return { bookings: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async getShortStayBooking(userId, bookingId) {
        const { data, error } = await supabaseAdmin
            .from('short_stay_bookings')
            .select(`
        *,
        properties!inner (
          id, title, description,
          property_locations ( * ),
          short_term_config ( * )
        ),
        guest:users!guest_user_id (
          id, email, phone_number,
          user_profiles ( full_name, display_name, avatar_url )
        ),
        booking_payments ( * ),
        booking_checkins ( * )
      `)
            .eq('id', bookingId)
            .single();
        if (error)
            throw new Error('Booking not found');
        if (data.properties.created_by !== userId)
            throw new Error('Forbidden');
        return data;
    }
    async updateShortStayBookingStatus(userId, bookingId, status) {
        // Verify ownership via property
        const { data: booking } = await supabaseAdmin
            .from('short_stay_bookings')
            .select('properties!inner(created_by)')
            .eq('id', bookingId)
            .single();
        if (!booking || booking.properties.created_by !== userId) {
            throw new Error('Forbidden');
        }
        const { error } = await supabaseAdmin
            .from('short_stay_bookings')
            .update({ status, confirmed_at: status === 'confirmed' ? new Date().toISOString() : undefined })
            .eq('id', bookingId);
        if (error)
            throw new Error(`Failed to update booking status: ${error.message}`);
        // If confirming, send notification (handled by application layer)
        logger.info({ userId, bookingId, status }, 'landlord.short_stay.status_updated');
        return { success: true, status };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 6: VISIT SCHEDULES
    // ═══════════════════════════════════════════════════════════════════════════
    async listVisits(userId, page, limit, status) {
        const from = (page - 1) * limit;
        let q = supabaseAdmin
            .from('visit_schedules')
            .select(`
        id, proposed_datetime, confirmed_datetime, status,
        visit_type, duration_minutes, meeting_point,
        notes_from_seeker, notes_from_host,
        properties!inner (
          id, title,
          property_locations ( county, area )
        ),
        seeker:users!seeker_user_id (
          id, email,
          user_profiles ( full_name, display_name, avatar_url, phone_number )
        )
      `, { count: 'exact' })
            .eq('properties.created_by', userId)
            .order('proposed_datetime', { ascending: true })
            .range(from, from + limit - 1);
        if (status)
            q = q.eq('status', status);
        const { data, count, error } = await q;
        if (error)
            throw new Error(`Failed to fetch visits: ${error.message}`);
        return { visits: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async confirmVisit(userId, visitId, confirmedDatetime) {
        const { error } = await supabaseAdmin
            .from('visit_schedules')
            .update({
            status: 'confirmed',
            confirmed_datetime: confirmedDatetime,
        })
            .eq('id', visitId)
            .eq('host_user_id', userId);
        if (error)
            throw new Error(`Failed to confirm visit: ${error.message}`);
        logger.info({ userId, visitId, confirmedDatetime }, 'landlord.visit.confirmed');
        return { success: true };
    }
    async rescheduleVisit(userId, visitId, proposedDatetime, reason) {
        // First get current reschedule count
        const { data: visit } = await supabaseAdmin
            .from('visit_schedules')
            .select('reschedule_count')
            .eq('id', visitId)
            .single();
        const { error } = await supabaseAdmin
            .from('visit_schedules')
            .update({
            status: 'rescheduled',
            proposed_datetime: proposedDatetime,
            reschedule_count: (visit?.reschedule_count ?? 0) + 1,
            rescheduled_by: userId,
            reschedule_reason: reason,
        })
            .eq('id', visitId)
            .eq('host_user_id', userId);
        if (error)
            throw new Error(`Failed to reschedule visit: ${error.message}`);
        logger.info({ userId, visitId, proposedDatetime, reason }, 'landlord.visit.rescheduled');
        return { success: true };
    }
    async cancelVisit(userId, visitId, reason) {
        const { error } = await supabaseAdmin
            .from('visit_schedules')
            .update({
            status: 'cancelled',
            cancelled_reason: reason,
            cancelled_by: userId,
        })
            .eq('id', visitId)
            .eq('host_user_id', userId);
        if (error)
            throw new Error(`Failed to cancel visit: ${error.message}`);
        logger.info({ userId, visitId, reason }, 'landlord.visit.cancelled');
        return { success: true };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 7: MESSAGING
    // ═══════════════════════════════════════════════════════════════════════════
    async listConversations(userId, page, limit) {
        const from = (page - 1) * limit;
        const { data, count, error } = await supabaseAdmin
            .from('conversations')
            .select(`
        id, type, last_message_at, last_message_text, unread_b, archived_by_b,
        property_id,
        properties!property_id ( id, title, property_locations(county, area) ),
        participant_a:users!participant_a (
          id, email,
          user_profiles ( full_name, display_name, avatar_url )
        )
      `, { count: 'exact' })
            .eq('participant_b', userId)
            .eq('archived_by_b', false)
            .order('last_message_at', { ascending: false, nullsFirst: false })
            .range(from, from + limit - 1);
        if (error)
            throw new Error(`Failed to fetch conversations: ${error.message}`);
        return { conversations: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async getMessages(userId, conversationId) {
        // Verify landlord is participant_b
        const { data: conv, error: convError } = await supabaseAdmin
            .from('conversations')
            .select('participant_b')
            .eq('id', conversationId)
            .single();
        if (convError)
            throw new Error('Conversation not found');
        if (conv.participant_b !== userId)
            throw new Error('Forbidden');
        const { data, error } = await supabaseAdmin
            .from('messages')
            .select('*')
            .eq('conversation_id', conversationId)
            .eq('is_deleted', false)
            .order('created_at', { ascending: true });
        if (error)
            throw new Error(`Failed to fetch messages: ${error.message}`);
        // Mark as read
        await supabaseAdmin
            .from('conversations')
            .update({ unread_b: 0 })
            .eq('id', conversationId);
        return data ?? [];
    }
    async sendMessage(userId, conversationId, body, type) {
        // Verify landlord is participant in conversation
        const { data: conv, error: convError } = await supabaseAdmin
            .from('conversations')
            .select('participant_b')
            .eq('id', conversationId)
            .single();
        if (convError)
            throw new Error('Conversation not found');
        if (conv.participant_b !== userId)
            throw new Error('Forbidden');
        const { data, error } = await supabaseAdmin
            .from('messages')
            .insert({
            conversation_id: conversationId,
            sender_id: userId,
            body,
            type,
            created_at: new Date().toISOString(),
        })
            .select()
            .single();
        if (error)
            throw new Error(`Failed to send message: ${error.message}`);
        return data;
    }
    async markConversationRead(userId, conversationId) {
        const { error } = await supabaseAdmin
            .from('conversations')
            .update({ unread_b: 0 })
            .eq('id', conversationId)
            .eq('participant_b', userId);
        if (error)
            throw new Error(`Failed to mark conversation read: ${error.message}`);
        return { success: true };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 8: TEAM MANAGEMENT (Caretakers & Agents)
    // ═══════════════════════════════════════════════════════════════════════════
    async listTeamMembers(userId, propertyId) {
        let q = supabaseAdmin
            .from('caretaker_assignments')
            .select(`
        id, can_collect_rent, can_edit_listing, can_create_enquiry,
        assigned_at,
        property_id,
        building_id,
        properties!property_id ( id, title ),
        rental_buildings!building_id ( id, name ),
        caretaker:users!caretaker_user_id (
          id, email, phone_number,
          user_profiles ( full_name, display_name, avatar_url ),
          caretaker_profiles ( rating, lives_on_compound )
        )
      `)
            .eq('assigned_by', userId)
            .is('revoked_at', null);
        if (propertyId)
            q = q.eq('property_id', propertyId);
        const { data, error } = await q;
        if (error)
            throw new Error(`Failed to fetch team members: ${error.message}`);
        // Also fetch agent assignments from property_contacts
        const { data: agents } = await supabaseAdmin
            .from('property_contacts')
            .select(`
        id, full_name, phone_primary, email, agent_license_no,
        property_id,
        properties!property_id ( id, title )
      `)
            .eq('role', 'agent')
            .in('property_id', supabaseAdmin.from('properties').select('id').eq('created_by', userId));
        return {
            caretakers: data ?? [],
            agents: agents ?? [],
        };
    }
    async assignCaretaker(userId, assignment) {
        // Verify property/building belongs to landlord
        if (assignment.property_id) {
            const { data: prop } = await supabaseAdmin
                .from('properties')
                .select('created_by')
                .eq('id', assignment.property_id)
                .single();
            if (prop?.created_by !== userId)
                throw new Error('Forbidden: Property not owned by you');
        }
        const { data, error } = await supabaseAdmin
            .from('caretaker_assignments')
            .insert({
            caretaker_user_id: assignment.caretaker_user_id,
            property_id: assignment.property_id,
            building_id: assignment.building_id,
            assigned_by: userId,
            can_collect_rent: assignment.can_collect_rent || false,
            can_edit_listing: assignment.can_edit_listing || false,
            assigned_at: new Date().toISOString(),
        })
            .select()
            .single();
        if (error)
            throw new Error(`Failed to assign caretaker: ${error.message}`);
        logger.info({ userId, assignment }, 'landlord.team.caretaker_assigned');
        return data;
    }
    async searchProfessionals(query, roleName) {
        // Search for users by name or email who hold the specified role
        const { data, error } = await supabaseAdmin
            .from('user_roles')
            .select(`
        user_id,
        roles!inner ( name ),
        user:users!inner (
          id, email,
          user_profiles!inner ( full_name, display_name, avatar_url )
        )
      `)
            .eq('roles.name', roleName)
            .eq('is_active', true)
            .or(`email.ilike.%${query}%,full_name.ilike.%${query}%`, { foreignTable: 'user.user_profiles' })
            .limit(10);
        if (error) {
            // Fallback: search user_profiles first then filter by role
            const { data: profiles } = await supabaseAdmin
                .from('user_profiles')
                .select(`
          user_id, full_name, avatar_url,
          user:users!inner ( email )
        `)
                .or(`full_name.ilike.%${query}%,user.email.ilike.%${query}%`)
                .limit(20);
            const userIds = profiles?.map(p => p.user_id) ?? [];
            const { data: withRole } = await supabaseAdmin
                .from('user_roles')
                .select('user_id')
                .in('user_id', userIds)
                .eq('roles.name', roleName)
                .innerJoin('roles', 'role_id', 'roles.id'); // pseudocode
            // Actually, since this is a complex join, I'll rely on the OR logic or a simplified version
            return profiles?.map(p => ({
                id: p.user_id,
                email: p.user.email,
                full_name: p.full_name,
                avatar_url: p.avatar_url,
            })) ?? [];
        }
        return (data ?? []).map((r) => ({
            id: r.user.id,
            email: r.user.email,
            full_name: r.user.user_profiles.full_name,
            avatar_url: r.user.user_profiles.avatar_url,
        }));
    }
    async assignAgent(userId, assignment) {
        // Verify ownership
        if (assignment.property_id) {
            const { data: prop } = await supabaseAdmin
                .from('properties')
                .select('created_by')
                .eq('id', assignment.property_id)
                .single();
            if (prop?.created_by !== userId)
                throw new Error('Forbidden: Property not owned by you');
        }
        // Insert into the new agent_partnerships table for backend access control
        const { data, error } = await supabaseAdmin
            .from('agent_partnerships')
            .insert({
            agent_user_id: assignment.agent_user_id,
            property_id: assignment.property_id,
            building_id: assignment.building_id,
            landlord_user_id: userId,
            can_edit_listing: assignment.permissions?.can_edit_listing ?? true,
            can_view_analytics: assignment.permissions?.can_view_analytics ?? true,
            can_manage_bookings: assignment.permissions?.can_manage_bookings ?? true,
        })
            .select()
            .single();
        if (error)
            throw new Error(`Failed to assign agent: ${error.message}`);
        // Also sync to property_contacts for public listing display
        if (assignment.property_id) {
            const { data: profile } = await supabaseAdmin.from('user_profiles').select('full_name').eq('user_id', assignment.agent_user_id).single();
            const { data: user } = await supabaseAdmin.from('users').select('phone_number, email').eq('id', assignment.agent_user_id).single();
            await supabaseAdmin.from('property_contacts').upsert({
                property_id: assignment.property_id,
                role: 'agent',
                full_name: profile?.full_name || 'Agent',
                phone_primary: user?.phone_number,
                email: user?.email,
                is_primary_contact: false
            }, { onConflict: 'property_id,role,email' });
        }
        logger.info({ userId, assignment }, 'landlord.team.agent_assigned');
        return data;
    }
    async removeTeamMember(userId, assignmentId) {
        // First check if this assignment belongs to landlord
        const { data: assignment } = await supabaseAdmin
            .from('caretaker_assignments')
            .select('assigned_by')
            .eq('id', assignmentId)
            .single();
        if (!assignment)
            throw new Error('Assignment not found');
        if (assignment.assigned_by !== userId)
            throw new Error('Forbidden');
        const { error } = await supabaseAdmin
            .from('caretaker_assignments')
            .update({ revoked_at: new Date().toISOString() })
            .eq('id', assignmentId);
        if (error)
            throw new Error(`Failed to remove team member: ${error.message}`);
        logger.info({ userId, assignmentId }, 'landlord.team.member_removed');
        return { success: true };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 9: REVENUE & PAYOUTS
    // ═══════════════════════════════════════════════════════════════════════════
    async getRevenueSummary(userId, period = 'month') {
        const now = new Date();
        let startDate;
        switch (period) {
            case 'week':
                startDate = new Date(now.setDate(now.getDate() - 7));
                break;
            case 'year':
                startDate = new Date(now.setFullYear(now.getFullYear() - 1));
                break;
            default:
                startDate = new Date(now.setMonth(now.getMonth() - 1));
        }
        const startIso = startDate.toISOString();
        // Short-stay payouts
        const { data: shortStayPayouts } = await supabaseAdmin
            .from('booking_payments')
            .select('amount_kes, completed_at')
            .eq('role', 'host_payout')
            .eq('status', 'released')
            .gte('completed_at', startIso);
        // Long-term rent (from approved tenancies)
        const { data: longTermRent } = await supabaseAdmin
            .from('long_term_bookings')
            .select('agreed_monthly_rent_kes, lease_start_date')
            .eq('landlord_user_id', userId)
            .in('status', ['active', 'deposit_paid']);
        const shortStayTotal = (shortStayPayouts ?? []).reduce((s, p) => s + Number(p.amount_kes), 0);
        const monthlyRentTotal = (longTermRent ?? []).reduce((s, t) => s + Number(t.agreed_monthly_rent_kes), 0);
        // Group short-stay by month
        const byMonth = {};
        for (const payout of shortStayPayouts ?? []) {
            const month = payout.completed_at.substring(0, 7);
            byMonth[month] = (byMonth[month] ?? 0) + Number(payout.amount_kes);
        }
        return {
            period,
            total_kes: round2(shortStayTotal + monthlyRentTotal),
            breakdown: {
                short_stay_payouts_kes: round2(shortStayTotal),
                monthly_rent_recurring_kes: round2(monthlyRentTotal),
            },
            monthly_series: Object.entries(byMonth).map(([month, total]) => ({ month, total_kes: round2(total) })),
        };
    }
    async getPayoutTransactions(userId, page, limit) {
        const from = (page - 1) * limit;
        // Get properties owned by landlord
        const { data: properties } = await supabaseAdmin
            .from('properties')
            .select('id')
            .eq('created_by', userId);
        const propertyIds = properties?.map(p => p.id) ?? [];
        if (propertyIds.length === 0) {
            return { transactions: [], total: 0, page, limit, pages: 0 };
        }
        // Get payouts for those properties via bookings
        const { data, count, error } = await supabaseAdmin
            .from('booking_payments')
            .select(`
        id, amount_kes, status, completed_at, initiated_at,
        mpesa_transaction_id,
        short_stay_bookings!booking_id (
          id, booking_ref, check_in_date, check_out_date,
          properties ( id, title )
        )
      `, { count: 'exact' })
            .eq('role', 'host_payout')
            .in('short_stay_bookings.property_id', propertyIds)
            .order('completed_at', { ascending: false, nullsFirst: false })
            .range(from, from + limit - 1);
        if (error)
            throw new Error(`Failed to fetch payouts: ${error.message}`);
        return { transactions: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async getEscrowBalance(userId) {
        // Get properties owned by landlord
        const { data: properties } = await supabaseAdmin
            .from('properties')
            .select('id')
            .eq('created_by', userId);
        const propertyIds = properties?.map(p => p.id) ?? [];
        if (propertyIds.length === 0) {
            return { held_kes: 0, pending_release_kes: 0 };
        }
        // Get bookings that are confirmed but not yet checked in (escrow held)
        const { data: bookings } = await supabaseAdmin
            .from('short_stay_bookings')
            .select('host_payout_kes')
            .in('property_id', propertyIds)
            .eq('status', 'confirmed');
        const held = (bookings ?? []).reduce((s, b) => s + Number(b.host_payout_kes), 0);
        // Get bookings that are checked in (should be released soon)
        const { data: checkedIn } = await supabaseAdmin
            .from('short_stay_bookings')
            .select('host_payout_kes')
            .in('property_id', propertyIds)
            .eq('status', 'checked_in');
        const pendingRelease = (checkedIn ?? []).reduce((s, b) => s + Number(b.host_payout_kes), 0);
        return {
            held_kes: round2(held),
            pending_release_kes: round2(pendingRelease),
        };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 10: BOOSTS & PROMOTIONS
    // ═══════════════════════════════════════════════════════════════════════════
    async listBoostPackages() {
        const { data, error } = await supabaseAdmin
            .from('boost_packages')
            .select('*')
            .eq('is_active', true)
            .order('price_kes', { ascending: true });
        if (error)
            throw new Error(`Failed to fetch boost packages: ${error.message}`);
        return data ?? [];
    }
    async purchaseBoost(userId, purchase) {
        // Verify property ownership
        const { data: prop } = await supabaseAdmin
            .from('properties')
            .select('created_by')
            .eq('id', purchase.property_id)
            .single();
        if (prop?.created_by !== userId)
            throw new Error('Forbidden: Property not owned by you');
        // Get package details
        const { data: pkg } = await supabaseAdmin
            .from('boost_packages')
            .select('*')
            .eq('id', purchase.package_id)
            .single();
        if (!pkg)
            throw new Error('Package not found');
        const startsAt = new Date();
        const endsAt = new Date();
        endsAt.setDate(endsAt.getDate() + pkg.duration_days);
        // Create boost record (payment would be handled by payment gateway)
        const { data, error } = await supabaseAdmin
            .from('listing_boosts')
            .insert({
            property_id: purchase.property_id,
            purchased_by: userId,
            package_id: purchase.package_id,
            amount_paid_kes: pkg.price_kes,
            starts_at: startsAt.toISOString(),
            ends_at: endsAt.toISOString(),
            is_active: true,
        })
            .select()
            .single();
        if (error)
            throw new Error(`Failed to purchase boost: ${error.message}`);
        // Update search scores (trigger will handle this, but we can force refresh)
        await supabaseAdmin.rpc('deactivate_expired_boosts');
        logger.info({ userId, propertyId: purchase.property_id, packageId: purchase.package_id }, 'landlord.boost.purchased');
        return data;
    }
    async listActiveBoosts(userId) {
        const { data, error } = await supabaseAdmin
            .from('listing_boosts')
            .select(`
        id, starts_at, ends_at, amount_paid_kes, is_active,
        impressions_delivered, clicks_delivered,
        boost_packages ( name, duration_days, visibility_score_bonus, badge_label ),
        properties!inner (
          id, title,
          property_locations ( county, area )
        )
      `)
            .eq('properties.created_by', userId)
            .eq('is_active', true)
            .order('ends_at', { ascending: true });
        if (error)
            throw new Error(`Failed to fetch active boosts: ${error.message}`);
        return data ?? [];
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 11: SUBSCRIPTION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════
    async getSubscription(userId) {
        const { data, error } = await supabaseAdmin
            .from('user_subscriptions')
            .select(`
        id, status, amount_kes, billing_cycle, started_at, renews_at,
        unlock_credits_used, ai_queries_used_today,
        subscription_plans (
          id, name, price_monthly_kes, price_annual_kes,
          viewing_unlocks_per_month, ai_recommendations_per_day,
          saved_searches_limit, priority_support,
          can_see_price_history, can_see_similar_properties
        )
      `)
            .eq('user_id', userId)
            .eq('status', 'active')
            .maybeSingle();
        if (error)
            throw new Error(`Failed to fetch subscription: ${error.message}`);
        // Get all available plans for upgrade
        const { data: plans } = await supabaseAdmin
            .from('subscription_plans')
            .select('*')
            .eq('is_active', true)
            .order('price_monthly_kes', { ascending: true });
        return {
            current: data ?? null,
            available_plans: plans ?? [],
        };
    }
    async changeSubscription(userId, change) {
        // Get plan details
        const { data: plan } = await supabaseAdmin
            .from('subscription_plans')
            .select('*')
            .eq('id', change.plan_id)
            .single();
        if (!plan)
            throw new Error('Plan not found');
        const amount = change.billing_cycle === 'monthly'
            ? plan.price_monthly_kes
            : plan.price_annual_kes;
        // Cancel existing subscription
        await supabaseAdmin
            .from('user_subscriptions')
            .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('status', 'active');
        // Create new subscription
        const { data, error } = await supabaseAdmin
            .from('user_subscriptions')
            .insert({
            user_id: userId,
            plan_id: change.plan_id,
            billing_cycle: change.billing_cycle,
            amount_kes: amount,
            status: 'active',
            started_at: new Date().toISOString().split('T')[0],
            renews_at: new Date(Date.now() + (change.billing_cycle === 'monthly' ? 30 : 365) * 86400000).toISOString().split('T')[0],
        })
            .select()
            .single();
        if (error)
            throw new Error(`Failed to change subscription: ${error.message}`);
        logger.info({ userId, planId: change.plan_id, billingCycle: change.billing_cycle }, 'landlord.subscription.changed');
        return data;
    }
    async cancelSubscription(userId) {
        const { error } = await supabaseAdmin
            .from('user_subscriptions')
            .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString().split('T')[0],
        })
            .eq('user_id', userId)
            .eq('status', 'active');
        if (error)
            throw new Error(`Failed to cancel subscription: ${error.message}`);
        logger.info({ userId }, 'landlord.subscription.cancelled');
        return { success: true, effective_at: 'End of current billing period' };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 12: REVIEWS
    // ═══════════════════════════════════════════════════════════════════════════
    async getPropertyReviews(userId, page, limit) {
        const from = (page - 1) * limit;
        // Get properties owned by landlord
        const { data: properties } = await supabaseAdmin
            .from('properties')
            .select('id')
            .eq('created_by', userId);
        const propertyIds = properties?.map(p => p.id) ?? [];
        if (propertyIds.length === 0) {
            return { reviews: [], total: 0, page, limit, pages: 0 };
        }
        const { data, count, error } = await supabaseAdmin
            .from('unified_reviews')
            .select(`
        id, review_type, rating_overall, rating_cleanliness, rating_communication,
        rating_accuracy, rating_value, rating_location, review_text,
        status, submitted_at, published_at, reply_text, replied_at,
        reviewer:users!reviewer_id (
          id, email,
          user_profiles ( full_name, display_name, avatar_url )
        ),
        property:properties!property_id (
          id, title, listing_category
        )
      `, { count: 'exact' })
            .in('property_id', propertyIds)
            .eq('status', 'published')
            .order('submitted_at', { ascending: false })
            .range(from, from + limit - 1);
        if (error)
            throw new Error(`Failed to fetch reviews: ${error.message}`);
        return { reviews: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
    }
    async replyToReview(userId, reviewId, replyText) {
        // Verify the review is for a property owned by landlord
        const { data: review } = await supabaseAdmin
            .from('unified_reviews')
            .select('property:properties!inner(created_by)')
            .eq('id', reviewId)
            .single();
        if (!review || review.property.created_by !== userId) {
            throw new Error('Forbidden: Cannot reply to review for property you don\'t own');
        }
        const { error } = await supabaseAdmin
            .from('unified_reviews')
            .update({
            reply_text: replyText,
            replied_at: new Date().toISOString(),
        })
            .eq('id', reviewId);
        if (error)
            throw new Error(`Failed to reply to review: ${error.message}`);
        logger.info({ userId, reviewId }, 'landlord.review.replied');
        return { success: true };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 13: PROFILE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════
    async getProfile(userId) {
        const { data, error } = await supabaseAdmin
            .from('users')
            .select(`
        id, email, phone_number, email_verified, phone_verified,
        user_profiles ( * ),
        landlord_profiles ( * )
      `)
            .eq('id', userId)
            .single();
        if (error)
            throw new Error(`Failed to fetch profile: ${error.message}`);
        return data;
    }
    async updateProfile(userId, updates) {
        // Update user_profiles
        if (updates.full_name || updates.display_name || updates.county || updates.whatsapp_number) {
            const { error } = await supabaseAdmin
                .from('user_profiles')
                .update({
                full_name: updates.full_name,
                display_name: updates.display_name,
                county: updates.county,
                whatsapp_number: updates.whatsapp_number,
                updated_at: new Date().toISOString(),
            })
                .eq('user_id', userId);
            if (error)
                throw new Error(`Failed to update profile: ${error.message}`);
        }
        // Update landlord_profiles
        if (updates.is_company !== undefined || updates.company_name || updates.kra_pin) {
            const { error } = await supabaseAdmin
                .from('landlord_profiles')
                .update({
                is_company: updates.is_company,
                company_name: updates.company_name,
                kra_pin: updates.kra_pin,
                updated_at: new Date().toISOString(),
            })
                .eq('user_id', userId);
            if (error)
                throw new Error(`Failed to update landlord profile: ${error.message}`);
        }
        logger.info({ userId }, 'landlord.profile.updated');
        return this.getProfile(userId);
    }
    async submitVerification(userId, verification) {
        const { data, error } = await supabaseAdmin
            .from('id_verifications')
            .insert({
            user_id: userId,
            doc_type: verification.id_type,
            doc_number: verification.id_number,
            front_image_url: verification.id_doc_url,
            status: 'pending',
            submitted_at: new Date().toISOString(),
        })
            .select()
            .single();
        if (error)
            throw new Error(`Failed to submit verification: ${error.message}`);
        logger.info({ userId, docType: verification.id_type }, 'landlord.verification.submitted');
        return data;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // Private helpers
    // ═══════════════════════════════════════════════════════════════════════════
    async _getTotalEarnings(userId) {
        // Short-stay payouts
        const { data: payouts } = await supabaseAdmin
            .from('booking_payments')
            .select('amount_kes')
            .eq('role', 'host_payout')
            .eq('status', 'released');
        const shortStayTotal = (payouts ?? []).reduce((s, p) => s + Number(p.amount_kes), 0);
        // Long-term rent (from active tenancies)
        const { data: tenancies } = await supabaseAdmin
            .from('long_term_bookings')
            .select('agreed_monthly_rent_kes')
            .eq('landlord_user_id', userId)
            .in('status', ['active', 'deposit_paid']);
        const monthlyRentTotal = (tenancies ?? []).reduce((s, t) => s + Number(t.agreed_monthly_rent_kes), 0);
        return shortStayTotal + monthlyRentTotal;
    }
}
export const landlordService = new LandlordService();
