import { Hono } from 'hono';
import { spatialController } from './spatial.controller.js';
const spatialRouter = new Hono();
// Public spatial queries
spatialRouter.get('/search', (c) => spatialController.searchByRadius(c));
spatialRouter.get('/proximity', (c) => spatialController.getProximityIntelligence(c));
spatialRouter.get('/search-external', (c) => spatialController.searchExternal(c));
spatialRouter.post('/link-landmark', (c) => spatialController.linkLandmark(c));
export { spatialRouter };
