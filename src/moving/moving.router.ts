/**
 * moving.router.ts — mounted at /api/moving
 *
 * ROUTE SUMMARY:
 *   GET  /api/moving/companies  → list moving companies (public)
 *   POST /api/moving/quotes     → submit quote request (public)
 *   POST /api/moving/register   → company registration CTA (public)
 */
import { Hono }            from 'hono';
import { movingController } from './moving.controller.js';

const movingRouter = new Hono();

movingRouter.get('/companies', (c) => movingController.listCompanies(c));
movingRouter.post('/quotes',   (c) => movingController.submitQuote(c));
movingRouter.post('/register', (c) => movingController.registerCompany(c));

export { movingRouter };
