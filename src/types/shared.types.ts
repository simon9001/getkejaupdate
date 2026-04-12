/**
 * shared.types.ts — Chat, Visit Schedules, Long-Term Bookings, Reviews
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// CHAT
// ─────────────────────────────────────────────────────────────────────────────

export const startConversationSchema = z.object({
  property_id:      z.string().uuid(),
  recipient_id:     z.string().uuid(),
  type:             z.enum(['property_enquiry','visit_coordination','booking_discussion','support']).default('property_enquiry'),
  initial_message:  z.string().min(1).max(2000),
});

export const sendMessageSchema = z.object({
  body:            z.string().max(4000).optional(),
  type:            z.enum(['text','image','document','visit_request','booking_offer','system']).default('text'),
  media_url:       z.string().url().optional(),
  media_mime_type: z.string().max(100).optional(),
  media_filename:  z.string().max(200).optional(),
  reply_to_id:     z.string().uuid().optional(),
  metadata:        z.record(z.string(), z.unknown()).optional(), // ✅ FIXED: Added key type
}).refine(
  (d) => d.body || d.media_url,
  { message: 'Message must have body or media_url' },
);

export const reportMessageSchema = z.object({
  reason: z.string().min(5).max(200),
});

// ─────────────────────────────────────────────────────────────────────────────
// VISIT SCHEDULES
// ─────────────────────────────────────────────────────────────────────────────

export const requestVisitSchema = z.object({
  property_id:       z.string().uuid(),
  proposed_datetime: z.string().datetime({ message: 'Must be ISO 8601' }),
  visit_type:        z.enum(['in_person','virtual']).default('in_person'),
  duration_minutes:  z.number().int().min(15).max(120).default(30),
  notes_from_seeker: z.string().max(500).optional(),
}).refine(
  (d) => new Date(d.proposed_datetime) > new Date(),
  { message: 'Proposed visit time must be in the future', path: ['proposed_datetime'] },
);

export const confirmVisitSchema = z.object({
  confirmed_datetime: z.string().datetime(),
  meeting_point:      z.string().max(300).optional(),
  virtual_link:       z.string().url().optional(),
  notes_from_host:    z.string().max(500).optional(),
});

export const rescheduleVisitSchema = z.object({
  proposed_datetime: z.string().datetime(),
  reason:            z.string().min(5).max(300),
});

export const cancelVisitSchema = z.object({
  reason: z.string().min(5).max(300),
});

export const completeVisitSchema = z.object({
  outcome_notes: z.string().max(1000).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// LONG-TERM BOOKINGS
// ─────────────────────────────────────────────────────────────────────────────

export const applyLongTermSchema = z.object({
  property_id:           z.string().uuid(),
  desired_move_in:       z.string().date(),
  lease_duration_months: z.number().int().min(1).max(60).default(12),
  occupants_count:       z.number().int().min(1).max(20).default(1),
  has_pets:              z.boolean().default(false),
  pets_description:      z.string().max(200).optional(),
  employment_status:     z.string().max(50).optional(),
  monthly_income_kes:    z.number().positive().optional(),
  cover_letter:          z.string().max(2000).optional(),
  id_document_url:       z.string().url().optional(),
}).refine(
  (d) => new Date(d.desired_move_in) >= new Date(new Date().toISOString().split('T')[0]),
  { message: 'Move-in date cannot be in the past', path: ['desired_move_in'] },
);

export const approveLongTermSchema = z.object({
  agreed_monthly_rent_kes: z.number().positive(),
  agreed_deposit_kes:      z.number().nonnegative(),
  agreed_move_in_date:     z.string().date(),
  lease_duration_months:   z.number().int().min(1).max(60),
  notes:                   z.string().max(500).optional(),
});

export const payDepositSchema = z.object({
  payment_method:   z.enum(['mpesa','card','bank_transfer']).default('mpesa'),
  mpesa_phone:      z.string().regex(/^\+?254\d{9}$/).optional(),
  mpesa_ref:        z.string().max(50).optional(),
  amount_paid_kes:  z.number().positive(),
}).refine(
  (d) => d.payment_method !== 'mpesa' || !!d.mpesa_phone,
  { message: 'mpesa_phone required for M-Pesa', path: ['mpesa_phone'] },
);

export const giveNoticeSchema = z.object({
  notice_date:   z.string().date(),
  reason:        z.string().min(5).max(500),
});

export const terminateBookingSchema = z.object({
  termination_date: z.string().date(),
  reason:           z.string().min(5).max(500),
});

// ─────────────────────────────────────────────────────────────────────────────
// REVIEWS
// ─────────────────────────────────────────────────────────────────────────────

const ratingField  = z.number().int().min(1).max(5).optional();
const ratingRequired = z.number().int().min(1).max(5);

export const submitReviewSchema = z.object({
  review_type:         z.enum(['tenant_reviews_property','tenant_reviews_landlord','landlord_reviews_tenant']),

  // Exactly one interaction source
  visit_id:              z.string().uuid().optional(),
  long_term_booking_id:  z.string().uuid().optional(),
  short_stay_booking_id: z.string().uuid().optional(),

  rating_overall:        ratingRequired,
  rating_cleanliness:    ratingField,
  rating_communication:  ratingField,
  rating_accuracy:       ratingField,
  rating_value:          ratingField,
  rating_location:       ratingField,
  rating_maintenance:    ratingField,
  rating_responsiveness: ratingField,
  rating_house_rules:    ratingField,

  review_text:           z.string().min(20).max(3000).optional(),
}).refine(
  (d) => {
    const sources = [d.visit_id, d.long_term_booking_id, d.short_stay_booking_id].filter(Boolean);
    return sources.length === 1;
  },
  { message: 'Exactly one of visit_id, long_term_booking_id, short_stay_booking_id is required' },
).refine(
  // Extreme ratings without text are suspicious — require text for 1 or 5 stars
  (d) => (d.rating_overall >= 2 && d.rating_overall <= 4) || (d.review_text && d.review_text.length >= 20),
  { message: 'Reviews with 1 or 5 stars must include a written review (min 20 characters)', path: ['review_text'] },
);

export const replyToReviewSchema = z.object({
  reply_text: z.string().min(5).max(1000),
});

export const moderateReviewSchema = z.object({
  action:           z.enum(['approve','reject','remove']),
  moderation_notes: z.string().min(5).max(500),
});

export const listReviewsQuerySchema = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(50).default(20),
  sort:   z.enum(['newest','highest','lowest']).default('newest'),
  type:   z.enum(['tenant_reviews_property','tenant_reviews_landlord','landlord_reviews_tenant']).optional(),
});

// Inferred types
export type StartConversationInput  = z.infer<typeof startConversationSchema>;
export type SendMessageInput        = z.infer<typeof sendMessageSchema>;
export type RequestVisitInput       = z.infer<typeof requestVisitSchema>;
export type ConfirmVisitInput       = z.infer<typeof confirmVisitSchema>;
export type RescheduleVisitInput    = z.infer<typeof rescheduleVisitSchema>;
export type CancelVisitInput        = z.infer<typeof cancelVisitSchema>;
export type CompleteVisitInput      = z.infer<typeof completeVisitSchema>;
export type ApplyLongTermInput      = z.infer<typeof applyLongTermSchema>;
export type ApproveLongTermInput    = z.infer<typeof approveLongTermSchema>;
export type PayDepositInput         = z.infer<typeof payDepositSchema>;
export type SubmitReviewInput       = z.infer<typeof submitReviewSchema>;
export type ListReviewsQuery        = z.infer<typeof listReviewsQuerySchema>;