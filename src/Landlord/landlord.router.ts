/**
 * landlord.router.ts
 *
 * Landlord routes for GETKEJA.
 *
 * All routes require: authenticate + requireLandlordRole
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ROUTE SUMMARY:
 *
 * DASHBOARD
 *   GET  /api/landlord/dashboard                     → KPI cards
 *
 * PROPERTIES (CRUD)
 *   GET    /api/landlord/properties                  → list properties
 *   GET    /api/landlord/properties/:id              → get property
 *   POST   /api/landlord/properties                  → create property
 *   PUT    /api/landlord/properties/:id              → update property
 *   DELETE /api/landlord/properties/:id              → delete property
 *   PATCH  /api/landlord/properties/:id/status       → update status
 *
 * PROPERTY MEDIA
 *   POST   /api/landlord/properties/:id/media        → add media
 *   DELETE /api/landlord/properties/:id/media/:mediaId → delete media
 *   PATCH  /api/landlord/properties/:id/media/:mediaId/cover → set cover
 *
 * TENANCIES (Long-term)
 *   GET    /api/landlord/tenancies                   → list tenancies
 *   GET    /api/landlord/tenancies/:id               → get tenancy
 *   POST   /api/landlord/tenancies/:id/approve       → approve application
 *   POST   /api/landlord/tenancies/:id/reject        → reject application
 *   POST   /api/landlord/tenancies/:id/terminate     → terminate active tenancy
 *
 * SHORT-STAY BOOKINGS
 *   GET    /api/landlord/short-stay/bookings         → list bookings
 *   GET    /api/landlord/short-stay/bookings/:id     → get booking
 *   PATCH  /api/landlord/short-stay/bookings/:id/status → update status
 *
 * VISITS (Viewings)
 *   GET    /api/landlord/visits                      → list visits
 *   PATCH  /api/landlord/visits/:id/confirm          → confirm visit
 *   PATCH  /api/landlord/visits/:id/reschedule       → reschedule visit
 *   PATCH  /api/landlord/visits/:id/cancel           → cancel visit
 *
 * MESSAGING
 *   GET    /api/landlord/conversations               → list conversations
 *   GET    /api/landlord/conversations/:id/messages  → get messages
 *   POST   /api/landlord/conversations/:id/messages  → send message
 *   PATCH  /api/landlord/conversations/:id/read      → mark as read
 *
 * TEAM MANAGEMENT
 *   GET    /api/landlord/team                        → list team members
 *   POST   /api/landlord/team/caretaker              → assign caretaker
 *   POST   /api/landlord/team/agent                  → assign agent
 *   DELETE /api/landlord/team/:assignmentId          → remove team member
 *
 * REVENUE & PAYOUTS
 *   GET    /api/landlord/revenue/summary             → revenue summary
 *   GET    /api/landlord/revenue/transactions        → payout list
 *   GET    /api/landlord/revenue/escrow              → escrow balance
 *
 * BOOSTS
 *   GET    /api/landlord/boosts/packages             → available packages
 *   POST   /api/landlord/boosts                      → purchase boost
 *   GET    /api/landlord/boosts/active               → active boosts
 *
 * SUBSCRIPTION
 *   GET    /api/landlord/subscription                → current subscription
 *   POST   /api/landlord/subscription/upgrade        → change plan
 *   POST   /api/landlord/subscription/cancel         → cancel subscription
 *
 * REVIEWS
 *   GET    /api/landlord/reviews                     → property reviews
 *   POST   /api/landlord/reviews/:id/reply           → reply to review
 *
 * PROFILE
 *   GET    /api/landlord/profile                     → get profile
 *   PATCH  /api/landlord/profile                     → update profile
 *   POST   /api/landlord/profile/verify              → submit verification
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { authenticate } from '../middleware/auth.middleware.js';
import { landlordController } from './landlord.controller.js';

const landlordRouter = new Hono();

// ─────────────────────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────────────────────

/** Landlord role required (landlord, developer, or super_admin) */
const requireLandlordRole: MiddlewareHandler = async (c, next) => {
  const roles = (c.get('user')?.roles ?? []) as string[];
  const allowedRoles = ['landlord', 'developer', 'super_admin'];
  if (!roles.some(r => allowedRoles.includes(r))) {
    return c.json({ message: 'Forbidden: landlord access required', code: 'FORBIDDEN' }, 403);
  }
  await next();
};

// Apply auth + landlord guard to every route
landlordRouter.use('*', authenticate, requireLandlordRole);

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

landlordRouter.get('/dashboard', (c) => landlordController.getDashboard(c));

// ─────────────────────────────────────────────────────────────────────────────
// PROPERTIES (CRUD)
// ─────────────────────────────────────────────────────────────────────────────

landlordRouter.get('/properties', (c) => landlordController.listProperties(c));
landlordRouter.get('/properties/:id', (c) => landlordController.getProperty(c));
landlordRouter.post('/properties', (c) => landlordController.createProperty(c));
landlordRouter.put('/properties/:id', (c) => landlordController.updateProperty(c));
landlordRouter.delete('/properties/:id', (c) => landlordController.deleteProperty(c));
landlordRouter.patch('/properties/:id/status', (c) => landlordController.updatePropertyStatus(c));

