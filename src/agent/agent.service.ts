/**
 * agent.service.ts — Agent dashboard KPI + viewings + leads + commissions
 */

import { supabaseAdmin } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';

export class AgentService {

  // ─── Dashboard KPIs ───────────────────────────────────────────────────────

  async getDashboardStats(userId: string) {
    const { data: ownedProps, count: totalListings } = await supabaseAdmin
      .from('properties')
      .select('id', { count: 'exact' })
      .eq('created_by', userId)
      .is('deleted_at', null);

    const propertyIds = (ownedProps ?? []).map((p: any) => p.id);

    const [pendingViewings, totalLeads, unreadConversations, activeBoosts] = await Promise.all([
      propertyIds.length > 0
        ? supabaseAdmin
            .from('visit_schedules')
            .select('id', { count: 'exact', head: true })
            .in('property_id', propertyIds)
            .in('status', ['requested', 'rescheduled'])
        : Promise.resolve({ count: 0 }),

      propertyIds.length > 0
        ? supabaseAdmin
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .in('property_id', propertyIds)
        : Promise.resolve({ count: 0 }),

      supabaseAdmin
        .from('conversations')
        .select('unread_b')
        .eq('participant_b', userId)
        .gt('unread_b', 0),

      propertyIds.length > 0
        ? supabaseAdmin
            .from('listing_boosts')
            .select('id', { count: 'exact', head: true })
            .in('property_id', propertyIds)
            .eq('status', 'active')
            .gte('expires_at', new Date().toISOString())
        : Promise.resolve({ count: 0 }),
    ]);

    const unreadCount = (unreadConversations.data ?? []).reduce(
      (sum: number, c: any) => sum + (c.unread_b ?? 0), 0
    );

    logger.info({ userId, totalListings }, 'agent.getDashboardStats');

    return {
      total_listings:   totalListings ?? 0,
      pending_viewings: (pendingViewings as any).count ?? 0,
      total_leads:      (totalLeads as any).count ?? 0,
      unread_messages:  unreadCount,
      active_boosts:    (activeBoosts as any).count ?? 0,
      generated_at:     new Date().toISOString(),
    };
  }

  // ─── Viewings ─────────────────────────────────────────────────────────────

  async getViewings(userId: string, status?: string) {
    const { data: ownedProps } = await supabaseAdmin
      .from('properties')
      .select('id')
      .eq('created_by', userId)
      .is('deleted_at', null);

    const propertyIds = (ownedProps ?? []).map((p: any) => p.id);

    if (propertyIds.length === 0) {
      return { viewings: [], total: 0 };
    }

    let query = supabaseAdmin
      .from('visit_schedules')
      .select(`
        id, visit_date, visit_time, status, notes, created_at,
        property:property_id (id, title, location:property_locations(area, county)),
        requester:requester_user_id (id, full_name, email, phone)
      `)
      .in('property_id', propertyIds)
      .order('visit_date', { ascending: true });

    if (status && status !== 'all') {
      query = query.eq('status', status);
    } else {
      // Default: show upcoming/pending/confirmed
      query = query.in('status', ['requested', 'confirmed', 'rescheduled']);
    }

    const { data, error } = await query.limit(50);

    if (error) throw new Error(error.message);

    logger.info({ userId, count: data?.length }, 'agent.getViewings');
    return { viewings: data ?? [], total: data?.length ?? 0 };
  }

  // ─── Leads ────────────────────────────────────────────────────────────────

  async getLeads(userId: string) {
    const { data: ownedProps } = await supabaseAdmin
      .from('properties')
      .select('id')
      .eq('created_by', userId)
      .is('deleted_at', null);

    const propertyIds = (ownedProps ?? []).map((p: any) => p.id);

    if (propertyIds.length === 0) {
      return { leads: [], total: 0 };
    }

    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select(`
        id, created_at, unread_b, last_message_at,
        property:property_id (id, title, listing_category, location:property_locations(area, county)),
        seeker:participant_a (id, full_name, email, phone)
      `)
      .in('property_id', propertyIds)
      .order('last_message_at', { ascending: false })
      .limit(50);

    if (error) throw new Error(error.message);

    logger.info({ userId, count: data?.length }, 'agent.getLeads');
    return { leads: data ?? [], total: data?.length ?? 0 };
  }

