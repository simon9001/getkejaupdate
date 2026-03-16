import { Hono } from 'hono';
import { dashboardController } from './dashboard.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const dashboardRouter = new Hono();

dashboardRouter.get('/stats', authenticate, (c) => dashboardController.getStats(c));

export { dashboardRouter };
