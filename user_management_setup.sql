-- ============================================================================
-- ADMIN USER MANAGEMENT SETUP
-- ============================================================================
-- This script adds the necessary infrastructure for the new Admin User 
-- Management features (Deactivation/Suspension).
-- ============================================================================

-- 1. Add is_active column to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- 2. Add index for faster filtering of active users
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON public.profiles(is_active);

-- 3. (Optional) Audit log for deactivation
COMMENT ON COLUMN public.profiles.is_active IS 'Flag to enable/disable user account access.';
