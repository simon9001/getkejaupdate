/**
 * visits.service.ts
 *
 * Tables: visit_schedules, viewing_unlocks
 *
 * Business rules:
 *   - Seeker must have an active viewing_unlock for the property before scheduling
 *   - Only one active visit per seeker per property (unique index enforced in DB)
 *   - Max 2 reschedules per booking (configurable)
 *   - No-show tracking triggers an audit log entry
 */
import { supabaseAdmin } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';
const MAX_RESCHEDULES = 2;
export class VisitsService {
    // ─────────────────────────────────────────────────────────────────────────
    // REQUEST
    // ─────────────────────────────────────────────────────────────────────────
    async requestVisit(seekerUserId, input) {
        const { property_id, proposed_datetime, visit_type, duration_minutes, notes_from_seeker } = input;
        // Verify property exists and is available
        const { data: property } = await supabaseAdmin
            .from('properties')
            .select('id, status, created_by, listing_category')
            .eq('id', property_id)
            .is('deleted_at', null)
            .maybeSingle();
        if (!property)
            throw new Error('Property not found');
        if (property.status !== 'available')
            throw new Error('Property is not currently available for viewings');
        if (property.created_by === seekerUserId)
            throw new Error('You cannot schedule a visit to your own property');
        // Verify seeker has an active unlock (paid or free credit used)
        const { data: unlock } = await supabaseAdmin
            .from('viewing_unlocks')
            .select('id, expires_at')
            .eq('property_id', property_id)
            .eq('seeker_user_id', seekerUserId)
            .maybeSingle();
        if (!unlock) {
            throw new Error('You must unlock this property before scheduling a visit. Use the unlock endpoint first.');
        }
        const isExpired = unlock.expires_at && new Date(unlock.expires_at) < new Date();
        if (isExpired) {
            throw new Error('Your viewing unlock has expired. Please unlock the property again.');
        }
        // Prevent duplicate active visits (DB unique index is the hard constraint;
        // this gives a cleaner error message)
        const { data: existingVisit } = await supabaseAdmin
            .from('visit_schedules')
            .select('id, status')
            .eq('property_id', property_id)
            .eq('seeker_user_id', seekerUserId)
            .in('status', ['requested', 'confirmed', 'rescheduled'])
            .maybeSingle();
        if (existingVisit) {
            throw new Error(`You already have an active visit request for this property (status: ${existingVisit.status}). Cancel it before requesting a new one.`);
        }
        const { data: visit, error } = await supabaseAdmin
            .from('visit_schedules')
            .insert({
            property_id,
            seeker_user_id: seekerUserId,
            host_user_id: property.created_by,
            unlock_id: unlock.id,
            proposed_datetime,
            visit_type,
            duration_minutes,
            notes_from_seeker: notes_from_seeker ?? null,
            status: 'requested',
        })
            .select('id, status, proposed_datetime, visit_type')
            .single();
        if (error)
            throw new Error(`Failed to request visit: ${error.message}`);
        // Update the viewing_unlock to mark as booked
        await supabaseAdmin
            .from('viewing_unlocks')
            .update({ viewing_booked: true, viewing_datetime: proposed_datetime })
            .eq('id', unlock.id);
        logger.info({ visitId: visit.id, seekerUserId, propertyId: property_id }, 'visit.requested');
        return visit;
    }
    // ─────────────────────────────────────────────────────────────────────────
    // CONFIRM (host)
    // ─────────────────────────────────────────────────────────────────────────
    async confirmVisit(visitId, hostUserId, input) {
        const visit = await this._fetchAndAssertHost(visitId, hostUserId);
        if (visit.status !== 'requested' && visit.status !== 'rescheduled') {
            throw new Error(`Cannot confirm a visit with status '${visit.status}'`);
        }
        const { error } = await supabaseAdmin
            .from('visit_schedules')
            .update({
            status: 'confirmed',
            confirmed_datetime: input.confirmed_datetime,
            meeting_point: input.meeting_point ?? null,
            virtual_link: input.virtual_link ?? null,
            notes_from_host: input.notes_from_host ?? null,
            updated_at: new Date().toISOString(),
        })
            .eq('id', visitId);
        if (error)
            throw new Error(`Failed to confirm visit: ${error.message}`);
        logger.info({ visitId, hostUserId }, 'visit.confirmed');
        return { success: true, confirmed_datetime: input.confirmed_datetime };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // RESCHEDULE (either party)
    // ─────────────────────────────────────────────────────────────────────────
    async rescheduleVisit(visitId, userId, input) {
        const { data: visit } = await supabaseAdmin
            .from('visit_schedules')
            .select('id, seeker_user_id, host_user_id, status, reschedule_count')
            .eq('id', visitId)
            .maybeSingle();
        if (!visit)
            throw new Error('Visit not found');
        this._assertParticipant(visit, userId);
        if (!['requested', 'confirmed', 'rescheduled'].includes(visit.status)) {
            throw new Error(`Cannot reschedule a visit with status '${visit.status}'`);
        }
        if (visit.reschedule_count >= MAX_RESCHEDULES) {
            throw new Error(`Maximum reschedules (${MAX_RESCHEDULES}) reached. Please cancel and create a new request.`);
        }
        if (new Date(input.proposed_datetime) <= new Date()) {
            throw new Error('Rescheduled time must be in the future');
        }
        const { error } = await supabaseAdmin
            .from('visit_schedules')
            .update({
            status: 'rescheduled',
            proposed_datetime: input.proposed_datetime,
            confirmed_datetime: null, // needs re-confirmation
            reschedule_count: visit.reschedule_count + 1,
            rescheduled_by: userId,
            reschedule_reason: input.reason,
            updated_at: new Date().toISOString(),
        })
            .eq('id', visitId);
        if (error)
            throw new Error(`Failed to reschedule: ${error.message}`);
        logger.info({ visitId, userId, newTime: input.proposed_datetime }, 'visit.rescheduled');
        return { success: true };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // CANCEL (either party)
    // ─────────────────────────────────────────────────────────────────────────
    async cancelVisit(visitId, userId, reason) {
        const { data: visit } = await supabaseAdmin
            .from('visit_schedules')
            .select('id, seeker_user_id, host_user_id, status, unlock_id')
            .eq('id', visitId)
            .maybeSingle();
        if (!visit)
            throw new Error('Visit not found');
        this._assertParticipant(visit, userId);
        if (['completed', 'cancelled', 'no_show_guest', 'no_show_host'].includes(visit.status)) {
            throw new Error(`Cannot cancel a visit with status '${visit.status}'`);
        }
        await supabaseAdmin
            .from('visit_schedules')
            .update({
            status: 'cancelled',
            cancelled_by: userId,
            cancelled_reason: reason,
            updated_at: new Date().toISOString(),
        })
            .eq('id', visitId);
        // Unmark the viewing_unlock booking flag
        if (visit.unlock_id) {
            await supabaseAdmin
                .from('viewing_unlocks')
                .update({ viewing_booked: false, viewing_datetime: null })
                .eq('id', visit.unlock_id);
        }
        logger.info({ visitId, userId }, 'visit.cancelled');
        return { success: true };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // COMPLETE (host or admin)
    // ─────────────────────────────────────────────────────────────────────────
    async completeVisit(visitId, userId, outcomeNotes) {
        const visit = await this._fetchAndAssertHost(visitId, userId);
        if (visit.status !== 'confirmed') {
            throw new Error(`Cannot complete a visit with status '${visit.status}'`);
        }
        await supabaseAdmin
            .from('visit_schedules')
            .update({
            status: 'completed',
            actual_datetime: new Date().toISOString(),
            outcome_notes: outcomeNotes ?? null,
            updated_at: new Date().toISOString(),
        })
            .eq('id', visitId);
        logger.info({ visitId, userId }, 'visit.completed');
        return { success: true };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // NO-SHOW (host marks guest as no-show, or seeker marks host)
    // ─────────────────────────────────────────────────────────────────────────
    async markNoShow(visitId, reportedByUserId) {
        const { data: visit } = await supabaseAdmin
            .from('visit_schedules')
            .select('id, seeker_user_id, host_user_id, status, confirmed_datetime')
            .eq('id', visitId)
            .maybeSingle();
        if (!visit)
            throw new Error('Visit not found');
        this._assertParticipant(visit, reportedByUserId);
        if (visit.status !== 'confirmed') {
            throw new Error('Can only mark no-show for confirmed visits');
        }
        // Only allow no-show report after the scheduled time has passed
        if (visit.confirmed_datetime && new Date(visit.confirmed_datetime) > new Date()) {
            throw new Error('Cannot mark no-show before the scheduled visit time');
        }
        const noShowStatus = reportedByUserId === visit.seeker_user_id
            ? 'no_show_host'
            : 'no_show_guest';
        await supabaseAdmin
            .from('visit_schedules')
            .update({ status: noShowStatus, updated_at: new Date().toISOString() })
            .eq('id', visitId);
        logger.warn({ visitId, noShowStatus, reportedBy: reportedByUserId }, 'visit.no_show');
        return { success: true, status: noShowStatus };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // READ
    // ─────────────────────────────────────────────────────────────────────────
    async getMyVisitsAsSeeker(userId, status) {
        let q = supabaseAdmin
            .from('visit_schedules')
            .select(`
        id, proposed_datetime, confirmed_datetime, status, visit_type,
        reschedule_count, meeting_point, virtual_link, duration_minutes,
        updated_at, created_at,
        properties ( id, title, listing_type,
          property_locations ( county, area, estate_name, road_street ),
          property_media ( url, thumbnail_url, is_cover ) )
      `)
            .eq('seeker_user_id', userId)
            .order('proposed_datetime', { ascending: true });
        if (status)
            q = q.eq('status', status);
        const { data, error } = await q;
        if (error)
            throw new Error(`Failed to fetch visits: ${error.message}`);
        return data ?? [];
    }
    async getMyVisitsAsHost(userId, status) {
        let q = supabaseAdmin
            .from('visit_schedules')
            .select(`
        id, proposed_datetime, confirmed_datetime, status, visit_type,
        reschedule_count, notes_from_seeker, duration_minutes, updated_at,
        properties ( id, title ),
        seeker:users!seeker_user_id ( id,
          user_profiles ( full_name, display_name, avatar_url, whatsapp_number ) )
      `)
            .eq('host_user_id', userId)
            .order('proposed_datetime', { ascending: true });
        if (status)
            q = q.eq('status', status);
        const { data, error } = await q;
        if (error)
            throw new Error(`Failed to fetch host visits: ${error.message}`);
        return data ?? [];
    }
    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────
    async _fetchAndAssertHost(visitId, hostUserId) {
        const { data: visit } = await supabaseAdmin
            .from('visit_schedules')
            .select('id, seeker_user_id, host_user_id, status, reschedule_count, confirmed_datetime, unlock_id')
            .eq('id', visitId)
            .maybeSingle();
        if (!visit)
            throw new Error('Visit not found');
        if (visit.host_user_id !== hostUserId)
            throw new Error('Forbidden: you are not the host of this visit');
        return visit;
    }
    _assertParticipant(visit, userId) {
        if (visit.seeker_user_id !== userId && visit.host_user_id !== userId) {
            throw new Error('Forbidden: you are not part of this visit');
        }
    }
}
export const visitsService = new VisitsService();