// ─────────────────────────────────────────────────────────────────────────────
// PROPERTY MEDIA
// ─────────────────────────────────────────────────────────────────────────────

landlordRouter.post('/properties/:id/media', (c) => landlordController.addMedia(c));
landlordRouter.delete('/properties/:id/media/:mediaId', (c) => landlordController.deleteMedia(c));
landlordRouter.patch('/properties/:id/media/:mediaId/cover', (c) => landlordController.setCoverPhoto(c));

// ─────────────────────────────────────────────────────────────────────────────
// TENANCIES (Long-term)
// ─────────────────────────────────────────────────────────────────────────────

landlordRouter.get('/tenancies', (c) => landlordController.listTenancies(c));
landlordRouter.get('/tenancies/:id', (c) => landlordController.getTenancy(c));
landlordRouter.post('/tenancies/:id/approve', (c) => landlordController.approveTenancy(c));
landlordRouter.post('/tenancies/:id/reject', (c) => landlordController.rejectTenancy(c));
landlordRouter.post('/tenancies/:id/terminate', (c) => landlordController.terminateTenancy(c));

// ─────────────────────────────────────────────────────────────────────────────
// SHORT-STAY BOOKINGS
// ─────────────────────────────────────────────────────────────────────────────

landlordRouter.get('/short-stay/bookings', (c) => landlordController.listShortStayBookings(c));
landlordRouter.get('/short-stay/bookings/:id', (c) => landlordController.getShortStayBooking(c));
landlordRouter.patch('/short-stay/bookings/:id/status', (c) => landlordController.updateShortStayBookingStatus(c));

// ─────────────────────────────────────────────────────────────────────────────
// VISITS (Viewings)
// ─────────────────────────────────────────────────────────────────────────────

landlordRouter.get('/visits', (c) => landlordController.listVisits(c));
landlordRouter.patch('/visits/:id/confirm', (c) => landlordController.confirmVisit(c));
landlordRouter.patch('/visits/:id/reschedule', (c) => landlordController.rescheduleVisit(c));
landlordRouter.patch('/visits/:id/cancel', (c) => landlordController.cancelVisit(c));

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGING
// ─────────────────────────────────────────────────────────────────────────────

landlordRouter.get('/conversations', (c) => landlordController.listConversations(c));
landlordRouter.get('/conversations/:id/messages', (c) => landlordController.getMessages(c));
landlordRouter.post('/conversations/:id/messages', (c) => landlordController.sendMessage(c));
landlordRouter.patch('/conversations/:id/read', (c) => landlordController.markConversationRead(c));

// ─────────────────────────────────────────────────────────────────────────────
// TEAM MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

landlordRouter.get('/team', (c) => landlordController.listTeamMembers(c));
landlordRouter.post('/team/caretaker', (c) => landlordController.assignCaretaker(c));
landlordRouter.post('/team/agent', (c) => landlordController.assignAgent(c));
landlordRouter.delete('/team/:assignmentId', (c) => landlordController.removeTeamMember(c));

// ─────────────────────────────────────────────────────────────────────────────
// REVENUE & PAYOUTS
// ─────────────────────────────────────────────────────────────────────────────

landlordRouter.get('/revenue/summary', (c) => landlordController.getRevenueSummary(c));
landlordRouter.get('/revenue/transactions', (c) => landlordController.getPayoutTransactions(c));
landlordRouter.get('/revenue/escrow', (c) => landlordController.getEscrowBalance(c));

// ─────────────────────────────────────────────────────────────────────────────
// BOOSTS
// ─────────────────────────────────────────────────────────────────────────────

landlordRouter.get('/boosts/packages', (c) => landlordController.listBoostPackages(c));
landlordRouter.post('/boosts', (c) => landlordController.purchaseBoost(c));
landlordRouter.get('/boosts/active', (c) => landlordController.listActiveBoosts(c));

// ─────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTION
// ─────────────────────────────────────────────────────────────────────────────

landlordRouter.get('/subscription', (c) => landlordController.getSubscription(c));
landlordRouter.post('/subscription/upgrade', (c) => landlordController.changeSubscription(c));
landlordRouter.post('/subscription/cancel', (c) => landlordController.cancelSubscription(c));

// ─────────────────────────────────────────────────────────────────────────────
// REVIEWS
// ─────────────────────────────────────────────────────────────────────────────

landlordRouter.get('/reviews', (c) => landlordController.getPropertyReviews(c));
landlordRouter.post('/reviews/:id/reply', (c) => landlordController.replyToReview(c));

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────────────────────────────────────

landlordRouter.get('/profile', (c) => landlordController.getProfile(c));
landlordRouter.patch('/profile', (c) => landlordController.updateProfile(c));
landlordRouter.post('/profile/verify', (c) => landlordController.submitVerification(c));

export { landlordRouter };