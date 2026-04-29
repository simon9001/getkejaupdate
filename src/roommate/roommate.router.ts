/**
 * roommate.router.ts — mounted at /api/roommate
 *
 * ROUTE SUMMARY:
 *   GET  /api/roommate/profiles         → browse listings (public)
 *   POST /api/roommate/profiles         → post your profile (auth required)
 *   POST /api/roommate/profiles/:id/connect  → send connect request (auth required)
 *   GET  /api/roommate/connections      → your connect states (auth required)
 */
import { Hono }                from 'hono';
import { authenticate }        from '../middleware/auth.middleware.js';
import { roommateController }  from './roommate.controller.js';

const roommateRouter = new Hono();

// Public routes
roommateRouter.get('/profiles',  (c) => roommateController.listProfiles(c));

// Authenticated routes
roommateRouter.post('/profiles',              authenticate, (c) => roommateController.createProfile(c));
roommateRouter.post('/profiles/:id/connect',  authenticate, (c) => roommateController.sendConnect(c));
roommateRouter.get('/connections',            authenticate, (c) => roommateController.getMyConnections(c));

export { roommateRouter };
