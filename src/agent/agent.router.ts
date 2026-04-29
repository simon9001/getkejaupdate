/**
 * agent.router.ts — mounted at /api/agent
 *
 * ROUTE SUMMARY:
 *   GET /api/agent/dashboard     → KPI cards
 *   GET /api/agent/viewings      → visit schedules on agent's listings (?status=)
 *   GET /api/agent/leads         → conversation leads on agent's listings
 *   GET /api/agent/commissions   → commission tracker + recent deals
 *   GET /api/agent/reports       → portfolio report summary
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { authenticate } from '../middleware/auth.middleware.js';
import { agentController } from './agent.controller.js';

const agentRouter = new Hono();

const requireAgentRole: MiddlewareHandler = async (c, next) => {
  const roles = (c.get('user')?.roles ?? []) as string[];
  const allowed = ['agent', 'landlord', 'super_admin'];
  if (!roles.some(r => allowed.includes(r))) {
    return c.json({ message: 'Forbidden: agent access required', code: 'FORBIDDEN' }, 403);
  }
  await next();
};

agentRouter.use('*', authenticate, requireAgentRole);

agentRouter.get('/dashboard',   (c) => agentController.getDashboard(c));
agentRouter.get('/viewings',    (c) => agentController.getViewings(c));
agentRouter.get('/leads',       (c) => agentController.getLeads(c));
agentRouter.get('/commissions', (c) => agentController.getCommissions(c));
agentRouter.get('/reports',     (c) => agentController.getReports(c));

export { agentRouter };
