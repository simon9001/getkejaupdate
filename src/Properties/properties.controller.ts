import type { Context } from 'hono';
import { propertiesService } from './properties.service.js';
import { logger } from '../utils/logger.js';
import { parseNaturalLanguageQuery } from '../utils/nlp.utils.js';
import type {
    CreatePropertyInput,
    PropertyStatus,
    PropertyType,
    PropertyCategory
} from '../types/property.types.js';

export class PropertiesController {
    /**
     * Create a new property with category classification
     */
    async createProperty(c: Context) {
        try {
            const user = c.get('user');
            const input: CreatePropertyInput = await c.req.json();

            if (!user) {
                return c.json({
                    message: 'Unauthorized',
                    code: 'UNAUTHORIZED'
                }, 401);
            }

            // Validate required fields
            if (!input.title || !input.property_type || !input.latitude || !input.longitude) {
                return c.json({
                    message: 'Missing required fields: title, property_type, latitude, longitude',
                    code: 'MISSING_FIELDS'
                }, 400);
            }

            // Auto-categorize property based on type
            const category = this.categorizeProperty(input.property_type);

            const property = await propertiesService.createProperty(user.userId, input);

            return c.json({
                message: 'Property created successfully',
                code: 'PROPERTY_CREATED',
                property: {
                    ...property,
                    category
                }
            }, 201);

        } catch (error: any) {
            logger.error({ error: error.message }, 'Create property error');

            const status = error.message.includes('Unauthorized') ? 403 : 400;
            return c.json({
                message: error.message || 'Failed to create property',
                code: 'CREATION_FAILED'
            }, status);
        }
    }

    /**
     * Categorize property based on type
     */
    private categorizeProperty(propertyType: PropertyType): PropertyCategory {
        const commercialTypes: PropertyType[] = ['office', 'retail', 'warehouse', 'industrial'];
        const residentialTypes: PropertyType[] = ['bedsitter', 'studio', 'apartment', 'maisonette', 'bungalow', 'villa'];
        const recreationalTypes: PropertyType[] = ['short_term', 'vacation', 'resort', 'camp'];

        if (commercialTypes.includes(propertyType)) {
            return 'commercial';
        } else if (recreationalTypes.includes(propertyType)) {
            return 'recreational';
        } else {
            return 'residential';
        }
    }

    /**
     * Get property by ID
     */
    async getProperty(c: Context) {
        try {
            const id = c.req.param('id');

            if (!id) {
                return c.json({
                    message: 'Property ID is required',
                    code: 'ID_REQUIRED'
                }, 400);
            }

            const property = await propertiesService.getPropertyById(id);

            // Add category to response
            const category = this.categorizeProperty(property.property_type);

            return c.json({
                property: {
                    ...property,
                    category
                },
                code: 'PROPERTY_FETCHED'
            });

        } catch (error: any) {
            logger.error({ error: error.message }, 'Get property error');

            const status = error.message.includes('not found') ? 404 : 500;
            return c.json({
                message: error.message || 'Property not found',
                code: 'FETCH_FAILED'
            }, status);
        }
    }

