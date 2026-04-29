/**
 * developer.controller.ts — Developer HTTP adapter for GETKEJA.
 */

import type { Context } from 'hono';
import { developerService } from './developer.service.js';
import { logger } from '../utils/logger.js';

function resolveStatus(err: Error): 400 | 403 | 404 | 500 {
  const msg = err.message.toLowerCase();
  if (msg.includes('not found')) return 404;
  if (msg.includes('forbidden')) return 403;
  if (msg.includes('invalid') || msg.includes('must')) return 400;
  return 500;
}

function fail(c: Context, err: unknown, code: string) {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({ code, message: error.message }, 'developer.error');
  return c.json({ message: error.message || 'Request failed', code }, resolveStatus(error));
}

export class DeveloperController {

  async getPipeline(c: Context) {
    try {
      const userId = c.get('user').userId;
      const data = await developerService.getPipelineStats(userId);
      return c.json({ ...data, code: 'PIPELINE_FETCHED' });
    } catch (err) { return fail(c, err, 'PIPELINE_FAILED'); }
  }

  async getUnits(c: Context) {
    try {
      const userId = c.get('user').userId;
      const data = await developerService.getUnitTracker(userId);
      return c.json({ ...data, code: 'UNITS_FETCHED' });
    } catch (err) { return fail(c, err, 'UNITS_FAILED'); }
  }
}

export const developerController = new DeveloperController();
