/***
 * DONT RUN IF U SEE A PYTHON CODE ANYWHERE ITS NOMAL MY GUY JUST STAY COOL
 * admin.service.ts
 *
 * Central admin dashboard service for GETKEJA.
 *
 * Every query references exact table/column names from the schema:
 *
 *  Core schema (main migration):
 *    users, user_profiles, user_roles, roles, user_sessions,
 *    security_audit_log, id_verifications,
 *    properties, property_locations, property_pricing, property_media,
 *    listing_search_scores, listing_payments, listing_fee_tiers,
 *    listing_boosts, boost_packages,
 *    subscription_plans, user_subscriptions, viewing_unlocks,
 *    viewing_fee_config, fee_config, ad_campaigns, advertisers,
 *    search_queries
 *
 *  Short-stay migration:
 *    short_stay_bookings, booking_payments, booking_cancellations,
 *    short_stay_disputes, property_reviews, host_reviews,
 *    property_review_stats
 *
 *  Chat/visits/bookings/reviews migration:
 *    conversations, messages, message_reports,
 *    visit_schedules, long_term_bookings,
 *    unified_reviews, review_fraud_signals, review_aggregates
 *
 * Design rules:
 *   - Never re-implement logic that already exists in another service.
 *     The dashboard aggregates and cross-joins; individual modules own mutations.
 *   - All date filters default to current calendar month when not supplied.
 *   - Every paginated method returns { data, total, page, limit, pages }.
 *   - Revenue figures are always in KES, always rounded to 2 dp.
 *   - Counts are always integers (never null — COALESCE(count,0)).
 */

import { supabaseAdmin } from '../utils/supabase.js';
import { logger }        from '../utils/logger.js';
import { emailService }   from '../utils/email.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function startOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function startOf30Days(): string {
  return new Date(Date.now() - 30 * 86_400_000).toISOString();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// AdminService
// ─────────────────────────────────────────────────────────────────────────────

export class AdminService {

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: OVERVIEW / KPI SNAPSHOT
  // Single endpoint that powers the top row of metric cards on the dashboard.
  // All counts are from the live DB — no caching, runs fast via indexes.
  // ═══════════════════════════════════════════════════════════════════════════

