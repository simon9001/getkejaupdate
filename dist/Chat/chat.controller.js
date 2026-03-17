import { chatService } from './chat.service.js';
export class ChatController {
    async getOrCreateConversation(c) {
        try {
            const user = c.get('user');
            if (!user)
                return c.json({ error: 'Unauthorized' }, 401);
            const { propertyId, hostId } = await c.req.json();
            const conversation = await chatService.getOrCreateConversation(propertyId, user.userId, hostId);
            return c.json(conversation);
        }
        catch (error) {
            return c.json({ error: error.message }, 500);
        }
    }
    async getMessages(c) {
        try {
            const conversationId = c.req.param('id');
            const user = c.get('user');
            if (!user)
                return c.json({ error: 'Unauthorized' }, 401);
            const messages = await chatService.getConversationMessages(conversationId);
            // Optionally mark as read
            await chatService.markMessagesAsRead(conversationId, user.userId);
            return c.json(messages);
        }
        catch (error) {
            return c.json({ error: error.message }, 500);
        }
    }
    async sendMessage(c) {
        try {
            const user = c.get('user');
            if (!user)
                return c.json({ error: 'Unauthorized' }, 401);
            const { conversationId, message } = await c.req.json();
            const sentMessage = await chatService.sendMessage(conversationId, user.userId, message);
            return c.json(sentMessage, 201);
        }
        catch (error) {
            return c.json({ error: error.message }, 500);
        }
    }
    async getUserConversations(c) {
        try {
            const user = c.get('user');
            if (!user)
                return c.json({ error: 'Unauthorized' }, 401);
            const conversations = await chatService.getUserConversations(user.userId);
            return c.json(conversations);
        }
        catch (error) {
            return c.json({ error: error.message }, 500);
        }
    }
    async getUnreadCount(c) {
        try {
            const user = c.get('user');
            if (!user)
                return c.json({ unreadCount: 0 });
            const count = await chatService.getUnreadCount(user.userId);
            return c.json({ unreadCount: count });
        }
        catch (error) {
            return c.json({ unreadCount: 0 });
        }
    }
}
export const chatController = new ChatController();
