import { supabaseAdmin } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';

export class SpatialService {
    /**
     * Find properties within a radius of a point
     */
    async findPropertiesWithinRadius(
        lat: number,
        lng: number,
        radiusMeters: number,
        maxPrice?: number,
        minBedrooms?: number,
        query?: string
    ) {
        const { data, error } = await supabaseAdmin.rpc('get_properties_within_radius', {
            lon: lng,
            lat: lat,
            radius_m: radiusMeters,
            max_price: maxPrice ?? null,
            min_beds: minBedrooms ?? null,
            search_query: query ?? null
        });

        if (error) {
            logger.error({ error, lat, lng, radiusMeters }, 'Failed to find properties in radius');
            throw new Error(`Spatial query (findPropertiesWithinRadius) failed: ${error.message} at [${lat}, ${lng}]`);
        }

        return data ?? [];
    }

    /**
     * Get nearest landmarks for a coordinate point
     */
    async getNearestLandmarks(lat: number, lng: number, limit: number = 5) {
        const { data, error } = await supabaseAdmin.rpc('get_nearest_landmarks', {
            px: lng,
            py: lat,
            lim: limit,
        });

        if (error) {
            logger.error({ error, lat, lng }, 'Failed to get nearest landmarks');
            throw new Error(`Spatial query (getNearestLandmarks) failed: ${error.message}`);
        }

        return data ?? [];
    }

    /**
     * Get distance to nearest road and its surface type
     */
    async getNearestRoadInfo(lat: number, lng: number) {
        const { data, error } = await supabaseAdmin.rpc('get_nearest_road', {
            px: lng,
            py: lat,
        });

        if (error) {
            logger.error({ error, lat, lng }, 'Failed to get nearest road info');
            throw new Error(`Spatial query (getNearestRoadInfo) failed: ${error.message}`);
        }

        if (!data || data.length === 0) {
            return null;
        }

        return data[0];
    }

