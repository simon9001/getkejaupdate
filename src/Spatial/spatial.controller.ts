import type { Context } from 'hono';
import { spatialService } from '../services/spatial.service.js';
import { logger } from '../utils/logger.js';

export class SpatialController {
    /**
     * Search properties by radius
     */
    async searchByRadius(c: Context) {
        try {
            const lat = Number(c.req.query('lat'));
            const lng = Number(c.req.query('lng'));
            const radius = Number(c.req.query('radius')) || 2000;
            const maxPrice = c.req.query('maxPrice') ? Number(c.req.query('maxPrice')) : undefined;
            const minBedrooms = c.req.query('minBedrooms') ? Number(c.req.query('minBedrooms')) : undefined;
            const query = c.req.query('q');

            if (isNaN(lat) || isNaN(lng)) {
                return c.json({ message: 'Latitude and Longitude are required' }, 400);
            }

            const properties = await spatialService.findPropertiesWithinRadius(
                lat, lng, radius, maxPrice, minBedrooms, query
            );

            return c.json({
                center: { lat, lng },
                radius,
                count: properties.length,
                properties,
            });
        } catch (error: any) {
            logger.error({ error: error.message }, 'Search by radius error');
            return c.json({ message: error.message || 'Spatial search failed' }, 500);
        }
    }

    /**
     * Get proximity intelligence for a point (landmarks + roads)
     */
    async getProximityIntelligence(c: Context) {
        try {
            const lat = Number(c.req.query('lat'));
            const lng = Number(c.req.query('lng'));

            if (isNaN(lat) || isNaN(lng)) {
                return c.json({ message: 'Latitude and Longitude are required' }, 400);
            }

            const [landmarks, roadInfo] = await Promise.all([
                spatialService.getNearestLandmarks(lat, lng),
                spatialService.getNearestRoadInfo(lat, lng),
            ]);

            // Enrich landmarks with walking time
            const enrichedLandmarks = landmarks.map((l: any) => ({
                ...l,
                walking_time_mins: spatialService.calculateWalkingTime(l.distance_meters),
            }));

            return c.json({
                coordinates: { lat, lng },
                landmarks: enrichedLandmarks,
                nearest_road: roadInfo,
            });
        } catch (error: any) {
            logger.error({ error: error.message }, 'Proximity intelligence error');
            return c.json({ message: error.message || 'Proximity calculation failed' }, 500);
        }
    }

    /**
     * Search for places using Nominatim (External Search)
     */
    async searchExternal(c: Context) {
        try {
            const query = c.req.query('q');
            if (!query) {
                return c.json({ message: 'Search query is required' }, 400);
            }

            const results = await spatialService.searchExternalPlaces(query);
            return c.json(results);
        } catch (error: any) {
            logger.error({ error: error.message }, 'External search error');
            return c.json({ message: error.message || 'External search failed' }, 500);
        }
    }

    /**
     * Link landmark to property
     */
    async linkLandmark(c: Context) {
        try {
            const body = await c.req.json();
            logger.info({ body }, 'Received link-landmark request');
            const { propertyId, landmark } = body;

            if (!propertyId || !landmark || !landmark.name || landmark.lat === undefined || landmark.lon === undefined) {
                logger.warn({ body }, 'Invalid link-landmark request body');
                return c.json({
                    message: 'Property ID and complete landmark data (name, lat, lon) are required',
                    received: body
                }, 400);
            }

            const result = await spatialService.linkLandmark(propertyId, landmark);
            return c.json(result);
        } catch (error: any) {
            logger.error({ error: error.message }, 'Link landmark error');
            return c.json({ message: error.message || 'Linking landmark failed' }, 500);
        }
    }
}

export const spatialController = new SpatialController();
