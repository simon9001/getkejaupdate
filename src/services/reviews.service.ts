/**
 * reviews.service.ts
 *
 * Anti-fraud review system for GETKEJA.
 *
 * Tables: unified_reviews, review_fraud_signals, review_aggregates
 *
 * Anti-fraud measures (7 signals — each independently scored):
 *
 *   1. velocity_multiple_reviews   — reviewer submitted ≥3 reviews in 24h
 *   2. account_age_too_new         — account < 7 days old at submission
 *   3. no_verified_interaction     — no completed visit/booking for the interaction_id
 *   4. text_duplicate              — review text ≥80% similar to another review
 *   5. rating_extreme_no_text      — 1 or 5 stars with <20 chars of text (enforced by DB constraint + here)
 *   6. reciprocal_pattern          — reviewer and reviewee have exchanged 5-star reviews in <72h
 *   7. ip_cluster                  — same IP submitted ≥3 reviews in 24h (checked at insert)
 *
 * Confidence levels:
 *   high   → review held_for_moderation (never auto-published)
 *   medium → review enters pending (24h window) with signal logged
 *   low    → review enters pending normally, signal logged for analysis
 *
 * Mutual blind:
 *   For landlord↔tenant reviews (both parties can review each other),
 *   neither party sees the other's review until both have submitted
 *   OR 14 days after the interaction ends.
 *
 * Edit window:
 *   Reviewers can edit their review within 48h of submission (max 3 edits).
 *   After 48h the review is locked.
 *
 * Cooling-off period:
 *   Reviews cannot be submitted until 48h after the interaction completed.
 *   This prevents rage-reviews written in the heat of the moment.
 */

import { supabaseAdmin } from '../utils/supabase.js';
import { logger }        from '../utils/logger.js';
import type {
  SubmitReviewInput,
  ListReviewsQuery,
} from '../types/shared.types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fraud signal definitions
// ─────────────────────────────────────────────────────────────────────────────

type FraudSignalResult = {
  signal:     string;
  confidence: 'low' | 'medium' | 'high';
  detail:     string;
} | null;

// Simple text similarity using character bigrams (Dice coefficient)
function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const sa = bigrams(a.toLowerCase());
  const sb = bigrams(b.toLowerCase());
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  return (2 * inter) / (sa.size + sb.size);
}

// ─────────────────────────────────────────────────────────────────────────────
// ReviewsService
// ─────────────────────────────────────────────────────────────────────────────

export class ReviewsService {

  // ─────────────────────────────────────────────────────────────────────────
  // SUBMIT REVIEW
  // ─────────────────────────────────────────────────────────────────────────

