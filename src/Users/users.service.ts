/**
 * users.service.ts
 *
 * Aligned to the actual PostgreSQL schema:
 *  - users            (id, email, phone_number, account_status, email_verified, …)
 *  - user_profiles    (user_id, full_name, display_name, avatar_url, county, …)
 *  - user_roles       (user_id, role_id, is_active, verified_at)  → roles(id, name)
 *  - landlord_profiles / agent_profiles / caretaker_profiles /
 *    developer_profiles / seeker_profiles
 *
 * Profile types supported:
 *   GET  /users/me                 — own full profile
 *   PUT  /users/me                 — update own base profile (user_profiles)
 *   PUT  /users/me/seeker          — upsert seeker_profiles
 *   PUT  /users/me/landlord        — upsert landlord_profiles
 *   PUT  /users/me/agent           — upsert agent_profiles
 *   PUT  /users/me/caretaker       — upsert caretaker_profiles
 *   PUT  /users/me/developer       — upsert developer_profiles
 *
 * Admin routes:
 *   GET    /users                  — paginated list with search
 *   GET    /users/:id              — single user full profile
 *   PATCH  /users/:id/role         — assign / revoke roles
 *   PATCH  /users/:id/status       — change account_status
 *   DELETE /users/:id              — soft-delete
 */

import { supabaseAdmin } from '../utils/supabase.js';
import type { AccountStatus, UserRole } from '../types/auth.types.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Build the full profile object from joined rows. */
function buildProfile(user: any, profile: any, roles: any[]) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone_number ?? null,
    email_verified: user.email_verified,
    account_status: user.account_status,
    auth_provider: user.auth_provider,
    created_at: user.created_at,
    // user_profiles fields
    full_name: profile?.full_name ?? null,
    display_name: profile?.display_name ?? null,
    avatar_url: profile?.avatar_url ?? null,
    county: profile?.county ?? null,
    whatsapp_number: profile?.whatsapp_number ?? null,
    notification_prefs: profile?.notification_prefs ?? { sms: true, email: true, push: true },
    preferred_language: profile?.preferred_language ?? 'en',
    // roles array (only active, verified roles)
    roles: roles
      .filter((r) => r.is_active)
      .map((r) => r.roles?.name as UserRole)
      .filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// UsersService
// ---------------------------------------------------------------------------
export class UsersService {

