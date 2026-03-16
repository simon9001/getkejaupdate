import { Hono } from 'hono';
import { spatialController } from './spatial.controller.js';
const spatialRouter = new Hono();
// Public spatial queries
spatialRouter.get('/search', (c) => spatialController.searchByRadius(c));
spatialRouter.get('/proximity', (c) => spatialController.getProximityIntelligence(c));
export { spatialRouter };
