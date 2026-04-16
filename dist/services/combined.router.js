/**
 * combined.router.ts
 *
 * Mounts all four modules under their respective prefixes.
 * Add to index.ts:
 *   import { chatRouter }         from './Chat/chat.router.js';
 *   import { visitsRouter }       from './Visits/visits.router.js';
 *   import { ltBookingsRouter }   from './Bookings/lt-bookings.router.js';
 *   import { reviewsRouter }      from './Reviews/reviews.router.js';
 *   app.route('/api/chat',        chatRouter);
 *   app.route('/api/visits',      visitsRouter);
 *   app.route('/api/bookings',    ltBookingsRouter);
 *   app.route('/api/reviews',     reviewsRouter);
 *
 * ─────────────────────────────────────────────────────────────────────
 * CHAT  /api/chat
 * ─────────────────────────────────────────────────────────────────────
 * POST   /                               → start or retrieve conversation
 * GET    /                               → my conversations (inbox)
 * GET    /:id                            → conversation detail + mark read
 * PATCH  /:id/archive                    → archive conversation
 * PATCH  /:id/block                      → block conversation
 * GET    /:id/messages                   → paginated messages
 * POST   /:id/messages                   → send a message
 * DELETE /:id/messages/:messageId        → soft-delete message (5-min window)
 * POST   /:id/messages/:messageId/report → report abuse
 *
 * ─────────────────────────────────────────────────────────────────────
 * VISITS  /api/visits
 * ─────────────────────────────────────────────────────────────────────
 * POST   /                          → request a visit
 * GET    /my/seeker                  → my visits as seeker
 * GET    /my/host                    → my visits as host
 * GET    /:id                        → single visit detail
 * PATCH  /:id/confirm                → host confirms proposed time
 * PATCH  /:id/reschedule             → either party reschedules
 * PATCH  /:id/cancel                 → either party cancels
 * PATCH  /:id/complete               → host marks visit done
 * PATCH  /:id/no-show                → either party reports no-show
 *
 * ─────────────────────────────────────────────────────────────────────
 * LONG-TERM BOOKINGS  /api/bookings
 * ─────────────────────────────────────────────────────────────────────
 * POST   /apply                      → tenant submits application
 * GET    /my/tenant                  → my applications as tenant
 * GET    /my/landlord                → my applications as landlord
 * GET    /:id                        → booking detail
 * PATCH  /:id/approve                → landlord approves
 * PATCH  /:id/reject                 → landlord rejects
 * POST   /:id/deposit                → tenant pays deposit
 * PATCH  /:id/activate               → landlord confirms move-in
 * PATCH  /:id/notice                 → either party gives notice
 * PATCH  /:id/terminate              → terminate tenancy
 *
 * ─────────────────────────────────────────────────────────────────────
 * REVIEWS  /api/reviews
 * ─────────────────────────────────────────────────────────────────────
 * POST   /                           → submit a review
 * GET    /property/:propertyId       → published property reviews + aggregates
 * GET    /my                         → my given + received reviews
 * PATCH  /:id/edit                   → edit within 48h window
 * POST   /:id/reply                  → reviewee replies publicly
 * GET    /admin/queue                → moderation queue (admin)
 * PATCH  /admin/:id/moderate         → approve / reject / remove
 * PATCH  /admin/signals/:id/resolve  → mark signal resolved
 */
