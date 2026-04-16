/**
 * searchService.ts
 *
 * Search layer that wraps Supabase PostgREST queries.
 * Three modes:
 *   search()       — text + filter search, ordered by listing_search_scores.total_score
 *   searchNearby() — same filters + Haversine radius post-filter, ordered by distance
 *   searchInBounds()— same filters + lat/lng bounding-box post-filter (map view)
 *
 * Radius and bounds filtering is done in JS after fetching a larger candidate set
 * because Supabase PostgREST doesn't expose PostGIS ST_DWithin without an RPC.
 * The candidate cap (MAX_CANDIDATES) keeps memory usage bounded.
 */
import { supabaseAdmin } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';
// ── Haversine (self-contained — keeps this module independent) ──────────────
const EARTH_R_M = 6_371_000;
const toRad = (d) => (d * Math.PI) / 180;
function haversineM(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R_M * Math.asin(Math.sqrt(a));
}
const MAX_CANDIDATES = 300; // ceiling for pre-filter fetch to avoid memory bloat
// ── Shared SELECT for list views ─────────────────────────────────────────────
const LIST_SELECT = `
  id, listing_category, listing_type, title, status,
  bedrooms, bathrooms, is_furnished, is_featured, floor_area_sqm, created_at,
  property_locations ( county, sub_county, area, estate_name, latitude, longitude ),
  property_pricing   ( asking_price, monthly_rent, currency, negotiable ),
  property_media     ( url, thumbnail_url, is_cover, sort_order, media_type ),
  listing_search_scores ( total_score ),
  short_term_config  ( price_per_night, short_term_type, min_nights, max_guests, instant_book ),
  commercial_config  ( commercial_type, floor_area_sqft )
`;
// ── Helper: extract location coords from a raw Supabase row ──────────────────
function rowCoords(row) {
    const loc = row.property_locations;
    const l = Array.isArray(loc) ? loc[0] : loc;
    if (!l?.latitude || !l?.longitude)
        return null;
    return { lat: Number(l.latitude), lng: Number(l.longitude) };
}
// ── SearchService ─────────────────────────────────────────────────────────────
export class SearchService {
    // ── Core filter query (reused by all three search modes) ───────────────────
    async fetchCandidates(params, fetchLimit) {
        const { q, listing_category, listing_type, county, area, min_price, max_price, bedrooms, is_furnished, is_featured, construction_status, page = 1, limit = 20, } = params;
        const from = (page - 1) * limit;
        let query = supabaseAdmin
            .from('properties')
            .select(LIST_SELECT, { count: 'exact' })
            .is('deleted_at', null)
            .eq('status', 'available');
        // Text search — title + description via ilike (PostgREST safe, no FTS config required)
        if (q?.trim()) {
            const term = q.trim();
            query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
        }
        if (listing_category)
            query = query.eq('listing_category', listing_category);
        if (listing_type)
            query = query.eq('listing_type', listing_type);
        if (construction_status)
            query = query.eq('construction_status', construction_status);
        if (bedrooms !== undefined)
            query = query.eq('bedrooms', bedrooms);
        if (is_furnished)
            query = query.eq('is_furnished', is_furnished);
        if (is_featured !== undefined)
            query = query.eq('is_featured', is_featured);
        // Location text filters (on joined table — PostgREST supports .ilike on embedded cols)
        if (county)
            query = query.ilike('property_locations.county', `%${county}%`);
        if (area)
            query = query.ilike('property_locations.area', `%${area}%`);
        // Price filters — we OR across both price columns since different categories
        // use different fields (monthly_rent vs asking_price)
        if (min_price !== undefined) {
            query = query
                .gte('property_pricing.monthly_rent', min_price)
                .gte('property_pricing.asking_price', min_price);
        }
        if (max_price !== undefined) {
            query = query
                .lte('property_pricing.monthly_rent', max_price)
                .lte('property_pricing.asking_price', max_price);
        }
        return query
            .order('total_score', { referencedTable: 'listing_search_scores', ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false })
            .range(from, from + fetchLimit - 1);
    }
    // ── 1. Text + filter search ────────────────────────────────────────────────
    async search(params) {
        const { page = 1, limit = 20 } = params;
        const from = (page - 1) * limit;
        const { data, count, error } = await this.fetchCandidates(params, limit);
        if (error) {
            logger.error({ error, params }, 'search.text.failed');
            throw new Error(`Search failed: ${error.message}`);
        }
        return {
            properties: data ?? [],
            total: count ?? 0,
            page,
            limit,
            pages: Math.ceil((count ?? 0) / limit),
        };
    }
    // ── 2. Radius search ───────────────────────────────────────────────────────
    async searchNearby(params) {
        const { lat, lng, radius_km = 5, page = 1, limit = 20, ...filters } = params;
        const radiusM = radius_km * 1_000;
        // Fetch a large candidate set ordered by score, then post-filter by distance
        const { data, error } = await this.fetchCandidates({ ...filters, page: 1, limit: MAX_CANDIDATES }, MAX_CANDIDATES);
        if (error) {
            logger.error({ error, params }, 'search.nearby.failed');
            throw new Error(`Nearby search failed: ${error.message}`);
        }
        // Compute distances and filter
        const withDist = (data ?? [])
            .map((row) => {
            const coords = rowCoords(row);
            if (!coords)
                return null;
            const distanceM = Math.round(haversineM(lat, lng, coords.lat, coords.lng));
            return { ...row, distance_m: distanceM };
        })
            .filter((r) => r !== null && r.distance_m <= radiusM)
            .sort((a, b) => a.distance_m - b.distance_m);
        const start = (page - 1) * limit;
        return {
            properties: withDist.slice(start, start + limit),
            total: withDist.length,
            page,
            limit,
            pages: Math.ceil(withDist.length / limit),
        };
    }
    // ── 3. Bounding-box search (map view) ─────────────────────────────────────
    async searchInBounds(params) {
        const { north, south, east, west, page = 1, limit = 50, ...filters } = params;
        const { data, error } = await this.fetchCandidates({ ...filters, page: 1, limit: MAX_CANDIDATES }, MAX_CANDIDATES);
        if (error) {
            logger.error({ error, params }, 'search.bounds.failed');
            throw new Error(`Bounds search failed: ${error.message}`);
        }
        const inBounds = (data ?? []).filter((row) => {
            const coords = rowCoords(row);
            if (!coords)
                return false;
            return coords.lat >= south && coords.lat <= north &&
                coords.lng >= west && coords.lng <= east;
        });
        const start = (page - 1) * limit;
        return {
            properties: inBounds.slice(start, start + limit),
            total: inBounds.length,
            page,
            limit,
            pages: Math.ceil(inBounds.length / limit),
        };
    }
}
export const searchService = new SearchService();