  // -------------------------------------------------------------------------
  // SELF — GET own profile (all role-specific sub-profiles included)
  // -------------------------------------------------------------------------
  async getMyProfile(userId: string) {
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id, email, phone_number, email_verified, account_status, auth_provider, created_at')
      .eq('id', userId)
      .is('deleted_at', null)
      .single();

    if (userErr || !user) throw userErr ?? new Error('User not found');

    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('full_name, display_name, avatar_url, county, whatsapp_number, notification_prefs, preferred_language')
      .eq('user_id', userId)
      .maybeSingle();

    const { data: roleRows } = await supabaseAdmin
      .from('user_roles')
      .select('is_active, verified_at, roles(name)')
      .eq('user_id', userId);

    const base = buildProfile(user, profile, roleRows ?? []);

    // Attach any role-specific sub-profiles that exist
    const roleNames = base.roles;

    const extras: Record<string, any> = {};

    if (roleNames.includes('seeker')) {
      const { data } = await supabaseAdmin
        .from('seeker_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (data) extras.seeker_profile = data;
    }
    if (roleNames.includes('landlord')) {
      const { data } = await supabaseAdmin
        .from('landlord_profiles')
        .select('id_type, id_verified, is_company, company_name, kra_pin, total_properties, avg_response_hours, rating')
        .eq('user_id', userId)
        .maybeSingle();
      if (data) extras.landlord_profile = data;
    }
    if (roleNames.includes('agent')) {
      const { data } = await supabaseAdmin
        .from('agent_profiles')
        .select('earb_license_no, license_verified, license_expiry, agency_name, years_experience, specialisations, service_counties, commission_rate_pct, avg_response_hours, rating, total_listings, total_closed_deals')
        .eq('user_id', userId)
        .maybeSingle();
      if (data) extras.agent_profile = data;
    }
    if (roleNames.includes('caretaker')) {
      const { data } = await supabaseAdmin
        .from('caretaker_profiles')
        .select('id_verified, lives_on_compound, work_hours, emergency_contact, rating')
        .eq('user_id', userId)
        .maybeSingle();
      if (data) extras.caretaker_profile = data;
    }
    if (roleNames.includes('developer')) {
      const { data } = await supabaseAdmin
        .from('developer_profiles')
        .select('company_name, company_reg_no, nca_reg_no, nca_verified, years_in_operation, completed_projects, website_url, logo_url, rating')
        .eq('user_id', userId)
        .maybeSingle();
      if (data) extras.developer_profile = data;
    }

    return { ...base, ...extras };
  }

  // -------------------------------------------------------------------------
  // SELF — UPDATE base profile (user_profiles row)
  // -------------------------------------------------------------------------
  async updateMyProfile(
    userId: string,
    body: {
      full_name?: string;
      display_name?: string;
      avatar_url?: string;
      county?: string;
      whatsapp_number?: string;
      preferred_language?: string;
      notification_prefs?: { sms?: boolean; email?: boolean; push?: boolean };
    },
  ) {
    const allowed = [
      'full_name', 'display_name', 'avatar_url',
      'county', 'whatsapp_number', 'preferred_language', 'notification_prefs',
    ];

    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (body[key as keyof typeof body] !== undefined) {
        updates[key] = body[key as keyof typeof body];
      }
    }

    if (Object.keys(updates).length === 0) {
      return { success: true, message: 'No fields to update' };
    }

    updates.updated_at = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('user_profiles')
      .update(updates)
      .eq('user_id', userId);

    if (error) throw error;
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // SELF — UPSERT role-specific sub-profiles
  // -------------------------------------------------------------------------
  async upsertSeekerProfile(
    userId: string,
    body: {
      intent?: 'buying' | 'renting_long' | 'renting_short';
      budget_min?: number;
      budget_max?: number;
      preferred_counties?: string[];
      preferred_areas?: string[];
      preferred_types?: string[];
      min_bedrooms?: number;
      alert_frequency?: 'instant' | 'daily' | 'weekly';
    },
  ) {
    const { error } = await supabaseAdmin
      .from('seeker_profiles')
      .upsert({ user_id: userId, ...body, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    return { success: true };
  }

  async upsertLandlordProfile(
    userId: string,
    body: {
      id_type?: string;
      id_number?: string;
      is_company?: boolean;
      company_name?: string;
      kra_pin?: string;
    },
  ) {
    const { error } = await supabaseAdmin
      .from('landlord_profiles')
      .upsert({ user_id: userId, ...body, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    return { success: true };
  }

  async upsertAgentProfile(
    userId: string,
    body: {
      earb_license_no?: string;
      agency_name?: string;
      years_experience?: number;
      specialisations?: string[];
      service_counties?: string[];
      commission_rate_pct?: number;
    },
  ) {
    const { error } = await supabaseAdmin
      .from('agent_profiles')
      .upsert({ user_id: userId, ...body, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    return { success: true };
  }

  async upsertCaretakerProfile(
    userId: string,
    body: {
      lives_on_compound?: boolean;
      work_hours?: string;
      emergency_contact?: string;
    },
  ) {
    const { error } = await supabaseAdmin
      .from('caretaker_profiles')
      .upsert({ user_id: userId, ...body, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    return { success: true };
  }

  async upsertDeveloperProfile(
    userId: string,
    body: {
      company_name?: string;
      company_reg_no?: string;
      kra_pin?: string;
      nca_reg_no?: string;
      years_in_operation?: number;
      website_url?: string;
      logo_url?: string;
    },
  ) {
    if (!body.company_name) {
      // company_name is NOT NULL in schema — require it on first upsert
      const { data: existing } = await supabaseAdmin
        .from('developer_profiles')
        .select('company_name')
        .eq('user_id', userId)
        .maybeSingle();
      if (!existing && !body.company_name) {
        throw new Error('company_name is required for a new developer profile');
      }
    }

    const { error } = await supabaseAdmin
      .from('developer_profiles')
      .upsert({ user_id: userId, ...body, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // ADMIN — GET paginated user list
  // -------------------------------------------------------------------------
  async getAllUsers(page = 1, limit = 10, search = '') {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Base query on `users` joined to `user_profiles` and `user_roles → roles`
    let query = supabaseAdmin
      .from('users')
      .select(
        `id, email, phone_number, account_status, email_verified, auth_provider, created_at,
         user_profiles(full_name, display_name, avatar_url, county),
         user_roles(is_active, roles(name))`,
        { count: 'exact' },
      )
      .is('deleted_at', null);

    if (search) {
      // Search on email (users table) — full_name search requires a separate approach
      // because Supabase PostgREST can't OR across joined tables in a single filter.
      // We do a two-pronged approach: search users by email OR fetch profile IDs by name.
      const { data: profileMatches } = await supabaseAdmin
        .from('user_profiles')
        .select('user_id')
        .ilike('full_name', `%${search}%`);

      const profileIds = (profileMatches ?? []).map((p) => p.user_id);

      if (profileIds.length > 0) {
        query = query.or(`email.ilike.%${search}%,id.in.(${profileIds.join(',')})`);
      } else {
        query = query.ilike('email', `%${search}%`);
      }
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const users = (data ?? []).map((u: any) => ({
      id: u.id,
      email: u.email,
      phone: u.phone_number ?? null,
      account_status: u.account_status,
      email_verified: u.email_verified,
      auth_provider: u.auth_provider,
      created_at: u.created_at,
      full_name: u.user_profiles?.full_name ?? null,
      display_name: u.user_profiles?.display_name ?? null,
      avatar_url: u.user_profiles?.avatar_url ?? null,
      county: u.user_profiles?.county ?? null,
      roles: (u.user_roles ?? [])
        .filter((r: any) => r.is_active)
        .map((r: any) => r.roles?.name)
        .filter(Boolean),
    }));

    return {
      users,
      total: count ?? 0,
      page,
      limit,
      pages: Math.ceil((count ?? 0) / limit),
    };
  }

  // -------------------------------------------------------------------------
  // ADMIN — GET single user (full profile)
  // -------------------------------------------------------------------------
  async getUserById(userId: string) {
    return this.getMyProfile(userId); // reuse — same query, no ownership filter
  }

  // -------------------------------------------------------------------------
  // ADMIN — UPDATE account_status  (active / suspended / banned / pending_verify)
  // -------------------------------------------------------------------------
  async updateUserStatus(userId: string, status: AccountStatus) {
    const VALID: AccountStatus[] = ['active', 'suspended', 'pending_verify', 'banned'];
    if (!VALID.includes(status)) {
      throw new Error(`Invalid status. Must be one of: ${VALID.join(', ')}`);
    }

    const { error } = await supabaseAdmin
      .from('users')
      .update({ account_status: status })
      .eq('id', userId)
      .is('deleted_at', null);

    if (error) throw error;
    return { success: true, account_status: status };
  }

  // -------------------------------------------------------------------------
  // ADMIN — ASSIGN / REVOKE roles
  //
  // Accepts `{ assign: string[], revoke: string[] }` so the caller can be
  // surgical rather than doing a destructive full-replace.
  // -------------------------------------------------------------------------
  async updateUserRoles(
    userId: string,
    ops: { assign?: UserRole[]; revoke?: UserRole[] },
  ) {
    const { assign = [], revoke = [] } = ops;

    // Resolve role names → IDs
    const names = [...new Set([...assign, ...revoke])];
    if (names.length === 0) return { success: true, message: 'No role changes requested' };

    const { data: roleRows, error: roleErr } = await supabaseAdmin
      .from('roles')
      .select('id, name')
      .in('name', names);

    if (roleErr) throw roleErr;

    const roleMap = new Map((roleRows ?? []).map((r) => [r.name as UserRole, r.id as number]));

    // Revoke first
    for (const roleName of revoke) {
      const roleId = roleMap.get(roleName);
      if (!roleId) continue;
      await supabaseAdmin
        .from('user_roles')
        .update({ is_active: false })
        .eq('user_id', userId)
        .eq('role_id', roleId);
    }

    // Assign (upsert — re-activates a previously revoked role gracefully)
    for (const roleName of assign) {
      const roleId = roleMap.get(roleName);
      if (!roleId) throw new Error(`Role '${roleName}' not found`);
      await supabaseAdmin
        .from('user_roles')
        .upsert(
          { user_id: userId, role_id: roleId, is_active: true, assigned_at: new Date().toISOString() },
          { onConflict: 'user_id,role_id' },
        );
    }

    return { success: true };
  }

  // -------------------------------------------------------------------------
  // SELF — SUBMIT ID / role verification request
  // Creates a row in id_verifications with status='pending'.
  // Staff reviews it; on approval the backend assigns the requested_role.
  // -------------------------------------------------------------------------
  async submitVerification(
    userId: string,
    body: {
      requested_role:  'landlord' | 'developer';
      doc_type:        'national_id' | 'passport' | 'company_cert' | 'earb_license' | 'nca_cert';
      doc_number?:     string;
      front_image?:    string;   // base64 dataUrl or public URL
      back_image?:     string;
      selfie?:         string;
      company_name?:   string;
      kra_pin?:        string;
      nca_reg_number?: string;
    },
  ) {
    // Prevent duplicate pending submissions
    const { data: existing } = await supabaseAdmin
      .from('id_verifications')
      .select('id, status')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      throw new Error('You already have a pending verification request. Please wait for it to be reviewed.');
    }

    const { error } = await supabaseAdmin
      .from('id_verifications')
      .insert({
        user_id:         userId,
        requested_role:  body.requested_role,
        doc_type:        body.doc_type,
        doc_number:      body.doc_number  ?? null,
        front_image_url: body.front_image ?? null,
        back_image_url:  body.back_image  ?? null,
        selfie_url:      body.selfie       ?? null,
        status:          'pending',
        submitted_at:    new Date().toISOString(),
      });

    if (error) throw new Error(`Failed to submit verification: ${error.message}`);
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // ADMIN — SOFT-DELETE user
  // -------------------------------------------------------------------------
  async deleteUser(userId: string) {
    const { error } = await supabaseAdmin
      .from('users')
      .update({ deleted_at: new Date().toISOString(), account_status: 'banned' })
      .eq('id', userId)
      .is('deleted_at', null);

    if (error) throw error;
    return { success: true };
  }
}

export const usersService = new UsersService();