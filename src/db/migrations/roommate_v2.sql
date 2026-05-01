-- =====================================================================
-- Roommate Finder v2.0 — Database Migration
-- Apply once to Supabase. All statements are idempotent (IF NOT EXISTS).
-- =====================================================================

-- ── Extend roommate_profiles ──────────────────────────────────────────
ALTER TABLE roommate_profiles
  ADD COLUMN IF NOT EXISTS profile_type         TEXT NOT NULL DEFAULT 'seeker'
                                                CHECK (profile_type IN ('host','seeker')),

  -- Host-only fields
  ADD COLUMN IF NOT EXISTS room_type            TEXT    CHECK (room_type IN ('private_room','shared_room','entire_place')),
  ADD COLUMN IF NOT EXISTS bathrooms            TEXT    CHECK (bathrooms IN ('private','shared')),
  ADD COLUMN IF NOT EXISTS furnishing           TEXT    CHECK (furnishing IN ('furnished','semi_furnished','unfurnished')),
  ADD COLUMN IF NOT EXISTS parking              BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wifi                 BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS available_from       DATE,
  ADD COLUMN IF NOT EXISTS rent_amount          INTEGER,
  ADD COLUMN IF NOT EXISTS bills_included       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS current_tenants      INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS housemate_gender     TEXT    DEFAULT 'any',
  ADD COLUMN IF NOT EXISTS housemate_age_min    INTEGER DEFAULT 18,
  ADD COLUMN IF NOT EXISTS housemate_age_max    INTEGER DEFAULT 99,
  ADD COLUMN IF NOT EXISTS house_rules          TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS property_address     TEXT,

  -- Seeker-only fields
  ADD COLUMN IF NOT EXISTS preferred_move_in    DATE,
  ADD COLUMN IF NOT EXISTS max_housemates       INTEGER DEFAULT 4,
  ADD COLUMN IF NOT EXISTS room_type_pref       TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS work_schedule        TEXT    CHECK (work_schedule IN ('day_shift','night_shift','remote','flexible','student')),

  -- Common new fields
  ADD COLUMN IF NOT EXISTS whatsapp_number      TEXT,
  ADD COLUMN IF NOT EXISTS deal_breakers        TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_active_at       TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS connections_this_week INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS week_reset_at        TIMESTAMPTZ DEFAULT NOW();

-- ── Create roommate_matches (directional, computed) ───────────────────
CREATE TABLE IF NOT EXISTS roommate_matches (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  host_profile_id     UUID        NOT NULL REFERENCES roommate_profiles(id) ON DELETE CASCADE,
  seeker_profile_id   UUID        NOT NULL REFERENCES roommate_profiles(id) ON DELETE CASCADE,
  lifestyle_score     FLOAT       NOT NULL DEFAULT 0,
  soft_score          FLOAT       NOT NULL DEFAULT 0,
  total_score         FLOAT       GENERATED ALWAYS AS (lifestyle_score * 0.7 + soft_score * 0.3) STORED,
  passes_hard_filters BOOLEAN     DEFAULT TRUE,
  passes_house_rules  BOOLEAN     DEFAULT TRUE,
  computed_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(host_profile_id, seeker_profile_id)
);

-- ── Extend roommate_connections ───────────────────────────────────────
ALTER TABLE roommate_connections
  ADD COLUMN IF NOT EXISTS initiated_by_role TEXT    CHECK (initiated_by_role IN ('host','seeker')),
  ADD COLUMN IF NOT EXISTS host_profile_id   UUID    REFERENCES roommate_profiles(id),
  ADD COLUMN IF NOT EXISTS seeker_profile_id UUID    REFERENCES roommate_profiles(id),
  ADD COLUMN IF NOT EXISTS host_accepted     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS seeker_accepted   BOOLEAN DEFAULT FALSE;

-- ── Indexes ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_roommate_profiles_type     ON roommate_profiles(profile_type);
CREATE INDEX IF NOT EXISTS idx_roommate_profiles_active   ON roommate_profiles(is_active, profile_type);
CREATE INDEX IF NOT EXISTS idx_roommate_matches_host      ON roommate_matches(host_profile_id);
CREATE INDEX IF NOT EXISTS idx_roommate_matches_seeker    ON roommate_matches(seeker_profile_id);
CREATE INDEX IF NOT EXISTS idx_roommate_connections_host  ON roommate_connections(host_profile_id);
CREATE INDEX IF NOT EXISTS idx_roommate_connections_seeker ON roommate_connections(seeker_profile_id);
