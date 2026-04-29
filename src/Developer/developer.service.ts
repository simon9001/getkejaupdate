/**
 * developer.service.ts — Developer dashboard: Sales Pipeline + Unit Tracker
 */

import { supabaseAdmin } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';

export class DeveloperService {

  // ─── Sales Pipeline ───────────────────────────────────────────────────────

  async getPipelineStats(userId: string) {
    // Developer's properties
    const { data: ownedProps } = await supabaseAdmin
      .from('properties')
      .select('id, title, status, category, listing_category')
      .eq('created_by', userId)
      .is('deleted_at', null);

    const propertyIds = (ownedProps ?? []).map((p: any) => p.id);

    if (propertyIds.length === 0) {
      return {
        total_enquiries: 0,
        reserved_units: 0,
        properties_for_sale: 0,
        projected_sales_kes: 0,
        pipeline_entries: [],
        generated_at: new Date().toISOString(),
      };
    }

    const [enquiries, reservations, forSaleProps, recentConversations] = await Promise.all([
      // Total enquiries (all conversations on developer's listings)
      supabaseAdmin
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .in('property_id', propertyIds),

      // Reserved units (pending or active long-term bookings)
      supabaseAdmin
        .from('long_term_bookings')
        .select('id', { count: 'exact', head: true })
        .in('property_id', propertyIds)
        .in('status', ['pending', 'active']),

      // For-sale properties with pricing
      supabaseAdmin
        .from('properties')
        .select('id, title, status')
        .eq('created_by', userId)
        .eq('listing_category', 'for_sale')
        .is('deleted_at', null),

      // Recent enquiries with property + user details for the pipeline list
      supabaseAdmin
        .from('conversations')
        .select(`
          id, created_at, unread_b,
          property:property_id (id, title, status),
          requester:participant_a (id, full_name, email, phone)
        `)
        .in('property_id', propertyIds)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    // Projected sales: count for_sale properties * avg asking price
    let projectedSalesKes = 0;
    if ((forSaleProps.data ?? []).length > 0) {
      const forSaleIds = (forSaleProps.data ?? []).map((p: any) => p.id);
      const { data: pricing } = await supabaseAdmin
        .from('property_pricing')
        .select('asking_price')
        .in('property_id', forSaleIds)
        .not('asking_price', 'is', null);

      projectedSalesKes = (pricing ?? []).reduce(
        (sum: number, p: any) => sum + (p.asking_price ?? 0), 0
      );
    }

    logger.info({ userId, propertyIds: propertyIds.length }, 'developer.getPipelineStats');

    return {
      total_enquiries:      (enquiries as any).count ?? 0,
      reserved_units:       (reservations as any).count ?? 0,
      properties_for_sale:  (forSaleProps.data ?? []).length,
      projected_sales_kes:  projectedSalesKes,
      pipeline_entries:     recentConversations.data ?? [],
      generated_at:         new Date().toISOString(),
    };
  }

  // ─── Unit Tracker ─────────────────────────────────────────────────────────

  async getUnitTracker(userId: string) {
    const { data: properties } = await supabaseAdmin
      .from('properties')
      .select(`
        id, title, status, listing_category, construction_status,
        bedrooms, bathrooms, property_type,
        location:property_locations (area, county, town)
      `)
      .eq('created_by', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    const props = properties ?? [];

    // Aggregate by status
    const byStatus = props.reduce((acc: Record<string, number>, p: any) => {
      const s = p.status ?? 'available';
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Aggregate by listing category
    const byCategory = props.reduce((acc: Record<string, number>, p: any) => {
      const cat = p.listing_category ?? 'long_term_rent';
      acc[cat] = (acc[cat] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Construction status breakdown
    const byConstruction = props.reduce((acc: Record<string, number>, p: any) => {
      const cs = p.construction_status ?? 'completed';
      acc[cs] = (acc[cs] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Active long-term bookings to know which units are occupied
    const propertyIds = props.map((p: any) => p.id);
    let occupiedIds: string[] = [];
    if (propertyIds.length > 0) {
      const { data: activeBookings } = await supabaseAdmin
        .from('long_term_bookings')
        .select('property_id')
        .in('property_id', propertyIds)
        .eq('status', 'active');
      occupiedIds = (activeBookings ?? []).map((b: any) => b.property_id);
    }

    logger.info({ userId, total: props.length }, 'developer.getUnitTracker');

    return {
      total_units:       props.length,
      available:         byStatus['available'] ?? 0,
      let_out:           (byStatus['let'] ?? 0) + occupiedIds.length,
      sold:              byStatus['sold'] ?? 0,
      off_market:        byStatus['off_market'] ?? 0,
      under_offer:       byStatus['under_offer'] ?? 0,
      by_category:       byCategory,
      by_construction:   byConstruction,
      properties:        props.slice(0, 20),
      generated_at:      new Date().toISOString(),
    };
  }
}

export const developerService = new DeveloperService();