  // ─── Commissions ──────────────────────────────────────────────────────────

  async getCommissions(userId: string) {
    // Agent's properties with pricing (agent_commission_pct)
    const { data: ownedProps } = await supabaseAdmin
      .from('properties')
      .select('id, title')
      .eq('created_by', userId)
      .is('deleted_at', null);

    const propertyIds = (ownedProps ?? []).map((p: any) => p.id);

    // Also check property_assignments where this user is the agent
    const { data: assignments } = await supabaseAdmin
      .from('property_assignments')
      .select('property_id, commission_rate_pct, properties(id, title)')
      .eq('agent_user_id', userId)
      .eq('role', 'agent');

    const assignedIds = (assignments ?? []).map((a: any) => a.property_id);
    const allPropertyIds = [...new Set([...propertyIds, ...assignedIds])];

    if (allPropertyIds.length === 0) {
      return {
        earned_this_month_kes: 0,
        pending_kes: 0,
        annual_total_kes: 0,
        recent_deals: [],
        commission_rate_pct: 0,
      };
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const startOfYear  = new Date(now.getFullYear(), 0, 1).toISOString();

    // Closed long-term bookings this month
    const [closedThisMonth, closedThisYear, pendingBookings, pricing] = await Promise.all([
      supabaseAdmin
        .from('long_term_bookings')
        .select('id, monthly_rent_kes, status, property_id, created_at, tenant:tenant_user_id(full_name)')
        .in('property_id', allPropertyIds)
        .eq('status', 'active')
        .gte('created_at', startOfMonth),

      supabaseAdmin
        .from('long_term_bookings')
        .select('id, monthly_rent_kes, status, property_id, created_at')
        .in('property_id', allPropertyIds)
        .eq('status', 'active')
        .gte('created_at', startOfYear),

      supabaseAdmin
        .from('long_term_bookings')
        .select('id, monthly_rent_kes, status, property_id, created_at, tenant:tenant_user_id(full_name)')
        .in('property_id', allPropertyIds)
        .eq('status', 'pending'),

      allPropertyIds.length > 0
        ? supabaseAdmin
            .from('property_pricing')
            .select('property_id, agent_commission_pct')
            .in('property_id', allPropertyIds)
        : Promise.resolve({ data: [] }),
    ]);

    // Build pricing map
    const pricingMap: Record<string, number> = {};
    for (const p of (pricing.data ?? [])) {
      pricingMap[p.property_id] = p.agent_commission_pct ?? 0;
    }

    // Check assignments commission rates too
    const assignmentRates: Record<string, number> = {};
    for (const a of (assignments ?? [])) {
      assignmentRates[a.property_id] = a.commission_rate_pct ?? 0;
    }

    function commissionPct(propId: string): number {
      return pricingMap[propId] ?? assignmentRates[propId] ?? 5; // default 5%
    }

    const earnedThisMonth = (closedThisMonth.data ?? []).reduce((sum: number, b: any) => {
      return sum + ((b.monthly_rent_kes ?? 0) * commissionPct(b.property_id) / 100);
    }, 0);

    const annualTotal = (closedThisYear.data ?? []).reduce((sum: number, b: any) => {
      return sum + ((b.monthly_rent_kes ?? 0) * commissionPct(b.property_id) / 100);
    }, 0);

    const pendingKes = (pendingBookings.data ?? []).reduce((sum: number, b: any) => {
      return sum + ((b.monthly_rent_kes ?? 0) * commissionPct(b.property_id) / 100);
    }, 0);

    // Recent deals list (combine active + pending for display)
    const propTitleMap: Record<string, string> = {};
    for (const p of ownedProps ?? []) propTitleMap[p.id] = p.title;
    for (const a of assignments ?? []) {
      const prop = (a as any).properties;
      if (prop) propTitleMap[prop.id] = prop.title;
    }

    const allDeals = [
      ...(closedThisMonth.data ?? []).map((b: any) => ({
        id: b.id,
        property: propTitleMap[b.property_id] ?? 'Property',
        client: (b.tenant as any)?.full_name ?? 'Tenant',
        amount_kes: Math.round((b.monthly_rent_kes ?? 0) * commissionPct(b.property_id) / 100),
        status: 'paid',
        date: b.created_at,
      })),
      ...(pendingBookings.data ?? []).map((b: any) => ({
        id: b.id,
        property: propTitleMap[b.property_id] ?? 'Property',
        client: (b.tenant as any)?.full_name ?? 'Tenant',
        amount_kes: Math.round((b.monthly_rent_kes ?? 0) * commissionPct(b.property_id) / 100),
        status: 'pending',
        date: b.created_at,
      })),
    ].slice(0, 10);

    const avgCommissionPct = allPropertyIds.length > 0
      ? Object.values(pricingMap).reduce((s, v) => s + v, 0) / allPropertyIds.length
      : 5;

    logger.info({ userId, earnedThisMonth }, 'agent.getCommissions');

    return {
      earned_this_month_kes: Math.round(earnedThisMonth),
      pending_kes:           Math.round(pendingKes),
      annual_total_kes:      Math.round(annualTotal),
      recent_deals:          allDeals,
      commission_rate_pct:   Math.round(avgCommissionPct * 10) / 10,
    };
  }

  // ─── Reports ──────────────────────────────────────────────────────────────

  async getReports(userId: string) {
    const { data: ownedProps, count: total } = await supabaseAdmin
      .from('properties')
      .select('id, listing_category', { count: 'exact' })
      .eq('created_by', userId)
      .is('deleted_at', null);

    const propertyIds = (ownedProps ?? []).map((p: any) => p.id);

    if (propertyIds.length === 0) {
      return {
        total_listings: 0,
        active_tenancies: 0,
        pending_viewings: 0,
        total_leads: 0,
        conversion_rate_pct: 0,
        listings_by_category: {},
        generated_at: new Date().toISOString(),
      };
    }

    const [activeTenancies, pendingVisits, leads] = await Promise.all([
      supabaseAdmin
        .from('long_term_bookings')
        .select('id', { count: 'exact', head: true })
        .in('property_id', propertyIds)
        .eq('status', 'active'),

      supabaseAdmin
        .from('visit_schedules')
        .select('id', { count: 'exact', head: true })
        .in('property_id', propertyIds)
        .in('status', ['requested', 'confirmed']),

      supabaseAdmin
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .in('property_id', propertyIds),
    ]);

    const byCategory = (ownedProps ?? []).reduce((acc: Record<string, number>, p: any) => {
      const cat = p.listing_category ?? 'other';
      acc[cat] = (acc[cat] ?? 0) + 1;
      return acc;
    }, {});

    const activeTenancyCount = (activeTenancies as any).count ?? 0;
    const leadsCount = (leads as any).count ?? 0;
    const conversionRate = leadsCount > 0
      ? Math.round((activeTenancyCount / leadsCount) * 100)
      : 0;

    return {
      total_listings:        total ?? 0,
      active_tenancies:      activeTenancyCount,
      pending_viewings:      (pendingVisits as any).count ?? 0,
      total_leads:           leadsCount,
      conversion_rate_pct:   conversionRate,
      listings_by_category:  byCategory,
      generated_at:          new Date().toISOString(),
    };
  }
}

export const agentService = new AgentService();
