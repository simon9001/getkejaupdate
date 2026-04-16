-- =============================================================================
-- GETKEJA — Property Statuses (Stories) Migration
-- Run in Supabase Dashboard → SQL Editor
-- =============================================================================

-- Who can post: landlords, agents, developers, caretakers, staff, super_admin
CREATE TABLE IF NOT EXISTS property_statuses (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    property_id      UUID REFERENCES properties (id) ON DELETE SET NULL,  -- optional link

    -- Media: array of { url, cloudinary_public_id, resource_type, thumbnail_url }
    media            JSONB NOT NULL DEFAULT '[]',

    caption          TEXT,
    views            INTEGER NOT NULL DEFAULT 0,

    -- Boost
    is_boosted         BOOLEAN NOT NULL DEFAULT FALSE,
    boost_expires_at   TIMESTAMPTZ,
    boost_amount_kes   DECIMAL(8,2),

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Auto-expiry: set to exactly 24 hours from insert time
    expires_at       TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX idx_statuses_owner      ON property_statuses (owner_user_id);
CREATE INDEX idx_statuses_expires    ON property_statuses (expires_at);
CREATE INDEX idx_statuses_boosted    ON property_statuses (is_boosted, boost_expires_at)
    WHERE is_boosted = TRUE;
CREATE INDEX idx_statuses_property   ON property_statuses (property_id)
    WHERE property_id IS NOT NULL;

-- View reads: increment atomically
CREATE OR REPLACE FUNCTION increment_status_views(p_status_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    UPDATE property_statuses SET views = views + 1 WHERE id = p_status_id;
END;
$$;

-- Cleanup function (called by cron or endpoint): deletes expired statuses AND their Cloudinary assets
-- NOTE: Cloudinary deletion is handled at the application layer (statuses.router.ts).
-- This function only removes DB rows; the router fetches them first, deletes Cloudinary, then calls here.
CREATE OR REPLACE FUNCTION delete_expired_statuses()
RETURNS TABLE (deleted_id UUID, media_payload JSONB) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    DELETE FROM property_statuses
    WHERE expires_at < NOW()
    RETURNING id, media;
END;
$$;
-- Schedule via pg_cron:
-- SELECT cron.schedule('0 * * * *', $$SELECT delete_expired_statuses()$$);
