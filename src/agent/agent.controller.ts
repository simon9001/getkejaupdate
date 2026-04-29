/**
 * agent.controller.ts — Agent HTTP adapter for GETKEJA.
 */

import type { Context } from 'hono';
import { agentService } from './agent.service.js';
import { logger } from '../utils/logger.js';

function resolveStatus(err: Error): 400 | 403 | 404 | 422 | 500 {
  const msg = err.message.toLowerCase();
  if (msg.includes('not found'))  return 404;
  if (msg.includes('forbidden'))  return 403;
  if (msg.includes('invalid') || msg.includes('must')) return 400;
  return 500;
}

function fail(c: Context, err: unknown, code: string) {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({ code, message: error.message }, 'agent.error');
  return c.json({ message: error.message || 'Request failed', code }, resolveStatus(error));
}

export class AgentController {

  async getDashboard(c: Context) {
    try {
      const userId = c.get('user').userId;
      const data = await agentService.getDashboardStats(userId);
      return c.json({ ...data, code: 'DASHBOARD_FETCHED' });
    } catch (err) { return fail(c, err, 'DASHBOARD_FAILED'); }
  }

  async getViewings(c: Context) {
    try {
      const userId = c.get('user').userId;
      const status = c.req.query('status');
      const data = await agentService.getViewings(userId, status);
      return c.json({ ...data, code: 'VIEWINGS_FETCHED' });
    } catch (err) { return fail(c, err, 'VIEWINGS_FAILED'); }
  }

  async getLeads(c: Context) {
    try {
      const userId = c.get('user').userId;
      const data = await agentService.getLeads(userId);
      return c.json({ ...data, code: 'LEADS_FETCHED' });
    } catch (err) { return fail(c, err, 'LEADS_FAILED'); }
  }

  async getCommissions(c: Context) {
    try {
      const userId = c.get('user').userId;
      const data = await agentService.getCommissions(userId);
      return c.json({ ...data, code: 'COMMISSIONS_FETCHED' });
    } catch (err) { return fail(c, err, 'COMMISSIONS_FAILED'); }
  }

  async getReports(c: Context) {
    try {
      const userId = c.get('user').userId;
      const data = await agentService.getReports(userId);
      return c.json({ ...data, code: 'REPORTS_FETCHED' });
    } catch (err) { return fail(c, err, 'REPORTS_FAILED'); }
  }
}

export const agentController = new AgentController();
