/**
 * subscription.types.ts
 *
 * All types derived directly from the PostgreSQL schema.
 * Tables: subscription_plans, user_subscriptions, viewing_fee_config, viewing_unlocks
 */
import { z } from 'zod';
// =============================================================================
// Zod schemas
// =============================================================================
// ── Subscribe / upgrade ──────────────────────────────────────────────────────
export const subscribePlanSchema = z.object({
    plan_id: z.string().uuid('plan_id must be a valid UUID'),
    billing_cycle: z.enum(['monthly', 'annual']).default('monthly'),
    payment_method: z.enum(['mpesa', 'card', 'bank_transfer']).default('mpesa'),
    /**
     * For M-Pesa: the phone number that will receive the STK push.
     * Required when payment_method is 'mpesa'.
     */
    mpesa_phone: z.string().regex(/^\+?254\d{9}$/, 'Must be a valid Kenyan number (+2547XXXXXXXX)').optional(),
}).refine((d) => d.payment_method !== 'mpesa' || !!d.mpesa_phone, { message: 'mpesa_phone is required when payment_method is mpesa', path: ['mpesa_phone'] });
// ── Cancel subscription ──────────────────────────────────────────────────────
export const cancelSubscriptionSchema = z.object({
    reason: z.string().max(500).optional(),
});
// ── Admin: manually set status ───────────────────────────────────────────────
export const adminSetStatusSchema = z.object({
    status: z.enum(['active', 'cancelled', 'past_due', 'expired']),
    reason: z.string().max(500).optional(),
});
// ── Unlock a property for viewing ────────────────────────────────────────────
export const unlockPropertySchema = z.object({
    property_id: z.string().uuid('property_id must be a valid UUID'),
    payment_method: z.enum(['mpesa', 'card', 'bank_transfer']).default('mpesa'),
    mpesa_phone: z.string().regex(/^\+?254\d{9}$/).optional(),
}).refine((d) => d.payment_method !== 'mpesa' || !!d.mpesa_phone, { message: 'mpesa_phone is required when payment_method is mpesa', path: ['mpesa_phone'] });
// ── Book a viewing after unlocking ───────────────────────────────────────────
export const bookViewingSchema = z.object({
    property_id: z.string().uuid(),
    viewing_datetime: z.string().datetime({ message: 'Must be a valid ISO 8601 datetime' }),
});
