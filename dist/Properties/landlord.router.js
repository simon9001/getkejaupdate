/**
 * landlord.router.ts
 *
 * Landlord-facing property routes — mounted at /api/landlord/properties
 *
 * Route map (all authenticated):
 *   GET    /                        → list the current user's own properties
 *   POST   /                        → create a new property
 *   GET    /:id                     → get a single property by id
 *   PUT    /:id                     → update own property  (frontend uses PUT)
 *   PATCH  /:id                     → update own property  (alias)
 *   DELETE /:id                     → soft-delete own property
 *   POST   /:id/media               → upload media files (base64)
 *   DELETE /:id/media/:mediaId      → delete a media item
 *   PATCH  /:id/media/:mediaId/cover → set a media item as cover
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { authenticate } from '../middleware/auth.middleware.js';
import { propertiesController } from './properties.controller.js';
import { createPropertySchema, updatePropertySchema, } from '../types/property.types.js';
/** Custom Zod hook — returns a readable { message, fields } instead of the raw ZodError object */
function zodHook(result, c) {
    if (!result.success) {
        const issues = result.error?.issues ?? [];
        const fields = issues.map((i) => ({
            field: i.path?.join('.') ?? '?',
            message: i.message,
        }));
        const message = fields.length
            ? `Validation failed: ${fields.map((f) => `${f.field} — ${f.message}`).join('; ')}`
            : 'Request validation failed';
        return c.json({ message, code: 'VALIDATION_ERROR', fields }, 400);
    }
}
const landlordRouter = new Hono();
/** Roles that may create and manage listings */
const LISTER_ROLES = ['landlord', 'agent', 'developer', 'super_admin', 'staff'];
const requireLister = async (c, next) => {
    const roles = (c.get('user')?.roles ?? []);
    if (!roles.some((r) => LISTER_ROLES.includes(r))) {
        return c.json({ message: 'Forbidden: landlord, agent, or developer role required', code: 'FORBIDDEN' }, 403);
    }
    await next();
};
// GET /api/landlord/properties  → my own properties (paginated)
landlordRouter.get('/', authenticate, (c) => propertiesController.getMyProperties(c));
// POST /api/landlord/properties  → create property
landlordRouter.post('/', authenticate, requireLister, zValidator('json', createPropertySchema, zodHook), (c) => propertiesController.createProperty(c));
// GET /api/landlord/properties/:id  → single property detail
landlordRouter.get('/:id', authenticate, (c) => propertiesController.getProperty(c));
// PUT /api/landlord/properties/:id  → update (frontend uses PUT)
landlordRouter.put('/:id', authenticate, zValidator('json', updatePropertySchema, zodHook), (c) => propertiesController.updateProperty(c));
// PATCH /api/landlord/properties/:id  → update (alias for PATCH callers)
landlordRouter.patch('/:id', authenticate, zValidator('json', updatePropertySchema, zodHook), (c) => propertiesController.updateProperty(c));
// DELETE /api/landlord/properties/:id  → soft delete
landlordRouter.delete('/:id', authenticate, (c) => propertiesController.deleteProperty(c));
// POST /api/landlord/properties/:id/media  → upload media (base64 dataUri or https URL)
landlordRouter.post('/:id/media', authenticate, (c) => propertiesController.uploadMedia(c));
// DELETE /api/landlord/properties/:id/media/:mediaId  → remove media item
landlordRouter.delete('/:id/media/:mediaId', authenticate, (c) => propertiesController.deleteMedia(c));
export { landlordRouter };