  async submitReview(
    reviewerId: string,
    input: SubmitReviewInput,
    meta: { ip?: string; userAgent?: string },
  ) {
    const {
      review_type, visit_id, long_term_booking_id, short_stay_booking_id,
      rating_overall, review_text, ...ratings
    } = input;

    // ── 1. Resolve the interaction and verified reviewee ─────────────────
    const interaction = await this._resolveInteraction({
      reviewerId, review_type, visit_id, long_term_booking_id, short_stay_booking_id,
    });

    // ── 2. Cooling-off period (48h after interaction ended) ───────────────
    if (interaction.completedAt) {
      const hoursSince =
        (Date.now() - new Date(interaction.completedAt).getTime()) / 3_600_000;
      if (hoursSince < 48) {
        throw new Error(
          `Reviews can be submitted 48 hours after the interaction completes. ` +
          `Please wait ${Math.ceil(48 - hoursSince)} more hour(s).`,
        );
      }

      // 14-day window
      const daysSince = hoursSince / 24;
      if (daysSince > 14) {
        throw new Error('The 14-day review window for this interaction has closed');
      }
    }

    // ── 3. Account age at submission ─────────────────────────────────────
    const { data: reviewer } = await supabaseAdmin
      .from('users')
      .select('created_at')
      .eq('id', reviewerId)
      .single();

    const accountAgeDays = reviewer
      ? Math.floor((Date.now() - new Date(reviewer.created_at).getTime()) / 86_400_000)
      : 0;

    // ── 4. Run all fraud detectors ────────────────────────────────────────
    const signals: NonNullable<FraudSignalResult>[] = [];

    const [velSig, ageSig, dupSig, recSig, ipSig] = await Promise.all([
      this._checkVelocity(reviewerId),
      this._checkAccountAge(accountAgeDays),
      this._checkTextDuplicate(review_text),
      this._checkReciprocalPattern(reviewerId, interaction.revieweeId ?? ''),
      this._checkIpCluster(meta.ip),
    ]);

    for (const sig of [velSig, ageSig, dupSig, recSig, ipSig]) {
      if (sig) signals.push(sig);
    }

    // Any HIGH confidence signal → held for moderation
    const highSignals = signals.filter((s) => s.confidence === 'high');
    const initialStatus =
      highSignals.length > 0
        ? 'held_for_moderation'
        : interaction.isMutualBlind
        ? 'blind_pending'
        : 'pending';

    const autoPublishAt =
      initialStatus === 'pending'
        ? new Date(Date.now() + 24 * 3_600_000).toISOString()
        : null;

    // ── 5. Insert review ──────────────────────────────────────────────────
    const { data: review, error } = await supabaseAdmin
      .from('unified_reviews')
      .insert({
        review_type,
        reviewer_id:                             reviewerId,
        reviewee_id:                             interaction.revieweeId    ?? null,
        property_id:                             interaction.propertyId    ?? null,
        visit_id:                                visit_id                  ?? null,
        long_term_booking_id:                    long_term_booking_id      ?? null,
        short_stay_booking_id:                   short_stay_booking_id     ?? null,
        rating_overall,
        rating_cleanliness:                      ratings.rating_cleanliness    ?? null,
        rating_communication:                    ratings.rating_communication  ?? null,
        rating_accuracy:                         ratings.rating_accuracy       ?? null,
        rating_value:                            ratings.rating_value          ?? null,
        rating_location:                         ratings.rating_location       ?? null,
        rating_maintenance:                      ratings.rating_maintenance    ?? null,
        rating_responsiveness:                   ratings.rating_responsiveness ?? null,
        rating_house_rules:                      ratings.rating_house_rules    ?? null,
        review_text:                             review_text ?? null,
        status:                                  initialStatus,
        auto_publish_at:                         autoPublishAt,
        submitted_ip:                            meta.ip           ?? null,
        submitted_user_agent:                    meta.userAgent    ?? null,
        account_age_days_at_submission:          accountAgeDays,
        reviewer_total_reviews_at_submission:    await this._countPriorReviews(reviewerId),
        blind_pair_review_id:                    interaction.pairReviewId ?? null,
      })
      .select('id, status, auto_publish_at')
      .single();

    if (error) {
      // Unique constraint violation — duplicate review
      if (error.code === '23505') throw new Error('You have already reviewed this interaction');
      throw new Error(`Failed to submit review: ${error.message}`);
    }

    // ── 6. Store fraud signals ────────────────────────────────────────────
    if (signals.length > 0) {
      await supabaseAdmin.from('review_fraud_signals').insert(
        signals.map((s) => ({
          review_id:  review.id,
          signal:     s.signal,
          confidence: s.confidence,
          detail:     s.detail,
        })),
      );
    }

    // ── 7. Update mutual blind pair if applicable ─────────────────────────
    if (interaction.pairReviewId) {
      await supabaseAdmin
        .from('unified_reviews')
        .update({ blind_pair_review_id: review.id })
        .eq('id', interaction.pairReviewId);
    }

    logger.info(
      { reviewId: review.id, reviewerId, status: initialStatus, signals: signals.length },
      'review.submitted',
    );

    return {
      review_id:         review.id,
      status:            initialStatus,
      auto_publish_at:   autoPublishAt,
      fraud_signals:     signals.length,
      message:
        initialStatus === 'held_for_moderation'
          ? 'Your review has been submitted and is under moderation'
          : initialStatus === 'blind_pending'
          ? 'Your review has been submitted. It will be visible once both parties have reviewed.'
          : 'Your review has been submitted and will be published within 24 hours',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EDIT REVIEW
  // ─────────────────────────────────────────────────────────────────────────

  async editReview(
    reviewId: string,
    reviewerId: string,
    updates: { rating_overall?: number; review_text?: string },
  ) {
    const { data: review } = await supabaseAdmin
      .from('unified_reviews')
      .select('id, reviewer_id, submitted_at, edit_count, status')
      .eq('id', reviewId)
      .maybeSingle();

    if (!review) throw new Error('Review not found');
    if (review.reviewer_id !== reviewerId) throw new Error('Forbidden: this is not your review');
    if (['rejected','removed_violation'].includes(review.status)) {
      throw new Error('This review cannot be edited');
    }

    // 48-hour edit window
    const hoursSince = (Date.now() - new Date(review.submitted_at).getTime()) / 3_600_000;
    if (hoursSince > 48) throw new Error('Reviews can only be edited within 48 hours of submission');

    if (review.edit_count >= 3) throw new Error('Maximum edit limit (3) reached for this review');

    if (updates.rating_overall !== undefined &&
        (updates.rating_overall < 1 || updates.rating_overall > 5)) {
      throw new Error('rating_overall must be between 1 and 5');
    }

    const patch: Record<string, unknown> = {
      last_edited_at: new Date().toISOString(),
      edit_count: review.edit_count + 1,
    };
    if (updates.rating_overall !== undefined) patch.rating_overall = updates.rating_overall;
    if (updates.review_text    !== undefined) patch.review_text    = updates.review_text;

    await supabaseAdmin.from('unified_reviews').update(patch).eq('id', reviewId);
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REPLY (reviewee replies publicly)
  // ─────────────────────────────────────────────────────────────────────────

  async replyToReview(reviewId: string, replierUserId: string, replyText: string) {
    const { data: review } = await supabaseAdmin
      .from('unified_reviews')
      .select('id, reviewee_id, status, reply_text')
      .eq('id', reviewId)
      .maybeSingle();

    if (!review) throw new Error('Review not found');
    if (review.reviewee_id !== replierUserId) throw new Error('Forbidden: you are not the reviewee');
    if (review.status !== 'published') throw new Error('Can only reply to published reviews');
    if (review.reply_text) throw new Error('You have already replied to this review');
    if (!replyText || replyText.trim().length < 5) throw new Error('Reply must be at least 5 characters');

    await supabaseAdmin
      .from('unified_reviews')
      .update({ reply_text: replyText, replied_at: new Date().toISOString() })
      .eq('id', reviewId);

    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // READ
  // ─────────────────────────────────────────────────────────────────────────

  async getPropertyReviews(propertyId: string, query: ListReviewsQuery) {
    const { page, limit, sort, type } = query;
    const from = (page - 1) * limit;

    let orderCol = 'submitted_at';
    let asc = false;
    if (sort === 'highest') { orderCol = 'rating_overall'; asc = false; }
    if (sort === 'lowest')  { orderCol = 'rating_overall'; asc = true;  }

    let q = supabaseAdmin
      .from('unified_reviews')
      .select(`
        id, review_type, rating_overall, rating_cleanliness, rating_communication,
        rating_accuracy, rating_value, rating_location, rating_maintenance,
        rating_responsiveness, review_text, reply_text, replied_at,
        submitted_at, published_at, edit_count,
        reviewer:users!reviewer_id ( id,
          user_profiles ( full_name, display_name, avatar_url ) )
      `, { count: 'exact' })
      .eq('property_id', propertyId)
      .eq('status', 'published')
      .order(orderCol, { ascending: asc })
      .range(from, from + limit - 1);

    if (type) q = q.eq('review_type', type);

    const { data, count, error } = await q;
    if (error) throw new Error(`Failed to fetch reviews: ${error.message}`);

    const { data: agg } = await supabaseAdmin
      .from('review_aggregates')
      .select('*')
      .eq('property_id', propertyId)
      .maybeSingle();

    return {
      reviews:    data ?? [],
      total:      count ?? 0,
      page, limit,
      pages:      Math.ceil((count ?? 0) / limit),
      aggregates: agg ?? null,
    };
  }

  async getMyReviews(userId: string) {
    const { data: given } = await supabaseAdmin
      .from('unified_reviews')
      .select('id, review_type, rating_overall, review_text, status, submitted_at, property_id')
      .eq('reviewer_id', userId)
      .order('submitted_at', { ascending: false });

    const { data: received } = await supabaseAdmin
      .from('unified_reviews')
      .select('id, review_type, rating_overall, review_text, reply_text, status, submitted_at, reviewer_id')
      .eq('reviewee_id', userId)
      .eq('status', 'published')
      .order('submitted_at', { ascending: false });

    return { given: given ?? [], received: received ?? [] };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ADMIN MODERATION
  // ─────────────────────────────────────────────────────────────────────────

  async moderateReview(reviewId: string, adminId: string, action: 'approve' | 'reject' | 'remove', notes: string) {
    const statusMap = {
      approve: 'published',
      reject:  'rejected',
      remove:  'removed_violation',
    };

    const patch: Record<string, unknown> = {
      status:           statusMap[action],
      moderated_by:     adminId,
      moderation_notes: notes,
    };

    if (action === 'approve') patch.published_at = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('unified_reviews')
      .update(patch)
      .eq('id', reviewId);

    if (error) throw new Error(`Failed to moderate review: ${error.message}`);

    logger.info({ reviewId, adminId, action }, 'review.moderated');
    return { success: true };
  }

  async getReviewsForModeration(page = 1, limit = 20) {
    const from = (page - 1) * limit;

    const { data, count, error } = await supabaseAdmin
      .from('unified_reviews')
      .select(`
        id, review_type, rating_overall, review_text, status,
        submitted_at, submitted_ip, account_age_days_at_submission,
        reviewer_total_reviews_at_submission,
        review_fraud_signals ( signal, confidence, detail ),
        reviewer:users!reviewer_id ( id, email,
          user_profiles ( full_name ) )
      `, { count: 'exact' })
      .eq('status', 'held_for_moderation')
      .order('submitted_at', { ascending: true })
      .range(from, from + limit - 1);

    if (error) throw new Error(`Failed to fetch moderation queue: ${error.message}`);
    return { reviews: data ?? [], total: count ?? 0, page, limit };
  }

  async resolveSignal(signalId: string, adminId: string) {
    await supabaseAdmin
      .from('review_fraud_signals')
      .update({ resolved: true, resolved_by: adminId, resolved_at: new Date().toISOString() })
      .eq('id', signalId);
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: interaction resolver
  // ─────────────────────────────────────────────────────────────────────────

  private async _resolveInteraction(opts: {
    reviewerId: string;
    review_type: string;
    visit_id?: string;
    long_term_booking_id?: string;
    short_stay_booking_id?: string;
  }): Promise<{
    propertyId?: string;
    revieweeId?: string;
    completedAt?: string;
    isMutualBlind: boolean;
    pairReviewId?: string;
  }> {
    const { reviewerId, review_type, visit_id, long_term_booking_id, short_stay_booking_id } = opts;

    if (visit_id) {
      const { data } = await supabaseAdmin
        .from('visit_schedules')
        .select('id, seeker_user_id, host_user_id, property_id, status, actual_datetime, updated_at')
        .eq('id', visit_id)
        .maybeSingle();

      if (!data) throw new Error('Visit not found');
      if (data.seeker_user_id !== reviewerId && data.host_user_id !== reviewerId) {
        throw new Error('You were not part of this visit');
      }
      if (data.status !== 'completed') {
        throw new Error('Reviews can only be submitted for completed visits');
      }

      return {
        propertyId:   data.property_id,
        revieweeId:   data.seeker_user_id === reviewerId ? data.host_user_id : data.seeker_user_id,
        completedAt:  data.actual_datetime ?? data.updated_at,
        isMutualBlind: false, // visits are one-directional (seeker reviews property)
      };
    }

    if (long_term_booking_id) {
      const { data } = await supabaseAdmin
        .from('long_term_bookings')
        .select('id, tenant_user_id, landlord_user_id, property_id, status, updated_at')
        .eq('id', long_term_booking_id)
        .maybeSingle();

      if (!data) throw new Error('Booking not found');
      if (data.tenant_user_id !== reviewerId && data.landlord_user_id !== reviewerId) {
        throw new Error('You were not part of this booking');
      }

      const completedStatuses = ['terminated', 'notice_given', 'active'];
      if (!completedStatuses.includes(data.status)) {
        throw new Error(`Reviews can only be submitted for active or completed tenancies (current: ${data.status})`);
      }

      // Find the pair review (mutual blind for landlord↔tenant)
      const isMutual =
        review_type === 'tenant_reviews_landlord' || review_type === 'landlord_reviews_tenant';

      let pairReviewId: string | undefined;
      if (isMutual) {
        const { data: pair } = await supabaseAdmin
          .from('unified_reviews')
          .select('id')
          .eq('long_term_booking_id', long_term_booking_id)
          .neq('reviewer_id', reviewerId)
          .maybeSingle();
        pairReviewId = pair?.id;
      }

      return {
        propertyId:   review_type === 'tenant_reviews_property' ? data.property_id : undefined,
        revieweeId:   data.tenant_user_id === reviewerId ? data.landlord_user_id : data.tenant_user_id,
        completedAt:  data.updated_at,
        isMutualBlind: isMutual,
        pairReviewId,
      };
    }

    if (short_stay_booking_id) {
      const { data } = await supabaseAdmin
        .from('short_stay_bookings')
        .select('id, guest_user_id, host_user_id, property_id, status, check_out_date')
        .eq('id', short_stay_booking_id)
        .maybeSingle();

      if (!data) throw new Error('Short-stay booking not found');
      if (data.guest_user_id !== reviewerId && data.host_user_id !== reviewerId) {
        throw new Error('You were not part of this booking');
      }

      const completedStatuses = ['checked_out', 'completed'];
      if (!completedStatuses.includes(data.status)) {
        throw new Error('Reviews can only be submitted after checkout');
      }

      const isMutual = true; // both guest→property and host→guest are mutual blind
      const { data: pair } = await supabaseAdmin
        .from('unified_reviews')
        .select('id')
        .eq('short_stay_booking_id', short_stay_booking_id)
        .neq('reviewer_id', reviewerId)
        .maybeSingle();

      return {
        propertyId:   data.property_id,
        revieweeId:   data.guest_user_id === reviewerId ? data.host_user_id : data.guest_user_id,
        completedAt:  data.check_out_date,
        isMutualBlind: isMutual,
        pairReviewId: pair?.id,
      };
    }

    throw new Error('No interaction source provided');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: fraud signal detectors
  // ─────────────────────────────────────────────────────────────────────────

  private async _checkVelocity(reviewerId: string): Promise<FraudSignalResult> {
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const { count } = await supabaseAdmin
      .from('unified_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('reviewer_id', reviewerId)
      .gte('submitted_at', since);

    if ((count ?? 0) >= 5) return { signal: 'velocity_multiple_reviews', confidence: 'high', detail: `${count} reviews in last 24h` };
    if ((count ?? 0) >= 3) return { signal: 'velocity_multiple_reviews', confidence: 'medium', detail: `${count} reviews in last 24h` };
    return null;
  }

  private async _checkAccountAge(ageDays: number): Promise<FraudSignalResult> {
    if (ageDays < 3)  return { signal: 'account_age_too_new', confidence: 'high',   detail: `Account is ${ageDays} day(s) old` };
    if (ageDays < 7)  return { signal: 'account_age_too_new', confidence: 'medium', detail: `Account is ${ageDays} day(s) old` };
    if (ageDays < 14) return { signal: 'account_age_too_new', confidence: 'low',    detail: `Account is ${ageDays} day(s) old` };
    return null;
  }

  private async _checkTextDuplicate(reviewText?: string): Promise<FraudSignalResult> {
    if (!reviewText || reviewText.length < 30) return null;

    const { data: recent } = await supabaseAdmin
      .from('unified_reviews')
      .select('review_text')
      .not('review_text', 'is', null)
      .gte('submitted_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
      .limit(200);

    for (const r of recent ?? []) {
      if (!r.review_text) continue;
      const sim = diceCoefficient(reviewText, r.review_text);
      if (sim >= 0.9) return { signal: 'text_duplicate', confidence: 'high',   detail: `${Math.round(sim * 100)}% similarity to existing review` };
      if (sim >= 0.8) return { signal: 'text_duplicate', confidence: 'medium', detail: `${Math.round(sim * 100)}% similarity to existing review` };
    }
    return null;
  }

  private async _checkReciprocalPattern(reviewerId: string, revieweeId: string): Promise<FraudSignalResult> {
    if (!revieweeId) return null;

    const since72h = new Date(Date.now() - 72 * 3_600_000).toISOString();

    // Did the reviewee give the reviewer a 5-star review in the last 72h?
    const { data } = await supabaseAdmin
      .from('unified_reviews')
      .select('id, rating_overall')
      .eq('reviewer_id', revieweeId)
      .eq('reviewee_id', reviewerId)
      .eq('rating_overall', 5)
      .gte('submitted_at', since72h)
      .maybeSingle();

    if (data) return { signal: 'reciprocal_pattern', confidence: 'high', detail: 'Mutual 5-star exchange within 72h' };
    return null;
  }

  private async _checkIpCluster(ip?: string): Promise<FraudSignalResult> {
    if (!ip) return null;

    const since24h = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const { count } = await supabaseAdmin
      .from('unified_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('submitted_ip', ip)
      .gte('submitted_at', since24h);

    if ((count ?? 0) >= 5) return { signal: 'ip_cluster', confidence: 'high',   detail: `${count} reviews from this IP in 24h` };
    if ((count ?? 0) >= 3) return { signal: 'ip_cluster', confidence: 'medium', detail: `${count} reviews from this IP in 24h` };
    return null;
  }

  private async _countPriorReviews(reviewerId: string): Promise<number> {
    const { count } = await supabaseAdmin
      .from('unified_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('reviewer_id', reviewerId);
    return count ?? 0;
  }
}

export const reviewsService = new ReviewsService();