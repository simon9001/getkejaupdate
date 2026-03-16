-- ============================================================================
-- SPATIAL INFRASTRUCTURE FINAL SETUP
-- ============================================================================
-- Run this script in your Supabase SQL Editor to enable all spatial features.
-- ============================================================================

-- 1. Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

-- 3. Create Property-Landmark Distance Link Table (for cached/manual links)
CREATE TABLE IF NOT EXISTS public.property_landmark_distances (
    property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
    landmark_id UUID REFERENCES public.landmarks(id) ON DELETE CASCADE,
    distance_meters FLOAT,
    PRIMARY KEY (property_id, landmark_id)
);

-- 4. Create Roads Table (Optional for nearest road info)
CREATE TABLE IF NOT EXISTS public.roads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT,
    surface TEXT, -- 'Asphalt', 'Gravel', 'Dirt'
    location GEOMETRY(LineString, 4326),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roads_location ON public.roads USING GIST (location);

-- 5. RPC Functions

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
        AND (max_price IS NULL OR p.price <= max_price)
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
RETURNS TABLE (
    id uuid,
    name text,
    type text,
    distance_meters double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
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
    LIMIT lim;
END;
$$;

-- c) Get nearest road
CREATE OR REPLACE FUNCTION get_nearest_road(
    px double precision,
    py double precision
)
RETURNS TABLE (
    id uuid,
    name text,
    surface text,
    distance_meters double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'roads') THEN
        RETURN QUERY EXECUTE '
            SELECT 
                r.id,
                r.name,
                r.surface,
                ST_Distance(
                    r.location::geography,
                    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                ) as distance_meters
            FROM roads r
            ORDER BY distance_meters ASC
            LIMIT 1'
        USING px, py;
    ELSE
        RETURN;
    END IF;
END;
$$;

-- d) Calculate property to landmark distance (Helper for link function)
CREATE OR REPLACE FUNCTION calculate_property_landmark_distance(
    prop_id UUID,
    land_id UUID
)
RETURNS FLOAT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    dist FLOAT;
BEGIN
    SELECT ST_Distance(
        pl.location::geography,
        l.location::geography
    ) INTO dist
    FROM property_locations pl, landmarks l
    WHERE pl.property_id = prop_id AND l.id = land_id;
    
    RETURN dist;
END;
$$;

-- 6. Seed Sample Landmarks (Nairobi Area)
INSERT INTO public.landmarks (name, type, location)
VALUES 
    ('Westgate Mall', 'Mall', ST_SetSRID(ST_MakePoint(36.8041, -1.2581), 4326)),
    ('Aga Khan University Hospital', 'Hospital', ST_SetSRID(ST_MakePoint(36.8219, -1.2598), 4326)),
    ('University of Nairobi', 'University', ST_SetSRID(ST_MakePoint(36.8167, -1.2800), 4326)),
    ('Nairobi Hospital', 'Hospital', ST_SetSRID(ST_MakePoint(36.8067, -1.2950), 4326)),
    ('Embu University', 'University', ST_SetSRID(ST_MakePoint(37.4586, -0.5303), 4326)),
    ('Embu Level 5 Hospital', 'Hospital', ST_SetSRID(ST_MakePoint(37.4510, -0.5320), 4326))
ON CONFLICT DO NOTHING;
