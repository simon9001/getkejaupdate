import type { Context } from 'hono';
import { roommateService } from './roommate.service.js';
import { logger }          from '../utils/logger.js';

function resolveStatus(err: Error): 400 | 403 | 404 | 409 | 500 {
  const msg = err.message.toLowerCase();
  if (msg.includes('not found'))  return 404;
  if (msg.includes('forbidden') || msg.includes('own profile')) return 403;
  if (msg.includes('duplicate') || msg.includes('unique')) return 409;
  if (msg.includes('invalid') || msg.includes('must') || msg.includes('required')) return 400;
  return 500;
}

function fail(c: Context, err: unknown, code: string) {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({ code, message: error.message }, 'roommate.error');
  return c.json({ message: error.message || 'Request failed', code }, resolveStatus(error));
}

export class RoommateController {

  async listProfiles(c: Context) {
    try {
      const { search, gender, budgetMax, area, page, limit } = c.req.query();
      const data = await roommateService.listProfiles({
        search,
        gender,
        budgetMax: budgetMax ? Number(budgetMax) : undefined,
        area,
        page:      page  ? Number(page)  : 1,
        limit:     limit ? Number(limit) : 20,
      });
      return c.json({ ...data, code: 'PROFILES_FETCHED' });
    } catch (err) { return fail(c, err, 'PROFILES_FAILED'); }
  }

  async createProfile(c: Context) {
    try {
      const userId = c.get('user').userId;
      const body   = await c.req.json();
      const data   = await roommateService.createProfile(userId, body);
      return c.json({ profile: data, code: 'PROFILE_CREATED' }, 201);
    } catch (err) { return fail(c, err, 'PROFILE_CREATE_FAILED'); }
  }

  async sendConnect(c: Context) {
    try {
      const userId    = c.get('user').userId;
      const profileId = c.req.param('id');
      const data      = await roommateService.sendConnect(userId, profileId);
      return c.json({ ...data, code: 'CONNECT_SENT' });
    } catch (err) { return fail(c, err, 'CONNECT_FAILED'); }
  }

  async getMyConnections(c: Context) {
    try {
      const userId = c.get('user').userId;
      const data   = await roommateService.getMyConnections(userId);
      return c.json({ connections: data, code: 'CONNECTIONS_FETCHED' });
    } catch (err) { return fail(c, err, 'CONNECTIONS_FAILED'); }
  }
}

export const roommateController = new RoommateController();
