import type { Context } from 'hono';
import { movingService } from './moving.service.js';
import { logger }        from '../utils/logger.js';

function resolveStatus(err: Error): 400 | 403 | 404 | 500 {
  const msg = err.message.toLowerCase();
  if (msg.includes('not found'))  return 404;
  if (msg.includes('forbidden'))  return 403;
  if (msg.includes('invalid') || msg.includes('required')) return 400;
  return 500;
}

function fail(c: Context, err: unknown, code: string) {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({ code, message: error.message }, 'moving.error');
  return c.json({ message: error.message || 'Request failed', code }, resolveStatus(error));
}

export class MovingController {

  async listCompanies(c: Context) {
    try {
      const { search, priceRange, service } = c.req.query();
      const data = await movingService.listCompanies({ search, priceRange, service });
      return c.json({ ...data, code: 'COMPANIES_FETCHED' });
    } catch (err) { return fail(c, err, 'COMPANIES_FAILED'); }
  }

  async submitQuote(c: Context) {
    try {
      const body   = await c.req.json();
      // userId is optional (public route with optional auth)
      const userId = (c.get('user') as any)?.userId ?? undefined;
      const data   = await movingService.submitQuote({ ...body, userId });
      return c.json({ ...data, code: 'QUOTE_SUBMITTED' }, 201);
    } catch (err) { return fail(c, err, 'QUOTE_FAILED'); }
  }

  async registerCompany(c: Context) {
    try {
      const body = await c.req.json();
      const data = await movingService.registerCompany(body);
      return c.json({ ...data, code: 'REGISTRATION_SUBMITTED' }, 201);
    } catch (err) { return fail(c, err, 'REGISTER_FAILED'); }
  }
}

export const movingController = new MovingController();
