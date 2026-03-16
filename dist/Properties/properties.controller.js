import { propertiesService } from '../services/properties.service.js';
import { logger } from '../utils/logger.js';
export class PropertiesController {
    /**
     * Create a new property
     */
    async createProperty(c) {
        try {
            const user = c.get('user');
            const input = await c.req.json();
            if (!user) {
                return c.json({ message: 'Unauthorized' }, 401);
            }
            const property = await propertiesService.createProperty(user.userId, input);
            return c.json({
                message: 'Property created successfully',
                property,
            }, 201);
        }
        catch (error) {
            logger.error({ error: error.message }, 'Create property error');
            return c.json({ message: error.message || 'Failed to create property' }, 400);
        }
    }
    /**
     * Get property by ID
     */
    async getProperty(c) {
        try {
            const id = c.req.param('id');
            const property = await propertiesService.getPropertyById(id);
            return c.json(property);
        }
        catch (error) {
            logger.error({ error: error.message }, 'Get property error');
            return c.json({ message: error.message || 'Property not found' }, 404);
        }
    }
    /**
     * List all properties
     */
    async listProperties(c) {
        try {
            const status = c.req.query('status');
            const type = c.req.query('type');
            const minPrice = c.req.query('minPrice') ? Number(c.req.query('minPrice')) : undefined;
            const maxPrice = c.req.query('maxPrice') ? Number(c.req.query('maxPrice')) : undefined;
            const properties = await propertiesService.listProperties({
                status,
                type,
                minPrice,
                maxPrice,
            });
            return c.json(properties);
        }
        catch (error) {
            logger.error({ error: error.message }, 'List properties error');
            return c.json({ message: error.message || 'Failed to list properties' }, 500);
        }
    }
}
export const propertiesController = new PropertiesController();
