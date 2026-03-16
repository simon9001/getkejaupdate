import { propertiesService } from '../services/properties.service.js';
import { logger } from '../utils/logger.js';
import { parseNaturalLanguageQuery } from '../utils/nlp.utils.js';
export class PropertiesController {
    /**
     * Create a new property with category classification
     */
    async createProperty(c) {
        try {
            const user = c.get('user');
            const input = await c.req.json();
            if (!user) {
                return c.json({ error: 'Unauthorized' }, 401);
            }
            // Validate required fields
            if (!input.title || !input.property_type || !input.latitude || !input.longitude) {
                return c.json({
                    error: 'Missing required fields: title, property_type, latitude, longitude'
                }, 400);
            }
            const property = await propertiesService.createProperty(user.id, input);
            return c.json({
                message: 'Property created successfully',
                property: {
                    ...property,
                    category: this.categorizeProperty(property.property_type)
                }
            }, 201);
        }
        catch (error) {
            logger.error({ error: error.message }, 'Create property error');
            return c.json({ error: error.message || 'Failed to create property' }, 400);
        }
    }
    /**
     * Categorize property based on type
     */
    categorizeProperty(propertyType) {
        const commercialTypes = ['office', 'retail', 'warehouse', 'industrial'];
        const residentialTypes = ['bedsitter', 'studio', 'apartment', 'maisonette', 'bungalow', 'villa'];
        const recreationalTypes = ['short_term', 'vacation', 'resort', 'camp'];
        if (commercialTypes.includes(propertyType))
            return 'commercial';
        if (recreationalTypes.includes(propertyType))
            return 'recreational';
        return 'residential';
    }
    /**
     * Get property by ID
     */
    async getProperty(c) {
        try {
            const id = c.req.param('id');
            if (!id) {
                return c.json({ error: 'Property ID is required' }, 400);
            }
            const property = await propertiesService.getPropertyById(id);
            return c.json({
                property: {
                    ...property,
                    category: this.categorizeProperty(property.property_type)
                }
            });
        }
        catch (error) {
            logger.error({ error: error.message }, 'Get property error');
            const status = error.message.includes('not found') ? 404 : 500;
            return c.json({ error: error.message || 'Property not found' }, status);
        }
    }
    /**
     * List properties with filters
     */
    async listProperties(c) {
        try {
            const { status, type, category, minPrice, maxPrice, town, county, bedrooms, bathrooms, lat, lng, radius, amenities, limit = 20, page = 1, is_verified } = c.req.query();
            const offset = (Number(page) - 1) * Number(limit);
            // Get property types for category if specified
            let propertyTypes;
            if (category && this.isValidCategory(category)) {
                propertyTypes = propertiesService.getPropertyTypesByCategory(category);
            }
            const result = await propertiesService.listProperties({
                status: status,
                type: type,
                propertyTypes,
                minPrice: minPrice ? Number(minPrice) : undefined,
                maxPrice: maxPrice ? Number(maxPrice) : undefined,
                town,
                county,
                bedrooms: bedrooms ? Number(bedrooms) : undefined,
                bathrooms: bathrooms ? Number(bathrooms) : undefined,
                lat: lat ? Number(lat) : undefined,
                lng: lng ? Number(lng) : undefined,
                radius: radius ? Number(radius) : undefined,
                amenities: amenities?.split(','),
                limit: Number(limit),
                offset,
                is_verified: is_verified === 'true' ? true : is_verified === 'false' ? false : undefined
            });
            // Add category to each property
            const propertiesWithCategory = result.properties.map(property => ({
                ...property,
                category: this.categorizeProperty(property.property_type)
            }));
            return c.json({
                properties: propertiesWithCategory,
                total: result.total,
                page: Number(page),
                limit: Number(limit),
                ...(category && this.isValidCategory(category) && {
                    category: {
                        name: category,
                        info: propertiesService.getCategoryInfo(category)
                    }
                })
            });
        }
        catch (error) {
            logger.error({ error: error.message }, 'List properties error');
            return c.json({ error: error.message || 'Failed to list properties' }, 500);
        }
    }
    /**
     * Natural language search for properties
     */
    async naturalLanguageSearch(c) {
        try {
            const query = c.req.query('q');
            if (!query) {
                return c.json({ error: 'Search query is required' }, 400);
            }
            const parsedQuery = await parseNaturalLanguageQuery(query);
            logger.info({ parsedQuery }, 'Parsed natural language query');
            // If landmark is specified, use landmark search
            if (parsedQuery.landmark) {
                const properties = await propertiesService.getPropertiesNearLandmark(parsedQuery.landmark, parsedQuery.radius || 2000, parsedQuery.category);
                // Apply additional filters
                let filteredProperties = properties;
                if (parsedQuery.minPrice !== undefined) {
                    filteredProperties = filteredProperties.filter(p => (p.price_per_month || 0) >= parsedQuery.minPrice);
                }
                if (parsedQuery.maxPrice !== undefined) {
                    filteredProperties = filteredProperties.filter(p => (p.price_per_month || 0) <= parsedQuery.maxPrice);
                }
                if (parsedQuery.bedrooms !== undefined) {
                    filteredProperties = filteredProperties.filter(p => p.bedrooms === parsedQuery.bedrooms);
                }
                // Add category to properties
                const propertiesWithCategory = filteredProperties.map(property => ({
                    ...property,
                    category: this.categorizeProperty(property.property_type)
                }));
                return c.json({
                    query: parsedQuery,
                    results: propertiesWithCategory,
                    total: propertiesWithCategory.length
                });
            }
            // Otherwise use regular search
            const filters = {
                status: 'active',
                is_verified: true,
                limit: Number(c.req.query('limit') || 20),
                offset: Number(c.req.query('page') ? (Number(c.req.query('page')) - 1) * 20 : 0)
            };
            if (parsedQuery.maxPrice)
                filters.maxPrice = parsedQuery.maxPrice;
            if (parsedQuery.minPrice)
                filters.minPrice = parsedQuery.minPrice;
            if (parsedQuery.bedrooms !== undefined)
                filters.bedrooms = parsedQuery.bedrooms;
            if (parsedQuery.propertyType)
                filters.type = parsedQuery.propertyType;
            if (parsedQuery.category) {
                filters.propertyTypes = propertiesService.getPropertyTypesByCategory(parsedQuery.category);
            }
            if (parsedQuery.town)
                filters.town = parsedQuery.town;
            const results = await propertiesService.searchProperties(filters);
            const propertiesArray = Array.isArray(results) ? results : results.properties || [];
            const totalCount = Array.isArray(results) ? results.length : results.total || propertiesArray.length;
            const propertiesWithCategory = propertiesArray.map((property) => ({
                ...property,
                category: this.categorizeProperty(property.property_type)
            }));
            return c.json({
                query: parsedQuery,
                results: propertiesWithCategory,
                total: totalCount,
                page: Number(c.req.query('page') || 1)
            });
        }
        catch (error) {
            logger.error({ error: error.message }, 'Natural language search error');
            return c.json({ error: error.message || 'Failed to process search query' }, 500);
        }
    }
    /**
     * Search by category
     */
    async searchByCategory(c) {
        try {
            const category = c.req.param('category');
            if (!this.isValidCategory(category)) {
                return c.json({ error: 'Invalid category' }, 400);
            }
            const { minPrice, maxPrice, town, lat, lng, radius, bedrooms, limit = 20, page = 1 } = c.req.query();
            const offset = (Number(page) - 1) * Number(limit);
            const propertyTypes = propertiesService.getPropertyTypesByCategory(category);
            const results = await propertiesService.listProperties({
                propertyTypes,
                minPrice: minPrice ? Number(minPrice) : undefined,
                maxPrice: maxPrice ? Number(maxPrice) : undefined,
                town,
                bedrooms: bedrooms ? Number(bedrooms) : undefined,
                lat: lat ? Number(lat) : undefined,
                lng: lng ? Number(lng) : undefined,
                radius: radius ? Number(radius) : undefined,
                limit: Number(limit),
                offset,
                status: 'active',
                is_verified: true
            });
            const propertiesWithCategory = results.properties.map(property => ({
                ...property,
                category
            }));
            return c.json({
                properties: propertiesWithCategory,
                total: results.total,
                page: Number(page),
                limit: Number(limit),
                category: {
                    name: category,
                    info: propertiesService.getCategoryInfo(category)
                }
            });
        }
        catch (error) {
            logger.error({ error: error.message }, 'Category search error');
            return c.json({ error: error.message || 'Failed to search by category' }, 500);
        }
    }
    /**
     * Get properties near a landmark
     */
    async getPropertiesNearLandmark(c) {
        try {
            const landmarkName = decodeURIComponent(c.req.param('landmark'));
            const { radius = 2000, category, minPrice, maxPrice, bedrooms } = c.req.query();
            if (!landmarkName) {
                return c.json({ error: 'Landmark name is required' }, 400);
            }
            let properties = await propertiesService.getPropertiesNearLandmark(landmarkName, Number(radius), category);
            // Apply additional filters
            if (minPrice) {
                properties = properties.filter(p => (p.price_per_month || 0) >= Number(minPrice));
            }
            if (maxPrice) {
                properties = properties.filter(p => (p.price_per_month || 0) <= Number(maxPrice));
            }
            if (bedrooms) {
                properties = properties.filter(p => p.bedrooms === Number(bedrooms));
            }
            const propertiesWithCategory = properties.map(property => ({
                ...property,
                category: this.categorizeProperty(property.property_type)
            }));
            return c.json({
                landmark: landmarkName,
                radius: Number(radius),
                properties: propertiesWithCategory,
                total: properties.length
            });
        }
        catch (error) {
            logger.error({ error: error.message }, 'Get properties near landmark error');
            return c.json({ error: error.message || 'Failed to fetch properties near landmark' }, 500);
        }
    }
    /**
     * Get category statistics
     */
    async getCategoryStatistics(c) {
        try {
            const stats = await propertiesService.getCategoryStatistics();
            return c.json({ statistics: stats });
        }
        catch (error) {
            logger.error({ error: error.message }, 'Get category statistics error');
            return c.json({ error: error.message || 'Failed to fetch category statistics' }, 500);
        }
    }
    /**
     * Update property
     */
    async updateProperty(c) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');
            const updates = await c.req.json();
            if (!user) {
                return c.json({ error: 'Unauthorized' }, 401);
            }
            if (!id) {
                return c.json({ error: 'Property ID is required' }, 400);
            }
            const property = await propertiesService.updateProperty(id, user.id, updates);
            return c.json({
                message: 'Property updated successfully',
                property: {
                    ...property,
                    category: this.categorizeProperty(property.property_type)
                }
            });
        }
        catch (error) {
            logger.error({ error: error.message }, 'Update property error');
            let status = 400;
            if (error.message.includes('not found'))
                status = 404;
            if (error.message.includes('Unauthorized'))
                status = 403;
            return c.json({ error: error.message || 'Failed to update property' }, status);
        }
    }
    /**
     * Delete property
     */
    async deleteProperty(c) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');
            if (!user) {
                return c.json({ error: 'Unauthorized' }, 401);
            }
            if (!id) {
                return c.json({ error: 'Property ID is required' }, 400);
            }
            const result = await propertiesService.deleteProperty(id, user.id);
            return c.json(result);
        }
        catch (error) {
            logger.error({ error: error.message }, 'Delete property error');
            let status = 400;
            if (error.message.includes('not found'))
                status = 404;
            if (error.message.includes('Unauthorized'))
                status = 403;
            return c.json({ error: error.message || 'Failed to delete property' }, status);
        }
    }
    /**
     * Add images to property
     */
    async addPropertyImages(c) {
        try {
            const user = c.get('user');
            const propertyId = c.req.param('id');
            const { images } = await c.req.json();
            if (!user) {
                return c.json({ error: 'Unauthorized' }, 401);
            }
            if (!propertyId) {
                return c.json({ error: 'Property ID is required' }, 400);
            }
            if (!images || !Array.isArray(images) || images.length === 0) {
                return c.json({ error: 'Images array is required' }, 400);
            }
            const uploadedImages = await propertiesService.addPropertyImages(propertyId, user.id, images);
            return c.json({
                message: 'Images added successfully',
                images: uploadedImages
            }, 201);
        }
        catch (error) {
            logger.error({ error: error.message }, 'Add property images error');
            let status = 400;
            if (error.message.includes('not found'))
                status = 404;
            if (error.message.includes('Unauthorized'))
                status = 403;
            return c.json({ error: error.message || 'Failed to add images' }, status);
        }
    }
    /**
     * Delete property image
     */
    async deletePropertyImage(c) {
        try {
            const user = c.get('user');
            const imageId = c.req.param('imageId');
            if (!user) {
                return c.json({ error: 'Unauthorized' }, 401);
            }
            if (!imageId) {
                return c.json({ error: 'Image ID is required' }, 400);
            }
            const result = await propertiesService.deletePropertyImage(imageId, user.id);
            return c.json(result);
        }
        catch (error) {
            logger.error({ error: error.message }, 'Delete property image error');
            let status = 400;
            if (error.message.includes('not found'))
                status = 404;
            if (error.message.includes('Unauthorized'))
                status = 403;
            return c.json({ error: error.message || 'Failed to delete image' }, status);
        }
    }
    /**
     * Get properties by current user
     */
    async getMyProperties(c) {
        try {
            const user = c.get('user');
            const status = c.req.query('status');
            if (!user) {
                return c.json({ error: 'Unauthorized' }, 401);
            }
            const properties = await propertiesService.getPropertiesByOwner(user.id, status ? { status } : undefined);
            const propertiesWithCategory = properties.map(property => ({
                ...property,
                category: this.categorizeProperty(property.property_type)
            }));
            return c.json({
                properties: propertiesWithCategory,
                total: properties.length
            });
        }
        catch (error) {
            logger.error({ error: error.message }, 'Get my properties error');
            return c.json({ error: error.message || 'Failed to fetch your properties' }, 500);
        }
    }
    /**
     * Search by location
     */
    async searchByLocation(c) {
        try {
            const lat = Number(c.req.query('lat'));
            const lng = Number(c.req.query('lng'));
            const radius = Number(c.req.query('radius') || 5000);
            if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
                return c.json({ error: 'Valid latitude and longitude are required' }, 400);
            }
            const results = await propertiesService.searchByLocation(lat, lng, radius);
            return c.json({ results, total: results.length });
        }
        catch (error) {
            logger.error({ error: error.message }, 'Location search error');
            return c.json({ error: error.message || 'Failed to search by location' }, 500);
        }
    }
    /**
     * Get unverified properties (admin)
     */
    async getUnverifiedProperties(c) {
        try {
            const user = c.get('user');
            if (!user) {
                return c.json({ error: 'Unauthorized' }, 401);
            }
            const properties = await propertiesService.getUnverifiedProperties();
            const propertiesWithCategory = properties.map(property => ({
                ...property,
                category: this.categorizeProperty(property.property_type)
            }));
            return c.json({
                properties: propertiesWithCategory,
                total: properties.length
            });
        }
        catch (error) {
            logger.error({ error: error.message }, 'Get unverified error');
            return c.json({ error: error.message || 'Failed to fetch unverified properties' }, 500);
        }
    }
    /**
     * Verify property (admin)
     */
    async verifyProperty(c) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');
            if (!user) {
                return c.json({ error: 'Unauthorized' }, 401);
            }
            if (!id) {
                return c.json({ error: 'Property ID is required' }, 400);
            }
            const property = await propertiesService.verifyProperty(id);
            return c.json({
                message: 'Property verified successfully',
                property: {
                    ...property,
                    category: this.categorizeProperty(property.property_type)
                }
            });
        }
        catch (error) {
            logger.error({ error: error.message }, 'Verify property error');
            return c.json({ error: error.message || 'Failed to verify property' }, 400);
        }
    }
    /**
     * Boost property (admin)
     */
    async boostProperty(c) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');
            const { isBoosted } = await c.req.json();
            if (!user) {
                return c.json({ error: 'Unauthorized' }, 401);
            }
            if (!id) {
                return c.json({ error: 'Property ID is required' }, 400);
            }
            const property = await propertiesService.boostProperty(id, isBoosted);
            return c.json({
                message: isBoosted ? 'Property boosted successfully' : 'Boost removed successfully',
                property: {
                    ...property,
                    category: this.categorizeProperty(property.property_type)
                }
            });
        }
        catch (error) {
            logger.error({ error: error.message }, 'Boost property error');
            return c.json({ error: error.message || 'Failed to boost property' }, 400);
        }
    }
    /**
     * Strike property (admin)
     */
    async strikeProperty(c) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');
            const { isStruck } = await c.req.json();
            if (!user) {
                return c.json({ error: 'Unauthorized' }, 401);
            }
            if (!id) {
                return c.json({ error: 'Property ID is required' }, 400);
            }
            const property = await propertiesService.strikeProperty(id, isStruck);
            return c.json({
                message: isStruck ? 'Property struck successfully' : 'Strike removed successfully',
                property: {
                    ...property,
                    category: this.categorizeProperty(property.property_type)
                }
            });
        }
        catch (error) {
            logger.error({ error: error.message }, 'Strike property error');
            return c.json({ error: error.message || 'Failed to strike property' }, 400);
        }
    }
    /**
     * Get all properties (admin)
     */
    async getAllProperties(c) {
        try {
            const user = c.get('user');
            if (!user) {
                return c.json({ error: 'Unauthorized' }, 401);
            }
            const properties = await propertiesService.getAllProperties();
            const propertiesWithCategory = properties.map(property => ({
                ...property,
                category: this.categorizeProperty(property.property_type)
            }));
            return c.json({
                properties: propertiesWithCategory,
                total: properties.length
            });
        }
        catch (error) {
            logger.error({ error: error.message }, 'Get all properties error');
            return c.json({ error: error.message || 'Failed to fetch all properties' }, 500);
        }
    }
    /**
     * Helper to validate category
     */
    isValidCategory(category) {
        return ['commercial', 'residential', 'recreational'].includes(category);
    }
}
export const propertiesController = new PropertiesController();
