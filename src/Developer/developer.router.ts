/**
 * developer.router.ts — mounted at /api/developer
 *
 * ROUTE SUMMARY:
 *   GET /api/developer/pipeline  → sales pipeline stats + recent enquiries
 *   GET /api/developer/units     → unit tracker (inventory by status/category)
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { authenticate } from '../middleware/auth.middleware.js';
import { developerController } from './developer.controller.js';

const developerRouter = new Hono();

const requireDeveloperRole: MiddlewareHandler = async (c, next) => {
  const roles = (c.get('user')?.roles ?? []) as string[];
  const allowed = ['developer', 'super_admin'];
  if (!roles.some(r => allowed.includes(r))) {
    return c.json({ message: 'Forbidden: developer access required', code: 'FORBIDDEN' }, 403);
  }
  await next();
};

developerRouter.use('*', authenticate, requireDeveloperRole);

developerRouter.get('/pipeline', (c) => developerController.getPipeline(c));
developerRouter.get('/units',    (c) => developerController.getUnits(c));

export { developerRouter };
