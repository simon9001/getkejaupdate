/**
 * caretaker.service.ts
 *
 * Caretaker service for GETKEJA.
 *
 * Caretakers can:
 *   - View assigned properties and units
 *   - Manage maintenance requests
 *   - Record rent payments (if permitted)
 *   - Track move-ins/move-outs
 *   - Log daily activities
 *   - Manage inventory
 *   - Record utility readings
 *   - Handle tenant complaints
 */

import { supabaseAdmin } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// =============================================================================
// CaretakerService
// =============================================================================

export class CaretakerService {

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: DASHBOARD OVERVIEW
  // ═══════════════════════════════════════════════════════════════════════════

  async getDashboardStats(userId: string) {
    // Get assigned properties
    const assignments = await this._getCaretakerAssignments(userId);
    const propertyIds = assignments.map(a => a.property_id).filter(Boolean);
    const buildingIds = assignments.map(a => a.building_id).filter(Boolean);

    // Get units count
    let totalUnits = 0;
    if (buildingIds.length > 0) {
      const { data: buildings } = await supabaseAdmin
        .from('rental_buildings')
        .select('total_units')
        .in('id', buildingIds);
      totalUnits = (buildings ?? []).reduce((sum, b) => sum + (b.total_units ?? 0), 0);
    }

    if (propertyIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('rental_units')
        .select('id', { count: 'exact', head: true })
        .in('property_id', propertyIds);
      totalUnits += (count ?? 0);
    }

    // Get counts for various metrics
    const [
      openMaintenance,
      pendingComplaints,
      upcomingMoveIns,
      upcomingMoveOuts,
      overdueRent,
      unreadNotifications,
    ] = await Promise.all([
      // Open maintenance requests
      supabaseAdmin
        .from('maintenance_requests')
        .select('id', { count: 'exact', head: true })
        .in('property_id', propertyIds)
        .not('status', 'in', ['completed', 'cancelled']),

      // Pending complaints
      supabaseAdmin
        .from('complaints')
        .select('id', { count: 'exact', head: true })
        .in('property_id', propertyIds)
        .eq('status', 'pending'),

      // Upcoming move-ins (next 7 days)
      supabaseAdmin
        .from('long_term_bookings')
        .select('id', { count: 'exact', head: true })
        .in('property_id', propertyIds)
        .eq('status', 'approved')
        .gte('lease_start_date', new Date().toISOString().split('T')[0])
        .lte('lease_start_date', new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]),

      // Upcoming move-outs (next 7 days)
      supabaseAdmin
        .from('long_term_bookings')
        .select('id', { count: 'exact', head: true })
        .in('property_id', propertyIds)
        .eq('status', 'active')
        .lte('lease_end_date', new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]),

      // Overdue rent (simplified - would need rent payment table)
      supabaseAdmin
        .from('rent_payments')
        .select('id', { count: 'exact', head: true })
        .in('property_id', propertyIds)
        .eq('status', 'overdue'),

      // Unread notifications
      supabaseAdmin
        .from('caretaker_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('caretaker_id', userId)
        .eq('is_read', false),
    ]);

