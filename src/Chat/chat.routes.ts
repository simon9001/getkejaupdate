import { Hono } from 'hono';
import { chatController } from './chat.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const chatRoutes = new Hono();

chatRoutes.post('/conversations', authenticate, (c) => chatController.getOrCreateConversation(c));
chatRoutes.get('/conversations', authenticate, (c) => chatController.getUserConversations(c));
chatRoutes.get('/conversations/:id/messages', authenticate, (c) => chatController.getMessages(c));
chatRoutes.post('/messages', authenticate, (c) => chatController.sendMessage(c));
chatRoutes.get('/unread-count', authenticate, (c) => chatController.getUnreadCount(c));

export default chatRoutes;
