/**
 * subscriptions.service.ts
 *
 * Handles the full subscription lifecycle:
 *   - Browsing available plans
 *   - Subscribing (creates user_subscriptions row + simulates payment)
 *   - Upgrading / downgrading between plans
 *   - Cancelling (sets cancelled_at, status → cancelled)
 *   - Renewal tracking (renews_at date)
 *   - Viewing unlocks (viewing_unlocks table + credit deduction)
 *   - Viewing booking (viewing_datetime on the unlock row)
 *   - Admin: list all subscriptions, change status
 *
 * Payment integration:
 *   The schema stores mpesa_recurring_token (encrypted) for recurring M-Pesa.
 *   In this implementation, payment is simulated with a reference string.
 *   Replace the _simulatePayment() stub with your M-Pesa Daraja / Stripe SDK call.
 *
 * Tables used:
 *   subscription_plans, user_subscriptions, viewing_fee_config,
 *   viewing_unlocks, property_pricing, properties
 */

import { supabaseAdmin } from '../utils/supabase.js';
import { logger }        from '../utils/logger.js';
import type {
  SubscribePlanInput,
  CancelSubscriptionInput,
  AdminSetStatusInput,
  UnlockPropertyInput,
  BookViewingInput,
  SubscriptionStatus,
} from '../types/Subscription.types.js';

// =============================================================================
// SubscriptionsService
// =============================================================================
export class SubscriptionsService {

  // ─────────────────────────────────────────────────────────────────────────
  // PLANS — public
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List all active subscription plans.
   * Public — no auth required.
   */
  async getPlans() {
    const { data, error } = await supabaseAdmin
      .from('subscription_plans')
      .select(`
        id, name, price_monthly_kes, price_annual_kes,
        viewing_unlocks_per_month, ai_recommendations_per_day,
        saved_searches_limit, alert_frequency,
        priority_support, can_see_price_history, can_see_similar_properties
      `)
      .eq('is_active', true)
      .order('price_monthly_kes', { ascending: true });

    if (error) throw new Error(`Failed to fetch plans: ${error.message}`);
    return data ?? [];
  }

  /**
   * Get a single plan by ID.
   */
  async getPlanById(planId: string) {
    const { data, error } = await supabaseAdmin
      .from('subscription_plans')
      .select('*')
      .eq('id', planId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch plan: ${error.message}`);
    if (!data)  throw new Error('Plan not found or inactive');
    return data;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MY SUBSCRIPTION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the current active subscription for the authenticated user.
   * Returns null if the user has no active subscription.
   */
  async getMySubscription(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('user_subscriptions')
      .select(`
        id, billing_cycle, amount_kes, status,
        started_at, renews_at, cancelled_at,
        unlock_credits_used, ai_queries_used_today,
        subscription_plans (
          id, name, price_monthly_kes, price_annual_kes,
          viewing_unlocks_per_month, ai_recommendations_per_day,
          saved_searches_limit, alert_frequency,
          priority_support, can_see_price_history, can_see_similar_properties
        )
      `)
      .eq('user_id', userId)
      .in('status', ['active', 'past_due'])
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch subscription: ${error.message}`);

    if (!data) return null;

    // Attach remaining credits
    const plan = Array.isArray(data.subscription_plans)
      ? data.subscription_plans[0]
      : data.subscription_plans;

    const creditsRemaining = Math.max(
      0,
      (plan?.viewing_unlocks_per_month ?? 0) - (data.unlock_credits_used ?? 0),
    );

    return { ...data, plan, credits_remaining: creditsRemaining };
  }

