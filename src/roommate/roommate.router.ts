/**
 * roommate.router.ts v2.0 — mounted at /api/roommate
 *
 * All routes require authentication.
 *
 * GET  /profiles/me            → user's own active profiles
 * POST /profiles               → create host or seeker profile
 * DELETE /profiles/:id         → deactivate a profile
 * GET  /matches/as-host        → ranked seeker matches for the user's host profile
 * GET  /matches/as-seeker      → ranked host matches for the user's seeker profile
 * POST /connections            → send a connection request
 * PATCH /connections/:id       → accept or reject a connection
 * GET  /connections            → list all my connections (with mutual reveal if connected)
 */
import { Hono }               from 'hono';
import { authenticate }       from '../middleware/auth.middleware.js';
import { roommateController } from './roommate.controller.js';

const roommateRouter = new Hono();

roommateRouter.use('*', authenticate);

roommateRouter.get('/profiles/me',      (c) => roommateController.getMyProfiles(c));
roommateRouter.post('/profiles',         (c) => roommateController.createProfile(c));
roommateRouter.delete('/profiles/:id',   (c) => roommateController.deactivateProfile(c));

roommateRouter.get('/matches/as-host',   (c) => roommateController.getMatchesAsHost(c));
roommateRouter.get('/matches/as-seeker', (c) => roommateController.getMatchesAsSeeker(c));

roommateRouter.post('/connections',      (c) => roommateController.sendConnection(c));
roommateRouter.patch('/connections/:id', (c) => roommateController.respondToConnection(c));
roommateRouter.get('/connections',       (c) => roommateController.getMyConnections(c));

export { roommateRouter };
