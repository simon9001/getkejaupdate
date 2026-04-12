/**
 * properties.controller.ts
 *
 * Thin HTTP adapter layer — validates input, calls the service, returns
 * consistent JSON responses.  All business logic lives in the service.
 *
 * Error handling contract:
 *   - Service throws Error with a descriptive message
 *   - Controller maps well-known message fragments to HTTP status codes
 *   - Fallback is always 500 with a sanitised message
 */

import type { Context } from 'hono';
import { propertiesService } from './properties.service.js';
import { logger }            from '../utils/logger.js';

// Helper: map a thrown error to an appropriate HTTP status code
function resolveStatus(err: Error): 400 | 403 | 404 | 409 | 500 {
  const msg = err.message.toLowerCase();
  if (msg.includes('not found'))               return 404;
  if (msg.includes('forbidden') || msg.includes('do not own')) return 403;
  if (msg.includes('already exists'))          return 409;
  if (msg.includes('required') || msg.includes('invalid') || msg.includes('missing')) return 400;
  return 500;
}

function fail(c: Context, err: unknown, context: string) {
  const error = err instanceof Error ? err : new Error(String(err));
  const status = resolveStatus(error);
  logger.error(
    { requestId: c.get('requestId'), context, message: error.message },
    'properties.controller.error',
  );
  return c.json(
    { message: error.message || 'Request failed', code: context.toUpperCase() },
    status,
  );
}

