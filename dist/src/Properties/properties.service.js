import { supabaseAdmin } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';
import { parseNaturalLanguageQuery, extractKeywords } from '../utils/nlp.utils.js';
export class PropertiesService {
    /**
     * Create a new property with all related data
     */
    async createProperty(ownerId, input) {
        const { latitude, longitude, address, town, county, neighborhood, amenity_ids, images, ...propertyData } = input;
        try {
            // 1. Insert the main property record
            const { data: property, error: propertyError } = await supabaseAdmin
                .from('properties')
                .insert({
                owner_id: ownerId,
                title: propertyData.title,
                description: propertyData.description,
                property_type: propertyData.property_type,
                status: propertyData.status || 'draft',
                size_sqm: propertyData.size_sqm,
                bedrooms: propertyData.bedrooms || 0,
                bathrooms: propertyData.bathrooms || 0,
                floor_level: propertyData.floor_level,
                furnished_status: propertyData.furnished_status,
                year_built: propertyData.year_built,
                renovation_details: propertyData.renovation_details,
                internet_speed: propertyData.internet_speed,
                price_per_month: propertyData.price_per_month,
                price_per_night: propertyData.price_per_night,
                currency: propertyData.currency || 'KES',
                security_deposit: propertyData.security_deposit,
                cleaning_fee: propertyData.cleaning_fee,
                service_fee: propertyData.service_fee,
                tax_amount: propertyData.tax_amount,
                is_verified: false,
                is_boosted: false,
                is_struck: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
                .select()
                .single();
            if (propertyError) {
                logger.error({ error: propertyError }, 'Failed to create property');
                throw new Error(`Failed to create property: ${propertyError.message}`);
            }
            // 2. Insert location data
            const locationData = {
                property_id: property.id,
                address,
                town,
                county,
                location: `POINT(${longitude} ${latitude})`
            };
            const { error: locationError } = await supabaseAdmin
                .from('property_locations')
                .insert(locationData);
            if (locationError) {
                logger.error({ error: locationError }, 'Failed to create property location');
                throw new Error(`Failed to create property location: ${locationError.message}`);
            }
            // 3. Insert neighborhood metadata if provided
            if (neighborhood) {
                const { error: neighborhoodError } = await supabaseAdmin
                    .from('property_neighborhood')
                    .insert({
                    property_id: property.id,
                    crime_rating: neighborhood.crime_rating,
                    noise_level: neighborhood.noise_level,
                    community_vibe: neighborhood.community_vibe,
                    light_exposure: neighborhood.light_exposure
                });
                if (neighborhoodError) {
                    logger.error({ error: neighborhoodError }, 'Failed to create neighborhood metadata');
                }
            }
            // 4. Link amenities if provided
            if (amenity_ids && amenity_ids.length > 0) {
                const amenityLinks = amenity_ids.map(amenity_id => ({
                    property_id: property.id,
                    amenity_id
                }));
                const { error: amenitiesError } = await supabaseAdmin
                    .from('property_amenities')
                    .insert(amenityLinks);
                if (amenitiesError) {
                    logger.error({ error: amenitiesError }, 'Failed to link amenities');
                }
            }
            // 5. Insert images if provided
            if (images && images.length > 0) {
                const imageData = images.map((img, index) => ({
                    property_id: property.id,
                    image_url: img.url,
                    is_primary: img.isPrimary || false,
                    sort_order: img.sortOrder !== undefined ? img.sortOrder : index,
                    created_at: new Date().toISOString()
                }));
                const { error: imagesError } = await supabaseAdmin
                    .from('property_images')
                    .insert(imageData);
                if (imagesError) {
                    logger.error({ error: imagesError }, 'Failed to insert property images');
                }
            }
            // 6. Calculate nearby landmarks
            await this.calculateNearbyLandmarks(property.id, latitude, longitude);
            logger.info({ propertyId: property.id, ownerId }, 'Property created successfully');
            // 7. Fetch and return complete property
            return await this.getPropertyById(property.id);
        }
        catch (error) {
            logger.error({ error, ownerId }, 'Error in createProperty');
            throw error;
        }
    }
    /**
     * Calculate and store nearby landmarks for a property
     */
    /**
 * Calculate and store nearby landmarks for a property
 */
    async calculateNearbyLandmarks(propertyId, latitude, longitude) {
        try {
            // Get all landmarks
            const { data: landmarks, error } = await supabaseAdmin
                .from('landmarks')
                .select('id, name, location');
            if (error || !landmarks) {
                logger.error({ error, propertyId }, 'Failed to fetch landmarks');
                return;
            }
            // Calculate distances manually
            const distances = [];
            for (const landmark of landmarks) {
                const pointMatch = landmark.location.match(/POINT\(([^ ]+) ([^)]+)\)/);
                if (!pointMatch)
                    continue;
                const lng = parseFloat(pointMatch[1]);
                const lat = parseFloat(pointMatch[2]);
                const distance = this.calculateDistance(latitude, longitude, lat, lng) * 1000; // Convert to meters
                // Store only landmarks within 5km
                if (distance <= 5000) {
                    distances.push({
                        property_id: propertyId,
                        landmark_id: landmark.id,
                        distance_meters: Math.round(distance)
                    });
                }
            }
            // Store distances in database
            if (distances.length > 0) {
                const { error: insertError } = await supabaseAdmin
                    .from('property_landmark_distances')
                    .upsert(distances, {
                    onConflict: 'property_id,landmark_id'
                });
                if (insertError) {
                    logger.error({ error: insertError }, 'Failed to store landmark distances');
                }
            }
        }
        catch (error) {
            logger.error({ error, propertyId }, 'Error calculating nearby landmarks');
        }
    }
    /**
     * Find a landmark by name
     */
    /**
 * Find a landmark by name
 */
    async findLandmarkByName(name) {
        try {
            const { data, error } = await supabaseAdmin
                .from('landmarks')
                .select('id, name, location')
                .ilike('name', `%${name}%`)
                .limit(1);
            if (error || !data || data.length === 0) {
                return null;
            }
            const landmark = data[0];
            // Parse location from PostGIS format
            const pointMatch = landmark.location.match(/POINT\(([^ ]+) ([^)]+)\)/);
            if (pointMatch) {
                return {
                    id: landmark.id,
                    name: landmark.name,
                    longitude: parseFloat(pointMatch[1]),
                    latitude: parseFloat(pointMatch[2])
                };
            }
            return null;
        }
        catch (error) {
            logger.error({ error, name }, 'Error finding landmark by name');
            return null;
        }
    }
    /**
     * Search properties with advanced filters
     */
    async searchProperties(filters) {
        try {
            let query = supabaseAdmin
                .from('properties')
                .select(`
                    *,
                    owner:profiles!owner_id(
                        full_name,
                        email,
                        phone,
                        avatar_url
                    ),
                    location:property_locations(
                        address,
                        town,
                        county,
                        location
                    ),
                    images:property_images(
                        id,
                        image_url,
                        is_primary,
                        sort_order
                    ),
                    amenities:property_amenities(
                        amenity:amenities(
                            id,
                            name,
                            icon_name
                        )
                    )
                `, { count: 'exact' });
            // Apply filters
            query = query.eq('is_verified', true)
                .eq('status', 'active');
            if (filters.propertyTypes && filters.propertyTypes.length > 0) {
                query = query.in('property_type', filters.propertyTypes);
            }
            if (filters.type) {
                query = query.eq('property_type', filters.type);
            }
            if (filters.minPrice !== undefined) {
                query = query.gte('price_per_month', filters.minPrice);
            }
            if (filters.maxPrice !== undefined) {
                query = query.lte('price_per_month', filters.maxPrice);
            }
            if (filters.bedrooms !== undefined) {
                if (filters.bedrooms === 0) {
                    // Studio/bedsitter (bedrooms = 0 or null)
                    query = query.or('bedrooms.eq.0,bedrooms.is.null');
                }
                else {
                    query = query.gte('bedrooms', filters.bedrooms);
                }
            }
            if (filters.town) {
                query = query.filter('location.town', 'ilike', `%${filters.town}%`);
            }
            // Geo-spatial search
            if (filters.lat && filters.lng && filters.radius) {
                const point = `POINT(${filters.lng} ${filters.lat})`;
                query = query.not('location', 'is', null)
                    .filter('location.location', 'st_dwithin', {
                    point,
                    distance: filters.radius
                });
            }
            // Pagination
            const limit = filters.limit || 20;
            const offset = filters.offset || 0;
            const { data: properties, error, count } = await query
                .order('is_boosted', { ascending: false })
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);
            if (error) {
                logger.error({ error, filters }, 'Failed to search properties');
                throw new Error(`Failed to search properties: ${error.message}`);
            }
            // Format properties
            const formattedProperties = properties?.map(property => this.formatProperty(property)) || [];
            return {
                properties: formattedProperties,
                total: count || 0,
                limit,
                offset
            };
        }
        catch (error) {
            logger.error({ error, filters }, 'Error in searchProperties');
            throw error;
        }
    }
    /**
     * Get properties near a specific landmark
     */
    /**
 * Get properties near a specific landmark
 */
    async getPropertiesNearLandmark(landmarkName, radius = 2000, category) {
        try {
            const landmark = await this.findLandmarkByName(landmarkName);
            if (!landmark) {
                throw new Error(`Landmark "${landmarkName}" not found`);
            }
            // Use raw SQL query for PostGIS operations
            const { data, error } = await supabaseAdmin.rpc('get_properties_near_landmark', {
                landmark_id: landmark.id,
                radius_meters: radius,
                category_filter: category || null
            });
            if (error) {
                logger.error({ error }, 'RPC get_properties_near_landmark failed');
                // Fallback to regular query if RPC doesn't exist
                return this.getPropertiesNearLandmarkFallback(landmark, radius, category);
            }
            // Format the results
            const formattedResults = data?.map((item) => ({
                id: item.id,
                title: item.title,
                description: item.description,
                property_type: item.property_type,
                price_per_month: item.price_per_month,
                bedrooms: item.bedrooms,
                bathrooms: item.bathrooms,
                images: item.images || [],
                location: {
                    address: item.address,
                    town: item.town,
                    county: item.county,
                    latitude: item.latitude,
                    longitude: item.longitude
                },
                distanceToLandmark: {
                    landmark: landmarkName,
                    distance: Math.round(item.distance_meters)
                }
            })) || [];
            return formattedResults;
        }
        catch (error) {
            logger.error({ error, landmarkName, radius }, 'Error in getPropertiesNearLandmark');
            throw error;
        }
    }
    /**
     * Fallback method for getting properties near landmark using regular queries
     */
    async getPropertiesNearLandmarkFallback(landmark, radius, category) {
        try {
            // First, get all property locations within radius
            const { data: locations, error: locError } = await supabaseAdmin
                .from('property_locations')
                .select(`
                property_id,
                address,
                town,
                county,
                location
            `);
            if (locError) {
                throw new Error(`Failed to fetch locations: ${locError.message}`);
            }
            // Calculate distances manually (since we can't use PostGIS)
            const propertiesWithDistance = [];
            for (const loc of locations || []) {
                // Parse location from PostGIS format
                const pointMatch = loc.location.match(/POINT\(([^ ]+) ([^)]+)\)/);
                if (!pointMatch)
                    continue;
                const lng = parseFloat(pointMatch[1]);
                const lat = parseFloat(pointMatch[2]);
                // Calculate distance using Haversine formula
                const distance = this.calculateDistance(landmark.latitude, landmark.longitude, lat, lng) * 1000; // Convert to meters
                if (distance <= radius) {
                    // Get property details
                    const { data: property, error: propError } = await supabaseAdmin
                        .from('properties')
                        .select(`
                        *,
                        images:property_images(
                            image_url,
                            is_primary
                        )
                    `)
                        .eq('id', loc.property_id)
                        .eq('is_verified', true)
                        .eq('status', 'active')
                        .single();
                    if (!propError && property) {
                        // Check category if specified
                        if (category) {
                            const propertyTypes = this.getPropertyTypesByCategory(category);
                            if (!propertyTypes.includes(property.property_type)) {
                                continue;
                            }
                        }
                        propertiesWithDistance.push({
                            ...property,
                            distance_meters: distance,
                            address: loc.address,
                            town: loc.town,
                            county: loc.county,
                            latitude: lat,
                            longitude: lng
                        });
                    }
                }
            }
            // Sort by distance
            propertiesWithDistance.sort((a, b) => a.distance_meters - b.distance_meters);
            return propertiesWithDistance;
        }
        catch (error) {
            logger.error({ error }, 'Error in getPropertiesNearLandmarkFallback');
            throw error;
        }
    }
    /**
     * Calculate distance between two coordinates using Haversine formula
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c; // Distance in km
    }
    toRad(value) {
        return value * Math.PI / 180;
    }
    /**
     * Get category statistics
     */
    async getCategoryStatistics() {
        try {
            const categories = ['commercial', 'residential', 'recreational'];
            const statistics = [];
            for (const category of categories) {
                const propertyTypes = this.getPropertyTypesByCategory(category);
                const { data, error } = await supabaseAdmin
                    .from('properties')
                    .select('property_type, price_per_month', { count: 'exact' })
                    .in('property_type', propertyTypes)
                    .eq('status', 'active')
                    .eq('is_verified', true);
                if (error) {
                    logger.error({ error, category }, 'Failed to fetch category statistics');
                    continue;
                }
                const prices = data?.map(p => p.price_per_month).filter(p => p !== null);
                const averagePrice = prices.length > 0
                    ? prices.reduce((a, b) => a + b, 0) / prices.length
                    : 0;
                // Find most common property type
                const typeCount = {};
                data?.forEach(p => {
                    typeCount[p.property_type] = (typeCount[p.property_type] || 0) + 1;
                });
                const mostCommonType = Object.entries(typeCount)
                    .sort((a, b) => b[1] - a[1])
                    .map(entry => entry[0])[0] || propertyTypes[0];
                statistics.push({
                    category,
                    total: data?.length || 0,
                    active: data?.length || 0,
                    averagePrice: Math.round(averagePrice),
                    minPrice: prices.length > 0 ? Math.min(...prices) : 0,
                    maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
                    mostCommonType
                });
            }
            return statistics;
        }
        catch (error) {
            logger.error({ error }, 'Error in getCategoryStatistics');
            throw error;
        }
    }
    /**
     * Get property types by category
     */
    getPropertyTypesByCategory(category) {
        const categoryMap = {
            commercial: ['office', 'retail', 'warehouse', 'industrial'],
            residential: ['bedsitter', 'studio', 'apartment', 'maisonette', 'bungalow', 'villa'],
            recreational: ['short_term', 'vacation', 'resort', 'camp']
        };
        return categoryMap[category] || [];
    }
    /**
     * Format property object
     */
    formatProperty(property) {
        if (!property)
            return null;
        // Parse location if it exists
        let location = null;
        if (property.location) {
            const pointMatch = property.location.location?.match(/POINT\(([^ ]+) ([^)]+)\)/);
            if (pointMatch) {
                location = {
                    address: property.location.address,
                    town: property.location.town,
                    county: property.location.county,
                    longitude: parseFloat(pointMatch[1]),
                    latitude: parseFloat(pointMatch[2])
                };
            }
        }
        return {
            ...property,
            location,
            amenities: property.amenities?.map((a) => ({
                id: a.amenity?.id,
                name: a.amenity?.name,
                icon_name: a.amenity?.icon_name,
                details: a.details
            })) || []
        };
    }
    /**
     * Get property by ID with all related data
     */
    async getPropertyById(id) {
        try {
            const { data: property, error: propertyError } = await supabaseAdmin
                .from('properties')
                .select(`
                    *,
                    owner:profiles!owner_id(
                        full_name,
                        email,
                        phone,
                        avatar_url
                    ),
                    location:property_locations(
                        address,
                        town,
                        county,
                        location
                    ),
                    images:property_images(
                        id,
                        image_url,
                        is_primary,
                        sort_order
                    ),
                    amenities:property_amenities(
                        amenity:amenities(
                            id,
                            name,
                            icon_name
                        ),
                        details
                    ),
                    neighborhood:property_neighborhood(*)
                `)
                .eq('id', id)
                .single();
            if (propertyError) {
                logger.error({ error: propertyError, propertyId: id }, 'Failed to fetch property');
                throw new Error(`Property not found: ${propertyError.message}`);
            }
            return this.formatProperty(property);
        }
        catch (error) {
            logger.error({ error, propertyId: id }, 'Error in getPropertyById');
            throw error;
        }
    }
    /**
     * List properties with filters
     */
    async listProperties(filters) {
        try {
            let query = supabaseAdmin
                .from('properties')
                .select(`
                    *,
                    owner:profiles!owner_id(
                        full_name,
                        email,
                        phone,
                        avatar_url
                    ),
                    location:property_locations(
                        address,
                        town,
                        county,
                        location
                    ),
                    images:property_images(
                        image_url,
                        is_primary,
                        sort_order
                    ),
                    amenities:property_amenities(
                        amenity:amenities(
                            id,
                            name,
                            icon_name
                        )
                    )
                `, { count: 'exact' });
            // Default to only verified properties for public listing
            query = query.eq('is_verified', filters.is_verified !== undefined ? filters.is_verified : true);
            // Apply filters
            if (filters.status) {
                query = query.eq('status', filters.status);
            }
            if (filters.type) {
                query = query.eq('property_type', filters.type);
            }
            if (filters.propertyTypes && filters.propertyTypes.length > 0) {
                query = query.in('property_type', filters.propertyTypes);
            }
            if (filters.minPrice !== undefined) {
                query = query.gte('price_per_month', filters.minPrice);
            }
            if (filters.maxPrice !== undefined) {
                query = query.lte('price_per_month', filters.maxPrice);
            }
            if (filters.bedrooms !== undefined) {
                query = query.gte('bedrooms', filters.bedrooms);
            }
            if (filters.bathrooms !== undefined) {
                query = query.gte('bathrooms', filters.bathrooms);
            }
            if (filters.town) {
                query = query.ilike('location.town', `%${filters.town}%`);
            }
            if (filters.county) {
                query = query.ilike('location.county', `%${filters.county}%`);
            }
            // Geo-spatial search with radius
            if (filters.lat && filters.lng && filters.radius) {
                const point = `POINT(${filters.lng} ${filters.lat})`;
                query = query.not('location', 'is', null)
                    .filter('location.location', 'st_dwithin', {
                    point,
                    distance: filters.radius
                });
            }
            // Amenities filter
            if (filters.amenities && filters.amenities.length > 0) {
                for (const amenityId of filters.amenities) {
                    query = query.filter('amenities.amenity_id', 'eq', amenityId);
                }
            }
            // Pagination
            const limit = filters.limit || 20;
            const offset = filters.offset || 0;
            const { data: properties, error, count } = await query
                .order('is_boosted', { ascending: false })
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);
            if (error) {
                logger.error({ error, filters }, 'Failed to list properties');
                throw new Error(`Failed to list properties: ${error.message}`);
            }
            // Format the response
            const formattedProperties = properties?.map(property => this.formatProperty(property)) || [];
            return {
                properties: formattedProperties,
                total: count || 0,
                limit,
                offset
            };
        }
        catch (error) {
            logger.error({ error, filters }, 'Error in listProperties');
            throw error;
        }
    }
    /**
     * Update property
     */
    /**
 * Update property
 */
    async updateProperty(id, userId, updates) {
        try {
            // First check if user owns the property
            const { data: existing, error: checkError } = await supabaseAdmin
                .from('properties')
                .select('owner_id')
                .eq('id', id)
                .single();
            if (checkError || !existing) {
                throw new Error('Property not found');
            }
            if (existing.owner_id !== userId) {
                throw new Error('Unauthorized: You do not own this property');
            }
            const { latitude, longitude, address, town, county, neighborhood, amenity_ids, images, ...propertyUpdates } = updates;
            // Update main property
            if (Object.keys(propertyUpdates).length > 0) {
                const updateData = {
                    updated_at: new Date().toISOString()
                };
                if (propertyUpdates.title !== undefined)
                    updateData.title = propertyUpdates.title;
                if (propertyUpdates.description !== undefined)
                    updateData.description = propertyUpdates.description;
                if (propertyUpdates.property_type !== undefined)
                    updateData.property_type = propertyUpdates.property_type;
                if (propertyUpdates.status !== undefined)
                    updateData.status = propertyUpdates.status;
                if (propertyUpdates.size_sqm !== undefined)
                    updateData.size_sqm = propertyUpdates.size_sqm;
                if (propertyUpdates.bedrooms !== undefined)
                    updateData.bedrooms = propertyUpdates.bedrooms;
                if (propertyUpdates.bathrooms !== undefined)
                    updateData.bathrooms = propertyUpdates.bathrooms;
                if (propertyUpdates.floor_level !== undefined)
                    updateData.floor_level = propertyUpdates.floor_level;
                if (propertyUpdates.furnished_status !== undefined)
                    updateData.furnished_status = propertyUpdates.furnished_status;
                if (propertyUpdates.year_built !== undefined)
                    updateData.year_built = propertyUpdates.year_built;
                if (propertyUpdates.renovation_details !== undefined)
                    updateData.renovation_details = propertyUpdates.renovation_details;
                if (propertyUpdates.internet_speed !== undefined)
                    updateData.internet_speed = propertyUpdates.internet_speed;
                if (propertyUpdates.price_per_month !== undefined)
                    updateData.price_per_month = propertyUpdates.price_per_month;
                if (propertyUpdates.price_per_night !== undefined)
                    updateData.price_per_night = propertyUpdates.price_per_night;
                if (propertyUpdates.currency !== undefined)
                    updateData.currency = propertyUpdates.currency;
                if (propertyUpdates.security_deposit !== undefined)
                    updateData.security_deposit = propertyUpdates.security_deposit;
                if (propertyUpdates.cleaning_fee !== undefined)
                    updateData.cleaning_fee = propertyUpdates.cleaning_fee;
                if (propertyUpdates.service_fee !== undefined)
                    updateData.service_fee = propertyUpdates.service_fee;
                if (propertyUpdates.tax_amount !== undefined)
                    updateData.tax_amount = propertyUpdates.tax_amount;
                const { error: updateError } = await supabaseAdmin
                    .from('properties')
                    .update(updateData)
                    .eq('id', id);
                if (updateError) {
                    throw new Error(`Failed to update property: ${updateError.message}`);
                }
            }
            // Update location if provided
            if (address || town || county || (latitude && longitude)) {
                const locationUpdate = {};
                if (address)
                    locationUpdate.address = address;
                if (town)
                    locationUpdate.town = town;
                if (county)
                    locationUpdate.county = county;
                if (latitude && longitude) {
                    locationUpdate.location = `POINT(${longitude} ${latitude})`;
                }
                const { error: locationError } = await supabaseAdmin
                    .from('property_locations')
                    .update(locationUpdate)
                    .eq('property_id', id);
                if (locationError) {
                    logger.error({ error: locationError }, 'Failed to update location');
                }
            }
            // Update neighborhood if provided
            if (neighborhood) {
                const neighborhoodUpdate = {};
                if (neighborhood.crime_rating !== undefined)
                    neighborhoodUpdate.crime_rating = neighborhood.crime_rating;
                if (neighborhood.noise_level !== undefined)
                    neighborhoodUpdate.noise_level = neighborhood.noise_level;
                if (neighborhood.community_vibe !== undefined)
                    neighborhoodUpdate.community_vibe = neighborhood.community_vibe;
                if (neighborhood.light_exposure !== undefined)
                    neighborhoodUpdate.light_exposure = neighborhood.light_exposure;
                const { error: neighborhoodError } = await supabaseAdmin
                    .from('property_neighborhood')
                    .upsert({
                    property_id: id,
                    ...neighborhoodUpdate
                })
                    .eq('property_id', id);
                if (neighborhoodError) {
                    logger.error({ error: neighborhoodError }, 'Failed to update neighborhood');
                }
            }
            // Update amenities if provided
            if (amenity_ids) {
                // First remove all existing links
                await supabaseAdmin
                    .from('property_amenities')
                    .delete()
                    .eq('property_id', id);
                // Then add new ones
                if (amenity_ids.length > 0) {
                    const amenityLinks = amenity_ids.map(amenity_id => ({
                        property_id: id,
                        amenity_id
                    }));
                    const { error: amenitiesError } = await supabaseAdmin
                        .from('property_amenities')
                        .insert(amenityLinks);
                    if (amenitiesError) {
                        logger.error({ error: amenitiesError }, 'Failed to update amenities');
                    }
                }
            }
            // Update images if provided
            if (images && images.length > 0) {
                // Delete existing images
                await supabaseAdmin
                    .from('property_images')
                    .delete()
                    .eq('property_id', id);
                // Add new images
                const imageData = images.map((img, index) => ({
                    property_id: id,
                    image_url: img.url,
                    is_primary: img.isPrimary || false,
                    sort_order: img.sortOrder !== undefined ? img.sortOrder : index,
                    created_at: new Date().toISOString()
                }));
                const { error: imagesError } = await supabaseAdmin
                    .from('property_images')
                    .insert(imageData);
                if (imagesError) {
                    logger.error({ error: imagesError }, 'Failed to update images');
                }
            }
            // Recalculate landmarks if location changed
            if (latitude && longitude) {
                await this.calculateNearbyLandmarks(id, latitude, longitude);
            }
            // Return updated property
            return await this.getPropertyById(id);
        }
        catch (error) {
            logger.error({ error, propertyId: id, userId }, 'Error in updateProperty');
            throw error;
        }
    }
    /**
     * Delete property
     */
    async deleteProperty(id, userId) {
        try {
            // Check ownership
            const { data: existing, error: checkError } = await supabaseAdmin
                .from('properties')
                .select('owner_id')
                .eq('id', id)
                .single();
            if (checkError || !existing) {
                throw new Error('Property not found');
            }
            if (existing.owner_id !== userId) {
                throw new Error('Unauthorized: You do not own this property');
            }
            // Delete property (cascade will handle related tables)
            const { error: deleteError } = await supabaseAdmin
                .from('properties')
                .delete()
                .eq('id', id);
            if (deleteError) {
                throw new Error(`Failed to delete property: ${deleteError.message}`);
            }
            logger.info({ propertyId: id, userId }, 'Property deleted successfully');
            return { success: true, message: 'Property deleted successfully' };
        }
        catch (error) {
            logger.error({ error, propertyId: id, userId }, 'Error in deleteProperty');
            throw error;
        }
    }
    /**
     * Add images to property
     */
    async addPropertyImages(propertyId, userId, images) {
        try {
            // Verify ownership
            await this.verifyOwnership(propertyId, userId);
            const imageInserts = images.map((img, index) => ({
                property_id: propertyId,
                image_url: img.url,
                is_primary: img.isPrimary || false,
                sort_order: img.sortOrder !== undefined ? img.sortOrder : index,
                created_at: new Date().toISOString()
            }));
            const { data, error } = await supabaseAdmin
                .from('property_images')
                .insert(imageInserts)
                .select();
            if (error) {
                throw new Error(`Failed to add images: ${error.message}`);
            }
            return data;
        }
        catch (error) {
            logger.error({ error, propertyId, userId }, 'Error in addPropertyImages');
            throw error;
        }
    }
    /**
     * Delete property image
     */
    async deletePropertyImage(imageId, userId) {
        try {
            // First get the image to check property ownership
            const { data: image, error: fetchError } = await supabaseAdmin
                .from('property_images')
                .select('property_id')
                .eq('id', imageId)
                .single();
            if (fetchError || !image) {
                throw new Error('Image not found');
            }
            await this.verifyOwnership(image.property_id, userId);
            const { error: deleteError } = await supabaseAdmin
                .from('property_images')
                .delete()
                .eq('id', imageId);
            if (deleteError) {
                throw new Error(`Failed to delete image: ${deleteError.message}`);
            }
            return { success: true, message: 'Image deleted successfully' };
        }
        catch (error) {
            logger.error({ error, imageId, userId }, 'Error in deletePropertyImage');
            throw error;
        }
    }
    /**
     * Get properties by owner
     */
    async getPropertiesByOwner(ownerId, filters) {
        try {
            let query = supabaseAdmin
                .from('properties')
                .select(`
                    *,
                    images:property_images(
                        image_url,
                        is_primary
                    ),
                    location:property_locations(
                        town,
                        county
                    )
                `)
                .eq('owner_id', ownerId);
            if (filters?.status) {
                query = query.eq('status', filters.status);
            }
            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) {
                throw new Error(`Failed to fetch owner properties: ${error.message}`);
            }
            return data || [];
        }
        catch (error) {
            logger.error({ error, ownerId }, 'Error in getPropertiesByOwner');
            throw error;
        }
    }
    /**
     * Search by location (legacy method)
     */
    /**
 * Search by location (legacy method)
 */
    async searchByLocation(lat, lng, radius = 5000) {
        try {
            // Use RPC function
            const { data, error } = await supabaseAdmin.rpc('search_properties_by_location', {
                lat_param: lat,
                lng_param: lng,
                radius_meters: radius
            });
            if (error) {
                logger.error({ error }, 'RPC search_properties_by_location failed');
                // Fallback to manual calculation
                return this.searchByLocationFallback(lat, lng, radius);
            }
            return data || [];
        }
        catch (error) {
            logger.error({ error, lat, lng, radius }, 'Error in searchByLocation');
            throw error;
        }
    }
    /**
     * Fallback for location search
     */
    async searchByLocationFallback(lat, lng, radius) {
        try {
            // Get all properties with locations
            const { data: locations, error: locError } = await supabaseAdmin
                .from('property_locations')
                .select(`
                property_id,
                address,
                town,
                county,
                location
            `);
            if (locError) {
                throw new Error(`Failed to fetch locations: ${locError.message}`);
            }
            const results = [];
            for (const loc of locations || []) {
                // Parse location
                const pointMatch = loc.location.match(/POINT\(([^ ]+) ([^)]+)\)/);
                if (!pointMatch)
                    continue;
                const propLng = parseFloat(pointMatch[1]);
                const propLat = parseFloat(pointMatch[2]);
                // Calculate distance
                const distance = this.calculateDistance(lat, lng, propLat, propLng) * 1000;
                if (distance <= radius) {
                    // Get property details
                    const { data: property, error: propError } = await supabaseAdmin
                        .from('properties')
                        .select(`
                        *,
                        images:property_images(
                            image_url,
                            is_primary
                        )
                    `)
                        .eq('id', loc.property_id)
                        .eq('is_verified', true)
                        .eq('status', 'active')
                        .single();
                    if (!propError && property) {
                        results.push({
                            property_id: loc.property_id,
                            address: loc.address,
                            town: loc.town,
                            county: loc.county,
                            distance: Math.round(distance),
                            property: {
                                ...property,
                                latitude: propLat,
                                longitude: propLng
                            }
                        });
                    }
                }
            }
            // Sort by distance
            results.sort((a, b) => a.distance - b.distance);
            return results;
        }
        catch (error) {
            logger.error({ error }, 'Error in searchByLocationFallback');
            throw error;
        }
    }
    /**
     * Get unverified properties (for admins/verifiers)
     */
    async getUnverifiedProperties() {
        try {
            const { data, error } = await supabaseAdmin
                .from('properties')
                .select(`
                    *,
                    location:property_locations(*),
                    images:property_images(*),
                    owner:profiles(full_name, email)
                `)
                .eq('is_verified', false)
                .order('created_at', { ascending: false });
            if (error)
                throw error;
            return data;
        }
        catch (error) {
            logger.error({ error: error.message }, 'Get unverified properties error');
            throw new Error(`Failed to fetch unverified properties: ${error.message}`);
        }
    }
    /**
     * Verify a property
     */
    async verifyProperty(id) {
        try {
            const { data, error } = await supabaseAdmin
                .from('properties')
                .update({
                is_verified: true,
                status: 'active',
                verified_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
                .eq('id', id)
                .select()
                .single();
            if (error)
                throw error;
            return data;
        }
        catch (error) {
            logger.error({ error: error.message }, 'Verify property error');
            throw new Error(`Failed to verify property: ${error.message}`);
        }
    }
    /**
     * Boost property (Toggle)
     */
    async boostProperty(id, isBoosted) {
        try {
            const { data, error } = await supabaseAdmin
                .from('properties')
                .update({
                is_boosted: isBoosted,
                updated_at: new Date().toISOString()
            })
                .eq('id', id)
                .select()
                .single();
            if (error)
                throw error;
            return data;
        }
        catch (error) {
            logger.error({ error: error.message }, 'Boost property error');
            throw new Error(`Failed to boost property: ${error.message}`);
        }
    }
    /**
     * Strike property (Toggle)
     */
    async strikeProperty(id, isStruck) {
        try {
            const { data, error } = await supabaseAdmin
                .from('properties')
                .update({
                is_struck: isStruck,
                status: isStruck ? 'suspended' : 'active',
                updated_at: new Date().toISOString()
            })
                .eq('id', id)
                .select()
                .single();
            if (error)
                throw error;
            return data;
        }
        catch (error) {
            logger.error({ error: error.message }, 'Strike property error');
            throw new Error(`Failed to strike property: ${error.message}`);
        }
    }
    /**
     * Get all properties (for Admin)
     */
    async getAllProperties() {
        try {
            const { data, error } = await supabaseAdmin
                .from('properties')
                .select(`
                    *,
                    owner:profiles!owner_id(full_name, email),
                    location:property_locations(town, county)
                `)
                .order('created_at', { ascending: false });
            if (error)
                throw error;
            return data || [];
        }
        catch (error) {
            logger.error({ error: error.message }, 'Get all properties error');
            throw new Error(`Failed to fetch all properties: ${error.message}`);
        }
    }
    /**
     * Verify property ownership
     */
    async verifyOwnership(propertyId, userId) {
        const { data, error } = await supabaseAdmin
            .from('properties')
            .select('owner_id')
            .eq('id', propertyId)
            .single();
        if (error || !data) {
            throw new Error('Property not found');
        }
        if (data.owner_id !== userId) {
            throw new Error('Unauthorized: You do not own this property');
        }
        return true;
    }
    /**
     * Get category info
     */
    getCategoryInfo(category) {
        const infoMap = {
            commercial: {
                description: 'Properties for business and commercial use',
                typicalAmenities: ['parking', 'security', 'loading bay', 'office space', 'reception'],
                searchTips: 'Search near business districts, highways, or industrial areas',
                propertyTypes: this.getPropertyTypesByCategory('commercial')
            },
            residential: {
                description: 'Homes and living spaces for individuals and families',
                typicalAmenities: ['parking', 'security', 'playground', 'garden', 'water tank'],
                searchTips: 'Search near schools, hospitals, or shopping centers',
                propertyTypes: this.getPropertyTypesByCategory('residential')
            },
            recreational: {
                description: 'Properties for leisure, tourism, and short-term stays',
                typicalAmenities: ['pool', 'gym', 'entertainment area', 'scenic view', 'restaurant'],
                searchTips: 'Search near tourist attractions, beaches, or scenic areas',
                propertyTypes: this.getPropertyTypesByCategory('recreational')
            }
        };
        return infoMap[category];
    }
}
export const propertiesService = new PropertiesService();
