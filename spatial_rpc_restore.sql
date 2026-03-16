-- Enable PostGIS if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Function: get_properties_within_radius
-- Matches the signature expected by spatial.service.ts
-- Search properties within a given radius using lat/lon
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

-- 2. Function: get_nearest_landmarks
-- px = longitude, py = latitude
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

-- 3. Function: get_nearest_road
-- px = longitude, py = latitude
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
    -- Check if roads table exists before querying
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
        -- Return empty result if table missing
        RETURN;
    END IF;
END;
$$;



----