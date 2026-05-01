import type { Context } from 'hono';
import { roommateService } from './roommate.service.js';
import { logger }          from '../utils/logger.js';

function resolveStatus(err: Error): 400 | 403 | 404 | 409 | 429 | 500 {
  const msg = err.message.toLowerCase();
  if (msg.includes('not found'))                                      return 404;
  if (msg.includes('forbidden') || msg.includes('own profile'))       return 403;
  if (msg.includes('already exists') || msg.includes('already have')) return 409;
  if (msg.includes('rate limit') || msg.includes('maximum'))          return 429;
  if (msg.includes('invalid') || msg.includes('must') || msg.includes('required') || msg.includes('first')) return 400;
  return 500;
}

function fail(c: Context, err: unknown, code: string) {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({ code, message: error.message }, 'roommate.error');
  return c.json({ message: error.message || 'Request failed', code }, resolveStatus(error));
}

export class RoommateController {

  async getMyProfiles(c: Context) {
    try {
      const userId = c.get('user').userId;
      const profiles = await roommateService.getMyProfiles(userId);
      return c.json({ profiles });
    } catch (err) { return fail(c, err, 'MY_PROFILES_FAILED'); }
  }

  async createProfile(c: Context) {
    try {
      const userId = c.get('user').userId;
      const body   = await c.req.json();
      const data   = await roommateService.createProfile(userId, body);
      return c.json({ profile: data, code: 'PROFILE_CREATED' }, 201);
    } catch (err) { return fail(c, err, 'PROFILE_CREATE_FAILED'); }
  }

  async deactivateProfile(c: Context) {
    try {
      const userId    = c.get('user').userId;
      const profileId = c.req.param('id');
      await roommateService.deactivateProfile(userId, profileId);
      return c.json({ message: 'Profile deactivated', code: 'PROFILE_DEACTIVATED' });
    } catch (err) { return fail(c, err, 'PROFILE_DEACTIVATE_FAILED'); }
  }

  async getMatchesAsHost(c: Context) {
    try {
      const userId = c.get('user').userId;
      const { page, limit } = c.req.query();
      const data = await roommateService.getMatchesAsHost(
        userId,
        page  ? Number(page)  : 1,
        limit ? Number(limit) : 15,
      );
      return c.json({ ...data, code: 'HOST_MATCHES_FETCHED' });
    } catch (err) { return fail(c, err, 'HOST_MATCHES_FAILED'); }
  }

  async getMatchesAsSeeker(c: Context) {
    try {
      const userId = c.get('user').userId;
      const { page, limit } = c.req.query();
      const data = await roommateService.getMatchesAsSeeker(
        userId,
        page  ? Number(page)  : 1,
        limit ? Number(limit) : 15,
      );
      return c.json({ ...data, code: 'SEEKER_MATCHES_FETCHED' });
    } catch (err) { return fail(c, err, 'SEEKER_MATCHES_FAILED'); }
  }

  async sendConnection(c: Context) {
    try {
      const userId = c.get('user').userId;
      const { targetProfileId, myProfileId } = await c.req.json();
      const data = await roommateService.sendConnection(userId, targetProfileId, myProfileId);
      return c.json({ ...data, code: 'CONNECTION_SENT' });
    } catch (err) { return fail(c, err, 'CONNECTION_FAILED'); }
  }

  async respondToConnection(c: Context) {
    try {
      const userId       = c.get('user').userId;
      const connectionId = c.req.param('id');
      const { action }   = await c.req.json();
      const data = await roommateService.respondToConnection(userId, connectionId, action);
      return c.json({ ...data, code: 'CONNECTION_RESPONDED' });
    } catch (err) { return fail(c, err, 'CONNECTION_RESPOND_FAILED'); }
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
