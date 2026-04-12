/**
 * properties.router.ts
 *
 * Route map:
 *
 *  Public (no auth):
 *    GET  /api/properties              → paginated list with filters
 *    GET  /api/properties/:id          → single property (full detail)
 *
 *  Authenticated — any role:
 *    GET  /api/properties/me           → own listings
 *
 *  Authenticated — landlord | agent | developer (listing creators):
 *    POST   /api/properties                            → create (with all type-specific details)
 *    PATCH  /api/properties/:id                        → update own listing
 *    DELETE /api/properties/:id                        → soft-delete own listing
 *    POST   /api/properties/:id/nearby-places          → add nearby places
 *    DELETE /api/properties/:id/nearby-places/:placeId → remove a nearby place
 *    POST   /api/properties/:id/availability           → add availability blocks (short-term only)
 *    GET    /api/properties/:id/availability           → get availability (short-term only)
 *    DELETE /api/properties/:id/availability/:blockId  → remove availability block
 *
 *  Authenticated — super_admin | staff:
 *    GET    /api/properties/admin/all          → all listings (paginated)
 *    PATCH  /api/properties/:id/status         → set status
 *    PATCH  /api/properties/:id/featured       → toggle featured flag
 *    POST   /api/properties/buildings          → create a rental building
 *
 *  Public (read-only):
 *    GET    /api/properties/buildings          → list all rental buildings
 *    GET    /api/properties/buildings/:id      → get building with its units
 *
 * Security notes:
 *  - Zod validates every request body before it reaches the controller.
 *  - Route ordering: specific named paths (/me, /admin/*) come BEFORE /:id.
 *  - Role guards use the correct role names from the `roles` table.
 */

import { Hono }         from 'hono';
import { zValidator }   from '@hono/zod-validator';
import { z }            from 'zod';
import type { MiddlewareHandler } from 'hono';

import { authenticate }          from '../middleware/auth.middleware.js';
import { propertiesController }  from './properties.controller.js';
import {
  createPropertySchema,
  updatePropertySchema,
  nearbyPlaceInputSchema,
  availabilityBlockSchema,
  createBuildingSchema,
} from '../types/property.types.js';

const propertiesRouter = new Hono();

// ─────────────────────────────────────────────────────────────────────────────
// Role guards
// ─────────────────────────────────────────────────────────────────────────────

/** Staff or super_admin */
const requireAdmin: MiddlewareHandler = async (c, next) => {
  const roles = (c.get('user')?.roles ?? []) as string[];
  if (!roles.includes('super_admin') && !roles.includes('staff')) {
    return c.json({ message: 'Forbidden: admin role required', code: 'FORBIDDEN' }, 403);
  }
  await next();
};

/** Roles that may create and manage listings */
const LISTER_ROLES = ['landlord', 'agent', 'developer', 'caretaker', 'super_admin', 'staff'];

const requireLister: MiddlewareHandler = async (c, next) => {
  const roles = (c.get('user')?.roles ?? []) as string[];
  if (!roles.some((r) => LISTER_ROLES.includes(r))) {
    return c.json(
      { message: 'Forbidden: landlord, agent, or developer role required', code: 'FORBIDDEN' },
      403,
    );
  }
  await next();
};

// ─────────────────────────────────────────────────────────────────────────────
// Schemas for simple patch endpoints
// ─────────────────────────────────────────────────────────────────────────────

const setStatusSchema = z.object({
  status: z.enum(['available', 'let', 'sold', 'off_market', 'under_offer']),
});

const setFeaturedSchema = z.object({
  featured: z.boolean(),
});

const addNearbyPlacesSchema = z.object({
  places: z.array(nearbyPlaceInputSchema).min(1).max(50),
});