    /**
     * List all properties with filters
     */
    async listProperties(c: Context) {
        try {
            const status = c.req.query('status') as PropertyStatus;
            const type = c.req.query('type') as PropertyType;
            const category = c.req.query('category') as PropertyCategory;
            const minPrice = c.req.query('minPrice') ? Number(c.req.query('minPrice')) : undefined;
            const maxPrice = c.req.query('maxPrice') ? Number(c.req.query('maxPrice')) : undefined;
            const town = c.req.query('town');
            const county = c.req.query('county');
            const bedrooms = c.req.query('bedrooms') ? Number(c.req.query('bedrooms')) : undefined;
            const bathrooms = c.req.query('bathrooms') ? Number(c.req.query('bathrooms')) : undefined;
            const lat = c.req.query('lat') ? Number(c.req.query('lat')) : undefined;
            const lng = c.req.query('lng') ? Number(c.req.query('lng')) : undefined;
            const radius = c.req.query('radius') ? Number(c.req.query('radius')) : undefined;
            const amenities = c.req.query('amenities')?.split(',');
            const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 20;
            const page = c.req.query('page') ? Number(c.req.query('page')) : 1;
            const is_verified = c.req.query('is_verified') === 'true' ? true :
                c.req.query('is_verified') === 'false' ? false : undefined;

            const offset = (page - 1) * limit;

            // If category is specified, get property types for that category
            let propertyTypes: PropertyType[] | undefined;
            if (category) {
                propertyTypes = propertiesService.getPropertyTypesByCategory(category);
            }

            const result = await propertiesService.listProperties({
                status,
                type,
                propertyTypes,
                minPrice,
                maxPrice,
                town,
                county,
                bedrooms,
                bathrooms,
                lat,
                lng,
                radius,
                amenities,
                limit,
                offset,
                is_verified
            });

            // Add category to each property
            const propertiesWithCategory = result.properties.map(property => ({
                ...property,
                category: this.categorizeProperty(property.property_type)
            }));

            return c.json({
                properties: propertiesWithCategory,
                total: result.total,
                page,
                limit,
                category: category ? {
                    name: category,
                    info: propertiesService.getCategoryInfo(category)
                } : undefined,
                code: 'PROPERTIES_LISTED'
            });

        } catch (error: any) {
            logger.error({ error: error.message }, 'List properties error');
            return c.json({
                message: error.message || 'Failed to list properties',
                code: 'LIST_FAILED'
            }, 500);
        }
    }

    /**
     * Natural language search for properties
     * Handles queries like "i want a house around embu university ranging 2500"
     */
    async naturalLanguageSearch(c: Context) {
        try {
            const query = c.req.query('q');

            if (!query) {
                return c.json({
                    message: 'Search query is required',
                    code: 'QUERY_REQUIRED'
                }, 400);
            }

            // Parse the natural language query
            const parsedQuery = await parseNaturalLanguageQuery(query);

            logger.info({ parsedQuery }, 'Parsed natural language query');

            // Build search filters based on parsed query
            const filters: any = {
                status: 'active',
                is_verified: true,
                limit: c.req.query('limit') ? Number(c.req.query('limit')) : 20,
                offset: c.req.query('page') ? (Number(c.req.query('page')) - 1) * 20 : 0
            };

            // Apply price filter
            if (parsedQuery.maxPrice) {
                filters.maxPrice = parsedQuery.maxPrice;
            }
            if (parsedQuery.minPrice) {
                filters.minPrice = parsedQuery.minPrice;
            }

            // Apply bedroom filter
            if (parsedQuery.bedrooms !== undefined) {
                filters.bedrooms = parsedQuery.bedrooms;
            }

            // Apply property type filter
            if (parsedQuery.propertyType) {
                filters.type = parsedQuery.propertyType as PropertyType;
            }

            // Apply category filter
            if (parsedQuery.category) {
                filters.propertyTypes = propertiesService.getPropertyTypesByCategory(parsedQuery.category);
            }

            // If location is a landmark name, search near that landmark
            if (parsedQuery.landmark) {
                // Use the landmark-based search
                const properties = await propertiesService.getPropertiesNearLandmark(
                    parsedQuery.landmark,
                    parsedQuery.radius || 2000,
                    parsedQuery.category
                );

                // Apply price and bedroom filters to results
                let filteredProperties = properties;

                if (parsedQuery.minPrice !== undefined) {
                    filteredProperties = filteredProperties.filter((p: any) =>
                        (p.price_per_month || 0) >= parsedQuery.minPrice!
                    );
                }

                if (parsedQuery.maxPrice !== undefined) {
                    filteredProperties = filteredProperties.filter((p: any) =>
                        (p.price_per_month || 0) <= parsedQuery.maxPrice!
                    );
                }

                if (parsedQuery.bedrooms !== undefined) {
                    filteredProperties = filteredProperties.filter((p: any) =>
                        p.bedrooms === parsedQuery.bedrooms
                    );
                }

                // Add category to properties
                const propertiesWithCategory = filteredProperties.map((property: any) => ({
                    ...property,
                    category: this.categorizeProperty(property.property_type)
                }));

                return c.json({
                    message: 'Search completed',
                    code: 'SEARCH_COMPLETED',
                    query: parsedQuery,
                    results: propertiesWithCategory,
                    total: propertiesWithCategory.length,
                    page: 1
                });
            }

            // If town is specified
            if (parsedQuery.town) {
                filters.town = parsedQuery.town;
            }

            // Execute search
            const results = await propertiesService.searchProperties(filters);

            // Handle both array and object responses
            const propertiesArray = Array.isArray(results) ? results : results.properties || [];
            const totalCount = Array.isArray(results) ? results.length : results.total || propertiesArray.length;

            // Add category to results
            const propertiesWithCategory = propertiesArray.map((property: any) => ({
                ...property,
                category: this.categorizeProperty(property.property_type)
            }));

            return c.json({
                message: 'Search completed',
                code: 'SEARCH_COMPLETED',
                query: parsedQuery,
                results: propertiesWithCategory,
                total: totalCount,
                page: c.req.query('page') ? Number(c.req.query('page')) : 1
            });

        } catch (error: any) {
            logger.error({ error: error.message, query: c.req.query('q') }, 'Natural language search error');
            return c.json({
                message: error.message || 'Failed to process search query',
                code: 'SEARCH_FAILED'
            }, 500);
        }
    }

