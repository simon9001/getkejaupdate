-- ============================================================================
-- SPATIAL INFRASTRUCTURE FIX
-- ============================================================================
-- This script prepares the database for proximity intelligence features.
-- ============================================================================

-- 1. Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Create Landmarks Table
CREATE TABLE IF NOT EXISTS public.landmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'School', 'Hospital', 'Mall', 'Park', etc.
    location GEOMETRY(Point, 4326),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for spatial queries
CREATE INDEX IF NOT EXISTS idx_landmarks_location ON public.landmarks USING GIST (location);

-- 3. Create Roads Table (Optional for nearest road info)
CREATE TABLE IF NOT EXISTS public.roads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT,
    surface TEXT, -- 'Asphalt', 'Gravel', 'Dirt'
    location GEOMETRY(LineString, 4326),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roads_location ON public.roads USING GIST (location);

-- 4. Restore Spatial RPC functions

-- a) Find properties within radius
CREATE OR REPLACE FUNCTION get_properties_within_radius(
    lat double precision,
    lon double precision,
    radius_m double precision,
    max_price double precision DEFAULT NULL,
    min_beds integer DEFAULT NULL,
    search_query text DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_agg(p_data)
    INTO result
    FROM (
        SELECT 
            p.*,
            pl.address,
            pl.town,
            pl.county,
            ST_Distance(
                pl.location::geography,
                ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
            ) as distance_meters
        FROM properties p
        JOIN property_locations pl ON p.id = pl.property_id
        WHERE ST_DWithin(
            pl.location::geography,
            ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography,
            radius_m
        )
        AND (max_price IS NULL OR p.price_per_month <= max_price)
        AND (min_beds IS NULL OR p.bedrooms >= min_beds)
        AND (search_query IS NULL OR (
            p.title ILIKE '%' || search_query || '%' OR 
            p.description ILIKE '%' || search_query || '%' OR
            pl.address ILIKE '%' || search_query || '%' OR
            pl.town ILIKE '%' || search_query || '%'
        ))
        AND p.status = 'active'
        ORDER BY distance_meters ASC
    ) p_data;

    RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- b) Get nearest landmarks
CREATE OR REPLACE FUNCTION get_nearest_landmarks(
    px double precision,
    py double precision,
    lim integer DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    -- Check if table exists
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'landmarks') THEN
        SELECT jsonb_agg(l_data)
        INTO result
        FROM (
            SELECT 
                l.id,
                l.name,
                l.type,
                ST_Distance(
                    l.location::geography,
                    ST_SetSRID(ST_MakePoint(px, py), 4326)::geography
                ) as distance_meters
            FROM landmarks l
            ORDER BY distance_meters ASC
            LIMIT lim
        ) l_data;
    END IF;
    
    RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- c) Get nearest road
CREATE OR REPLACE FUNCTION get_nearest_road(
    px double precision,
    py double precision
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'roads') THEN
        SELECT jsonb_agg(r_data)
        INTO result
        FROM (
            SELECT 
                r.id,
                r.name,
                r.surface,
                ST_Distance(
                    r.location::geography,
                    ST_SetSRID(ST_MakePoint(px, py), 4326)::geography
                ) as distance_meters
            FROM roads r
            ORDER BY distance_meters ASC
            LIMIT 1
        ) r_data;
    END IF;
    
    RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- d) geometry_within (Used as a helper)
CREATE OR REPLACE FUNCTION geometry_within(
    lat double precision,
    lon double precision,
    radius_m double precision
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_agg(p_data)
    INTO result
    FROM (
        SELECT 
            p.*,
            ST_Distance(
                pl.location::geography,
                ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
            ) as distance_meters
        FROM properties p
        JOIN property_locations pl ON p.id = pl.property_id
        WHERE ST_DWithin(
            pl.location::geography,
            ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography,
            radius_m
        )
        ORDER BY distance_meters ASC
    ) p_data;

    RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- 5. Seed sample landmark data (Nairobi area example)
-- Adjust coordinates if needed, or add more variety
    ('Westgate Mall', 'shopping_center', ST_SetSRID(ST_MakePoint(36.8041, -1.2581), 4326)::geography),
    ('Aga Khan Hospital', 'hospital', ST_SetSRID(ST_MakePoint(36.8219, -1.2598), 4326)::geography),
    ('University of Nairobi', 'university', ST_SetSRID(ST_MakePoint(36.8167, -1.2800), 4326)::geography),
    ('Karura Forest', 'market', ST_SetSRID(ST_MakePoint(36.8250, -1.2333), 4326)::geography),
    ('Nairobi Hospital', 'hospital', ST_SetSRID(ST_MakePoint(36.8067, -1.2950), 4326)::geography)
ON CONFLICT DO NOTHING;