export class PropertiesController {

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/properties
  // ─────────────────────────────────────────────────────────────────────────
  async createProperty(c: Context) {
    try {
      const user  = c.get('user');
      const input = await c.req.json();

      const property = await propertiesService.createProperty(user.userId, input);

      return c.json(
        { message: 'Property created successfully', code: 'PROPERTY_CREATED', property },
        201,
      );
    } catch (err) {
      return fail(c, err, 'PROPERTY_CREATE_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/properties/:id
  // ─────────────────────────────────────────────────────────────────────────
  async getProperty(c: Context) {
    try {
      const id       = c.req.param('id');
      const property = await propertiesService.getPropertyById(id);
      return c.json({ property, code: 'PROPERTY_FETCHED' });
    } catch (err) {
      return fail(c, err, 'PROPERTY_FETCH_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/properties
  // ─────────────────────────────────────────────────────────────────────────
  async listProperties(c: Context) {
    try {
      const q = c.req.query();
      const result = await propertiesService.listProperties({
        page:                Number(q.page)   || 1,
        limit:               Math.min(100, Number(q.limit) || 20),
        listing_category:    q.listing_category  as any,
        listing_type:        q.listing_type       as any,
        status:              q.status             as any,
        county:              q.county,
        area:                q.area,
        min_price:           q.min_price    ? Number(q.min_price)    : undefined,
        max_price:           q.max_price    ? Number(q.max_price)    : undefined,
        bedrooms:            q.bedrooms     ? Number(q.bedrooms)     : undefined,
        is_furnished:        q.is_furnished as any,
        is_featured:         q.is_featured  ? q.is_featured === 'true' : undefined,
        construction_status: q.construction_status as any,
        lat:                 q.lat    ? Number(q.lat)    : undefined,
        lng:                 q.lng    ? Number(q.lng)    : undefined,
        radius:              q.radius ? Number(q.radius) : 5,
      });
      return c.json({ ...result, code: 'PROPERTIES_LISTED' });
    } catch (err) {
      return fail(c, err, 'PROPERTIES_LIST_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PATCH /api/properties/:id
  // ─────────────────────────────────────────────────────────────────────────
  async updateProperty(c: Context) {
    try {
      const user    = c.get('user');
      const id      = c.req.param('id');
      const input   = await c.req.json();
      const isAdmin = (user.roles as string[]).some((r) => ['super_admin', 'staff'].includes(r));

      const property = await propertiesService.updateProperty(id, user.userId, input, isAdmin);
      return c.json({ message: 'Property updated', code: 'PROPERTY_UPDATED', property });
    } catch (err) {
      return fail(c, err, 'PROPERTY_UPDATE_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE /api/properties/:id
  // ─────────────────────────────────────────────────────────────────────────
  async deleteProperty(c: Context) {
    try {
      const user    = c.get('user');
      const id      = c.req.param('id');
      const isAdmin = (user.roles as string[]).some((r) => ['super_admin', 'staff'].includes(r));

      await propertiesService.deleteProperty(id, user.userId, isAdmin);
      return c.json({ message: 'Property deleted', code: 'PROPERTY_DELETED' });
    } catch (err) {
      return fail(c, err, 'PROPERTY_DELETE_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/properties/me
  // ─────────────────────────────────────────────────────────────────────────
  async getMyProperties(c: Context) {
    try {
      const user   = c.get('user');
      const status = c.req.query('status');
      const result = await propertiesService.getMyProperties(user.userId, { status });
      return c.json({ properties: result, total: result.length, code: 'MY_PROPERTIES_FETCHED' });
    } catch (err) {
      return fail(c, err, 'MY_PROPERTIES_FETCH_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PATCH /api/properties/:id/status  (admin)
  // ─────────────────────────────────────────────────────────────────────────
  async setStatus(c: Context) {
    try {
      const id     = c.req.param('id');
      const { status } = await c.req.json() as { status: string };

      if (!status) {
        return c.json({ message: 'status is required', code: 'MISSING_STATUS' }, 400);
      }

      const property = await propertiesService.setPropertyStatus(id, status);
      return c.json({ message: 'Status updated', code: 'STATUS_UPDATED', property });
    } catch (err) {
      return fail(c, err, 'STATUS_UPDATE_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PATCH /api/properties/:id/featured  (admin)
  // ─────────────────────────────────────────────────────────────────────────
  async setFeatured(c: Context) {
    try {
      const id = c.req.param('id');
      const { featured } = await c.req.json() as { featured: boolean };

      if (typeof featured !== 'boolean') {
        return c.json({ message: 'featured must be a boolean', code: 'INVALID_FIELD' }, 400);
      }

      const property = await propertiesService.setFeatured(id, featured);
      return c.json({
        message: featured ? 'Property marked as featured' : 'Featured status removed',
        code:    'FEATURED_UPDATED',
        property,
      });
    } catch (err) {
      return fail(c, err, 'FEATURED_UPDATE_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/properties/admin/all  (admin)
  // ─────────────────────────────────────────────────────────────────────────
  async getAllPropertiesAdmin(c: Context) {
    try {
      const page  = Number(c.req.query('page'))  || 1;
      const limit = Math.min(100, Number(c.req.query('limit')) || 20);
      const result = await propertiesService.getAllPropertiesAdmin(page, limit);
      return c.json({ ...result, code: 'ALL_PROPERTIES_FETCHED' });
    } catch (err) {
      return fail(c, err, 'ALL_PROPERTIES_FETCH_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/properties/:id/nearby-places
  // ─────────────────────────────────────────────────────────────────────────
  async addNearbyPlaces(c: Context) {
    try {
      const user    = c.get('user');
      const id      = c.req.param('id');
      const body    = await c.req.json() as { places: any[] };
      const isAdmin = (user.roles as string[]).some((r) => ['super_admin', 'staff'].includes(r));

      if (!Array.isArray(body.places) || body.places.length === 0) {
        return c.json({ message: 'places array is required', code: 'MISSING_PLACES' }, 400);
      }

      const places = await propertiesService.addNearbyPlaces(id, user.userId, body.places, isAdmin);
      return c.json(
        { message: `${places.length} nearby place(s) added with distances calculated`, code: 'NEARBY_PLACES_ADDED', places },
        201,
      );
    } catch (err) {
      return fail(c, err, 'NEARBY_PLACES_ADD_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE /api/properties/:id/nearby-places/:placeId
  // ─────────────────────────────────────────────────────────────────────────
  async deleteNearbyPlace(c: Context) {
    try {
      const user    = c.get('user');
      const id      = c.req.param('id');
      const placeId = c.req.param('placeId');
      const isAdmin = (user.roles as string[]).some((r) => ['super_admin', 'staff'].includes(r));

      await propertiesService.deleteNearbyPlace(placeId, id, user.userId, isAdmin);
      return c.json({ message: 'Nearby place removed', code: 'NEARBY_PLACE_DELETED' });
    } catch (err) {
      return fail(c, err, 'NEARBY_PLACE_DELETE_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/properties/:id/media
  // ─────────────────────────────────────────────────────────────────────────
  async uploadMedia(c: Context) {
    try {
      const user    = c.get('user');
      const id      = c.req.param('id');
      const isAdmin = (user.roles as string[]).some((r) => ['super_admin', 'staff'].includes(r));
      const body    = await c.req.json() as { media: any[] };

      if (!Array.isArray(body.media) || body.media.length === 0) {
        return c.json({ message: 'media array is required', code: 'MISSING_MEDIA' }, 400);
      }

      if (body.media.length > 20) {
        return c.json(
          { message: 'Maximum 20 files per request', code: 'TOO_MANY_FILES' },
          400,
        );
      }

      for (const [i, item] of body.media.entries()) {
        if (!item.media_type) {
          return c.json({ message: `media[${i}].media_type is required`, code: 'INVALID_MEDIA' }, 400);
        }
        if (!item.file || typeof item.file !== 'string') {
          return c.json({ message: `media[${i}].file must be a base64 data URI or https URL`, code: 'INVALID_MEDIA' }, 400);
        }
      }

      const saved = await propertiesService.uploadMediaForProperty(
        id,
        user.userId,
        body.media,
        isAdmin,
      );

      return c.json(
        {
          message: `${saved?.length ?? 0} file(s) uploaded successfully`,
          code:    'MEDIA_UPLOADED',
          media:   saved,
        },
        201,
      );
    } catch (err) {
      return fail(c, err, 'MEDIA_UPLOAD_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE /api/properties/:id/media/:mediaId
  // ─────────────────────────────────────────────────────────────────────────
  async deleteMedia(c: Context) {
    try {
      const user    = c.get('user');
      const id      = c.req.param('id');
      const mediaId = c.req.param('mediaId');
      const isAdmin = (user.roles as string[]).some((r) => ['super_admin', 'staff'].includes(r));

      await propertiesService.deleteMediaItem(mediaId, id, user.userId, isAdmin);
      return c.json({ message: 'Media deleted', code: 'MEDIA_DELETED' });
    } catch (err) {
      return fail(c, err, 'MEDIA_DELETE_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SHORT-TERM AVAILABILITY ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────

  async addAvailabilityBlocks(c: Context) {
    try {
      const user    = c.get('user');
      const id      = c.req.param('id');
      const body    = await c.req.json() as { blocks: any[] };
      const isAdmin = (user.roles as string[]).some((r) => ['super_admin', 'staff'].includes(r));

      if (!Array.isArray(body.blocks) || body.blocks.length === 0) {
        return c.json({ message: 'blocks array is required', code: 'MISSING_BLOCKS' }, 400);
      }

      const blocks = await propertiesService.addAvailabilityBlocks(id, user.userId, body.blocks, isAdmin);
      return c.json(
        { message: `${blocks.length} availability block(s) added`, code: 'AVAILABILITY_BLOCKS_ADDED', blocks },
        201,
      );
    } catch (err) {
      return fail(c, err, 'AVAILABILITY_BLOCKS_ADD_FAILED');
    }
  }

  async getAvailability(c: Context) {
    try {
      const id        = c.req.param('id');
      const startDate = c.req.query('start_date');
      const endDate   = c.req.query('end_date');

      if (!startDate || !endDate) {
        return c.json({ message: 'start_date and end_date are required', code: 'MISSING_DATES' }, 400);
      }

      const availability = await propertiesService.getAvailability(id, startDate, endDate);
      return c.json({ availability, code: 'AVAILABILITY_FETCHED' });
    } catch (err) {
      return fail(c, err, 'AVAILABILITY_FETCH_FAILED');
    }
  }

  async deleteAvailabilityBlock(c: Context) {
    try {
      const user    = c.get('user');
      const id      = c.req.param('id');
      const blockId = c.req.param('blockId');
      const isAdmin = (user.roles as string[]).some((r) => ['super_admin', 'staff'].includes(r));

      await propertiesService.deleteAvailabilityBlock(blockId, id, user.userId, isAdmin);
      return c.json({ message: 'Availability block removed', code: 'AVAILABILITY_BLOCK_DELETED' });
    } catch (err) {
      return fail(c, err, 'AVAILABILITY_BLOCK_DELETE_FAILED');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BUILDINGS ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────

  async getBuildings(c: Context) {
    try {
      const buildings = await propertiesService.getBuildings();
      return c.json({ buildings, code: 'BUILDINGS_FETCHED' });
    } catch (err) {
      return fail(c, err, 'BUILDINGS_FETCH_FAILED');
    }
  }

  async getBuildingById(c: Context) {
    try {
      const id = c.req.param('id');
      const building = await propertiesService.getBuildingById(id);
      return c.json({ building, code: 'BUILDING_FETCHED' });
    } catch (err) {
      return fail(c, err, 'BUILDING_FETCH_FAILED');
    }
  }

  async createBuilding(c: Context) {
    try {
      const user = c.get('user');
      const isAdmin = (user.roles as string[]).some((r) => ['super_admin', 'staff'].includes(r));

      if (!isAdmin) {
        return c.json({ message: 'Admin role required', code: 'FORBIDDEN' }, 403);
      }

      const input = await c.req.json();
      const building = await propertiesService.createBuilding(input);
      return c.json(
        { message: 'Building created successfully', code: 'BUILDING_CREATED', building },
        201,
      );
    } catch (err) {
      return fail(c, err, 'BUILDING_CREATE_FAILED');
    }
  }
}

export const propertiesController = new PropertiesController();