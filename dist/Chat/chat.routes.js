/**
 * chat.routes.ts
 *
 * Mounted at /api/chat — all routes require authentication.
 *
 * POST   /start                          → start or get existing conversation
 * GET    /conversations                  → list my conversations (paginated)
 * GET    /conversations/:id              → get single conversation + mark read
 * GET    /conversations/:id/messages     → paginated messages (newest first)
 * POST   /conversations/:id/messages     → send a message
 * PATCH  /conversations/:id/archive      → archive conversation
 * PATCH  /conversations/:id/block        → block conversation
 * DELETE /messages/:id                   → soft-delete own message (≤5 min)
 * POST   /messages/:id/report            → report a message
 */
import { Hono } from 'hono';
import { authenticate } from '../middleware/auth.middleware.js';
import { chatService } from '../services/chat.service.js';
import { logger } from '../utils/logger.js';
const chatRouter = new Hono();
// Helper: extract authenticated user id (middleware sets 'userId', not 'id')
const uid = (c) => c.get('user')?.userId;
// ── Start or get conversation ─────────────────────────────────────────────────
chatRouter.post('/start', authenticate, async (c) => {
    try {
        const body = await c.req.json();
        const { property_id, recipient_id, initial_message, type } = body;
        if (!property_id || !recipient_id || !initial_message) {
            return c.json({ message: 'property_id, recipient_id, and initial_message are required', code: 'VALIDATION_ERROR' }, 400);
        }
        const conversation = await chatService.startConversation(uid(c), {
            property_id,
            recipient_id,
            type: type ?? 'property_enquiry',
            initial_message,
        });
        return c.json({ conversation }, 200);
    }
    catch (err) {
        logger.error({ err }, 'chat.start.error');
        const status = err.message?.includes('yourself') || err.message?.includes('blocked') ? 400 : 500;
        return c.json({ message: err.message ?? 'Failed to start conversation', code: 'CHAT_ERROR' }, status);
    }
});
// ── List conversations ────────────────────────────────────────────────────────
chatRouter.get('/conversations', authenticate, async (c) => {
    try {
        const page = Number(c.req.query('page') ?? 1);
        const limit = Number(c.req.query('limit') ?? 30);
        const result = await chatService.getMyConversations(uid(c), page, limit);
        return c.json(result, 200);
    }
    catch (err) {
        logger.error({ err }, 'chat.list.error');
        return c.json({ message: err.message ?? 'Failed to fetch conversations', code: 'CHAT_ERROR' }, 500);
    }
});
// ── Get single conversation ───────────────────────────────────────────────────
chatRouter.get('/conversations/:id', authenticate, async (c) => {
    try {
        const conversation = await chatService.getConversationById(c.req.param('id'), uid(c));
        return c.json({ conversation }, 200);
    }
    catch (err) {
        logger.error({ err }, 'chat.get.error');
        const status = err.message?.includes('Forbidden') ? 403 : err.message?.includes('not found') ? 404 : 500;
        return c.json({ message: err.message ?? 'Failed to fetch conversation', code: 'CHAT_ERROR' }, status);
    }
});
// ── Get messages in a conversation ───────────────────────────────────────────
chatRouter.get('/conversations/:id/messages', authenticate, async (c) => {
    try {
        const page = Number(c.req.query('page') ?? 1);
        const limit = Number(c.req.query('limit') ?? 50);
        const result = await chatService.getMessages(c.req.param('id'), uid(c), page, limit);
        return c.json(result, 200);
    }
    catch (err) {
        logger.error({ err }, 'chat.messages.error');
        const status = err.message?.includes('Forbidden') ? 403 : err.message?.includes('not found') ? 404 : 500;
        return c.json({ message: err.message ?? 'Failed to fetch messages', code: 'CHAT_ERROR' }, status);
    }
});
// ── Send a message ────────────────────────────────────────────────────────────
chatRouter.post('/conversations/:id/messages', authenticate, async (c) => {
    try {
        const body = await c.req.json();
        if (!body.body && !body.media_url) {
            return c.json({ message: 'Message must have body or media_url', code: 'VALIDATION_ERROR' }, 400);
        }
        const message = await chatService.sendMessage(uid(c), c.req.param('id'), {
            body: body.body ?? undefined,
            type: body.type ?? 'text',
            media_url: body.media_url ?? undefined,
            media_mime_type: body.media_mime_type ?? undefined,
            media_filename: body.media_filename ?? undefined,
            reply_to_id: body.reply_to_id ?? undefined,
            metadata: body.metadata ?? undefined,
        });
        return c.json({ message }, 201);
    }
    catch (err) {
        logger.error({ err }, 'chat.send.error');
        const status = err.message?.includes('Forbidden') ? 403 : err.message?.includes('blocked') ? 400 : 500;
        return c.json({ message: err.message ?? 'Failed to send message', code: 'CHAT_ERROR' }, status);
    }
});
// ── Archive conversation ──────────────────────────────────────────────────────
chatRouter.patch('/conversations/:id/archive', authenticate, async (c) => {
    try {
        const result = await chatService.archiveConversation(c.req.param('id'), uid(c));
        return c.json(result, 200);
    }
    catch (err) {
        return c.json({ message: err.message ?? 'Failed to archive conversation', code: 'CHAT_ERROR' }, 400);
    }
});
// ── Block conversation ────────────────────────────────────────────────────────
chatRouter.patch('/conversations/:id/block', authenticate, async (c) => {
    try {
        const result = await chatService.blockConversation(c.req.param('id'), uid(c));
        return c.json(result, 200);
    }
    catch (err) {
        return c.json({ message: err.message ?? 'Failed to block conversation', code: 'CHAT_ERROR' }, 400);
    }
});
// ── Delete a message ──────────────────────────────────────────────────────────
chatRouter.delete('/messages/:id', authenticate, async (c) => {
    try {
        const result = await chatService.deleteMessage(c.req.param('id'), uid(c));
        return c.json(result, 200);
    }
    catch (err) {
        logger.error({ err }, 'chat.delete.error');
        const status = err.message?.includes('Forbidden') ? 403 : err.message?.includes('5 minutes') ? 400 : 500;
        return c.json({ message: err.message ?? 'Failed to delete message', code: 'CHAT_ERROR' }, status);
    }
});
// ── Report a message ──────────────────────────────────────────────────────────
chatRouter.post('/messages/:id/report', authenticate, async (c) => {
    try {
        const { reason } = await c.req.json();
        if (!reason)
            return c.json({ message: 'reason is required', code: 'VALIDATION_ERROR' }, 400);
        const result = await chatService.reportMessage(c.req.param('id'), uid(c), reason);
        return c.json(result, 200);
    }
    catch (err) {
        return c.json({ message: err.message ?? 'Failed to report message', code: 'CHAT_ERROR' }, 500);
    }
});
export { chatRouter };