  async getKpiSnapshot() {
    const monthStart = startOfMonth();
    const day30Start = startOf30Days();

    // Run all counts in parallel — each uses a partial/filtered index
    const [
      totalUsers,           newUsersMonth,
      totalProperties,      newPropertiesMonth,
      activeListings,
      totalShortStayBookings, confirmedBookings,
      totalLtBookings,      activeTenancies,
      totalRevenue,         revenueMonth,
      pendingVerifications,
      openDisputes,
      fraudQueueCount,
      activeSubscriptions,
      pendingVisits,
    ] = await Promise.all([
      // Users
      supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('created_at', monthStart).is('deleted_at', null),

      // Properties
      supabaseAdmin.from('properties').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      supabaseAdmin.from('properties').select('id', { count: 'exact', head: true }).gte('created_at', monthStart).is('deleted_at', null),
      supabaseAdmin.from('properties').select('id', { count: 'exact', head: true }).eq('status', 'available').is('deleted_at', null),

      // Short-stay bookings
      supabaseAdmin.from('short_stay_bookings').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('short_stay_bookings').select('id', { count: 'exact', head: true }).in('status', ['confirmed', 'checked_in']),

      // Long-term bookings
      supabaseAdmin.from('long_term_bookings').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('long_term_bookings').select('id', { count: 'exact', head: true }).eq('status', 'active'),

      // Revenue (all-time from listing_payments + viewing_unlocks + user_subscriptions)
      this._getTotalRevenue(),
      this._getRevenueInRange(monthStart, new Date().toISOString()),

      // Moderation queues
      supabaseAdmin.from('id_verifications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabaseAdmin.from('short_stay_disputes').select('id', { count: 'exact', head: true }).in('status', ['open', 'under_review']),
      supabaseAdmin.from('review_fraud_signals').select('id', { count: 'exact', head: true }).eq('resolved', false),

      // Subscriptions
      supabaseAdmin.from('user_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),

      // Visits pending confirmation
      supabaseAdmin.from('visit_schedules').select('id', { count: 'exact', head: true }).in('status', ['requested', 'rescheduled']),
    ]);

    return {
      users: {
        total:       totalUsers.count     ?? 0,
        new_30d:     newUsersMonth.count  ?? 0,
      },
      properties: {
        total:       totalProperties.count      ?? 0,
        new_30d:     newPropertiesMonth.count   ?? 0,
        active:      activeListings.count       ?? 0,
      },
      short_stay_bookings: {
        total:       totalShortStayBookings.count ?? 0,
        active:      confirmedBookings.count      ?? 0,
      },
      long_term_bookings: {
        total:       totalLtBookings.count ?? 0,
        active:      activeTenancies.count ?? 0,
      },
      revenue: {
        all_time_kes: round2(totalRevenue),
        month_kes:    round2(revenueMonth),
      },
      moderation: {
        pending_id_verifications: pendingVerifications.count ?? 0,
        open_disputes:            openDisputes.count         ?? 0,
        fraud_signals_unresolved: fraudQueueCount.count      ?? 0,
      },
      subscriptions: {
        active: activeSubscriptions.count ?? 0,
      },
      visits: {
        pending_confirmation: pendingVisits.count ?? 0,
      },
      generated_at: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: REVENUE ANALYTICS
  // Breaks down income by stream, period, and plan/tier.
  // Sources: listing_payments, viewing_unlocks, user_subscriptions,
  //          booking_payments (short-stay)
  // ═══════════════════════════════════════════════════════════════════════════

  async getRevenueBreakdown(fromDate: string, toDate: string) {
    const [listing, viewing, subscriptions, shortStay] = await Promise.all([

      // Listing fees (listing_payments.status = 'paid')
      supabaseAdmin
        .from('listing_payments')
        .select('amount_kes, payment_method, created_at, listing_fee_tiers(tier_name, listing_category)')
        .eq('status', 'paid')
        .gte('created_at', fromDate)
        .lte('created_at', toDate),

      // Viewing unlock fees
      supabaseAdmin
        .from('viewing_unlocks')
        .select('fee_paid_kes, unlocked_at')
        .gt('fee_paid_kes', 0)
        .gte('unlocked_at', fromDate)
        .lte('unlocked_at', toDate),

      // Subscription revenue
      supabaseAdmin
        .from('user_subscriptions')
        .select('amount_kes, billing_cycle, started_at, subscription_plans(name)')
        .in('status', ['active', 'cancelled'])
        .gte('started_at', fromDate)
        .lte('started_at', toDate),

      // Short-stay platform fees (role = 'platform_fee', status = 'released')
      supabaseAdmin
        .from('booking_payments')
        .select('amount_kes, initiated_at')
        .eq('role', 'platform_fee')
        .eq('status', 'released')
        .gte('initiated_at', fromDate)
        .lte('initiated_at', toDate),
    ]);

    const listingTotal      = (listing.data      ?? []).reduce((s, r) => s + Number(r.amount_kes), 0);
    const viewingTotal      = (viewing.data       ?? []).reduce((s, r) => s + Number(r.fee_paid_kes), 0);
    const subscriptionTotal = (subscriptions.data ?? []).reduce((s, r) => s + Number(r.amount_kes), 0);
    const shortStayTotal    = (shortStay.data     ?? []).reduce((s, r) => s + Number(r.amount_kes), 0);
    const grandTotal        = listingTotal + viewingTotal + subscriptionTotal + shortStayTotal;

    // By-plan breakdown for subscriptions
    const byPlan: Record<string, number> = {};
    for (const s of subscriptions.data ?? []) {
      const name = (s.subscription_plans as any)?.name ?? 'unknown';
      byPlan[name] = (byPlan[name] ?? 0) + Number(s.amount_kes);
    }

    // By-tier breakdown for listing fees
    const byTier: Record<string, number> = {};
    for (const l of listing.data ?? []) {
      const tier = (l.listing_fee_tiers as any)?.tier_name ?? 'unknown';
      byTier[tier] = (byTier[tier] ?? 0) + Number(l.amount_kes);
    }

    return {
      period: { from: fromDate, to: toDate },
      total_kes:              round2(grandTotal),
      by_stream: {
        listing_fees_kes:     round2(listingTotal),
        viewing_fees_kes:     round2(viewingTotal),
        subscriptions_kes:    round2(subscriptionTotal),
        short_stay_fees_kes:  round2(shortStayTotal),
      },
      listing_fees_by_tier:    byTier,
      subscriptions_by_plan:   byPlan,
      counts: {
        listing_payments:     listing.data?.length      ?? 0,
        viewing_unlocks_paid: viewing.data?.length      ?? 0,
        subscriptions_new:    subscriptions.data?.length ?? 0,
        short_stay_bookings:  shortStay.data?.length    ?? 0,
      },
    };
  }

  /**
   * Daily revenue time series for charting — last N days (default 30).
   * Returns one row per day with amounts split by stream.
   */
  async getDailyRevenueSeries(days = 30) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0];

    // We use the vw_daily_revenue view which already exists in the schema
    const { data, error } = await supabaseAdmin
      .from('vw_daily_revenue')
      .select('day, revenue_type, total_kes, transaction_count')
      .gte('day', since)
      .order('day', { ascending: true });

    if (error) throw new Error(`Failed to fetch revenue series: ${error.message}`);

    // Pivot: group by day, each stream as a column
    const series: Record<string, Record<string, number>> = {};
    for (const row of data ?? []) {
      const day = String(row.day);
      if (!series[day]) series[day] = { listing_fee: 0, viewing_fee: 0, subscription: 0 };
      series[day][row.revenue_type as string] = round2(Number(row.total_kes));
    }

    return {
      days,
      since,
      series: Object.entries(series).map(([day, streams]) => ({ day, ...streams })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: USER MANAGEMENT
  // Full paginated user list with role/status filters + per-user profile detail.
  // All heavy lifting is delegated to the existing users.service.getAllUsers.
  // The dashboard adds aggregate stats about a specific user.
  // ═══════════════════════════════════════════════════════════════════════════

  async getUserStats() {
    const monthStart = startOfMonth();

    const [
      byStatus,
      byProvider,
      byRole,
      newMonthly,
      verifiedIds,
    ] = await Promise.all([
      // Group by account_status
      supabaseAdmin
        .from('users')
        .select('account_status')
        .is('deleted_at', null),

      supabaseAdmin
        .from('users')
        .select('auth_provider')
        .is('deleted_at', null),

      // Active roles breakdown
      supabaseAdmin
        .from('user_roles')
        .select('roles(name)')
        .eq('is_active', true),

      // New users per month for the last 6 months (rough: just this month)
      supabaseAdmin
        .from('users')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', monthStart)
        .is('deleted_at', null),

      // ID verifications approved
      supabaseAdmin
        .from('id_verifications')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'approved'),
    ]);

    // Aggregate by_status
    const statusCounts: Record<string, number> = {};
    for (const u of byStatus.data ?? []) {
      const s = u.account_status as string;
      statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    }

    // Aggregate by_provider
    const providerCounts: Record<string, number> = {};
    for (const u of byProvider.data ?? []) {
      const p = u.auth_provider as string;
      providerCounts[p] = (providerCounts[p] ?? 0) + 1;
    }

    // Aggregate by_role
    const roleCounts: Record<string, number> = {};
    for (const r of byRole.data ?? []) {
      const name = (r.roles as any)?.name ?? 'unknown';
      roleCounts[name] = (roleCounts[name] ?? 0) + 1;
    }

    return {
      by_status:    statusCounts,
      by_provider:  providerCounts,
      by_role:      roleCounts,
      new_this_month:      newMonthly.count    ?? 0,
      verified_ids_total:  verifiedIds.count   ?? 0,
    };
  }

  /**
   * Full activity profile for a single user — used on the admin user-detail page.
   * Combines data from users, user_profiles, user_roles, subscriptions,
   * properties (if lister), bookings, reviews.
   */
  async getUserActivityProfile(userId: string) {
    const [
      userRow,
      sessions,
      properties,
      guestBookings,
      hostBookings,
      ltTenantBookings,
      ltLandlordBookings,
      givenReviews,
      subscription,
      auditLog,
    ] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select(`
          id, email, phone_number, account_status, email_verified,
          phone_verified, auth_provider, failed_login_count,
          last_login_at, last_login_ip, created_at,
          user_profiles ( full_name, display_name, avatar_url, county, whatsapp_number, notification_prefs ),
          user_roles ( is_active, verified_at, assigned_at, roles(name, display_name) ),
          id_verifications ( doc_type, status, submitted_at, reviewed_at )
        `)
        .eq('id', userId)
        .is('deleted_at', null)
        .maybeSingle(),

      supabaseAdmin
        .from('user_sessions')
        .select('device_type, ip_address, created_at, is_active, expires_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5),

      supabaseAdmin
        .from('properties')
        .select('id, title, status, listing_category, created_at')
        .eq('created_by', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(5),

      // Short-stay bookings as guest
      supabaseAdmin
        .from('short_stay_bookings')
        .select('id, booking_ref, status, check_in_date, check_out_date, total_charged_kes')
        .eq('guest_user_id', userId)
        .order('requested_at', { ascending: false })
        .limit(5),

      // Short-stay bookings as host
      supabaseAdmin
        .from('short_stay_bookings')
        .select('id, booking_ref, status, check_in_date, total_charged_kes, host_payout_kes')
        .eq('host_user_id', userId)
        .order('requested_at', { ascending: false })
        .limit(5),

      // Long-term as tenant
      supabaseAdmin
        .from('long_term_bookings')
        .select('id, booking_ref, status, desired_move_in, agreed_monthly_rent_kes')
        .eq('tenant_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5),

      // Long-term as landlord
      supabaseAdmin
        .from('long_term_bookings')
        .select('id, booking_ref, status, desired_move_in, agreed_monthly_rent_kes')
        .eq('landlord_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5),

      // Reviews given
      supabaseAdmin
        .from('unified_reviews')
        .select('id, review_type, rating_overall, status, submitted_at')
        .eq('reviewer_id', userId)
        .order('submitted_at', { ascending: false })
        .limit(10),

      // Active subscription
      supabaseAdmin
        .from('user_subscriptions')
        .select('id, status, amount_kes, billing_cycle, started_at, renews_at, subscription_plans(name)')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle(),

      // Recent audit log
      supabaseAdmin
        .from('security_audit_log')
        .select('event_type, ip_address, created_at, metadata')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    if (!userRow.data) throw new Error('User not found');

    return {
      user:              userRow.data,
      recent_sessions:   sessions.data     ?? [],
      properties:        properties.data   ?? [],
      short_stay: {
        as_guest: guestBookings.data  ?? [],
        as_host:  hostBookings.data   ?? [],
      },
      long_term: {
        as_tenant:   ltTenantBookings.data   ?? [],
        as_landlord: ltLandlordBookings.data ?? [],
      },
      reviews_given:  givenReviews.data ?? [],
      subscription:   subscription.data ?? null,
      audit_log:      auditLog.data     ?? [],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: PROPERTY MANAGEMENT
  // Dashboard-specific aggregations. Mutations (status, featured, delete)
  // are already in properties.service — no duplication here.
  // ═══════════════════════════════════════════════════════════════════════════

  async getPropertyStats() {
    const [
      byCategory,
      byStatus,
      byType,
      byFurnished,
      featuredCount,
      withBoosts,
      avgScores,
    ] = await Promise.all([
      supabaseAdmin.from('properties').select('listing_category').is('deleted_at', null),
      supabaseAdmin.from('properties').select('status').is('deleted_at', null),
      supabaseAdmin.from('properties').select('listing_type').is('deleted_at', null),
      supabaseAdmin.from('properties').select('is_furnished').is('deleted_at', null),
      supabaseAdmin.from('properties').select('id', { count: 'exact', head: true }).eq('is_featured', true).is('deleted_at', null),
      supabaseAdmin.from('listing_boosts').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabaseAdmin.from('listing_search_scores').select('base_score, boost_score, engagement_score, verification_score, total_score'),
    ]);

    const aggregate = (rows: any[], key: string) => {
      const counts: Record<string, number> = {};
      for (const r of rows ?? []) { const v = r[key]; counts[v] = (counts[v] ?? 0) + 1; }
      return counts;
    };

    const scores = avgScores.data ?? [];
    const avgScore = scores.length
      ? round2(scores.reduce((s, r) => s + Number(r.total_score), 0) / scores.length)
      : 0;

    return {
      by_category:   aggregate(byCategory.data ?? [], 'listing_category'),
      by_status:     aggregate(byStatus.data   ?? [], 'status'),
      by_type:       aggregate(byType.data     ?? [], 'listing_type'),
      by_furnished:  aggregate(byFurnished.data ?? [], 'is_furnished'),
      featured_count:  featuredCount.count ?? 0,
      active_boosts:   withBoosts.count   ?? 0,
      avg_search_score: avgScore,
    };
  }

  /**
   * Properties with zero views, no media, or missing pricing — helps
   * the admin team identify listings that need attention.
   */
  async getPropertiesNeedingAttention(page = 1, limit = 20) {
    const from = (page - 1) * limit;

    // Properties with no media
    const { data: noMedia, count: noMediaCount } = await supabaseAdmin
      .from('properties')
      .select(`
        id, title, listing_category, status, created_at,
        property_locations(county, area),
        users!created_by(email, user_profiles(full_name))
      `, { count: 'exact' })
      .is('deleted_at', null)
      .eq('status', 'available')
      .not('id', 'in',
        `(SELECT DISTINCT property_id FROM property_media)`
      )
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    return {
      no_media: {
        properties: noMedia ?? [],
        total:      noMediaCount ?? 0,
      },
      page,
      limit,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: BOOKINGS OVERVIEW
  // Unified view across short-stay bookings + long-term bookings.
  // ═══════════════════════════════════════════════════════════════════════════

  async getBookingStats() {
    const monthStart = startOfMonth();

    const [
      // Short-stay by status
      ssAll, ssMonth, ssConfirmed, ssCancelled, ssDisputed,
      ssEscrowHeld, ssPayoutReleased,
      // Long-term by status
      ltAll, ltPending, ltActive, ltTerminated,
      // Visits
      visRequested, visCompleted, visNoShow,
    ] = await Promise.all([
      supabaseAdmin.from('short_stay_bookings').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('short_stay_bookings').select('id', { count: 'exact', head: true }).gte('requested_at', monthStart),
      supabaseAdmin.from('short_stay_bookings').select('id', { count: 'exact', head: true }).in('status', ['confirmed','checked_in']),
      supabaseAdmin.from('short_stay_bookings').select('id', { count: 'exact', head: true }).in('status', ['cancelled_guest','cancelled_host']),
      supabaseAdmin.from('short_stay_bookings').select('id', { count: 'exact', head: true }).eq('status', 'disputed'),

      // Escrow still held
      supabaseAdmin.from('booking_payments').select('amount_kes').eq('status', 'held_escrow').eq('role', 'guest_charge'),
      // Payouts already released
      supabaseAdmin.from('booking_payments').select('amount_kes').eq('status', 'released').eq('role', 'host_payout'),

      supabaseAdmin.from('long_term_bookings').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('long_term_bookings').select('id', { count: 'exact', head: true }).eq('status', 'pending_review'),
      supabaseAdmin.from('long_term_bookings').select('id', { count: 'exact', head: true }).in('status', ['active', 'deposit_paid']),
      supabaseAdmin.from('long_term_bookings').select('id', { count: 'exact', head: true }).eq('status', 'terminated'),

      supabaseAdmin.from('visit_schedules').select('id', { count: 'exact', head: true }).in('status', ['requested','rescheduled']),
      supabaseAdmin.from('visit_schedules').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
      supabaseAdmin.from('visit_schedules').select('id', { count: 'exact', head: true }).in('status', ['no_show_guest','no_show_host']),
    ]);

    const escrowHeld   = (ssEscrowHeld.data   ?? []).reduce((s, r) => s + Number(r.amount_kes), 0);
    const payoutTotal  = (ssPayoutReleased.data ?? []).reduce((s, r) => s + Number(r.amount_kes), 0);

    return {
      short_stay: {
        total:         ssAll.count       ?? 0,
        new_this_month: ssMonth.count    ?? 0,
        active:        ssConfirmed.count ?? 0,
        cancelled:     ssCancelled.count ?? 0,
        disputed:      ssDisputed.count  ?? 0,
        escrow_held_kes:   round2(escrowHeld),
        payouts_released_kes: round2(payoutTotal),
      },
      long_term: {
        total:         ltAll.count       ?? 0,
        pending:       ltPending.count   ?? 0,
        active:        ltActive.count    ?? 0,
        terminated:    ltTerminated.count ?? 0,
      },
      visits: {
        pending_confirmation: visRequested.count  ?? 0,
        completed_total:      visCompleted.count  ?? 0,
        no_shows_total:       visNoShow.count     ?? 0,
      },
    };
  }

  /**
   * Paginated list of recent short-stay bookings across all properties.
   */
  async listAllShortStayBookings(
    page = 1, limit = 20,
    filters: { status?: string; fromDate?: string; toDate?: string } = {},
  ) {
    const from = (page - 1) * limit;
    let q = supabaseAdmin
      .from('short_stay_bookings')
      .select(`
        id, booking_ref, status, check_in_date, check_out_date, nights,
        guests_count, total_charged_kes, host_payout_kes, requested_at, confirmed_at,
        guest_name, guest_phone, cancellation_policy,
        properties ( id, title, property_locations(county, area) ),
        guest:users!guest_user_id ( id, email, user_profiles(full_name) ),
        host:users!host_user_id   ( id, email, user_profiles(full_name) )
      `, { count: 'exact' })
      .order('requested_at', { ascending: false })
      .range(from, from + limit - 1);

    if (filters.status)   q = q.eq('status', filters.status);
    if (filters.fromDate) q = q.gte('check_in_date', filters.fromDate);
    if (filters.toDate)   q = q.lte('check_out_date', filters.toDate);

    const { data, count, error } = await q;
    if (error) throw new Error(`Failed to list bookings: ${error.message}`);

    return { bookings: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
  }

  /**
   * Paginated list of long-term booking applications (all statuses).
   */
  async listAllLongTermBookings(
    page = 1, limit = 20,
    filters: { status?: string } = {},
  ) {
    const from = (page - 1) * limit;
    let q = supabaseAdmin
      .from('long_term_bookings')
      .select(`
        id, booking_ref, status, desired_move_in, agreed_monthly_rent_kes,
        agreed_deposit_kes, lease_start_date, lease_end_date,
        deposit_paid_at, created_at,
        properties ( id, title, property_locations(county, area) ),
        tenant:users!tenant_user_id (
          id, email, user_profiles(full_name, whatsapp_number) ),
        landlord:users!landlord_user_id (
          id, email, user_profiles(full_name) )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (filters.status) q = q.eq('status', filters.status);

    const { data, count, error } = await q;
    if (error) throw new Error(`Failed to list long-term bookings: ${error.message}`);

    return { bookings: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6: MODERATION QUEUES
  // ID verifications, disputes, review fraud signals, message reports.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Pending ID verifications — shown in the "Verify Users" admin tab.
   */
  async getPendingVerifications(page = 1, limit = 20, status = 'pending') {
    const from = (page - 1) * limit;

    const VALID_STATUSES = ['pending', 'approved', 'rejected', 'expired'];
    const safeStatus = VALID_STATUSES.includes(status) ? status : 'pending';

    const { data, count, error } = await supabaseAdmin
      .from('id_verifications')
      .select(`
        id, doc_type, doc_number, status, submitted_at, reviewed_at, rejection_reason,
        front_image_url, back_image_url, selfie_url,
        users!user_id (
          id, email, phone_number,
          user_profiles ( full_name, display_name, avatar_url )
        )
      `, { count: 'exact' })
      .eq('status', safeStatus)
      .order('submitted_at', { ascending: safeStatus === 'pending' })
      .range(from, from + limit - 1);

    if (error) throw new Error(`Failed to fetch verifications: ${error.message}`);

    // Flatten nested shape for the frontend
    const verifications = (data ?? []).map((v: any) => ({
      id:               v.id,
      doc_type:         v.doc_type,
      doc_number:       v.doc_number ?? null,
      status:           v.status,
      submitted_at:     v.submitted_at,
      reviewed_at:      v.reviewed_at ?? null,
      rejection_reason: v.rejection_reason ?? null,
      front_image_url:  v.front_image_url ?? null,
      back_image_url:   v.back_image_url  ?? null,
      selfie_url:       v.selfie_url      ?? null,
      user_id:          v.users?.id       ?? null,
      user_email:       v.users?.email    ?? null,
      user_phone:       v.users?.phone_number ?? null,
      user_full_name:   v.users?.user_profiles?.full_name    ?? null,
      user_display_name:v.users?.user_profiles?.display_name ?? null,
      user_avatar_url:  v.users?.user_profiles?.avatar_url   ?? null,
    }));

    return { verifications, total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
  }

  /**
   * Open disputes (short-stay).
   */
  async getOpenDisputes(page = 1, limit = 20) {
    const from = (page - 1) * limit;

    const { data, count, error } = await supabaseAdmin
      .from('short_stay_disputes')
      .select(`
        id, reason, description, status, raised_at, evidence_urls,
        raised_by_role, refund_amount_kes,
        short_stay_bookings (
          id, booking_ref, check_in_date, check_out_date,
          total_charged_kes, host_payout_kes ),
        raised_by_user:users!raised_by ( id, email, user_profiles(full_name) ),
        against:users!against_user_id  ( id, email, user_profiles(full_name) )
      `, { count: 'exact' })
      .in('status', ['open', 'under_review'])
      .order('raised_at', { ascending: true })
      .range(from, from + limit - 1);

    if (error) throw new Error(`Failed to fetch disputes: ${error.message}`);
    return { disputes: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
  }

  /**
   * Review fraud moderation queue — reviews held for admin action.
   */
  async getFraudReviewQueue(page = 1, limit = 20) {
    const from = (page - 1) * limit;

    const { data, count, error } = await supabaseAdmin
      .from('unified_reviews')
      .select(`
        id, review_type, rating_overall, review_text, status,
        submitted_at, submitted_ip, account_age_days_at_submission,
        reviewer_total_reviews_at_submission, edit_count,
        property:properties!property_id ( id, title ),
        reviewer:users!reviewer_id ( id, email, user_profiles(full_name) ),
        reviewee:users!reviewee_id  ( id, email, user_profiles(full_name) ),
        review_fraud_signals ( id, signal, confidence, detail, resolved )
      `, { count: 'exact' })
      .eq('status', 'held_for_moderation')
      .order('submitted_at', { ascending: true })
      .range(from, from + limit - 1);

    if (error) throw new Error(`Failed to fetch fraud queue: ${error.message}`);
    return { reviews: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
  }

  /**
   * Reported messages — flagged by users for abuse/spam.
   */
  async getReportedMessages(page = 1, limit = 20) {
    const from = (page - 1) * limit;

    const { data, count, error } = await supabaseAdmin
      .from('message_reports')
      .select(`
        id, reason, created_at, reviewed,
        messages (
          id, body, media_url, type, sender_id, created_at,
          conversations ( id, property_id, participant_a, participant_b )
        ),
        reporter:users!reported_by ( id, email, user_profiles(full_name) )
      `, { count: 'exact' })
      .eq('reviewed', false)
      .order('created_at', { ascending: true })
      .range(from, from + limit - 1);

    if (error) throw new Error(`Failed to fetch reported messages: ${error.message}`);
    return { reports: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
  }

  /**
   * Mark a message report as reviewed.
   */
  async resolveMessageReport(reportId: string, adminId: string) {
    const { error } = await supabaseAdmin
      .from('message_reports')
      .update({ reviewed: true, reviewed_by: adminId, reviewed_at: new Date().toISOString() })
      .eq('id', reportId);

    if (error) throw new Error(`Failed to resolve report: ${error.message}`);
    logger.info({ reportId, adminId }, 'admin.message_report.resolved');
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 7: SUBSCRIPTION & PLAN MANAGEMENT
  // Plan CRUD + subscriber counts per plan.
  // ═══════════════════════════════════════════════════════════════════════════

  async getSubscriptionStats() {
    const [all, byStatus, byPlan, pastDue] = await Promise.all([
      supabaseAdmin.from('user_subscriptions').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('user_subscriptions').select('status'),
      supabaseAdmin.from('user_subscriptions').select('subscription_plans(name), status'),
      supabaseAdmin.from('user_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'past_due'),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const r of byStatus.data ?? []) {
      const s = r.status as string;
      statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    }

    const planCounts: Record<string, number> = {};
    for (const r of byPlan.data ?? []) {
      const name = (r.subscription_plans as any)?.name ?? 'unknown';
      planCounts[name] = (planCounts[name] ?? 0) + 1;
    }

    return {
      total:          all.count    ?? 0,
      past_due:       pastDue.count ?? 0,
      by_status:      statusCounts,
      subscribers_by_plan: planCounts,
    };
  }

  /**
   * List all subscription plans with live subscriber count.
   */
  async listSubscriptionPlans() {
    const { data: plans, error } = await supabaseAdmin
      .from('subscription_plans')
      .select(`
        id, name, price_monthly_kes, price_annual_kes,
        viewing_unlocks_per_month, ai_recommendations_per_day,
        saved_searches_limit, alert_frequency,
        priority_support, can_see_price_history, can_see_similar_properties,
        is_active, updated_at
      `)
      .order('price_monthly_kes', { ascending: true });

    if (error) throw new Error(`Failed to list plans: ${error.message}`);

    // Attach subscriber counts
    const { data: counts } = await supabaseAdmin
      .from('user_subscriptions')
      .select('plan_id, status');

    const activeCounts: Record<string, number> = {};
    const totalCounts:  Record<string, number> = {};
    for (const c of counts ?? []) {
      totalCounts[c.plan_id]  = (totalCounts[c.plan_id]  ?? 0) + 1;
      if (c.status === 'active') activeCounts[c.plan_id] = (activeCounts[c.plan_id] ?? 0) + 1;
    }

    return (plans ?? []).map((p) => ({
      ...p,
      active_subscribers: activeCounts[p.id] ?? 0,
      total_subscribers:  totalCounts[p.id]  ?? 0,
    }));
  }

  /**
   * Update a subscription plan's pricing or limits.
   */
  async updateSubscriptionPlan(planId: string, adminId: string, updates: {
    name?: string;
    price_monthly_kes?: number;
    price_annual_kes?: number;
    viewing_unlocks_per_month?: number;
    ai_recommendations_per_day?: number;
    saved_searches_limit?: number;
    priority_support?: boolean;
    can_see_price_history?: boolean;
    can_see_similar_properties?: boolean;
    is_active?: boolean;
  }) {
    const { error } = await supabaseAdmin
      .from('subscription_plans')
      .update({ ...updates, updated_by: adminId, updated_at: new Date().toISOString() })
      .eq('id', planId);

    if (error) throw new Error(`Failed to update plan: ${error.message}`);
    logger.info({ planId, adminId, updates }, 'admin.plan.updated');
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 8: PLATFORM FEE CONFIGURATION
  // Read and update fee_config and viewing_fee_config tables.
  // ═══════════════════════════════════════════════════════════════════════════

  async getFeeConfig() {
    const [feeConfig, viewingFees, listingTiers, boostPackages] = await Promise.all([
      supabaseAdmin.from('fee_config').select('*').order('config_group'),
      supabaseAdmin.from('viewing_fee_config').select('*').order('listing_category').order('property_price_min'),
      supabaseAdmin.from('listing_fee_tiers').select('*').order('listing_category').order('price_min_kes'),
      supabaseAdmin.from('boost_packages').select('*').order('duration_days'),
    ]);

    return {
      fee_config:    feeConfig.data    ?? [],
      viewing_fees:  viewingFees.data  ?? [],
      listing_tiers: listingTiers.data ?? [],
      boost_packages: boostPackages.data ?? [],
    };
  }

  async updateFeeConfigEntry(configKey: string, newValue: number, adminId: string) {
    const { error } = await supabaseAdmin
      .from('fee_config')
      .update({ value: newValue, updated_by: adminId, updated_at: new Date().toISOString() })
      .eq('config_key', configKey);

    if (error) throw new Error(`Failed to update fee config: ${error.message}`);
    logger.info({ configKey, newValue, adminId }, 'admin.fee_config.updated');
    return { success: true };
  }

  async updateViewingFee(feeId: string, updates: {
    viewing_fee_kes?: number;
    fee_valid_days?: number;
    free_for_subscribers?: boolean;
    includes_virtual_tour?: boolean;
  }, adminId: string) {
    const { error } = await supabaseAdmin
      .from('viewing_fee_config')
      .update({ ...updates, updated_by: adminId, updated_at: new Date().toISOString() })
      .eq('id', feeId);

    if (error) throw new Error(`Failed to update viewing fee: ${error.message}`);
    logger.info({ feeId, updates, adminId }, 'admin.viewing_fee.updated');
    return { success: true };
  }

  async updateBoostPackage(packageId: string, updates: {
    name?: string;
    duration_days?: number;
    price_kes?: number;
    visibility_score_bonus?: number;
    badge_label?: string;
    homepage_slot?: boolean;
    push_notification?: boolean;
    is_active?: boolean;
  }, adminId: string) {
    const { error } = await supabaseAdmin
      .from('boost_packages')
      .update({ ...updates, updated_by: adminId, updated_at: new Date().toISOString() })
      .eq('id', packageId);

    if (error) throw new Error(`Failed to update boost package: ${error.message}`);
    logger.info({ packageId, updates, adminId }, 'admin.boost_package.updated');
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 9: SEARCH & ENGAGEMENT ANALYTICS
  // Pulls from search_queries and listing_search_scores.
  // ═══════════════════════════════════════════════════════════════════════════

  async getSearchAnalytics(days = 30) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const [queries, topAreas, topTypes, zeroResults] = await Promise.all([
      supabaseAdmin
        .from('search_queries')
        .select('parsed_listing_category, parsed_area, parsed_bedrooms, result_count, radius_km, searched_at')
        .gte('searched_at', since),

      // Top searched areas
      supabaseAdmin
        .from('search_queries')
        .select('parsed_area')
        .not('parsed_area', 'is', null)
        .gte('searched_at', since),

      // Top searched listing types
      supabaseAdmin
        .from('search_queries')
        .select('parsed_listing_type')
        .not('parsed_listing_type', 'is', null)
        .gte('searched_at', since),

      // Zero-result searches
      supabaseAdmin
        .from('search_queries')
        .select('raw_query, searched_at')
        .eq('result_count', 0)
        .gte('searched_at', since)
        .order('searched_at', { ascending: false })
        .limit(50),
    ]);

    const totalQueries = queries.data?.length ?? 0;
    const avgResults   = totalQueries
      ? round2((queries.data ?? []).reduce((s, r) => s + Number(r.result_count ?? 0), 0) / totalQueries)
      : 0;

    // Count top areas
    const areaCounts: Record<string, number> = {};
    for (const r of topAreas.data ?? []) {
      const a = r.parsed_area as string;
      areaCounts[a] = (areaCounts[a] ?? 0) + 1;
    }
    const topAreasRanked = Object.entries(areaCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([area, count]) => ({ area, count }));

    // Count top types
    const typeCounts: Record<string, number> = {};
    for (const r of topTypes.data ?? []) {
      const t = r.parsed_listing_type as string;
      typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    }
    const topTypesRanked = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([type, count]) => ({ type, count }));

    return {
      period_days:       days,
      total_searches:    totalQueries,
      avg_results_per_search: avgResults,
      zero_result_count: zeroResults.data?.length ?? 0,
      zero_result_queries: (zeroResults.data ?? []).slice(0, 20).map((r) => r.raw_query),
      top_searched_areas:  topAreasRanked,
      top_searched_types:  topTypesRanked,
    };
  }

  /**
   * Top-performing listings by visibility score.
   */
  async getTopListings(limit = 20) {
    const { data, error } = await supabaseAdmin
      .from('listing_search_scores')
      .select(`
        property_id, total_score, boost_score, engagement_score,
        verification_score, base_score, last_recalculated,
        properties!property_id (
          id, title, status, listing_category, is_featured,
          property_locations(county, area),
          property_pricing(monthly_rent, asking_price)
        )
      `)
      .order('total_score', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to fetch top listings: ${error.message}`);
    return data ?? [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 10: SECURITY AUDIT LOG
  // ═══════════════════════════════════════════════════════════════════════════

  async getAuditLog(
    page = 1, limit = 50,
    filters: { eventType?: string; userId?: string; fromDate?: string; toDate?: string } = {},
  ) {
    const from = (page - 1) * limit;

    let q = supabaseAdmin
      .from('security_audit_log')
      .select(`
        id, event_type, ip_address, user_agent, metadata, created_at,
        actor:users!user_id      ( id, email ),
        performer:users!performed_by ( id, email )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (filters.eventType) q = q.eq('event_type', filters.eventType);
    if (filters.userId)    q = q.eq('user_id', filters.userId);
    if (filters.fromDate)  q = q.gte('created_at', filters.fromDate);
    if (filters.toDate)    q = q.lte('created_at', filters.toDate);

    const { data, count, error } = await q;
    if (error) throw new Error(`Failed to fetch audit log: ${error.message}`);

    return { events: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
  }

  async getAuditEventBreakdown(days = 7) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const { data } = await supabaseAdmin
      .from('security_audit_log')
      .select('event_type')
      .gte('created_at', since);

    const counts: Record<string, number> = {};
    for (const r of data ?? []) {
      const t = r.event_type as string;
      counts[t] = (counts[t] ?? 0) + 1;
    }

    return { days, since, by_event_type: counts };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 11: AD CAMPAIGNS
  // ═══════════════════════════════════════════════════════════════════════════

  async getAdCampaignStats() {
    const [all, byStatus, totalSpend, totalImpressions] = await Promise.all([
      supabaseAdmin.from('ad_campaigns').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('ad_campaigns').select('status'),
      supabaseAdmin.from('ad_campaigns').select('spent_kes, budget_kes, impressions, clicks'),
      supabaseAdmin.from('ad_campaigns').select('impressions, clicks'),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const r of byStatus.data ?? []) {
      const s = r.status as string;
      statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    }

    const spend = (totalSpend.data ?? []).reduce((s, r) => ({
      spent:       s.spent + Number(r.spent_kes),
      budget:      s.budget + Number(r.budget_kes),
      impressions: s.impressions + Number(r.impressions),
      clicks:      s.clicks + Number(r.clicks),
    }), { spent: 0, budget: 0, impressions: 0, clicks: 0 });

    const ctr = spend.impressions > 0
      ? round2((spend.clicks / spend.impressions) * 100)
      : 0;

    return {
      total_campaigns:   all.count ?? 0,
      by_status:         statusCounts,
      total_spent_kes:   round2(spend.spent),
      total_budget_kes:  round2(spend.budget),
      total_impressions: spend.impressions,
      total_clicks:      spend.clicks,
      avg_ctr_pct:       ctr,
    };
  }

  async listAdCampaigns(page = 1, limit = 20, status?: string) {
    const from = (page - 1) * limit;

    let q = supabaseAdmin
      .from('ad_campaigns')
      .select(`
        id, headline, body_text, cta_url, status, budget_kes, spent_kes,
        starts_at, ends_at, impressions, clicks, created_at,
        advertisers ( company_name, service_category, contact_phone ),
        ad_placements ( slot_name, pricing_model, rate_kes )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (status) q = q.eq('status', status);

    const { data, count, error } = await q;
    if (error) throw new Error(`Failed to list campaigns: ${error.message}`);
    return { campaigns: data ?? [], total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) };
  }

  async approveAdCampaign(campaignId: string, adminId: string) {
    const { error } = await supabaseAdmin
      .from('ad_campaigns')
      .update({ status: 'active', approved_by: adminId })
      .eq('id', campaignId)
      .eq('status', 'pending_approval');

    if (error) throw new Error(`Failed to approve campaign: ${error.message}`);
    logger.info({ campaignId, adminId }, 'admin.ad_campaign.approved');
    return { success: true };
  }

  async pauseAdCampaign(campaignId: string) {
    const { error } = await supabaseAdmin
      .from('ad_campaigns')
      .update({ status: 'paused' })
      .eq('id', campaignId);

    if (error) throw new Error(`Failed to pause campaign: ${error.message}`);
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 12: REVIEW MANAGEMENT
  // Published reviews across both unified_reviews (LT/visits) and
  // property_reviews (short-stay). Cross-module aggregation only.
  // ═══════════════════════════════════════════════════════════════════════════

  async getReviewStats() {
    const [
      totalPublished, totalHeld, totalRejected,
      avgRating, fiveStarCount, oneStarCount,
      fraudSignalsByType,
    ] = await Promise.all([
      supabaseAdmin.from('unified_reviews').select('id', { count: 'exact', head: true }).eq('status', 'published'),
      supabaseAdmin.from('unified_reviews').select('id', { count: 'exact', head: true }).eq('status', 'held_for_moderation'),
      supabaseAdmin.from('unified_reviews').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
      supabaseAdmin.from('unified_reviews').select('rating_overall').eq('status', 'published'),
      supabaseAdmin.from('unified_reviews').select('id', { count: 'exact', head: true }).eq('rating_overall', 5).eq('status', 'published'),
      supabaseAdmin.from('unified_reviews').select('id', { count: 'exact', head: true }).eq('rating_overall', 1).eq('status', 'published'),
      supabaseAdmin.from('review_fraud_signals').select('signal, confidence'),
    ]);

    const ratings = avgRating.data ?? [];
    const avg = ratings.length
      ? round2(ratings.reduce((s, r) => s + Number(r.rating_overall), 0) / ratings.length)
      : 0;

    const signalCounts: Record<string, { total: number; high: number }> = {};
    for (const s of fraudSignalsByType.data ?? []) {
      const sig = s.signal as string;
      if (!signalCounts[sig]) signalCounts[sig] = { total: 0, high: 0 };
      signalCounts[sig].total++;
      if (s.confidence === 'high') signalCounts[sig].high++;
    }

    return {
      published:       totalPublished.count ?? 0,
      held_moderation: totalHeld.count      ?? 0,
      rejected:        totalRejected.count  ?? 0,
      avg_rating:      avg,
      five_star:       fiveStarCount.count  ?? 0,
      one_star:        oneStarCount.count   ?? 0,
      fraud_signals_by_type: signalCounts,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 13: LISTING REVIEW (pending_review → available / rejected)
  // Staff approve or reject property listings before they go public.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Listings submitted by landlords/developers awaiting staff approval.
   */
  async getPendingListings(page = 1, limit = 20) {
    const from = (page - 1) * limit;

    // Properties that are available but not yet staff-reviewed (published_at IS NULL)
    const { data, count, error } = await supabaseAdmin
      .from('properties')
      .select(`
        id, title, listing_category, listing_type, status, created_at, published_at,
        property_locations ( county, area, sub_county ),
        property_pricing   ( monthly_rent, asking_price, currency ),
        property_media     ( url, thumbnail_url, is_cover, sort_order ),
        owner:users!properties_created_by_fkey (
          id, email,
          user_profiles ( full_name, avatar_url )
        )
      `, { count: 'exact' })
      .eq('status', 'available')
      .is('published_at', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .range(from, from + limit - 1);

    if (error) throw new Error(`Failed to fetch pending listings: ${error.message}`);

    // Flatten nested objects into the shape the frontend expects
    const listings = (data ?? []).map((p: any) => {
      const pricing   = Array.isArray(p.property_pricing) ? p.property_pricing[0] : p.property_pricing;
      const coverMedia = (p.property_media ?? []).find((m: any) => m.is_cover) ?? (p.property_media ?? [])[0];
      return {
        id:            p.id,
        title:         p.title,
        status:        p.status,
        listing_category: p.listing_category,
        property_type: p.listing_type ?? p.listing_category,
        created_at:    p.created_at,
        owner_email:   p.owner?.email ?? '',
        owner_name:    p.owner?.user_profiles?.full_name ?? '',
        owner_avatar:  p.owner?.user_profiles?.avatar_url ?? null,
        price:         pricing?.monthly_rent ?? pricing?.asking_price ?? 0,
        currency:      pricing?.currency ?? 'KES',
        location:      p.property_locations,
        media:         p.property_media ?? [],
        cover_url:     coverMedia?.url ?? null,
      };
    });

    return {
      listings,
      total: count ?? 0,
      page,
      limit,
      pages: Math.ceil((count ?? 0) / limit),
    };
  }

  /**
   * Approve a pending listing — sets status to 'available' so seekers can see it.
   */
  async approveListing(propertyId: string, adminId: string) {
    const { error } = await supabaseAdmin
      .from('properties')
      .update({ published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', propertyId)
      .is('published_at', null);

    if (error) throw new Error(`Failed to approve listing: ${error.message}`);
    logger.info({ propertyId, adminId }, 'admin.listing.approved');
    return { success: true };
  }

  /**
   * Reject a pending listing — sets status to 'off_market' so it disappears from searches.
   * The owner will need to re-submit (contact support) to get it reviewed again.
   */
  async rejectListing(propertyId: string, adminId: string, reason: string) {
    const { error } = await supabaseAdmin
      .from('properties')
      .update({ status: 'off_market', updated_at: new Date().toISOString() })
      .eq('id', propertyId)
      .is('published_at', null);

    if (error) throw new Error(`Failed to reject listing: ${error.message}`);
    logger.info({ propertyId, adminId, reason }, 'admin.listing.rejected');
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 14: VERIFICATION REVIEW (approve / reject ID verifications)
  // On approval: grant the user the requested role.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Approve an ID verification.
   * 1. Mark verification as approved.
   * 2. Assign the requested role to the user.
   */
  async approveVerification(verificationId: string, adminId: string) {
    // Fetch the verification record — no requested_role column in schema,
    // so we infer the role from doc_type.
    const { data: ver, error: fetchErr } = await supabaseAdmin
      .from('id_verifications')
      .select(`
        id, user_id, doc_type, status,
        users:user_id (
          email,
          user_profiles ( full_name )
        )
      `)
      .eq('id', verificationId)
      .single();

    if (fetchErr || !ver) throw new Error(`Failed to fetch verification record: ${fetchErr?.message ?? 'not found'}`);
    if (ver.status !== 'pending') throw new Error('Verification is not pending');

    // Infer the role the user is applying for based on their submitted doc type
    const DOC_TO_ROLE: Record<string, string> = {
      national_id:  'landlord',
      passport:     'landlord',
      company_cert: 'developer',
      nca_cert:     'developer',
      earb_license: 'agent',
    };
    const assignedRole: string = DOC_TO_ROLE[ver.doc_type] ?? 'landlord';

    // Mark verification as approved
    const { error: approveErr } = await supabaseAdmin
      .from('id_verifications')
      .update({
        status:      'approved',
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', verificationId);

    if (approveErr) throw new Error(`Failed to approve verification: ${approveErr.message}`);

    // Look up IDs for the new role AND the seeker role
    const { data: rolesArr } = await supabaseAdmin
      .from('roles')
      .select('id, name')
      .in('name', [assignedRole, 'seeker']);

    const newRoleRow    = rolesArr?.find(r => r.name === assignedRole);
    const seekerRoleRow = rolesArr?.find(r => r.name === 'seeker');

    if (newRoleRow) {
      // Grant the professional role (upsert so re-approvals don't duplicate)
      await supabaseAdmin
        .from('user_roles')
        .upsert(
          {
            user_id:     ver.user_id,
            role_id:     newRoleRow.id,
            is_active:   true,
            verified_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,role_id' },
        );

      // Remove the seeker role once a professional role is granted
      if (seekerRoleRow) {
        await supabaseAdmin
          .from('user_roles')
          .delete()
          .eq('user_id', ver.user_id)
          .eq('role_id', seekerRoleRow.id);
      }
    }

    // Send approval email
    const userData = (ver as any).users;
    if (userData?.email) {
      await emailService.sendVerificationApprovedEmail(
        userData.email,
        userData.user_profiles?.full_name || 'Member',
        assignedRole,
      ).catch(err => logger.error({ err, userId: ver.user_id }, 'admin.approve.email_failed'));
    }

    logger.info({ verificationId, adminId, assignedRole }, 'admin.verification.approved');
    return { success: true, assigned_role: assignedRole };
  }

  /**
   * Reject an ID verification with a reason.
   */
  async rejectVerification(verificationId: string, adminId: string, reason: string) {
    const { data: ver, error: fetchErr } = await supabaseAdmin
      .from('id_verifications')
      .select(`
        id, status, user_id,
        users:user_id (
          email,
          user_profiles ( full_name )
        )
      `)
      .eq('id', verificationId)
      .single();

    if (fetchErr || !ver) throw new Error('Verification not found');
    if (ver.status !== 'pending') throw new Error('Verification is not pending');

    const { error } = await supabaseAdmin
      .from('id_verifications')
      .update({
        status:           'rejected',
        rejection_reason: reason,
        reviewed_by:      adminId,
        reviewed_at:      new Date().toISOString(),
      })
      .eq('id', verificationId);

    if (error) throw new Error(`Failed to reject verification: ${error.message}`);

    // Send Rejection Email
    const userData = (ver as any).users;
    if (userData?.email) {
      await emailService.sendVerificationRejectedEmail(
        userData.email,
        userData.user_profiles?.full_name || 'Member',
        reason,
      ).catch(err => logger.error({ err, userId: ver.user_id }, 'admin.reject.email_failed'));
    }

    logger.info({ verificationId, adminId, reason }, 'admin.verification.rejected');
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private async _getTotalRevenue(): Promise<number> {
    const [l, v, s] = await Promise.all([
      supabaseAdmin.from('listing_payments').select('amount_kes').eq('status', 'paid'),
      supabaseAdmin.from('viewing_unlocks').select('fee_paid_kes').gt('fee_paid_kes', 0),
      supabaseAdmin.from('user_subscriptions').select('amount_kes').in('status', ['active','cancelled']),
    ]);
    const listing = (l.data ?? []).reduce((s, r) => s + Number(r.amount_kes), 0);
    const viewing = (v.data ?? []).reduce((s, r) => s + Number(r.fee_paid_kes), 0);
    const subs    = (s.data ?? []).reduce((s, r) => s + Number(r.amount_kes), 0);
    return listing + viewing + subs;
  }

  private async _getRevenueInRange(from: string, to: string): Promise<number> {
    const [l, v, s] = await Promise.all([
      supabaseAdmin.from('listing_payments').select('amount_kes').eq('status', 'paid').gte('created_at', from).lte('created_at', to),
      supabaseAdmin.from('viewing_unlocks').select('fee_paid_kes').gt('fee_paid_kes', 0).gte('unlocked_at', from).lte('unlocked_at', to),
      supabaseAdmin.from('user_subscriptions').select('amount_kes').in('status', ['active','cancelled']).gte('started_at', from).lte('started_at', to),
    ]);
    return (l.data ?? []).reduce((s, r) => s + Number(r.amount_kes), 0)
      + (v.data ?? []).reduce((s, r) => s + Number(r.fee_paid_kes), 0)
      + (s.data ?? []).reduce((s, r) => s + Number(r.amount_kes), 0);
  }
}

export const adminService = new AdminService();