    /**
     * Search by category (commercial, residential, recreational)
     */
    async searchByCategory(c: Context) {
        try {
            const category = c.req.param('category') as PropertyCategory;

            if (!['commercial', 'residential', 'recreational'].includes(category)) {
                return c.json({
                    message: 'Invalid category. Must be commercial, residential, or recreational',
                    code: 'INVALID_CATEGORY'
                }, 400);
            }

            const minPrice = c.req.query('minPrice') ? Number(c.req.query('minPrice')) : undefined;
            const maxPrice = c.req.query('maxPrice') ? Number(c.req.query('maxPrice')) : undefined;
            const town = c.req.query('town');
            const lat = c.req.query('lat') ? Number(c.req.query('lat')) : undefined;
            const lng = c.req.query('lng') ? Number(c.req.query('lng')) : undefined;
            const radius = c.req.query('radius') ? Number(c.req.query('radius')) : undefined;
            const bedrooms = c.req.query('bedrooms') ? Number(c.req.query('bedrooms')) : undefined;
            const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 20;
            const page = c.req.query('page') ? Number(c.req.query('page')) : 1;

            const offset = (page - 1) * limit;

            // Map category to property types
            const propertyTypes = propertiesService.getPropertyTypesByCategory(category);

            const filters = {
                propertyTypes,
                minPrice,
                maxPrice,
                town,
                bedrooms,
                lat,
                lng,
                radius,
                limit,
                offset,
                status: 'active' as PropertyStatus,
                is_verified: true
            };

            const results = await propertiesService.listProperties(filters);

            // Add category metadata
            const propertiesWithCategory = results.properties.map(property => ({
                ...property,
                category
            }));

            return c.json({
                properties: propertiesWithCategory,
                total: results.total,
                page,
                limit,
                category: {
                    name: category,
                    info: propertiesService.getCategoryInfo(category)
                },
                code: 'CATEGORY_SEARCH_COMPLETE'
            });

        } catch (error: any) {
            logger.error({ error: error.message }, 'Category search error');
            return c.json({
                message: error.message || 'Failed to search by category',
                code: 'CATEGORY_SEARCH_FAILED'
            }, 500);
        }
    }

    /**
     * Get properties near a specific landmark
     */
    async getPropertiesNearLandmark(c: Context) {
        try {
            const landmarkName = c.req.param('landmark');
            const radius = c.req.query('radius') ? Number(c.req.query('radius')) : 2000;
            const category = c.req.query('category') as PropertyCategory;
            const minPrice = c.req.query('minPrice') ? Number(c.req.query('minPrice')) : undefined;
            const maxPrice = c.req.query('maxPrice') ? Number(c.req.query('maxPrice')) : undefined;
            const bedrooms = c.req.query('bedrooms') ? Number(c.req.query('bedrooms')) : undefined;

            if (!landmarkName) {
                return c.json({
                    message: 'Landmark name is required',
                    code: 'LANDMARK_REQUIRED'
                }, 400);
            }

            let properties = await propertiesService.getPropertiesNearLandmark(
                landmarkName,
                radius,
                category
            );

            // Apply additional filters
            if (minPrice !== undefined) {
                properties = properties.filter((p: any) => (p.price_per_month || 0) >= minPrice);
            }
            if (maxPrice !== undefined) {
                properties = properties.filter((p: any) => (p.price_per_month || 0) <= maxPrice);
            }
            if (bedrooms !== undefined) {
                properties = properties.filter((p: any) => p.bedrooms === bedrooms);
            }

            // Add category to properties
            const propertiesWithCategory = properties.map((property: any) => ({
                ...property,
                category: this.categorizeProperty(property.property_type)
            }));

            return c.json({
                message: `Properties near ${landmarkName}`,
                code: 'NEAR_LANDMARK_FETCHED',
                landmark: landmarkName,
                radius,
                properties: propertiesWithCategory,
                total: properties.length
            });

        } catch (error: any) {
            logger.error({ error: error.message }, 'Get properties near landmark error');
            return c.json({
                message: error.message || 'Failed to fetch properties near landmark',
                code: 'NEAR_LANDMARK_FAILED'
            }, 500);
        }
    }

