/**
 * publicProfiles.router.ts
 *
 * No authentication required — public-facing profiles for agents and developers.
 *
 * GET /api/agents/:agentId        → agent profile + their active listings
 * GET /api/developers/:devId      → developer profile + their active listings
 */

import { Hono } from 'hono';
import { supabaseAdmin } from '../utils/supabase.js';

const agentsPublicRouter    = new Hono();
const developersPublicRouter = new Hono();

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchUserProfile(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('full_name, bio, avatar_url, phone, county, created_at')
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;
  return data;
}

async function fetchUserListings(userId: string, page = 1, limit = 12) {
  const { data, error, count } = await supabaseAdmin
    .from('properties')
    .select(`
      id, title, listing_category, listing_type, status, created_at,
      property_locations ( area, county ),
      property_pricing ( monthly_rent, asking_price, price_per_night, currency ),
      property_media ( url, is_cover )
    `, { count: 'exact' })
    .eq('created_by', userId)
    .eq('status', 'available')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  return { listings: data ?? [], total: count ?? 0, pages: Math.ceil((count ?? 0) / limit) };
}

async function fetchSimilarProperties(excludeUserId: string, category?: string, limit = 6) {
  let query = supabaseAdmin
    .from('properties')
    .select(`
      id, title, listing_category, listing_type,
      property_locations ( area, county ),
      property_pricing ( monthly_rent, asking_price, price_per_night, currency ),
      property_media ( url, is_cover )
    `)
    .eq('status', 'available')
    .is('deleted_at', null)
    .neq('created_by', excludeUserId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (category) query = query.eq('listing_category', category);

  const { data } = await query;
  return data ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agents/:agentId
// ─────────────────────────────────────────────────────────────────────────────

agentsPublicRouter.get('/:agentId', async (c) => {
  const { agentId } = c.req.param();
  const page  = Number(c.req.query('page')  ?? 1);
  const limit = Number(c.req.query('limit') ?? 12);

  // Verify user exists and has agent role
  const { data: user, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, email, account_status, user_roles(role_name:roles(name))')
    .eq('id', agentId)
    .eq('account_status', 'active')
    .single();

  if (userErr || !user) {
    return c.json({ message: 'Agent not found', code: 'NOT_FOUND' }, 404);
  }

  const roles: string[] = (user.user_roles as any[])?.map((r: any) => r.role_name?.name ?? '').filter(Boolean) ?? [];
  if (!roles.includes('agent') && !roles.includes('landlord')) {
    return c.json({ message: 'Agent not found', code: 'NOT_FOUND' }, 404);
  }

  const [profile, { listings, total, pages }, stats] = await Promise.all([
    fetchUserProfile(agentId),
    fetchUserListings(agentId, page, limit),
    supabaseAdmin
      .from('properties')
      .select('id, listing_category', { count: 'exact', head: false })
      .eq('created_by', agentId)
      .eq('status', 'available')
      .is('deleted_at', null),
  ]);

  // Most common category for similar property recommendations
  const categories = (stats.data ?? []).map((p: any) => p.listing_category).filter(Boolean);
  const topCategory = categories.sort((a: string, b: string) =>
    categories.filter((c: string) => c === b).length - categories.filter((c: string) => c === a).length
  )[0];

  const recommended = await fetchSimilarProperties(agentId, topCategory, 6);

  return c.json({
    agent: {
      id:         agentId,
      full_name:  profile?.full_name ?? 'Agent',
      bio:        profile?.bio ?? null,
      avatar_url: profile?.avatar_url ?? null,
      phone:      profile?.phone ?? null,
      county:     profile?.county ?? null,
      member_since: profile?.created_at ?? null,
      total_listings: total,
    },
    listings,
    total,
    page,
    pages,
    recommended,
    code: 'AGENT_PROFILE_FETCHED',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/developers/:devId
// ─────────────────────────────────────────────────────────────────────────────

developersPublicRouter.get('/:devId', async (c) => {
  const { devId } = c.req.param();
  const page  = Number(c.req.query('page')  ?? 1);
  const limit = Number(c.req.query('limit') ?? 12);

  const { data: user, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, email, account_status, user_roles(role_name:roles(name))')
    .eq('id', devId)
    .eq('account_status', 'active')
    .single();

  if (userErr || !user) {
    return c.json({ message: 'Developer not found', code: 'NOT_FOUND' }, 404);
  }

  const roles: string[] = (user.user_roles as any[])?.map((r: any) => r.role_name?.name ?? '').filter(Boolean) ?? [];
  if (!roles.includes('developer')) {
    return c.json({ message: 'Developer not found', code: 'NOT_FOUND' }, 404);
  }

  const [profile, { listings, total, pages }] = await Promise.all([
    fetchUserProfile(devId),
    fetchUserListings(devId, page, limit),
  ]);

  const recommended = await fetchSimilarProperties(devId, 'for_sale', 6);

  return c.json({
    developer: {
      id:         devId,
      full_name:  profile?.full_name ?? 'Developer',
      bio:        profile?.bio ?? null,
      avatar_url: profile?.avatar_url ?? null,
      phone:      profile?.phone ?? null,
      county:     profile?.county ?? null,
      member_since: profile?.created_at ?? null,
      total_listings: total,
    },
    listings,
    total,
    page,
    pages,
    recommended,
    code: 'DEVELOPER_PROFILE_FETCHED',
  });
});

export { agentsPublicRouter, developersPublicRouter };
