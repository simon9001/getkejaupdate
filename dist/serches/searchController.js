/**
 * searchController.ts
 *
 * Hono controller for the /api/search routes.
 * Parses query-string / body params, delegates to searchService, returns JSON.
 */
import { searchService } from './searchService.js';
import { logger } from '../utils/logger.js';
function fail(c, err, code) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ code, message: msg }, 'search.controller.error');
    return c.json({ message: msg || 'Search failed', code }, 500);
}
// Parse a query-string value as a positive number, return undefined if absent/invalid
function numQ(v) {
    if (!v)
        return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}
export class SearchController {
    /**
     * GET /api/search
     *   ?q=&listing_category=&listing_type=&county=&area=
     *   &min_price=&max_price=&bedrooms=&is_furnished=
     *   &is_featured=&construction_status=&page=&limit=
     */
    async search(c) {
        try {
            const q = c.req.query();
            const result = await searchService.search({
                q: q.q,
                listing_category: q.listing_category,
                listing_type: q.listing_type,
                county: q.county,
                area: q.area,
                min_price: numQ(q.min_price),
                max_price: numQ(q.max_price),
                bedrooms: numQ(q.bedrooms),
                is_furnished: q.is_furnished,
                is_featured: q.is_featured === 'true' ? true : q.is_featured === 'false' ? false : undefined,
                construction_status: q.construction_status,
                page: numQ(q.page) ?? 1,
                limit: Math.min(100, numQ(q.limit) ?? 20),
            });
            return c.json({ ...result, code: 'SEARCH_OK' });
        }
        catch (err) {
            return fail(c, err, 'SEARCH_FAILED');
        }
    }
    /**
     * GET /api/search/nearby
     *   ?lat=&lng=&radius_km=  + all search filters above
     */
    async searchNearby(c) {
        try {
            const q = c.req.query();
            const lat = numQ(q.lat);
            const lng = numQ(q.lng);
            if (lat === undefined || lng === undefined) {
                return c.json({ message: '`lat` and `lng` query params are required', code: 'MISSING_COORDS' }, 400);
            }
            const result = await searchService.searchNearby({
                lat,
                lng,
                radius_km: numQ(q.radius_km) ?? 5,
                q: q.q,
                listing_category: q.listing_category,
                listing_type: q.listing_type,
                county: q.county,
                area: q.area,
                min_price: numQ(q.min_price),
                max_price: numQ(q.max_price),
                bedrooms: numQ(q.bedrooms),
                is_furnished: q.is_furnished,
                construction_status: q.construction_status,
                page: numQ(q.page) ?? 1,
                limit: Math.min(100, numQ(q.limit) ?? 20),
            });
            return c.json({ ...result, code: 'NEARBY_OK' });
        }
        catch (err) {
            return fail(c, err, 'NEARBY_FAILED');
        }
    }
    /**
     * GET /api/search/map?north=&south=&east=&west=  (+ optional filters)
     * POST /api/search/map  { north, south, east, west, ...filters }
     *
     * Accepts both GET (query params) and POST (JSON body) so map UIs that prefer
     * POST with a complex payload also work.
     */
    async searchInBounds(c) {
        try {
            // Merge query params and body (body takes precedence)
            const qs = c.req.query();
            let body = {};
            if (c.req.method === 'POST') {
                body = await c.req.json().catch(() => ({}));
            }
            const merged = { ...qs, ...body };
            const north = numQ(String(merged.north ?? ''));
            const south = numQ(String(merged.south ?? ''));
            const east = numQ(String(merged.east ?? ''));
            const west = numQ(String(merged.west ?? ''));
            if (north === undefined || south === undefined || east === undefined || west === undefined) {
                return c.json({ message: '`north`, `south`, `east`, `west` are required', code: 'MISSING_BOUNDS' }, 400);
            }
            const result = await searchService.searchInBounds({
                north, south, east, west,
                q: merged.q,
                listing_category: merged.listing_category,
                listing_type: merged.listing_type,
                county: merged.county,
                area: merged.area,
                min_price: merged.min_price ? Number(merged.min_price) : undefined,
                max_price: merged.max_price ? Number(merged.max_price) : undefined,
                bedrooms: merged.bedrooms ? Number(merged.bedrooms) : undefined,
                is_furnished: merged.is_furnished,
                page: merged.page ? Number(merged.page) : 1,
                limit: merged.limit ? Math.min(200, Number(merged.limit)) : 50,
            });
            return c.json({ ...result, code: 'BOUNDS_OK' });
        }
        catch (err) {
            return fail(c, err, 'BOUNDS_FAILED');
        }
    }
}
export const searchController = new SearchController();