const addAvailabilityBlocksSchema = z.object({
  blocks: z.array(availabilityBlockSchema).min(1).max(100),
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Public routes (no auth required)
//    IMPORTANT: declare these BEFORE any /:id wildcard
// ─────────────────────────────────────────────────────────────────────────────

propertiesRouter.get('/', (c) => propertiesController.listProperties(c));

// Buildings - public read-only
propertiesRouter.get('/buildings', (c) => propertiesController.getBuildings(c));
propertiesRouter.get('/buildings/:id', (c) => propertiesController.getBuildingById(c));

// ─────────────────────────────────────────────────────────────────────────────
// 2. Authenticated — any role
// ─────────────────────────────────────────────────────────────────────────────

propertiesRouter.get(
  '/me',
  authenticate,
  (c) => propertiesController.getMyProperties(c),
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Admin-only routes (specific paths before /:id wildcard)
// ─────────────────────────────────────────────────────────────────────────────

propertiesRouter.get(
  '/admin/all',
  authenticate,
  requireAdmin,
  (c) => propertiesController.getAllPropertiesAdmin(c),
);

propertiesRouter.post(
  '/buildings',
  authenticate,
  requireAdmin,
  zValidator('json', createBuildingSchema),
  (c) => propertiesController.createBuilding(c),
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Create (listing roles only)
// ─────────────────────────────────────────────────────────────────────────────

propertiesRouter.post(
  '/',
  authenticate,
  requireLister,
  zValidator('json', createPropertySchema),
  (c) => propertiesController.createProperty(c),
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Single-property read (public) — AFTER named paths, BEFORE mutations
// ─────────────────────────────────────────────────────────────────────────────

propertiesRouter.get('/:id', (c) => propertiesController.getProperty(c));

// ─────────────────────────────────────────────────────────────────────────────
// 6. Mutations on a specific property (owner or admin)
// ─────────────────────────────────────────────────────────────────────────────

propertiesRouter.patch(
  '/:id',
  authenticate,
  zValidator('json', updatePropertySchema),
  (c) => propertiesController.updateProperty(c),
);

propertiesRouter.delete(
  '/:id',
  authenticate,
  (c) => propertiesController.deleteProperty(c),
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. Admin-only mutations on a specific property
// ─────────────────────────────────────────────────────────────────────────────

propertiesRouter.patch(
  '/:id/status',
  authenticate,
  requireAdmin,
  zValidator('json', setStatusSchema),
  (c) => propertiesController.setStatus(c),
);

propertiesRouter.patch(
  '/:id/featured',
  authenticate,
  requireAdmin,
  zValidator('json', setFeaturedSchema),
  (c) => propertiesController.setFeatured(c),
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. Media — upload to Cloudinary, store URL in DB
// ─────────────────────────────────────────────────────────────────────────────

propertiesRouter.post(
  '/:id/media',
  authenticate,
  (c) => propertiesController.uploadMedia(c),
);

propertiesRouter.delete(
  '/:id/media/:mediaId',
  authenticate,
  (c) => propertiesController.deleteMedia(c),
);

// ─────────────────────────────────────────────────────────────────────────────
// 9. Nearby places — owner or admin
// ─────────────────────────────────────────────────────────────────────────────

propertiesRouter.post(
  '/:id/nearby-places',
  authenticate,
  zValidator('json', addNearbyPlacesSchema),
  (c) => propertiesController.addNearbyPlaces(c),
);

propertiesRouter.delete(
  '/:id/nearby-places/:placeId',
  authenticate,
  (c) => propertiesController.deleteNearbyPlace(c),
);

// ─────────────────────────────────────────────────────────────────────────────
// 10. Short-term rental availability calendar
// ─────────────────────────────────────────────────────────────────────────────

propertiesRouter.post(
  '/:id/availability',
  authenticate,
  zValidator('json', addAvailabilityBlocksSchema),
  (c) => propertiesController.addAvailabilityBlocks(c),
);

propertiesRouter.get(
  '/:id/availability',
  (c) => propertiesController.getAvailability(c),
);

propertiesRouter.delete(
  '/:id/availability/:blockId',
  authenticate,
  (c) => propertiesController.deleteAvailabilityBlock(c),
);

export { propertiesRouter };