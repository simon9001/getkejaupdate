import { supabaseAdmin } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';
export class SpatialService {
    /**
     * find properties within a radius of a point
     */
    async findPropertiesWithinRadius(lat, lng, radiusMeters, maxPrice, minBedrooms, query) {
        const { data, error } = await supabaseAdmin.rpc('get_properties_within_radius', {
            lon: lng,
            lat: lat,
            radius_m: radiusMeters,
            max_price: maxPrice,
            min_beds: minBedrooms,
            search_query: query
        });
        if (error) {
            logger.error({ error, lat, lng, radiusMeters }, 'Failed to find properties in radius');
            throw new Error(`Spatial query failed: ${error.message}`);
        }
        return data;
    }
    /**
     * Get nearest landmarks for a property
     */
    async getNearestLandmarks(lat, lng, limit = 5) {
        const { data, error } = await supabaseAdmin.rpc('get_nearest_landmarks', {
            px: lng,
            py: lat,
            lim: limit,
        });
        if (error) {
            logger.error({ error }, 'Failed to get nearest landmarks');
            throw new Error(`Spatial query failed: ${error.message}`);
        }
        return data;
    }
    /**
     * Get distance to nearest road and its surface type
     */
    async getNearestRoadInfo(lat, lng) {
        const { data, error } = await supabaseAdmin.rpc('get_nearest_road', {
            px: lng,
            py: lat,
        });
        if (error) {
            logger.error({ error }, 'Failed to get nearest road info');
            throw new Error(`Spatial query failed: ${error.message}`);
        }
        return data?.[0] || null;
    }
    /**
     * Calculate walking time based on distance (80m per minute)
     */
    calculateWalkingTime(distanceMeters) {
        return Math.round(distanceMeters / 80);
    }
}
export const spatialService = new SpatialService();