  /**
   * Get subscription history for a user (all statuses).
   */
  async getMySubscriptionHistory(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('user_subscriptions')
      .select(`
        id, billing_cycle, amount_kes, status,
        started_at, renews_at, cancelled_at,
        subscription_plans ( id, name, price_monthly_kes )
      `)
      .eq('user_id', userId)
      .order('started_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch history: ${error.message}`);
    return data ?? [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUBSCRIBE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe a user to a plan.
   *
   * Rules:
   *  - If user already has an active subscription, they must cancel first
   *    (or call upgradePlan which handles the transition).
   *  - Amount is derived from the plan + billing cycle — never taken from the client.
   *  - Payment is simulated; replace _simulatePayment() with real M-Pesa / Stripe.
   */
  async subscribe(userId: string, input: SubscribePlanInput) {
    const { plan_id, billing_cycle, payment_method, mpesa_phone } = input;

    // ── Guard: no double subscription ────────────────────────────────────
    const existing = await this.getMySubscription(userId);
    if (existing) {
      // .plan is the normalised single-object set inside getMySubscription()
      const existingPlanName = (existing.plan as any)?.name ?? 'unknown plan';
      throw new Error(
        `You already have an active subscription (${existingPlanName}). Cancel it first or use the upgrade endpoint.`,
      );
    }

    // ── Resolve plan + price ──────────────────────────────────────────────
    const plan = await this.getPlanById(plan_id);

    const amountKes =
      billing_cycle === 'annual'
        ? (plan.price_annual_kes ?? plan.price_monthly_kes * 12)
        : plan.price_monthly_kes;

    // Free plan — skip payment entirely
    if (amountKes > 0) {
      await this._simulatePayment({
        userId,
        amountKes,
        paymentMethod: payment_method,
        mpesaPhone:    mpesa_phone,
        description:   `${plan.name} plan – ${billing_cycle} subscription`,
      });
    }

    // ── Compute dates ─────────────────────────────────────────────────────
    const startedAt  = new Date();
    const renewsAt   = this._computeRenewalDate(startedAt, billing_cycle);

    // ── Insert subscription row ───────────────────────────────────────────
    const { data, error } = await supabaseAdmin
      .from('user_subscriptions')
      .insert({
        user_id:                userId,
        plan_id,
        billing_cycle,
        amount_kes:             amountKes,
        status:                 'active',
        started_at:             startedAt.toISOString().split('T')[0],  // DATE
        renews_at:              renewsAt.toISOString().split('T')[0],
        unlock_credits_used:    0,
        ai_queries_used_today:  0,
      })
      .select(`
        id, billing_cycle, amount_kes, status, started_at, renews_at,
        subscription_plans ( id, name, viewing_unlocks_per_month )
      `)
      .single();

    if (error) throw new Error(`Failed to create subscription: ${error.message}`);

    logger.info({ userId, planId: plan_id, billing_cycle }, 'subscription.created');
    return data;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UPGRADE / DOWNGRADE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Upgrade or downgrade to a different plan.
   *
   * Strategy: cancel the current subscription immediately and create a new one.
   * Credits used carry over proportionally — unused credits are forfeited on
   * downgrade (consistent with most SaaS platforms).
   */
  async upgradePlan(userId: string, input: SubscribePlanInput) {
    const current = await this.getMySubscription(userId);

    // If no active subscription, treat as a fresh subscribe
    if (!current) {
      return this.subscribe(userId, input);
    }

    // .plan is the normalised single-object set inside getMySubscription()
    const currentPlanId  = (current.plan as any)?.id;
    if (currentPlanId === input.plan_id && current.billing_cycle === input.billing_cycle) {
      throw new Error('You are already on this plan with the same billing cycle');
    }

    // Cancel current subscription (no refund — pro-rate not implemented)
    await supabaseAdmin
      .from('user_subscriptions')
      .update({
        status:       'cancelled',
        cancelled_at: new Date().toISOString().split('T')[0],
      })
      .eq('id', current.id);

    logger.info(
      { userId, previousSubId: current.id },
      'subscription.upgrade.previous_cancelled',
    );

    // Create the new subscription
    return this.subscribe(userId, input);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CANCEL
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Cancel the user's active subscription.
   * Access remains until `renews_at` — we just stop the renewal.
   */
  async cancelSubscription(userId: string, input: CancelSubscriptionInput) {
    const current = await this.getMySubscription(userId);

    if (!current) {
      throw new Error('No active subscription to cancel');
    }

    const { error } = await supabaseAdmin
      .from('user_subscriptions')
      .update({
        status:       'cancelled',
        cancelled_at: new Date().toISOString().split('T')[0],
      })
      .eq('id', current.id)
      .eq('user_id', userId);

    if (error) throw new Error(`Failed to cancel subscription: ${error.message}`);

    logger.info(
      { userId, subId: current.id, reason: input.reason },
      'subscription.cancelled',
    );

    return {
      message:      'Subscription cancelled. Access continues until the end of the billing period.',
      access_until: current.renews_at,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENEWAL (called by a cron job or webhook)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Process renewal for a specific subscription.
   * Called by a scheduled job that queries subscriptions where
   * renews_at <= today AND status = 'active'.
   *
   * On success: updates renews_at, resets unlock_credits_used and ai_queries_used_today.
   * On payment failure: sets status to 'past_due'.
   */
  async renewSubscription(subscriptionId: string) {
    const { data: sub, error: fetchErr } = await supabaseAdmin
      .from('user_subscriptions')
      .select(`
        id, user_id, plan_id, billing_cycle, amount_kes, status, renews_at,
        subscription_plans ( name )
      `)
      .eq('id', subscriptionId)
      .eq('status', 'active')
      .maybeSingle();

    if (fetchErr || !sub) {
      logger.warn({ subscriptionId }, 'subscription.renew.not_found_or_inactive');
      return;
    }

    try {
      await this._simulatePayment({
        userId:        sub.user_id,
        amountKes:     sub.amount_kes,
        paymentMethod: 'mpesa',
        description:   `Renewal: ${(sub as any).subscription_plans?.name ?? (sub as any).plan?.name ?? 'plan'}`,
      });

      const newRenewsAt = this._computeRenewalDate(
        new Date(sub.renews_at),
        sub.billing_cycle as 'monthly' | 'annual',
      );

      await supabaseAdmin
        .from('user_subscriptions')
        .update({
          renews_at:             newRenewsAt.toISOString().split('T')[0],
          unlock_credits_used:   0,   // reset monthly credits
          ai_queries_used_today: 0,
        })
        .eq('id', subscriptionId);

      logger.info({ subscriptionId, newRenewsAt }, 'subscription.renewed');
    } catch (err: any) {
      // Mark past_due — user can retry payment via the portal
      await supabaseAdmin
        .from('user_subscriptions')
        .update({ status: 'past_due' })
        .eq('id', subscriptionId);

      logger.error({ subscriptionId, err: err.message }, 'subscription.renewal.failed');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VIEWING UNLOCKS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the viewing fee for a property based on its listing category and price.
   * Checks the viewing_fee_config table and the user's subscription.
   */
  async getViewingFee(userId: string, propertyId: string) {
    // Fetch property listing category + price
    const { data: property, error: propErr } = await supabaseAdmin
      .from('properties')
      .select(`
        id, listing_category, status,
        property_pricing ( asking_price, monthly_rent )
      `)
      .eq('id', propertyId)
      .is('deleted_at', null)
      .maybeSingle();

    if (propErr || !property) throw new Error('Property not found');
    if (property.status !== 'available') throw new Error('Property is not available');

    const pricing = Array.isArray(property.property_pricing)
      ? property.property_pricing[0]
      : property.property_pricing;

    const propertyPrice = pricing?.asking_price ?? pricing?.monthly_rent ?? 0;

    // Determine listing_fee_category (viewing_fee_config uses listing_fee_category_enum)
    const feeCategory = this._mapListingCategoryToFeeCategory(property.listing_category);

    // Fetch matching viewing fee config row
    const { data: feeConfig } = await supabaseAdmin
      .from('viewing_fee_config')
      .select('viewing_fee_kes, fee_valid_days, free_for_subscribers, includes_virtual_tour')
      .eq('listing_category', feeCategory)
      .lte('property_price_min', propertyPrice)
      .or(`property_price_max.is.null,property_price_max.gte.${propertyPrice}`)
      .order('property_price_min', { ascending: false })
      .limit(1)
      .maybeSingle();

    const baseFeeKes   = feeConfig?.viewing_fee_kes  ?? 100;
    const feeValidDays = feeConfig?.fee_valid_days   ?? 30;
    const freeForSubs  = feeConfig?.free_for_subscribers ?? false;

    // Check if user already unlocked this property
    const { data: existingUnlock } = await supabaseAdmin
      .from('viewing_unlocks')
      .select('id, unlocked_at, expires_at, viewing_booked')
      .eq('property_id', propertyId)
      .eq('seeker_user_id', userId)
      .maybeSingle();

    if (existingUnlock) {
      const expiresAt = existingUnlock.expires_at
        ? new Date(existingUnlock.expires_at)
        : null;
      const isExpired = expiresAt ? expiresAt < new Date() : false;

      if (!isExpired) {
        return {
          already_unlocked: true,
          fee_kes:          0,
          expires_at:       existingUnlock.expires_at,
          viewing_booked:   existingUnlock.viewing_booked,
        };
      }
    }

    // Check if subscriber gets it free
    const subscription = await this.getMySubscription(userId);
    const isFreeForThisUser = freeForSubs && subscription?.status === 'active';

    // Subscriber credit deduction
    let useCredit = false;
    if (subscription?.status === 'active' && !isFreeForThisUser) {
      // .plan is the normalised single-object set inside getMySubscription()
      const plan = (subscription.plan as any);
      const creditsLeft =
        (plan?.viewing_unlocks_per_month ?? 0) - (subscription.unlock_credits_used ?? 0);
      if (creditsLeft > 0) useCredit = true;
    }

    const effectiveFee = isFreeForThisUser || useCredit ? 0 : baseFeeKes;

    return {
      already_unlocked:      false,
      fee_kes:               effectiveFee,
      base_fee_kes:          baseFeeKes,
      free_for_subscribers:  freeForSubs,
      is_free_for_you:       isFreeForThisUser || useCredit,
      use_credit:            useCredit,
      fee_valid_days:        feeValidDays,
      includes_virtual_tour: feeConfig?.includes_virtual_tour ?? false,
    };
  }

  /**
   * Unlock a property for viewing.
   * - Checks if already unlocked (idempotent).
   * - Deducts a credit if user has an active subscription with credits remaining.
   * - Otherwise charges the viewing fee.
   * - Creates a row in viewing_unlocks.
   */
  async unlockProperty(userId: string, input: UnlockPropertyInput) {
    const { property_id, payment_method, mpesa_phone } = input;

    // Get fee details (includes idempotency check)
    const feeInfo = await this.getViewingFee(userId, property_id);

    if (feeInfo.already_unlocked) {
      return {
        message:    'Property already unlocked',
        expires_at: feeInfo.expires_at,
        was_free:   true,
        code:       'ALREADY_UNLOCKED',
      };
    }

    // If not free, process payment
    if (feeInfo.fee_kes > 0) {
      await this._simulatePayment({
        userId,
        amountKes:     feeInfo.fee_kes,
        paymentMethod: payment_method,
        mpesaPhone:    mpesa_phone,
        description:   `Property viewing unlock`,
      });
    }

    // Deduct credit if applicable
    if (feeInfo.use_credit) {
      const sub = await this.getMySubscription(userId);
      if (sub) {
        await supabaseAdmin
          .from('user_subscriptions')
          .update({ unlock_credits_used: (sub.unlock_credits_used ?? 0) + 1 })
          .eq('id', sub.id);
      }
    }

    // Compute expiry
    const unlockedAt = new Date();
    const expiresAt  = new Date(unlockedAt);
    expiresAt.setDate(expiresAt.getDate() + 30); // 30-day default; fee_valid_days from config

    // Create unlock row (UNIQUE on property_id, seeker_user_id — upsert handles retries)
    const { data, error } = await supabaseAdmin
      .from('viewing_unlocks')
      .upsert(
        {
          property_id,
          seeker_user_id:       userId,
          fee_paid_kes:         feeInfo.fee_kes,
          was_free:             feeInfo.fee_kes === 0,
          mpesa_transaction_id: null,  // set by real payment handler
          unlocked_at:          unlockedAt.toISOString(),
          expires_at:           expiresAt.toISOString(),
          viewing_booked:       false,
        },
        { onConflict: 'property_id,seeker_user_id' },
      )
      .select('id, unlocked_at, expires_at, was_free, fee_paid_kes')
      .single();

    if (error) throw new Error(`Failed to unlock property: ${error.message}`);

    logger.info(
      { userId, propertyId: property_id, fee: feeInfo.fee_kes, useCredit: feeInfo.use_credit },
      'viewing.unlocked',
    );

    return {
      message:    'Property unlocked for viewing',
      code:       'PROPERTY_UNLOCKED',
      unlock:     data,
      was_free:   feeInfo.fee_kes === 0,
      use_credit: feeInfo.use_credit,
    };
  }

  /**
   * Book a physical viewing slot.
   * Requires the property to already be unlocked by this user.
   */
  async bookViewing(userId: string, input: BookViewingInput) {
    const { property_id, viewing_datetime } = input;

    // Verify the property is unlocked and not expired
    const { data: unlock, error } = await supabaseAdmin
      .from('viewing_unlocks')
      .select('id, expires_at, viewing_booked')
      .eq('property_id', property_id)
      .eq('seeker_user_id', userId)
      .maybeSingle();

    if (error || !unlock) {
      throw new Error('Property not unlocked — unlock it before booking a viewing');
    }

    if (unlock.expires_at && new Date(unlock.expires_at) < new Date()) {
      throw new Error('Your viewing unlock has expired. Please unlock the property again.');
    }

    const viewingDate = new Date(viewing_datetime);
    if (viewingDate <= new Date()) {
      throw new Error('Viewing datetime must be in the future');
    }

    const { error: updateErr } = await supabaseAdmin
      .from('viewing_unlocks')
      .update({
        viewing_booked:   true,
        viewing_datetime: viewingDate.toISOString(),
      })
      .eq('id', unlock.id);

    if (updateErr) throw new Error(`Failed to book viewing: ${updateErr.message}`);

    logger.info({ userId, propertyId: property_id, viewingDate }, 'viewing.booked');

    return {
      message:          'Viewing booked successfully',
      code:             'VIEWING_BOOKED',
      property_id,
      viewing_datetime: viewingDate.toISOString(),
    };
  }

  /**
   * Get all viewing unlocks for the authenticated user.
   */
  async getMyUnlocks(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('viewing_unlocks')
      .select(`
        id, property_id, fee_paid_kes, was_free,
        unlocked_at, expires_at, viewing_booked, viewing_datetime,
        properties (
          id, title, listing_category, listing_type, status,
          property_locations ( county, area, estate_name ),
          property_media     ( url, thumbnail_url, is_cover, sort_order )
        )
      `)
      .eq('seeker_user_id', userId)
      .order('unlocked_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch unlocks: ${error.message}`);
    return data ?? [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ADMIN
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Paginated list of all subscriptions (admin only).
   */
  async getAllSubscriptions(page = 1, limit = 20, status?: SubscriptionStatus) {
    const from = (page - 1) * limit;

    let query = supabaseAdmin
      .from('user_subscriptions')
      .select(
        `id, user_id, billing_cycle, amount_kes, status,
         started_at, renews_at, cancelled_at, unlock_credits_used,
         subscription_plans ( id, name, price_monthly_kes ),
         users ( id, email )`,
        { count: 'exact' },
      )
      .order('started_at', { ascending: false })
      .range(from, from + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, count, error } = await query;
    if (error) throw new Error(`Failed to fetch subscriptions: ${error.message}`);

    return {
      subscriptions: data ?? [],
      total:         count ?? 0,
      page,
      limit,
      pages:         Math.ceil((count ?? 0) / limit),
    };
  }

  /**
   * Get all subscriptions for a specific user (admin only).
   */
  async getUserSubscriptions(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('user_subscriptions')
      .select(`
        id, billing_cycle, amount_kes, status,
        started_at, renews_at, cancelled_at,
        unlock_credits_used, ai_queries_used_today,
        subscription_plans ( id, name, price_monthly_kes, viewing_unlocks_per_month )
      `)
      .eq('user_id', userId)
      .order('started_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch user subscriptions: ${error.message}`);
    return data ?? [];
  }

  /**
   * Admin override — set subscription status directly.
   */
  async adminSetStatus(subscriptionId: string, input: AdminSetStatusInput) {
    const patch: Record<string, unknown> = { status: input.status };

    if (input.status === 'cancelled') {
      patch.cancelled_at = new Date().toISOString().split('T')[0];
    }

    const { data, error } = await supabaseAdmin
      .from('user_subscriptions')
      .update(patch)
      .eq('id', subscriptionId)
      .select('id, user_id, status, cancelled_at')
      .single();

    if (error) throw new Error(`Failed to update subscription status: ${error.message}`);

    logger.info(
      { subscriptionId, status: input.status, reason: input.reason },
      'subscription.admin.status_override',
    );

    return data;
  }

  /**
   * Admin: get revenue summary from subscriptions (supplement to vw_daily_revenue view).
   */
  async getRevenueSummary(fromDate: string, toDate: string) {
    const { data, error } = await supabaseAdmin
      .from('user_subscriptions')
      .select('amount_kes, billing_cycle, status, started_at, subscription_plans(name)')
      .gte('started_at', fromDate)
      .lte('started_at', toDate)
      .in('status', ['active', 'cancelled']);

    if (error) throw new Error(`Failed to fetch revenue summary: ${error.message}`);

    const total = (data ?? []).reduce((sum, s) => sum + Number(s.amount_kes), 0);
    const byPlan: Record<string, number> = {};

    for (const sub of data ?? []) {
      const planName = (sub.subscription_plans as any)?.name ?? 'unknown';
      byPlan[planName] = (byPlan[planName] ?? 0) + Number(sub.amount_kes);
    }

    return {
      total_kes:     total,
      by_plan:       byPlan,
      count:         data?.length ?? 0,
      from:          fromDate,
      to:            toDate,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Compute the next renewal date.
   * Monthly: +1 calendar month.
   * Annual:  +1 year.
   */
  private _computeRenewalDate(from: Date, cycle: 'monthly' | 'annual'): Date {
    const d = new Date(from);
    if (cycle === 'annual') {
      d.setFullYear(d.getFullYear() + 1);
    } else {
      d.setMonth(d.getMonth() + 1);
    }
    return d;
  }

  /**
   * Map listing_category_enum values to listing_fee_category_enum values.
   * The schema uses slightly different enums for these two tables.
   */
  private _mapListingCategoryToFeeCategory(listingCategory: string): string {
    const map: Record<string, string> = {
      for_sale:        'for_sale',
      long_term_rent:  'long_term_rent',
      short_term_rent: 'short_term',   // note: fee table uses 'short_term' not 'short_term_rent'
      commercial:      'commercial',
    };
    return map[listingCategory] ?? 'long_term_rent';
  }

  /**
   * Payment simulation stub.
   *
   * Replace with:
   *   - M-Pesa Daraja STK Push for mpesa
   *   - Stripe PaymentIntent for card
   *   - Manual bank transfer reference for bank_transfer
   *
   * Should throw an Error if payment fails so callers can catch and handle.
   */
  private async _simulatePayment(opts: {
    userId:        string;
    amountKes:     number;
    paymentMethod: string;
    mpesaPhone?:   string;
    description:   string;
  }): Promise<string> {
    // In development: always succeed and return a fake reference
    const ref = `SIM-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    logger.info(
      {
        userId:  opts.userId,
        amount:  opts.amountKes,
        method:  opts.paymentMethod,
        phone:   opts.mpesaPhone ?? 'n/a',
        ref,
        desc:    opts.description,
      },
      'payment.simulated',
    );

    return ref;

    /*
     * ── M-Pesa Daraja example (replace above with this when ready) ──────────
     *
     * const mpesaResponse = await mpesaClient.stkPush({
     *   phoneNumber:  opts.mpesaPhone!,
     *   amount:       Math.ceil(opts.amountKes),
     *   accountRef:   opts.userId.slice(0, 12),
     *   description:  opts.description,
     * });
     *
     * if (mpesaResponse.ResponseCode !== '0') {
     *   throw new Error(`M-Pesa payment failed: ${mpesaResponse.ResponseDescription}`);
     * }
     *
     * return mpesaResponse.CheckoutRequestID;
     */
  }
}

export const subscriptionsService = new SubscriptionsService();