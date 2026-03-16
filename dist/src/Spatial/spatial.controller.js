import { spatialService } from '../services/spatial.service.js';
import { logger } from '../utils/logger.js';
export class SpatialController {
    /**
     * Search properties by radius
     */
    async searchByRadius(c) {
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
            const properties = await spatialService.findPropertiesWithinRadius(lat, lng, radius, maxPrice, minBedrooms, query);
            return c.json({
                center: { lat, lng },
                radius,
                count: properties.length,
                properties,
            });
        }
        catch (error) {
            logger.error({ error: error.message }, 'Search by radius error');
            return c.json({ message: error.message || 'Spatial search failed' }, 500);
        }
    }
    /**
     * Get proximity intelligence for a point (landmarks + roads)
     */
    async getProximityIntelligence(c) {
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
            const enrichedLandmarks = landmarks.map((l) => ({
                ...l,
                walking_time_mins: spatialService.calculateWalkingTime(l.distance_meters),
            }));
            return c.json({
                coordinates: { lat, lng },
                landmarks: enrichedLandmarks,
                nearest_road: roadInfo,
            });
        }
        catch (error) {
            logger.error({ error: error.message }, 'Proximity intelligence error');
            return c.json({ message: error.message || 'Proximity calculation failed' }, 500);
        }
    }
}
export const spatialController = new SpatialController();
