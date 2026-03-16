-- Nearby Places System Updates

-- 1. Ensure PostGIS is enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Ensure landmark_type enum exists
DO $$ BEGIN
    CREATE TYPE landmark_type AS ENUM ('university','hospital','school','market','bus_stop','road','shopping_center');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Ensure landmarks table exists with GEOGRAPHY for accurate earth-surface distance
CREATE TABLE IF NOT EXISTS public.landmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type landmark_type NOT NULL,
    location GEOGRAPHY(Point, 4326) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_landmark_location ON landmarks USING GIST(location);

-- 4. Ensure property_landmark_distances table exists
CREATE TABLE IF NOT EXISTS public.property_landmark_distances (
    property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
    landmark_id UUID REFERENCES landmarks(id) ON DELETE CASCADE,
    distance_meters NUMERIC,
    PRIMARY KEY(property_id, landmark_id)
);

-- 5. Helper function to calculate distance using PostGIS and return in meters
CREATE OR REPLACE FUNCTION calculate_property_landmark_distance(
    prop_id UUID,
    land_id UUID
)
RETURNS NUMERIC AS $$
DECLARE
    prop_loc GEOGRAPHY;
    land_loc GEOGRAPHY;
    dist NUMERIC;
BEGIN
    SELECT location INTO prop_loc FROM property_locations WHERE property_id = prop_id;
    SELECT location INTO land_loc FROM landmarks WHERE id = land_id;
    
    IF prop_loc IS NULL OR land_loc IS NULL THEN
        RETURN NULL;
    END IF;

    dist := ST_Distance(prop_loc, land_loc);
    RETURN dist;
END;
$$ LANGUAGE plpgsql;
