import { Hono } from 'hono';
import { propertiesController } from './properties.controller.js';
import { authenticate, requireRoles } from '../middleware/auth.middleware.js';
const propertiesRouter = new Hono();
// Public routes
propertiesRouter.get('/', (c) => propertiesController.listProperties(c));
propertiesRouter.get('/:id', (c) => propertiesController.getProperty(c));
// Protected routes
propertiesRouter.post('/', authenticate, requireRoles('landlord', 'agent', 'caretaker'), (c) => propertiesController.createProperty(c));
export { propertiesRouter };