    /**
     * Search for places using OpenStreetMap Nominatim API (Kenya-scoped)
     */
    async searchExternalPlaces(query: string) {
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=10&countrycodes=ke`;
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'GetKeja-HouseHunting-Project'
                }
            });

            if (!response.ok) {
                throw new Error(`Nominatim API search failed with status ${response.status}`);
            }

            const results = await response.json();
            return results.map((r: any) => ({
                name: r.display_name,
                lat: parseFloat(r.lat),
                lon: parseFloat(r.lon),
                type: r.type || r.class || 'landmark'
            }));
        } catch (error: any) {
            logger.error({ error: error.message, query }, 'External places search failed');
            throw error;
        }
    }

    /**
     * Link a landmark to a property and calculate/store the distance.
     *
     * Fixes applied vs original:
     *  1. Use .maybeSingle() instead of .single() for existence check —
     *     .single() throws PGRST116 when no row is found, crashing before insert.
     *  2. Normalize external landmark types (e.g. Nominatim 'amenity', 'place')
     *     to valid landmark_type ENUM values before inserting into the DB.
     *  3. Added onConflict to upsert for property_landmark_distances.
     *  4. Improved error messages to surface the actual DB error.
     */
    async linkLandmark(
        propertyId: string,
        landmark: { name: string; type: string; lat: number; lon: number }
    ) {
        // 1. Check if landmark already exists (case-insensitive name match)
        //    maybeSingle() returns null instead of throwing when no row found
        const { data: existingLandmark, error: lookupError } = await supabaseAdmin
            .from('landmarks')
            .select('id')
            .ilike('name', landmark.name)
            .limit(1)
            .maybeSingle();

        if (lookupError) {
            logger.error({ error: lookupError, landmark }, 'Landmark lookup failed');
            throw new Error(`Landmark lookup failed: ${lookupError.message}`);
        }

        let landmarkId: string;

        if (existingLandmark) {
            // Reuse existing landmark
            landmarkId = existingLandmark.id;
            logger.info({ landmarkId, name: landmark.name }, 'Reusing existing landmark');
        } else {
            // Normalize type to a valid ENUM value before inserting
            const normalizedType = this.normalizeLandmarkType(landmark.type);

            const { data: newLandmark, error: insertError } = await supabaseAdmin
                .from('landmarks')
                .insert({
                    name: landmark.name,
                    type: normalizedType,
                    location: `POINT(${landmark.lon} ${landmark.lat})`
                })
                .select()
                .single();

            if (insertError) {
                logger.error({ error: insertError, landmark, normalizedType }, 'Failed to insert new landmark');
                throw new Error(`Failed to save landmark: ${insertError.message}`);
            }

            landmarkId = newLandmark.id;
            logger.info({ landmarkId, name: landmark.name, normalizedType }, 'New landmark created');
        }

        // 2. Calculate distance between property and landmark via RPC
        const { data: distance, error: distanceError } = await supabaseAdmin
            .rpc('calculate_property_landmark_distance', {
                prop_id: propertyId,
                land_id: landmarkId
            });

        if (distanceError) {
            const isMissing =
                distanceError.message.includes('not found') ||
                distanceError.code === 'PGRST202';

            logger.error({ error: distanceError, propertyId, landmarkId }, 'Distance calculation failed');

            if (isMissing) {
                throw new Error(
                    'Database function "calculate_property_landmark_distance" is missing. ' +
                    'Please run the spatial setup SQL in your Supabase SQL Editor.'
                );
            }

            throw new Error(`Distance calculation failed: ${distanceError.message}`);
        }

        // 3. Upsert the property <-> landmark distance record
        const { error: linkError } = await supabaseAdmin
            .from('property_landmark_distances')
            .upsert(
                {
                    property_id: propertyId,
                    landmark_id: landmarkId,
                    distance_meters: distance
                },
                { onConflict: 'property_id,landmark_id' }
            );

        if (linkError) {
            logger.error({ error: linkError, propertyId, landmarkId }, 'Failed to link landmark to property');
            throw new Error(`Failed to link landmark to property: ${linkError.message}`);
        }

        logger.info({ propertyId, landmarkId, distance }, 'Landmark linked to property successfully');

        return {
            id: landmarkId,
            name: landmark.name,
            type: landmark.type,
            distance_meters: distance
        };
    }

    /**
     * Map arbitrary external type strings (Nominatim, user input) to valid
     * landmark_type ENUM values:
     *   'university' | 'hospital' | 'school' | 'market' |
     *   'bus_stop'   | 'road'     | 'shopping_center'
     */
    private normalizeLandmarkType(type: string): string {
        const t = (type ?? '').toLowerCase();

        if (t.includes('university') || t.includes('college'))        return 'university';
        if (t.includes('school') || t.includes('primary') ||
            t.includes('secondary'))                                   return 'school';
        if (t.includes('hospital') || t.includes('clinic') ||
            t.includes('health') || t.includes('medical'))            return 'hospital';
        if (t.includes('shopping') || t.includes('centre') ||
            t.includes('center') || t.includes('mall'))               return 'shopping_center';
        if (t.includes('market') || t.includes('shop') ||
            t.includes('retail') || t.includes('store'))              return 'market';
        if (t.includes('bus') || t.includes('stop') ||
            t.includes('stage') || t.includes('transit') ||
            t.includes('matatu'))                                      return 'bus_stop';
        if (t.includes('road') || t.includes('highway') ||
            t.includes('street') || t.includes('avenue'))             return 'road';

        // Default fallback for anything unrecognized (amenity, place, etc.)
        return 'market';
    }

    /**
     * Calculate estimated walking time based on distance.
     * Assumes average walking speed of 80 metres per minute (~4.8 km/h).
     */
    calculateWalkingTime(distanceMeters: number): number {
        return Math.round(distanceMeters / 80);
    }
}

export const spatialService = new SpatialService();