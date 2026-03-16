import { supabaseAdmin } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';
export class PropertiesService {
    /**
     * Create a new property with its location
     */
    async createProperty(ownerId, input) {
        const { address, town, county, latitude, longitude, neighborhood, amenity_ids, images, ...propertyData } = input;
        // Start a transaction-like sequence using Supabase
        // 1. Insert property
        const { data: property, error: propError } = await supabaseAdmin
            .from('properties')
            .insert({
            ...propertyData,
            owner_id: ownerId,
        })
            .select()
            .single();
        if (propError) {
            logger.error({ error: propError }, 'Failed to create property');
            throw new Error(`Property creation failed: ${propError.message}`);
        }
        // 2. Insert location with PostGIS point
        const pointWkt = `POINT(${longitude} ${latitude})`;
        const { error: locError } = await supabaseAdmin
            .from('property_locations')
            .insert({
            property_id: property.id,
            address,
            town,
            county,
            location: pointWkt,
        });
        if (locError) {
            logger.error({ error: locError, propertyId: property.id }, 'Failed to create property location');
            await supabaseAdmin.from('properties').delete().eq('id', property.id);
            throw new Error(`Location creation failed: ${locError.message}`);
        }
        // 3. Insert neighborhood metadata if provided
        if (neighborhood) {
            const { error: neighError } = await supabaseAdmin
                .from('property_neighborhood')
                .insert({
                property_id: property.id,
                ...neighborhood,
            });
            if (neighError) {
                logger.warn({ error: neighError, propertyId: property.id }, 'Failed to create property neighborhood metadata');
            }
        }
        // 4. Link amenities if provided
        if (amenity_ids && amenity_ids.length > 0) {
            const amenityData = amenity_ids.map(amenityId => ({
                property_id: property.id,
                amenity_id: amenityId,
            }));
            const { error: amenError } = await supabaseAdmin
                .from('property_amenities')
                .insert(amenityData);
            if (amenError) {
                logger.warn({ error: amenError, propertyId: property.id }, 'Failed to link property amenities');
            }
        }
        return this.getPropertyById(property.id);
    }
    /**
     * Get property by ID with joined data
     */
    async getPropertyById(id) {
        const { data, error } = await supabaseAdmin
            .from('properties')
            .select(`
        *,
        location:property_locations(*),
        images:property_images(*),
        neighborhood:property_neighborhood(*),
        amenities:property_amenities(
          amenity:amenities(*)
        ),
        owner:profiles(full_name, email, phone, avatar_url)
      `)
            .eq('id', id)
            .single();
        if (error) {
            logger.error({ error, propertyId: id }, 'Failed to fetch property');
            throw new Error(`Property not found: ${error.message}`);
        }
        // Flatten amenities
        const property = data;
        if (property.amenities) {
            property.amenities = property.amenities.map((a) => a.amenity);
        }
        return property;
    }
    /**
     * List properties with optional filters
     */
    async listProperties(filters = {}) {
        let query = supabaseAdmin
            .from('properties')
            .select(`
        *,
        location:property_locations(*),
        images:property_images(image_url, is_primary)
      `);
        if (filters.status)
            query = query.eq('status', filters.status);
        if (filters.type)
            query = query.eq('property_type', filters.type);
        if (filters.minPrice)
            query = query.gte('price_per_month', filters.minPrice);
        if (filters.maxPrice)
            query = query.lte('price_per_month', filters.maxPrice);
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) {
            logger.error({ error }, 'Failed to list properties');
            throw new Error(`Failed to list properties: ${error.message}`);
        }
        return data;
    }
}
export const propertiesService = new PropertiesService();
