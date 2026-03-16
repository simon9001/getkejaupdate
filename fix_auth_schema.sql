-- ============================================================================
-- AUTHENTICATION SCHEMA FIX
-- ============================================================================
-- INSTRUCTIONS:
-- 1. Go to your Supabase Project Dashboard.
-- 2. Open the "SQL Editor" from the left sidebar.
-- 3. Create a "New Query".
-- 4. Paste this entire script and click "Run".
-- ============================================================================

-- 1. Password Resets Table (Fixes 500 error on forgot-password)
DROP TABLE IF EXISTS public.password_resets CASCADE;
CREATE TABLE public.password_resets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id)
);
CREATE INDEX idx_password_resets_user_id ON public.password_resets(user_id);
CREATE INDEX idx_password_resets_token ON public.password_resets(token);

-- 2. Security Logs (Used for auditing auth events)
DROP TABLE IF EXISTS public.security_logs CASCADE;
CREATE TABLE public.security_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    event TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_security_logs_user_id ON public.security_logs(user_id);
CREATE INDEX idx_security_logs_event ON public.security_logs(event);

-- 3. Token Blacklist (Used for secure logout)
DROP TABLE IF EXISTS public.token_blacklist CASCADE;
CREATE TABLE public.token_blacklist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    blacklisted_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_token_blacklist_token ON public.token_blacklist(token);

-- 4. Audit Table for Cleanup Service (Used by CleanupService)
CREATE TABLE IF NOT EXISTS public.cleanup_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation TEXT NOT NULL,
    deleted_count INTEGER,
    failed_count INTEGER,
    total_found INTEGER,
    deleted_ids UUID[],
    failed_ids UUID[],
    executed_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Helper RPC to refresh schema cache (Ensures API recognizes new tables instantly)
-- Usage: SELECT pgrst_watch();
-- (Note: Only works if you have permission to run NOTIFY)
-- NOTIFY pgrst, 'reload schema';