    /**
     * Get property statistics by category
     */
    async getCategoryStatistics(c: Context) {
        try {
            const stats = await propertiesService.getCategoryStatistics();

            return c.json({
                message: 'Category statistics retrieved',
                code: 'CATEGORY_STATS_FETCHED',
                statistics: stats
            });

        } catch (error: any) {
            logger.error({ error: error.message }, 'Get category statistics error');
            return c.json({
                message: error.message || 'Failed to fetch category statistics',
                code: 'STATS_FAILED'
            }, 500);
        }
    }

    /**
     * Update property
     */
    async updateProperty(c: Context) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');
            const updates = await c.req.json();

            if (!user) {
                return c.json({
                    message: 'Unauthorized',
                    code: 'UNAUTHORIZED'
                }, 401);
            }

            if (!id) {
                return c.json({
                    message: 'Property ID is required',
                    code: 'ID_REQUIRED'
                }, 400);
            }

            const property = await propertiesService.updateProperty(id, user.userId, updates);

            // Add category to response
            const category = this.categorizeProperty(property.property_type);

            return c.json({
                message: 'Property updated successfully',
                code: 'PROPERTY_UPDATED',
                property: {
                    ...property,
                    category
                }
            });

        } catch (error: any) {
            logger.error({ error: error.message }, 'Update property error');

            let status = 400;
            if (error.message.includes('not found')) status = 404;
            if (error.message.includes('Unauthorized')) status = 403;

            return c.json({
                message: error.message || 'Failed to update property',
                code: 'UPDATE_FAILED'
            }, status as any);
        }
    }

    /**
     * Delete property
     */
    async deleteProperty(c: Context) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');

            if (!user) {
                return c.json({
                    message: 'Unauthorized',
                    code: 'UNAUTHORIZED'
                }, 401);
            }

            if (!id) {
                return c.json({
                    message: 'Property ID is required',
                    code: 'ID_REQUIRED'
                }, 400);
            }

            const result = await propertiesService.deleteProperty(id, user.userId);

            return c.json(result);

        } catch (error: any) {
            logger.error({ error: error.message }, 'Delete property error');

            let status = 400;
            if (error.message.includes('not found')) status = 404;
            if (error.message.includes('Unauthorized')) status = 403;

            return c.json({
                message: error.message || 'Failed to delete property',
                code: 'DELETE_FAILED'
            }, status as any);
        }
    }

    /**
     * Add images to property
     */
    async addPropertyImages(c: Context) {
        try {
            const user = c.get('user');
            const propertyId = c.req.param('id');
            const { images } = await c.req.json();

            if (!user) {
                return c.json({
                    message: 'Unauthorized',
                    code: 'UNAUTHORIZED'
                }, 401);
            }

            if (!propertyId) {
                return c.json({
                    message: 'Property ID is required',
                    code: 'ID_REQUIRED'
                }, 400);
            }

            if (!images || !Array.isArray(images) || images.length === 0) {
                return c.json({
                    message: 'Images array is required',
                    code: 'IMAGES_REQUIRED'
                }, 400);
            }

            const uploadedImages = await propertiesService.addPropertyImages(
                propertyId,
                user.userId,
                images
            );

            return c.json({
                message: 'Images added successfully',
                code: 'IMAGES_ADDED',
                images: uploadedImages
            }, 201);

        } catch (error: any) {
            logger.error({ error: error.message }, 'Add property images error');

            let status = 400;
            if (error.message.includes('not found')) status = 404;
            if (error.message.includes('Unauthorized')) status = 403;

            return c.json({
                message: error.message || 'Failed to add images',
                code: 'IMAGE_ADD_FAILED'
            }, status as any);
        }
    }

    /**
     * Delete property image
     */
    async deletePropertyImage(c: Context) {
        try {
            const user = c.get('user');
            const imageId = c.req.param('imageId');

            if (!user) {
                return c.json({
                    message: 'Unauthorized',
                    code: 'UNAUTHORIZED'
                }, 401);
            }

            if (!imageId) {
                return c.json({
                    message: 'Image ID is required',
                    code: 'ID_REQUIRED'
                }, 400);
            }

            const result = await propertiesService.deletePropertyImage(imageId, user.userId);

            return c.json(result);

        } catch (error: any) {
            logger.error({ error: error.message }, 'Delete property image error');

            let status = 400;
            if (error.message.includes('not found')) status = 404;
            if (error.message.includes('Unauthorized')) status = 403;

            return c.json({
                message: error.message || 'Failed to delete image',
                code: 'IMAGE_DELETE_FAILED'
            }, status as any);
        }
    }

    /**
     * Get properties by current user
     */
    async getMyProperties(c: Context) {
        try {
            const user = c.get('user');
            const status = c.req.query('status') as PropertyStatus;

            if (!user) {
                return c.json({
                    message: 'Unauthorized',
                    code: 'UNAUTHORIZED'
                }, 401);
            }

            const properties = await propertiesService.getPropertiesByOwner(
                user.userId,
                status ? { status } : undefined
            );

            // Add category to each property
            const propertiesWithCategory = properties.map((property: any) => ({
                ...property,
                category: this.categorizeProperty(property.property_type)
            }));

            return c.json({
                properties: propertiesWithCategory,
                total: properties.length,
                code: 'MY_PROPERTIES_FETCHED'
            });

        } catch (error: any) {
            logger.error({ error: error.message }, 'Get my properties error');
            return c.json({
                message: error.message || 'Failed to fetch your properties',
                code: 'FETCH_FAILED'
            }, 500);
        }
    }

    /**
     * Search properties by location (legacy)
     */
    async searchByLocation(c: Context) {
        try {
            const lat = c.req.query('lat') ? Number(c.req.query('lat')) : undefined;
            const lng = c.req.query('lng') ? Number(c.req.query('lng')) : undefined;
            const radius = c.req.query('radius') ? Number(c.req.query('radius')) : 5000;

            if (!lat || !lng) {
                return c.json({
                    message: 'Latitude and longitude are required',
                    code: 'COORDINATES_REQUIRED'
                }, 400);
            }

            const results = await propertiesService.searchByLocation(lat, lng, radius);

            return c.json({
                results,
                total: results.length,
                code: 'LOCATION_SEARCH_COMPLETE'
            });

        } catch (error: any) {
            logger.error({ error: error.message }, 'Location search error');
            return c.json({
                message: error.message || 'Failed to search by location',
                code: 'SEARCH_FAILED'
            }, 500);
        }
    }

    /**
     * Get unverified properties (admin/verifier)
     */
    async getUnverifiedProperties(c: Context) {
        try {
            const user = c.get('user');
            if (!user) {
                return c.json({
                    message: 'Unauthorized',
                    code: 'UNAUTHORIZED'
                }, 401);
            }

            const properties = await propertiesService.getUnverifiedProperties();

            // Add category to each property
            const propertiesWithCategory = properties.map((property: any) => ({
                ...property,
                category: this.categorizeProperty(property.property_type)
            }));

            return c.json({
                properties: propertiesWithCategory,
                total: properties.length,
                code: 'UNVERIFIED_PROPERTIES_FETCHED'
            });
        } catch (error: any) {
            logger.error({ error: error.message }, 'Get unverified error');
            return c.json({
                message: error.message || 'Failed to fetch unverified properties',
                code: 'FETCH_FAILED'
            }, 500);
        }
    }

    /**
     * Verify property (admin/verifier)
     */
    async verifyProperty(c: Context) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');

            if (!user) {
                return c.json({
                    message: 'Unauthorized',
                    code: 'UNAUTHORIZED'
                }, 401);
            }

            if (!id) {
                return c.json({
                    message: 'Property ID is required',
                    code: 'ID_REQUIRED'
                }, 400);
            }

            const property = await propertiesService.verifyProperty(id, user.userId);

            // Add category to response
            const category = this.categorizeProperty(property.property_type);

            return c.json({
                message: 'Property verified successfully',
                property: {
                    ...property,
                    category
                },
                code: 'PROPERTY_VERIFIED'
            });
        } catch (error: any) {
            logger.error({ error: error.message }, 'Verify property error');
            return c.json({
                message: error.message || 'Failed to verify property',
                code: 'VERIFY_FAILED'
            }, 400);
        }
    }

    /**
     * Reject property (admin/verifier)
     */
    async rejectProperty(c: Context) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');
            const body = await c.req.json().catch(() => ({}));
            const reason = body?.reason as string | undefined;

            if (!user) {
                return c.json({ message: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
            }
            if (!id) {
                return c.json({ message: 'Property ID is required', code: 'ID_REQUIRED' }, 400);
            }

            const property = await propertiesService.rejectProperty(id, user.userId, reason);
            return c.json({
                message: 'Property rejected',
                property,
                code: 'PROPERTY_REJECTED'
            });
        } catch (error: any) {
            logger.error({ error: error.message }, 'Reject property error');
            return c.json({
                message: error.message || 'Failed to reject property',
                code: 'REJECT_FAILED'
            }, 400);
        }
    }

    /**
     * Boost property (admin)
     */
    async boostProperty(c: Context) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');
            const { isBoosted } = await c.req.json();

            if (!user) {
                return c.json({
                    message: 'Unauthorized',
                    code: 'UNAUTHORIZED'
                }, 401);
            }

            if (!id) {
                return c.json({
                    message: 'Property ID is required',
                    code: 'ID_REQUIRED'
                }, 400);
            }

            const property = await propertiesService.boostProperty(id, isBoosted);

            // Add category to response
            const category = this.categorizeProperty(property.property_type);

            return c.json({
                message: isBoosted ? 'Property boosted successfully' : 'Boost removed successfully',
                property: {
                    ...property,
                    category
                },
                code: 'PROPERTY_BOOSTED'
            });
        } catch (error: any) {
            logger.error({ error: error.message }, 'Boost property error');
            return c.json({
                message: error.message || 'Failed to boost property',
                code: 'BOOST_FAILED'
            }, 400);
        }
    }

    /**
     * Strike property (admin)
     */
    async strikeProperty(c: Context) {
        try {
            const user = c.get('user');
            const id = c.req.param('id');
            const { isStruck } = await c.req.json();

            if (!user) {
                return c.json({
                    message: 'Unauthorized',
                    code: 'UNAUTHORIZED'
                }, 401);
            }

            if (!id) {
                return c.json({
                    message: 'Property ID is required',
                    code: 'ID_REQUIRED'
                }, 400);
            }

            const property = await propertiesService.strikeProperty(id, isStruck);

            // Add category to response
            const category = this.categorizeProperty(property.property_type);

            return c.json({
                message: isStruck ? 'Property struck successfully' : 'Strike removed successfully',
                property: {
                    ...property,
                    category
                },
                code: 'PROPERTY_STRUCK'
            });
        } catch (error: any) {
            logger.error({ error: error.message }, 'Strike property error');
            return c.json({
                message: error.message || 'Failed to strike property',
                code: 'STRIKE_FAILED'
            }, 400);
        }
    }

    /**
     * Get all properties (admin)
     */
    async getAllProperties(c: Context) {
        try {
            const user = c.get('user');
            if (!user) {
                return c.json({
                    message: 'Unauthorized',
                    code: 'UNAUTHORIZED'
                }, 401);
            }

            const properties = await propertiesService.getAllProperties();

            // Add category to each property
            const propertiesWithCategory = properties.map((property: any) => ({
                ...property,
                category: this.categorizeProperty(property.property_type)
            }));

            return c.json({
                properties: propertiesWithCategory,
                total: properties.length,
                code: 'ALL_PROPERTIES_FETCHED'
            });
        } catch (error: any) {
            logger.error({ error: error.message }, 'Get all properties error');
            return c.json({
                message: error.message || 'Failed to fetch all properties',
                code: 'FETCH_FAILED'
            }, 500);
        }
    }
}

export const propertiesController = new PropertiesController();