    // Get recent activity (last 5 logs)
    const { data: recentLogs } = await supabaseAdmin
      .from('activity_logs')
      .select('*')
      .eq('caretaker_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);

    return {
      assigned_properties: assignments.length,
      total_units: totalUnits,
      metrics: {
        open_maintenance: openMaintenance.count ?? 0,
        pending_complaints: pendingComplaints.count ?? 0,
        upcoming_move_ins: upcomingMoveIns.count ?? 0,
        upcoming_move_outs: upcomingMoveOuts.count ?? 0,
        overdue_rent: overdueRent.count ?? 0,
        unread_notifications: unreadNotifications.count ?? 0,
      },
      recent_activity: recentLogs ?? [],
      generated_at: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: ASSIGNED PROPERTIES
  // ═══════════════════════════════════════════════════════════════════════════

  async getAssignedProperties(userId: string) {
    const assignments = await this._getCaretakerAssignments(userId);
    
    const properties = [];
    
    for (const assignment of assignments) {
      if (assignment.property_id) {
        const { data: property } = await supabaseAdmin
          .from('properties')
          .select(`
            id, title, listing_category, listing_type, bedrooms, bathrooms,
            property_locations ( county, area, estate_name ),
            property_pricing ( monthly_rent ),
            rental_units ( id, unit_number, unit_type, status, current_tenant_id )
          `)
          .eq('id', assignment.property_id)
          .single();
        
        if (property) {
          properties.push({
            ...property,
            can_collect_rent: assignment.can_collect_rent,
            can_edit_listing: assignment.can_edit_listing,
          });
        }
      }
      
      if (assignment.building_id) {
        const { data: building } = await supabaseAdmin
          .from('rental_buildings')
          .select(`
            id, name, total_units, floors, has_lift, has_backup_generator,
            parking_type, management_company,
            rental_units ( id, unit_number, unit_type, status )
          `)
          .eq('id', assignment.building_id)
          .single();
        
        if (building) {
          properties.push({
            ...building,
            is_building: true,
            can_collect_rent: assignment.can_collect_rent,
            can_edit_listing: assignment.can_edit_listing,
          });
        }
      }
    }
    
    return properties;
  }

  async getPropertyUnits(userId: string, propertyId: string) {
    // Verify caretaker has access to this property
    const hasAccess = await this._verifyPropertyAccess(userId, propertyId);
    if (!hasAccess) throw new Error('Forbidden: You do not have access to this property');

    const { data: units, error } = await supabaseAdmin
      .from('rental_units')
      .select(`
        id, unit_number, floor_level, unit_type, faces, has_balcony,
        is_corner_unit, status, availability_date,
        current_tenant:current_tenant_id (
          id, email,
          user_profiles ( full_name, display_name, phone_number )
        )
      `)
      .eq('property_id', propertyId)
      .order('unit_number', { ascending: true });

    if (error) throw new Error(`Failed to fetch units: ${error.message}`);
    return units ?? [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: TENANT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  async getTenants(userId: string, propertyId?: string, unitId?: string) {
    const accessibleProperties = await this._getAccessiblePropertyIds(userId);
    
    if (accessibleProperties.length === 0) {
      return [];
    }

    let query = supabaseAdmin
      .from('long_term_bookings')
      .select(`
        id, booking_ref, lease_start_date, lease_end_date,
        agreed_monthly_rent_kes, agreed_deposit_kes,
        tenant:users!tenant_user_id (
          id, email, phone_number,
          user_profiles ( full_name, display_name, avatar_url, whatsapp_number )
        ),
        property:properties!property_id (
          id, title,
          property_locations ( county, area, estate_name ),
          rental_units!inner ( id, unit_number, unit_type )
        )
      `)
      .in('property_id', accessibleProperties)
      .in('status', ['active', 'deposit_paid']);

    if (propertyId) {
      query = query.eq('property_id', propertyId);
    }
    
    if (unitId) {
      query = query.eq('rental_units.id', unitId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch tenants: ${error.message}`);
    return data ?? [];
  }

  async getTenantDetails(userId: string, tenantId: string) {
    // First verify tenant is in an accessible property
    const accessibleProperties = await this._getAccessiblePropertyIds(userId);
    
    if (accessibleProperties.length === 0) {
      throw new Error('Forbidden');
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .select(`
        id, email, phone_number, created_at,
        user_profiles ( full_name, display_name, avatar_url, whatsapp_number ),
        long_term_bookings!tenant_user_id (
          id, booking_ref, lease_start_date, lease_end_date,
          agreed_monthly_rent_kes, agreed_deposit_kes,
          status, cover_letter,
          property:properties!property_id (
            id, title,
            property_locations ( county, area, estate_name ),
            rental_units ( id, unit_number, unit_type, floor_level )
          )
        ),
        rent_payments ( id, amount_kes, payment_date, payment_method, mpesa_ref, status ),
        complaints ( id, title, description, status, created_at, resolved_at )
      `)
      .eq('id', tenantId)
      .single();

    if (error) throw new Error('Tenant not found');
    
    // Verify at least one booking property is accessible
    const hasAccess = (data.long_term_bookings ?? []).some(
      (booking: any) => accessibleProperties.includes(booking.property_id)
    );
    
    if (!hasAccess) throw new Error('Forbidden');
    
    return data;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: RENT COLLECTION
  // ═══════════════════════════════════════════════════════════════════════════

  async getRentCollections(userId: string, propertyId?: string, month?: string) {
    // Verify caretaker has rent collection permission
    const canCollect = await this._verifyRentCollectionPermission(userId);
    if (!canCollect) throw new Error('Forbidden: You do not have permission to record rent');

    const accessibleProperties = await this._getAccessiblePropertyIds(userId);
    
    let query = supabaseAdmin
      .from('rent_payments')
      .select(`
        id, amount_kes, payment_date, payment_method, mpesa_ref, status, notes,
        collected_by:collected_by_id (
          id, user_profiles ( full_name )
        ),
        tenant:tenant_id (
          id, user_profiles ( full_name, display_name, phone_number )
        ),
        property:property_id (
          id, title,
          rental_units ( id, unit_number )
        )
      `)
      .in('property_id', accessibleProperties)
      .order('payment_date', { ascending: false });

    if (propertyId) {
      query = query.eq('property_id', propertyId);
    }
    
    if (month) {
      query = query.gte('payment_date', `${month}-01`).lte('payment_date', `${month}-31`);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch rent collections: ${error.message}`);
    return data ?? [];
  }

  async recordRentPayment(userId: string, payment: {
    tenant_id: string;
    property_id: string;
    unit_id?: string;
    amount_kes: number;
    payment_method: string;
    mpesa_ref?: string;
    notes?: string;
  }) {
    // Verify caretaker has rent collection permission for this property
    const canCollect = await this._verifyPropertyRentCollectionPermission(userId, payment.property_id);
    if (!canCollect) throw new Error('Forbidden: You do not have permission to record rent for this property');

    const { data, error } = await supabaseAdmin
      .from('rent_payments')
      .insert({
        tenant_id: payment.tenant_id,
        property_id: payment.property_id,
        unit_id: payment.unit_id,
        amount_kes: payment.amount_kes,
        payment_method: payment.payment_method,
        mpesa_ref: payment.mpesa_ref,
        notes: payment.notes,
        collected_by_id: userId,
        payment_date: new Date().toISOString(),
        status: 'completed',
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to record rent payment: ${error.message}`);
    
    logger.info({ userId, tenantId: payment.tenant_id, amount: payment.amount_kes }, 'caretaker.rent.recorded');
    return data;
  }

  async getRentOverview(userId: string) {
    const accessibleProperties = await this._getAccessiblePropertyIds(userId);
    
    if (accessibleProperties.length === 0) {
      return { total_expected: 0, total_collected: 0, collection_rate: 0, by_property: [] };
    }

    // Get all active tenancies
    const { data: tenancies } = await supabaseAdmin
      .from('long_term_bookings')
      .select(`
        id, agreed_monthly_rent_kes,
        property_id,
        property:properties!property_id ( title )
      `)
      .in('property_id', accessibleProperties)
      .in('status', ['active', 'deposit_paid']);

    const totalExpected = (tenancies ?? []).reduce((sum, t) => sum + Number(t.agreed_monthly_rent_kes), 0);

    // Get current month's collections
    const currentMonth = new Date().toISOString().slice(0, 7);
    const { data: collections } = await supabaseAdmin
      .from('rent_payments')
      .select('amount_kes, property_id')
      .in('property_id', accessibleProperties)
      .gte('payment_date', `${currentMonth}-01`)
      .lte('payment_date', `${currentMonth}-31`)
      .eq('status', 'completed');

    const totalCollected = (collections ?? []).reduce((sum, c) => sum + Number(c.amount_kes), 0);

    // Group by property
    const byProperty: Record<string, { property_name: string; expected: number; collected: number }> = {};
    for (const tenancy of tenancies ?? []) {
      const propId = tenancy.property_id;
      if (!byProperty[propId]) {
        byProperty[propId] = {
          property_name: (tenancy.property as any)?.title ?? 'Unknown',
          expected: 0,
          collected: 0,
        };
      }
      byProperty[propId].expected += Number(tenancy.agreed_monthly_rent_kes);
    }
    
    for (const collection of collections ?? []) {
      const propId = collection.property_id;
      if (byProperty[propId]) {
        byProperty[propId].collected += Number(collection.amount_kes);
      }
    }

    return {
      total_expected: round2(totalExpected),
      total_collected: round2(totalCollected),
      collection_rate: totalExpected > 0 ? round2((totalCollected / totalExpected) * 100) : 0,
      by_property: Object.values(byProperty).map(p => ({
        ...p,
        rate: p.expected > 0 ? round2((p.collected / p.expected) * 100) : 0,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: MAINTENANCE REQUESTS
  // ═══════════════════════════════════════════════════════════════════════════

  async getMaintenanceRequests(userId: string, status?: string, propertyId?: string) {
    const accessibleProperties = await this._getAccessiblePropertyIds(userId);
    
    let query = supabaseAdmin
      .from('maintenance_requests')
      .select(`
        id, title, description, priority, status, created_at, updated_at,
        scheduled_date, completed_at, estimated_cost, actual_cost,
        assigned_to, resolution_notes,
        property:property_id (
          id, title,
          property_locations ( county, area, estate_name )
        ),
        unit:unit_id (
          id, unit_number, unit_type
        ),
        requested_by:requested_by_id (
          id, user_profiles ( full_name, display_name, phone_number )
        ),
        photos ( id, url )
      `)
      .in('property_id', accessibleProperties)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (propertyId) query = query.eq('property_id', propertyId);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch maintenance requests: ${error.message}`);
    return data ?? [];
  }

  async createMaintenanceRequest(userId: string, request: {
    property_id: string;
    unit_id?: string;
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'emergency';
    photos?: string[];
  }) {
    // Verify caretaker has access to this property
    const hasAccess = await this._verifyPropertyAccess(userId, request.property_id);
    if (!hasAccess) throw new Error('Forbidden: You do not have access to this property');

    const { data, error } = await supabaseAdmin
      .from('maintenance_requests')
      .insert({
        property_id: request.property_id,
        unit_id: request.unit_id,
        title: request.title,
        description: request.description,
        priority: request.priority,
        status: 'pending',
        requested_by_id: userId,
        requested_by_role: 'caretaker',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create maintenance request: ${error.message}`);

    // Add photos if provided
    if (request.photos && request.photos.length > 0) {
      for (const photo of request.photos) {
        await supabaseAdmin
          .from('maintenance_photos')
          .insert({
            request_id: data.id,
            url: photo,
          });
      }
    }

    logger.info({ userId, requestId: data.id, title: request.title }, 'caretaker.maintenance.created');
    return data;
  }

  async updateMaintenanceStatus(userId: string, requestId: string, status: string, notes?: string) {
    // Verify caretaker has access to the property
    const hasAccess = await this._verifyMaintenanceRequestAccess(userId, requestId);
    if (!hasAccess) throw new Error('Forbidden');

    const { data, error } = await supabaseAdmin
      .from('maintenance_requests')
      .update({
        status,
        notes: notes ? { ...(await this._getRequestNotes(requestId)), [status]: notes } : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update maintenance status: ${error.message}`);
    logger.info({ userId, requestId, status }, 'caretaker.maintenance.status_updated');
    return data;
  }

  async completeMaintenance(userId: string, requestId: string, completion: {
    resolution_notes: string;
    cost_kes?: number;
    completed_photos?: string[];
  }) {
    const hasAccess = await this._verifyMaintenanceRequestAccess(userId, requestId);
    if (!hasAccess) throw new Error('Forbidden');

    const { data, error } = await supabaseAdmin
      .from('maintenance_requests')
      .update({
        status: 'completed',
        resolution_notes: completion.resolution_notes,
        actual_cost: completion.cost_kes,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (error) throw new Error(`Failed to complete maintenance: ${error.message}`);

    // Add completion photos if provided
    if (completion.completed_photos && completion.completed_photos.length > 0) {
      for (const photo of completion.completed_photos) {
        await supabaseAdmin
          .from('maintenance_photos')
          .insert({
            request_id: requestId,
            url: photo,
            is_after: true,
          });
      }
    }

    logger.info({ userId, requestId, cost: completion.cost_kes }, 'caretaker.maintenance.completed');
    return data;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6: COMPLAINTS
  // ═══════════════════════════════════════════════════════════════════════════

  async getComplaints(userId: string, status?: string, propertyId?: string) {
    const accessibleProperties = await this._getAccessiblePropertyIds(userId);
    
    let query = supabaseAdmin
      .from('complaints')
      .select(`
        id, title, description, priority, status, created_at, resolved_at,
        resolution_notes,
        property:property_id (
          id, title,
          property_locations ( county, area, estate_name )
        ),
        unit:unit_id (
          id, unit_number
        ),
        tenant:tenant_id (
          id, user_profiles ( full_name, display_name, phone_number )
        )
      `)
      .in('property_id', accessibleProperties)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (propertyId) query = query.eq('property_id', propertyId);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch complaints: ${error.message}`);
    return data ?? [];
  }

  async resolveComplaint(userId: string, complaintId: string, resolutionNotes: string) {
    const hasAccess = await this._verifyComplaintAccess(userId, complaintId);
    if (!hasAccess) throw new Error('Forbidden');

    const { data, error } = await supabaseAdmin
      .from('complaints')
      .update({
        status: 'resolved',
        resolution_notes: resolutionNotes,
        resolved_at: new Date().toISOString(),
        resolved_by: userId,
      })
      .eq('id', complaintId)
      .select()
      .single();

    if (error) throw new Error(`Failed to resolve complaint: ${error.message}`);
    logger.info({ userId, complaintId }, 'caretaker.complaint.resolved');
    return data;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 7: MOVE-INS & MOVE-OUTS
  // ═══════════════════════════════════════════════════════════════════════════

  async getUpcomingMoveIns(userId: string, upcomingDays: number = 30) {
    const accessibleProperties = await this._getAccessiblePropertyIds(userId);
    
    const endDate = new Date(Date.now() + upcomingDays * 86400000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabaseAdmin
      .from('long_term_bookings')
      .select(`
        id, booking_ref, agreed_monthly_rent_kes, agreed_deposit_kes,
        lease_start_date, lease_end_date,
        tenant:users!tenant_user_id (
          id, email, phone_number,
          user_profiles ( full_name, display_name, avatar_url, whatsapp_number )
        ),
        property:properties!property_id (
          id, title,
          property_locations ( county, area, estate_name ),
          rental_units ( id, unit_number, unit_type, floor_level )
        )
      `)
      .in('property_id', accessibleProperties)
      .eq('status', 'approved')
      .gte('lease_start_date', today)
      .lte('lease_start_date', endDate)
      .order('lease_start_date', { ascending: true });

    if (error) throw new Error(`Failed to fetch move-ins: ${error.message}`);
    return data ?? [];
  }

  async getUpcomingMoveOuts(userId: string, upcomingDays: number = 30) {
    const accessibleProperties = await this._getAccessiblePropertyIds(userId);
    
    const endDate = new Date(Date.now() + upcomingDays * 86400000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabaseAdmin
      .from('long_term_bookings')
      .select(`
        id, booking_ref, agreed_monthly_rent_kes, agreed_deposit_kes,
        lease_start_date, lease_end_date,
        tenant:users!tenant_user_id (
          id, email, phone_number,
          user_profiles ( full_name, display_name, avatar_url, whatsapp_number )
        ),
        property:properties!property_id (
          id, title,
          property_locations ( county, area, estate_name ),
          rental_units ( id, unit_number, unit_type, floor_level )
        )
      `)
      .in('property_id', accessibleProperties)
      .eq('status', 'active')
      .gte('lease_end_date', today)
      .lte('lease_end_date', endDate)
      .order('lease_end_date', { ascending: true });

    if (error) throw new Error(`Failed to fetch move-outs: ${error.message}`);
    return data ?? [];
  }

  async confirmMoveIn(userId: string, bookingId: string, inspection: {
    inspection_notes: string;
    photos?: string[];
  }) {
    const hasAccess = await this._verifyBookingAccess(userId, bookingId);
    if (!hasAccess) throw new Error('Forbidden');

    // Update booking status to active
    const { error: bookingError } = await supabaseAdmin
      .from('long_term_bookings')
      .update({
        status: 'active',
        actual_move_in_date: new Date().toISOString().split('T')[0],
      })
      .eq('id', bookingId);

    if (bookingError) throw new Error(`Failed to confirm move-in: ${bookingError.message}`);

    // Create move-in record
    const { data, error } = await supabaseAdmin
      .from('move_in_out_records')
      .insert({
        booking_id: bookingId,
        type: 'move_in',
        inspection_notes: inspection.inspection_notes,
        performed_by: userId,
        performed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to record move-in: ${error.message}`);

    // Add photos if provided
    if (inspection.photos && inspection.photos.length > 0) {
      for (const photo of inspection.photos) {
        await supabaseAdmin
          .from('inspection_photos')
          .insert({
            record_id: data.id,
            url: photo,
          });
      }
    }

    logger.info({ userId, bookingId }, 'caretaker.move_in.confirmed');
    return data;
  }

  async confirmMoveOut(userId: string, bookingId: string, inspection: {
    inspection_notes: string;
    damage_deduction_kes?: number;
    photos?: string[];
  }) {
    const hasAccess = await this._verifyBookingAccess(userId, bookingId);
    if (!hasAccess) throw new Error('Forbidden');

    // Update booking status to terminated
    const { error: bookingError } = await supabaseAdmin
      .from('long_term_bookings')
      .update({
        status: 'terminated',
        actual_move_out_date: new Date().toISOString().split('T')[0],
      })
      .eq('id', bookingId);

    if (bookingError) throw new Error(`Failed to confirm move-out: ${bookingError.message}`);

    // Create move-out record
    const { data, error } = await supabaseAdmin
      .from('move_in_out_records')
      .insert({
        booking_id: bookingId,
        type: 'move_out',
        inspection_notes: inspection.inspection_notes,
        damage_deduction_kes: inspection.damage_deduction_kes,
        performed_by: userId,
        performed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to record move-out: ${error.message}`);

    // Add photos if provided
    if (inspection.photos && inspection.photos.length > 0) {
      for (const photo of inspection.photos) {
        await supabaseAdmin
          .from('inspection_photos')
          .insert({
            record_id: data.id,
            url: photo,
          });
      }
    }

    // Update property status to available
    const { data: booking } = await supabaseAdmin
      .from('long_term_bookings')
      .select('property_id')
      .eq('id', bookingId)
      .single();

    if (booking) {
      await supabaseAdmin
        .from('properties')
        .update({ status: 'available' })
        .eq('id', booking.property_id);
    }

    logger.info({ userId, bookingId, deduction: inspection.damage_deduction_kes }, 'caretaker.move_out.confirmed');
    return data;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 8: DAILY ACTIVITY LOGS
  // ═══════════════════════════════════════════════════════════════════════════

  async getActivityLogs(userId: string, date?: string, propertyId?: string) {
    let query = supabaseAdmin
      .from('activity_logs')
      .select(`
        id, date, activities, notes, created_at,
        property:property_id (
          id, title
        )
      `)
      .eq('caretaker_id', userId)
      .order('date', { ascending: false });

    if (date) query = query.eq('date', date);
    if (propertyId) query = query.eq('property_id', propertyId);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch activity logs: ${error.message}`);
    return data ?? [];
  }

  async createActivityLog(userId: string, log: {
    property_id: string;
    date: string;
    activities: Array<{ type: string; notes: string; time?: string }>;
    notes?: string;
  }) {
    const hasAccess = await this._verifyPropertyAccess(userId, log.property_id);
    if (!hasAccess) throw new Error('Forbidden');

    const { data, error } = await supabaseAdmin
      .from('activity_logs')
      .insert({
        caretaker_id: userId,
        property_id: log.property_id,
        date: log.date,
        activities: log.activities,
        notes: log.notes,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create activity log: ${error.message}`);
    logger.info({ userId, propertyId: log.property_id, date: log.date }, 'caretaker.activity_log.created');
    return data;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 9: INVENTORY MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  async getInventory(userId: string, propertyId?: string, unitId?: string) {
    const accessibleProperties = await this._getAccessiblePropertyIds(userId);
    
    let query = supabaseAdmin
      .from('inventory_items')
      .select(`
        id, item_name, category, quantity, condition, location,
        purchase_date, purchase_cost, notes, status,
        property:property_id (
          id, title
        ),
        unit:unit_id (
          id, unit_number
        )
      `)
      .in('property_id', accessibleProperties)
      .order('item_name', { ascending: true });

    if (propertyId) query = query.eq('property_id', propertyId);
    if (unitId) query = query.eq('unit_id', unitId);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch inventory: ${error.message}`);
    return data ?? [];
  }

  async addInventoryItem(userId: string, item: {
    property_id: string;
    unit_id?: string;
    item_name: string;
    category: string;
    quantity: number;
    condition: string;
    location?: string;
    purchase_date?: string;
    purchase_cost?: number;
    notes?: string;
  }) {
    const hasAccess = await this._verifyPropertyAccess(userId, item.property_id);
    if (!hasAccess) throw new Error('Forbidden');

    const { data, error } = await supabaseAdmin
      .from('inventory_items')
      .insert({
        property_id: item.property_id,
        unit_id: item.unit_id,
        item_name: item.item_name,
        category: item.category,
        quantity: item.quantity,
        condition: item.condition,
        location: item.location,
        purchase_date: item.purchase_date,
        purchase_cost: item.purchase_cost,
        notes: item.notes,
        status: 'active',
        created_by: userId,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to add inventory item: ${error.message}`);
    logger.info({ userId, itemName: item.item_name }, 'caretaker.inventory.added');
    return data;
  }

  async updateInventoryItem(userId: string, itemId: string, updates: {
    condition?: string;
    quantity?: number;
    status?: string;
    notes?: string;
  }) {
    // Verify caretaker has access to the property of this inventory item
    const hasAccess = await this._verifyInventoryAccess(userId, itemId);
    if (!hasAccess) throw new Error('Forbidden');

    const { data, error } = await supabaseAdmin
      .from('inventory_items')
      .update({
        ...updates,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', itemId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update inventory item: ${error.message}`);
    logger.info({ userId, itemId, updates }, 'caretaker.inventory.updated');
    return data;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 10: VISITOR MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  async getVisitorLogs(userId: string, propertyId?: string, date?: string) {
    const accessibleProperties = await this._getAccessiblePropertyIds(userId);
    
    let query = supabaseAdmin
      .from('visitor_logs')
      .select(`
        id, visitor_name, visitor_phone, purpose, check_in, check_out,
        property:property_id (
          id, title,
          property_locations ( county, area )
        ),
        unit:unit_id (
          id, unit_number
        ),
        hosted_by:hosted_by_id (
          id, user_profiles ( full_name )
        )
      `)
      .in('property_id', accessibleProperties)
      .order('check_in', { ascending: false });

    if (propertyId) query = query.eq('property_id', propertyId);
    if (date) query = query.gte('check_in', `${date}T00:00:00Z`).lte('check_in', `${date}T23:59:59Z`);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch visitor logs: ${error.message}`);
    return data ?? [];
  }

  async logVisitor(userId: string, visitor: {
    property_id: string;
    unit_id?: string;
    visitor_name: string;
    visitor_phone?: string;
    purpose: string;
    check_in: string;
    hosted_by_id?: string;
  }) {
    const hasAccess = await this._verifyPropertyAccess(userId, visitor.property_id);
    if (!hasAccess) throw new Error('Forbidden');

    const { data, error } = await supabaseAdmin
      .from('visitor_logs')
      .insert({
        property_id: visitor.property_id,
        unit_id: visitor.unit_id,
        visitor_name: visitor.visitor_name,
        visitor_phone: visitor.visitor_phone,
        purpose: visitor.purpose,
        check_in: visitor.check_in,
        hosted_by_id: visitor.hosted_by_id || userId,
        logged_by: userId,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to log visitor: ${error.message}`);
    logger.info({ userId, visitorName: visitor.visitor_name }, 'caretaker.visitor.logged');
    return data;
  }

  async visitorCheckout(userId: string, visitorId: string) {
    const { data, error } = await supabaseAdmin
      .from('visitor_logs')
      .update({
        check_out: new Date().toISOString(),
        checked_out_by: userId,
      })
      .eq('id', visitorId)
      .select()
      .single();

    if (error) throw new Error(`Failed to record visitor checkout: ${error.message}`);
    logger.info({ userId, visitorId }, 'caretaker.visitor.checkout');
    return data;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 11: UTILITY READINGS
  // ═══════════════════════════════════════════════════════════════════════════

  async getUtilityReadings(userId: string, propertyId?: string, unitId?: string, month?: string) {
    const accessibleProperties = await this._getAccessiblePropertyIds(userId);
    
    let query = supabaseAdmin
      .from('utility_readings')
      .select(`
        id, utility_type, reading, reading_date, previous_reading,
        consumption, notes, photo_url,
        property:property_id (
          id, title
        ),
        unit:unit_id (
          id, unit_number
        ),
        recorded_by:recorded_by_id (
          id, user_profiles ( full_name )
        )
      `)
      .in('property_id', accessibleProperties)
      .order('reading_date', { ascending: false });

    if (propertyId) query = query.eq('property_id', propertyId);
    if (unitId) query = query.eq('unit_id', unitId);
    if (month) query = query.gte('reading_date', `${month}-01`).lte('reading_date', `${month}-31`);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch utility readings: ${error.message}`);
    return data ?? [];
  }

  async submitUtilityReading(userId: string, reading: {
    property_id: string;
    unit_id?: string;
    utility_type: 'water' | 'electricity';
    reading: number;
    reading_date: string;
    notes?: string;
    photo_url?: string;
  }) {
    const hasAccess = await this._verifyPropertyAccess(userId, reading.property_id);
    if (!hasAccess) throw new Error('Forbidden');

    // Get previous reading
    const { data: previous } = await supabaseAdmin
      .from('utility_readings')
      .select('reading')
      .eq('property_id', reading.property_id)
      .eq('unit_id', reading.unit_id || '')
      .eq('utility_type', reading.utility_type)
      .order('reading_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    const consumption = previous ? reading.reading - previous.reading : null;

    const { data, error } = await supabaseAdmin
      .from('utility_readings')
      .insert({
        property_id: reading.property_id,
        unit_id: reading.unit_id,
        utility_type: reading.utility_type,
        reading: reading.reading,
        previous_reading: previous?.reading,
        consumption,
        reading_date: reading.reading_date,
        notes: reading.notes,
        photo_url: reading.photo_url,
        recorded_by_id: userId,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to submit utility reading: ${error.message}`);
    logger.info({ userId, propertyId: reading.property_id, utilityType: reading.utility_type, reading: reading.reading }, 'caretaker.utility.submitted');
    return data;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 12: NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async getNotifications(userId: string, unreadOnly: boolean = false) {
    let query = supabaseAdmin
      .from('caretaker_notifications')
      .select('*')
      .eq('caretaker_id', userId)
      .order('created_at', { ascending: false });

    if (unreadOnly) query = query.eq('is_read', false);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch notifications: ${error.message}`);
    return data ?? [];
  }

  async markNotificationRead(userId: string, notificationId: string) {
    const { error } = await supabaseAdmin
      .from('caretaker_notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('id', notificationId)
      .eq('caretaker_id', userId);

    if (error) throw new Error(`Failed to mark notification as read: ${error.message}`);
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 13: PROFILE
  // ═══════════════════════════════════════════════════════════════════════════

  async getProfile(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select(`
        id, email, phone_number, email_verified, phone_verified,
        user_profiles ( * ),
        caretaker_profiles ( * ),
        caretaker_assignments (
          id, can_collect_rent, can_edit_listing, assigned_at,
          property:property_id ( id, title ),
          building:building_id ( id, name )
        )
      `)
      .eq('id', userId)
      .single();

    if (error) throw new Error(`Failed to fetch profile: ${error.message}`);
    return data;
  }

  async updateProfile(userId: string, updates: any) {
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

      if (error) throw new Error(`Failed to update profile: ${error.message}`);
    }

    if (updates.lives_on_compound !== undefined || updates.emergency_contact) {
      const { error } = await supabaseAdmin
        .from('caretaker_profiles')
        .update({
          lives_on_compound: updates.lives_on_compound,
          emergency_contact: updates.emergency_contact,
          work_hours: updates.work_hours,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

      if (error) throw new Error(`Failed to update caretaker profile: ${error.message}`);
    }

    return this.getProfile(userId);
  }

  async submitVerification(userId: string, verification: {
    id_number: string;
    id_doc_url: string;
  }) {
    const { data, error } = await supabaseAdmin
      .from('id_verifications')
      .insert({
        user_id: userId,
        doc_type: 'national_id',
        doc_number: verification.id_number,
        front_image_url: verification.id_doc_url,
        status: 'pending',
        submitted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to submit verification: ${error.message}`);
    logger.info({ userId }, 'caretaker.verification.submitted');
    return data;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  private async _getCaretakerAssignments(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('caretaker_assignments')
      .select('property_id, building_id, can_collect_rent, can_edit_listing')
      .eq('caretaker_user_id', userId)
      .is('revoked_at', null);

    if (error) throw new Error(`Failed to fetch assignments: ${error.message}`);
    return data ?? [];
  }

  private async _getAccessiblePropertyIds(userId: string): Promise<string[]> {
    const assignments = await this._getCaretakerAssignments(userId);
    const propertyIds = assignments.map(a => a.property_id).filter(Boolean) as string[];
    
    // Also get properties from buildings
    const buildingIds = assignments.map(a => a.building_id).filter(Boolean);
    if (buildingIds.length > 0) {
      const { data: buildingProperties } = await supabaseAdmin
        .from('rental_units')
        .select('property_id')
        .in('building_id', buildingIds);
      
      const additionalIds = (buildingProperties ?? []).map(u => u.property_id);
      propertyIds.push(...additionalIds);
    }
    
    return [...new Set(propertyIds)];
  }

  private async _verifyPropertyAccess(userId: string, propertyId: string): Promise<boolean> {
    const accessibleIds = await this._getAccessiblePropertyIds(userId);
    return accessibleIds.includes(propertyId);
  }

  private async _verifyRentCollectionPermission(userId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('caretaker_assignments')
      .select('can_collect_rent')
      .eq('caretaker_user_id', userId)
      .eq('can_collect_rent', true)
      .is('revoked_at', null);

    if (error) return false;
    return (data?.length ?? 0) > 0;
  }

  private async _verifyPropertyRentCollectionPermission(userId: string, propertyId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('caretaker_assignments')
      .select('can_collect_rent')
      .eq('caretaker_user_id', userId)
      .eq('property_id', propertyId)
      .eq('can_collect_rent', true)
      .is('revoked_at', null)
      .maybeSingle();

    if (error) return false;
    return data?.can_collect_rent === true;
  }

  private async _verifyMaintenanceRequestAccess(userId: string, requestId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('maintenance_requests')
      .select('property_id')
      .eq('id', requestId)
      .single();

    if (error) return false;
    return this._verifyPropertyAccess(userId, data.property_id);
  }

  private async _verifyComplaintAccess(userId: string, complaintId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('complaints')
      .select('property_id')
      .eq('id', complaintId)
      .single();

    if (error) return false;
    return this._verifyPropertyAccess(userId, data.property_id);
  }

  private async _verifyBookingAccess(userId: string, bookingId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('long_term_bookings')
      .select('property_id')
      .eq('id', bookingId)
      .single();

    if (error) return false;
    return this._verifyPropertyAccess(userId, data.property_id);
  }

  private async _verifyInventoryAccess(userId: string, itemId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('inventory_items')
      .select('property_id')
      .eq('id', itemId)
      .single();

    if (error) return false;
    return this._verifyPropertyAccess(userId, data.property_id);
  }

  private async _getRequestNotes(requestId: string): Promise<any> {
    const { data } = await supabaseAdmin
      .from('maintenance_requests')
      .select('notes')
      .eq('id', requestId)
      .single();
    return data?.notes ?? {};
  }
}

export const caretakerService = new CaretakerService();