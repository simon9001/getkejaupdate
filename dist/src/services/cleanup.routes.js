// backend/src/routes/cleanup.routes.ts
import { Hono } from 'hono';
import { cleanupController } from '../services/cleanup.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
const cleanupRouter = new Hono();
// Protected admin routes
cleanupRouter.post('/trigger-cleanup', authenticate, (c) => cleanupController.triggerCleanup(c));
cleanupRouter.post('/trigger-reminders', authenticate, (c) => cleanupController.triggerReminders(c));
cleanupRouter.get('/stats', authenticate, (c) => cleanupController.getCleanupStats(c));
export { cleanupRouter };