// ─────────────────────────────────────────────────────────────────────────────
// CHAT ROUTER
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { chatService } from './chat.service.js';
import { visitsService } from './visits.service.js';
import { longTermBookingsService } from './long-term-bookings.service.js';
import { reviewsService } from './reviews.service.js';
import { startConversationSchema, sendMessageSchema, reportMessageSchema, requestVisitSchema, confirmVisitSchema, rescheduleVisitSchema, cancelVisitSchema, completeVisitSchema, applyLongTermSchema, approveLongTermSchema, payDepositSchema, giveNoticeSchema, terminateBookingSchema, submitReviewSchema, replyToReviewSchema, moderateReviewSchema, listReviewsQuerySchema, } from '../types/shared.types.js';
// ─────────────────────────────────────────────────────────────────────────────
// Shared admin guard
// ─────────────────────────────────────────────────────────────────────────────
const requireAdmin = async (c, next) => {
    const roles = (c.get('user')?.roles ?? []);
    if (!roles.includes('super_admin') && !roles.includes('staff')) {
        return c.json({ message: 'Forbidden: admin role required', code: 'FORBIDDEN' }, 403);
    }
    await next();
};
function fail(c, err, code) {
    const e = err instanceof Error ? err : new Error(String(err));
    const msg = e.message.toLowerCase();
    const status = msg.includes('not found') ? 404 :
        msg.includes('forbidden') ? 403 :
            msg.includes('already') ? 409 :
                msg.includes('cannot') || msg.includes('only') || msg.includes('window') ? 422 :
                    msg.includes('required') || msg.includes('invalid') || msg.includes('must') ? 400 : 500;
    return c.json({ message: e.message, code }, status);
}
// ═════════════════════════════════════════════════════════════════════════════
// CHAT
// ═════════════════════════════════════════════════════════════════════════════
export const chatRouter = new Hono();
chatRouter.use('*', authenticate);
chatRouter.post('/', zValidator('json', startConversationSchema), async (c) => { try {
    const u = c.get('user');
    return c.json({ conversation: await chatService.startConversation(u.userId, await c.req.json()), code: 'CONVERSATION_STARTED' }, 201);
}
catch (e) {
    return fail(c, e, 'CONVERSATION_START_FAILED');
} });
chatRouter.get('/', async (c) => { try {
    const u = c.get('user');
    const p = Number(c.req.query('page')) || 1;
    const l = Number(c.req.query('limit')) || 30;
    return c.json({ ...(await chatService.getMyConversations(u.userId, p, l)), code: 'CONVERSATIONS_FETCHED' });
}
catch (e) {
    return fail(c, e, 'CONVERSATIONS_FETCH_FAILED');
} });
chatRouter.get('/:id', async (c) => { try {
    const u = c.get('user');
    return c.json({ conversation: await chatService.getConversationById(c.req.param('id'), u.userId), code: 'CONVERSATION_FETCHED' });
}
catch (e) {
    return fail(c, e, 'CONVERSATION_FETCH_FAILED');
} });
chatRouter.patch('/:id/archive', async (c) => { try {
    const u = c.get('user');
    return c.json({ ...(await chatService.archiveConversation(c.req.param('id'), u.userId)), code: 'CONVERSATION_ARCHIVED' });
}
catch (e) {
    return fail(c, e, 'ARCHIVE_FAILED');
} });
chatRouter.patch('/:id/block', async (c) => { try {
    const u = c.get('user');
    return c.json({ ...(await chatService.blockConversation(c.req.param('id'), u.userId)), code: 'CONVERSATION_BLOCKED' });
}
catch (e) {
    return fail(c, e, 'BLOCK_FAILED');
} });
chatRouter.get('/:id/messages', async (c) => { try {
    const u = c.get('user');
    const p = Number(c.req.query('page')) || 1;
    const l = Number(c.req.query('limit')) || 50;
    return c.json({ ...(await chatService.getMessages(c.req.param('id'), u.userId, p, l)), code: 'MESSAGES_FETCHED' });
}
catch (e) {
    return fail(c, e, 'MESSAGES_FETCH_FAILED');
} });
chatRouter.post('/:id/messages', zValidator('json', sendMessageSchema), async (c) => { try {
    const u = c.get('user');
    return c.json({ message: await chatService.sendMessage(u.userId, c.req.param('id'), await c.req.json()), code: 'MESSAGE_SENT' }, 201);
}
catch (e) {
    return fail(c, e, 'MESSAGE_SEND_FAILED');
} });
chatRouter.delete('/:id/messages/:messageId', async (c) => { try {
    const u = c.get('user');
    return c.json({ ...(await chatService.deleteMessage(c.req.param('messageId'), u.userId)), code: 'MESSAGE_DELETED' });
}
catch (e) {
    return fail(c, e, 'MESSAGE_DELETE_FAILED');
} });
chatRouter.post('/:id/messages/:messageId/report', zValidator('json', reportMessageSchema), async (c) => { try {
    const u = c.get('user');
    const { reason } = await c.req.json();
    return c.json({ ...(await chatService.reportMessage(c.req.param('messageId'), u.userId, reason)), code: 'MESSAGE_REPORTED' });
}
catch (e) {
    return fail(c, e, 'REPORT_FAILED');
} });
// ═════════════════════════════════════════════════════════════════════════════
// VISITS
// ═════════════════════════════════════════════════════════════════════════════
export const visitsRouter = new Hono();
visitsRouter.use('*', authenticate);
visitsRouter.post('/', zValidator('json', requestVisitSchema), async (c) => { try {
    const u = c.get('user');
    return c.json({ visit: await visitsService.requestVisit(u.userId, await c.req.json()), code: 'VISIT_REQUESTED' }, 201);
}
catch (e) {
    return fail(c, e, 'VISIT_REQUEST_FAILED');
} });
visitsRouter.get('/my/seeker', async (c) => { try {
    const u = c.get('user');
    return c.json({ visits: await visitsService.getMyVisitsAsSeeker(u.userId, c.req.query('status')), code: 'VISITS_FETCHED' });
}
catch (e) {
    return fail(c, e, 'VISITS_FETCH_FAILED');
} });
visitsRouter.get('/my/host', async (c) => { try {
    const u = c.get('user');
    return c.json({ visits: await visitsService.getMyVisitsAsHost(u.userId, c.req.query('status')), code: 'VISITS_FETCHED' });
}
catch (e) {
    return fail(c, e, 'VISITS_FETCH_FAILED');
} });
visitsRouter.patch('/:id/confirm', zValidator('json', confirmVisitSchema), async (c) => { try {
    const u = c.get('user');
    return c.json({ ...(await visitsService.confirmVisit(c.req.param('id'), u.userId, await c.req.json())), code: 'VISIT_CONFIRMED' });
}
catch (e) {
    return fail(c, e, 'VISIT_CONFIRM_FAILED');
} });
visitsRouter.patch('/:id/reschedule', zValidator('json', rescheduleVisitSchema), async (c) => { try {
    const u = c.get('user');
    return c.json({ ...(await visitsService.rescheduleVisit(c.req.param('id'), u.userId, await c.req.json())), code: 'VISIT_RESCHEDULED' });
}
catch (e) {
    return fail(c, e, 'VISIT_RESCHEDULE_FAILED');
} });
visitsRouter.patch('/:id/cancel', zValidator('json', cancelVisitSchema), async (c) => { try {
    const u = c.get('user');
    const { reason } = await c.req.json();
    return c.json({ ...(await visitsService.cancelVisit(c.req.param('id'), u.userId, reason)), code: 'VISIT_CANCELLED' });
}
catch (e) {
    return fail(c, e, 'VISIT_CANCEL_FAILED');
} });
visitsRouter.patch('/:id/complete', async (c) => { try {
    const u = c.get('user');
    const b = await c.req.json().catch(() => ({}));
    return c.json({ ...(await visitsService.completeVisit(c.req.param('id'), u.userId, b.outcome_notes)), code: 'VISIT_COMPLETED' });
}
catch (e) {
    return fail(c, e, 'VISIT_COMPLETE_FAILED');
} });
visitsRouter.patch('/:id/no-show', async (c) => { try {
    const u = c.get('user');
    return c.json({ ...(await visitsService.markNoShow(c.req.param('id'), u.userId)), code: 'NO_SHOW_RECORDED' });
}
catch (e) {
    return fail(c, e, 'NO_SHOW_FAILED');
} });
// ═════════════════════════════════════════════════════════════════════════════
// LONG-TERM BOOKINGS
// ═════════════════════════════════════════════════════════════════════════════
export const ltBookingsRouter = new Hono();
ltBookingsRouter.use('*', authenticate);
ltBookingsRouter.post('/apply', zValidator('json', applyLongTermSchema), async (c) => { try {
    const u = c.get('user');
    return c.json({ booking: await longTermBookingsService.applyForTenancy(u.userId, await c.req.json()), code: 'APPLICATION_SUBMITTED' }, 201);
}
catch (e) {
    return fail(c, e, 'APPLICATION_FAILED');
} });
ltBookingsRouter.get('/my/tenant', async (c) => { try {
    const u = c.get('user');
    return c.json({ bookings: await longTermBookingsService.getMyApplicationsAsTenant(u.userId, c.req.query('status')), code: 'BOOKINGS_FETCHED' });
}
catch (e) {
    return fail(c, e, 'BOOKINGS_FETCH_FAILED');
} });
ltBookingsRouter.get('/my/landlord', async (c) => { try {
    const u = c.get('user');
    return c.json({ bookings: await longTermBookingsService.getMyApplicationsAsLandlord(u.userId, c.req.query('status')), code: 'BOOKINGS_FETCHED' });
}
catch (e) {
    return fail(c, e, 'BOOKINGS_FETCH_FAILED');
} });
ltBookingsRouter.get('/:id', async (c) => { try {
    const u = c.get('user');
    return c.json({ booking: await longTermBookingsService.getBookingById(c.req.param('id'), u.userId), code: 'BOOKING_FETCHED' });
}
catch (e) {
    return fail(c, e, 'BOOKING_FETCH_FAILED');
} });
ltBookingsRouter.patch('/:id/approve', zValidator('json', approveLongTermSchema), async (c) => { try {
    const u = c.get('user');
    return c.json({ ...(await longTermBookingsService.approveApplication(c.req.param('id'), u.userId, await c.req.json())), code: 'APPLICATION_APPROVED' });
}
catch (e) {
    return fail(c, e, 'APPROVE_FAILED');
} });
ltBookingsRouter.patch('/:id/reject', async (c) => { try {
    const u = c.get('user');
    const { reason } = await c.req.json();
    return c.json({ ...(await longTermBookingsService.rejectApplication(c.req.param('id'), u.userId, reason)), code: 'APPLICATION_REJECTED' });
}
catch (e) {
    return fail(c, e, 'REJECT_FAILED');
} });
ltBookingsRouter.post('/:id/deposit', zValidator('json', payDepositSchema), async (c) => { try {
    const u = c.get('user');
    return c.json({ ...(await longTermBookingsService.payDeposit(c.req.param('id'), u.userId, await c.req.json())), code: 'DEPOSIT_PAID' });
}
catch (e) {
    return fail(c, e, 'DEPOSIT_FAILED');
} });
ltBookingsRouter.patch('/:id/activate', async (c) => { try {
    const u = c.get('user');
    return c.json({ ...(await longTermBookingsService.activateTenancy(c.req.param('id'), u.userId)), code: 'TENANCY_ACTIVATED' });
}
catch (e) {
    return fail(c, e, 'ACTIVATE_FAILED');
} });
ltBookingsRouter.patch('/:id/notice', zValidator('json', giveNoticeSchema), async (c) => { try {
    const u = c.get('user');
    const { notice_date, reason } = await c.req.json();
    return c.json({ ...(await longTermBookingsService.giveNotice(c.req.param('id'), u.userId, notice_date, reason)), code: 'NOTICE_GIVEN' });
}
catch (e) {
    return fail(c, e, 'NOTICE_FAILED');
} });
ltBookingsRouter.patch('/:id/terminate', zValidator('json', terminateBookingSchema), async (c) => { try {
    const u = c.get('user');
    const { termination_date, reason } = await c.req.json();
    return c.json({ ...(await longTermBookingsService.terminateTenancy(c.req.param('id'), u.userId, termination_date, reason)), code: 'TENANCY_TERMINATED' });
}
catch (e) {
    return fail(c, e, 'TERMINATE_FAILED');
} });
// ═════════════════════════════════════════════════════════════════════════════
// REVIEWS
// ═════════════════════════════════════════════════════════════════════════════
export const reviewsRouter = new Hono();
reviewsRouter.use('*', authenticate);
reviewsRouter.post('/', zValidator('json', submitReviewSchema), async (c) => {
    try {
        const u = c.get('user');
        const result = await reviewsService.submitReview(u.userId, await c.req.json(), {
            ip: c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? c.req.header('x-real-ip'),
            userAgent: c.req.header('user-agent'),
        });
        return c.json({ ...result, code: 'REVIEW_SUBMITTED' }, 201);
    }
    catch (e) {
        return fail(c, e, 'REVIEW_SUBMIT_FAILED');
    }
});
reviewsRouter.get('/my', async (c) => { try {
    const u = c.get('user');
    return c.json({ ...(await reviewsService.getMyReviews(u.userId)), code: 'MY_REVIEWS_FETCHED' });
}
catch (e) {
    return fail(c, e, 'MY_REVIEWS_FETCH_FAILED');
} });
reviewsRouter.get('/admin/queue', requireAdmin, async (c) => { try {
    const p = Number(c.req.query('page')) || 1;
    const l = Number(c.req.query('limit')) || 20;
    return c.json({ ...(await reviewsService.getReviewsForModeration(p, l)), code: 'MODERATION_QUEUE_FETCHED' });
}
catch (e) {
    return fail(c, e, 'MODERATION_QUEUE_FAILED');
} });
reviewsRouter.patch('/admin/:id/moderate', requireAdmin, zValidator('json', moderateReviewSchema), async (c) => { try {
    const u = c.get('user');
    const { action, moderation_notes } = await c.req.json();
    return c.json({ ...(await reviewsService.moderateReview(c.req.param('id'), u.userId, action, moderation_notes)), code: 'REVIEW_MODERATED' });
}
catch (e) {
    return fail(c, e, 'MODERATE_FAILED');
} });
reviewsRouter.patch('/admin/signals/:id/resolve', requireAdmin, async (c) => { try {
    const u = c.get('user');
    return c.json({ ...(await reviewsService.resolveSignal(c.req.param('id'), u.userId)), code: 'SIGNAL_RESOLVED' });
}
catch (e) {
    return fail(c, e, 'SIGNAL_RESOLVE_FAILED');
} });
reviewsRouter.get('/property/:propertyId', zValidator('query', listReviewsQuerySchema), async (c) => { try {
    const q = c.req.query();
    return c.json({ ...(await reviewsService.getPropertyReviews(c.req.param('propertyId'), { page: Number(q.page) || 1, limit: Number(q.limit) || 20, sort: (q.sort ?? 'newest'), type: q.type })), code: 'REVIEWS_FETCHED' });
}
catch (e) {
    return fail(c, e, 'REVIEWS_FETCH_FAILED');
} });
reviewsRouter.patch('/:id/edit', async (c) => { try {
    const u = c.get('user');
    const b = await c.req.json();
    return c.json({ ...(await reviewsService.editReview(c.req.param('id'), u.userId, b)), code: 'REVIEW_EDITED' });
}
catch (e) {
    return fail(c, e, 'REVIEW_EDIT_FAILED');
} });
reviewsRouter.post('/:id/reply', zValidator('json', replyToReviewSchema), async (c) => { try {
    const u = c.get('user');
    const { reply_text } = await c.req.json();
    return c.json({ ...(await reviewsService.replyToReview(c.req.param('id'), u.userId, reply_text)), code: 'REPLY_POSTED' });
}
catch (e) {
    return fail(c, e, 'REPLY_FAILED');
} });
