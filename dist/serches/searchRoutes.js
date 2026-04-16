/**
 * searchRoutes.ts
 *
 * Mounted at /api/search in index.ts.
 *
 *   GET  /api/search               — text + filter search
 *   GET  /api/search/nearby        — radius search (lat, lng, radius_km)
 *   GET  /api/search/map           — bounding-box search (north/south/east/west)
 *   POST /api/search/map           — same, accepting JSON body
 *
 * All routes are public (no auth required) — search results only include
 * properties with status='available' and deleted_at IS NULL.
 */
import { Hono } from 'hono';
import { searchController } from './searchController.js';
const searchRouter = new Hono();
// Text + filter search
searchRouter.get('/', (c) => searchController.search(c));
// Radius search
searchRouter.get('/nearby', (c) => searchController.searchNearby(c));
// Map bounds search — GET (query params) and POST (JSON body)
searchRouter.get('/map', (c) => searchController.searchInBounds(c));
searchRouter.post('/map', (c) => searchController.searchInBounds(c));
export { searchRouter };
