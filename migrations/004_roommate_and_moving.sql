-- =============================================================================
-- Migration 004: Roommate Finder + Moving Services
-- Run against your existing GetKeja PostgreSQL database.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ROOMMATE PROFILES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roommate_profiles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,   -- NULL = anonymous post
    display_name    VARCHAR(100) NOT NULL,
    age             SMALLINT NOT NULL CHECK (age >= 18 AND age <= 99),
    gender          VARCHAR(10) NOT NULL CHECK (gender IN ('male','female','any')),
    occupation      VARCHAR(150),
    budget_min      DECIMAL(10,2) NOT NULL,
    budget_max      DECIMAL(10,2) NOT NULL,
    move_in_date    DATE NOT NULL,
    area            VARCHAR(100) NOT NULL,
    county          VARCHAR(60)  NOT NULL,
    property_id     UUID REFERENCES properties(id) ON DELETE SET NULL,
    bio             TEXT NOT NULL,
    lifestyle       TEXT[] NOT NULL DEFAULT '{}',
    photo_url       TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    connected_count INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_budget CHECK (budget_max >= budget_min)
);

CREATE INDEX IF NOT EXISTS idx_roommate_profiles_active   ON roommate_profiles (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_roommate_profiles_county   ON roommate_profiles (county);
CREATE INDEX IF NOT EXISTS idx_roommate_profiles_budget   ON roommate_profiles (budget_min, budget_max);
CREATE INDEX IF NOT EXISTS idx_roommate_profiles_user     ON roommate_profiles (user_id) WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. ROOMMATE CONNECTIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roommate_connections (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id   UUID NOT NULL REFERENCES roommate_profiles(id) ON DELETE CASCADE,
    status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','connected','rejected')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (requester_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_roommate_connections_requester ON roommate_connections (requester_id);
CREATE INDEX IF NOT EXISTS idx_roommate_connections_profile   ON roommate_connections (profile_id);

-- Helper function to safely increment connected_count
CREATE OR REPLACE FUNCTION increment_roommate_connected_count(profile_id UUID)
RETURNS VOID LANGUAGE sql AS $$
    UPDATE roommate_profiles
    SET    connected_count = connected_count + 1,
           updated_at      = NOW()
    WHERE  id = profile_id;
$$;

-- ---------------------------------------------------------------------------
-- 3. MOVING COMPANIES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS moving_companies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(200) NOT NULL,
    logo_initials   VARCHAR(5)   NOT NULL,
    logo_color      VARCHAR(7)   NOT NULL DEFAULT '#DD6E42',
    rating          DECIMAL(3,2) NOT NULL DEFAULT 0.00
                        CHECK (rating >= 0 AND rating <= 5),
    review_count    INTEGER      NOT NULL DEFAULT 0,
    coverage_areas  TEXT[]       NOT NULL DEFAULT '{}',
    services        TEXT[]       NOT NULL DEFAULT '{}',
    price_range     VARCHAR(10)  NOT NULL CHECK (price_range IN ('budget','mid','premium')),
    phone           VARCHAR(20)  NOT NULL,
    whatsapp        VARCHAR(20)  NOT NULL,
    email           VARCHAR(200),
    verified        BOOLEAN      NOT NULL DEFAULT FALSE,
    tagline         VARCHAR(300),
    years_active    SMALLINT     NOT NULL DEFAULT 0,
    total_moves     INTEGER      NOT NULL DEFAULT 0,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moving_companies_active ON moving_companies (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_moving_companies_rating ON moving_companies (rating DESC);

-- ---------------------------------------------------------------------------
-- 4. MOVING QUOTE REQUESTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS moving_quote_requests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id      UUID         NOT NULL REFERENCES moving_companies(id) ON DELETE CASCADE,
    user_id         UUID         REFERENCES users(id) ON DELETE SET NULL,
    from_location   VARCHAR(200) NOT NULL,
    to_location     VARCHAR(200) NOT NULL,
    move_date       DATE         NOT NULL,
    furniture_count INTEGER,
    box_count       INTEGER,
    special_items   TEXT,
    contact_name    VARCHAR(150) NOT NULL,
    contact_phone   VARCHAR(20)  NOT NULL,
    estimated_kes   DECIMAL(12,2),
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','contacted','confirmed','cancelled')),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moving_quotes_company ON moving_quote_requests (company_id);
CREATE INDEX IF NOT EXISTS idx_moving_quotes_user    ON moving_quote_requests (user_id) WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. MOVING COMPANY REGISTRATIONS (CTA form)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS moving_company_registrations (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(200) NOT NULL,
    contact_name VARCHAR(150) NOT NULL,
    phone        VARCHAR(20)  NOT NULL,
    email        VARCHAR(200) NOT NULL,
    areas        TEXT,
    status       VARCHAR(20)  NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected')),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 6. SEED — Moving Companies (mirrors the previous mock data)
-- ---------------------------------------------------------------------------
INSERT INTO moving_companies
    (name, logo_initials, logo_color, rating, review_count, coverage_areas,
     services, price_range, phone, whatsapp, email, verified, tagline, years_active, total_moves)
VALUES
    ('SwiftMove Kenya',    'SM', '#DD6E42', 4.80, 312,
     ARRAY['Nairobi','Kiambu','Machakos'],
     ARRAY['packing','transport','heavy_lifting','assembly'],
     'mid', '+254712000001', '+254712000001', 'info@swiftmove.co.ke',
     TRUE, 'Professional movers with over 10 years of experience.', 10, 4800),

    ('EasyReloc',          'ER', '#C0D6DF', 4.60, 187,
     ARRAY['Nairobi','Thika','Ruiru'],
     ARRAY['transport','packing','storage'],
     'budget', '+254712000002', '+254712000002', 'hello@easyreloc.co.ke',
     TRUE, 'Affordable, reliable relocation for everyone.', 5, 2100),

    ('PrimeMoves Ltd',     'PM', '#DD6E42', 4.90, 511,
     ARRAY['All Nairobi Counties','Nakuru','Kisumu','Mombasa'],
     ARRAY['packing','transport','heavy_lifting','assembly','storage','cleaning'],
     'premium', '+254712000003', '+254712000003', 'ops@primemoves.co.ke',
     TRUE, 'White-glove moving service for discerning clients.', 14, 9200),

    ('NBO Movers',         'NM', '#DD6E42', 4.40, 98,
     ARRAY['Nairobi CBD','Westlands','Kilimani','Lavington'],
     ARRAY['transport','heavy_lifting'],
     'budget', '+254712000004', '+254712000004', 'nbomovers@gmail.com',
     FALSE, 'Quick same-day moves around Nairobi.', 3, 650),

    ('Karibu Relocations', 'KR', '#50757A', 4.70, 229,
     ARRAY['Nairobi','Kiambu','Kajiado','Muranga'],
     ARRAY['packing','transport','assembly','cleaning'],
     'mid', '+254712000005', '+254712000005', 'move@karibureloc.co.ke',
     TRUE, 'Family-owned, community-trusted since 2015.', 9, 3300)

ON CONFLICT DO NOTHING;
