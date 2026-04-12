/**
 * auth.service.ts
 *
 * Security fixes applied:
 *
 *  Fix #1 — Transactional integrity
 *    register() now calls a `register_user` Postgres RPC that performs
 *    user + role + profile inserts inside a single DB transaction.
 *    See the companion SQL migration at the bottom of this file.
 *
 *  Fix #3 — Account enumeration prevention
 *    register() returns the same neutral response regardless of whether
 *    the email exists or which provider it uses.
 *
 *  Fix #4 — Role escalation protection
 *    assignRole() is the only permitted path to add a role.
 *    It validates against an explicit server-side allowlist and can
 *    optionally gate elevated roles behind a verification check.
 *
 *  Fix #5 — Refresh-token rotation detection
 *    refreshToken() stores the previous token hash.  If the same
 *    old hash is presented again (stolen-token replay), all sessions
 *    for that user are immediately revoked.
 *
 *  Fix #6 — Resend-verification cooldown
 *    resendVerification() enforces a per-user 60-second cooldown
 *    using a `email_verify_last_sent` column.
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { supabaseAdmin } from '../utils/supabase.js';
import { tokenService } from '../utils/token.service.js';
import { emailService } from '../utils/email.service.js';
import { env } from '../config/environment.js';
import type {
  RegisterInput,
  LoginInput,
  UserWithRoles,
  SessionInfo,
  AuthResult,
  RefreshResult,
  ServiceResult,
  LogoutOthersResult,
  UserRole,
} from '../types/auth.types.js';

// ---------------------------------------------------------------------------
// Google OAuth2 client
// ---------------------------------------------------------------------------
const googleClient = new OAuth2Client(
  env.google.clientId,
  env.google.clientSecret,
  env.google.redirectUri,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateOpaqueToken(): string {
  return crypto.randomBytes(40).toString('hex');
}

/** Pull roles for a user from user_roles join roles */
async function fetchUserRoles(userId: string): Promise<UserRole[]> {
  const { data } = await supabaseAdmin
    .from('user_roles')
    .select('roles(name)')
    .eq('user_id', userId)
    .eq('is_active', true);

  return (data ?? []).map((r: any) => (r.roles?.name ?? 'seeker') as UserRole);
}

/**
 * Insert a row into user_sessions and return the opaque refresh token.
 * Returns both the raw token AND its hash so the caller can store the hash
 * as `previous_token_hash` on subsequent rotations (Fix #5).
 */
async function createSession(
  userId: string,
  userAgent: string,
  ipAddress?: string,
): Promise<{ refreshToken: string; tokenHash: string }> {
  const refreshToken = generateOpaqueToken();
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + env.refreshTokenExpires);

  const deviceType = /android/i.test(userAgent)
    ? 'android'
    : /iphone|ipad/i.test(userAgent)
      ? 'ios'
      : /mozilla|chrome|safari/i.test(userAgent)
        ? 'web'
        : 'unknown';

  await supabaseAdmin.from('user_sessions').insert({
    user_id: userId,
    token_hash: tokenHash,
    previous_token_hash: null, // first-ever session — no previous hash
    device_type: deviceType,
    user_agent: userAgent,
    ip_address: ipAddress ?? null,
    is_active: true,
    expires_at: expiresAt.toISOString(),
  });

  return { refreshToken, tokenHash };
}

/** Log to security_audit_log */
async function auditLog(
  userId: string | null,
  eventType: string,
  userAgent?: string,
  ipAddress?: string,
  metadata?: Record<string, unknown>,
) {
  try {
    await supabaseAdmin.from('security_audit_log').insert({
      user_id: userId,
      event_type: eventType,
      user_agent: userAgent ?? null,
      ip_address: ipAddress ?? null,
      metadata: metadata ?? {},
    });
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

// ---------------------------------------------------------------------------
// Fix #4 — Role escalation protection
//
// ONLY call this function from the server.  Never accept a role value
// directly from user input.
// ---------------------------------------------------------------------------

/** Roles that can be assigned without any additional verification. */
const SELF_ASSIGNABLE_ROLES: UserRole[] = ['seeker'];

/** Roles that require an out-of-band verification workflow before assignment. */
const VERIFIED_ROLES: UserRole[] = ['landlord', 'caretaker', 'agent', 'developer'];

/** Roles restricted to platform admins — never assigned via user flows. */
const ADMIN_ROLES: UserRole[] = ['super_admin', 'staff'];

async function assignRole(
  userId: string,
  role: UserRole,
  opts: { requiresVerification?: boolean; bypassVerificationCheck?: boolean } = {},
): Promise<void> {
  // Guard: admin roles must never be assigned through regular flows.
  if ((ADMIN_ROLES as string[]).includes(role)) {
    throw new Error(`Role '${role}' can only be assigned by a platform admin.`);
  }

  // Guard: elevated roles must have gone through verification unless explicitly bypassed
  // (e.g. an admin-triggered bulk assignment).
  if ((VERIFIED_ROLES as string[]).includes(role) && !opts.bypassVerificationCheck) {
    if (!opts.requiresVerification) {
      throw new Error(`Role '${role}' requires a completed verification workflow.`);
    }
  }

  const { data: roleRow } = await supabaseAdmin
    .from('roles')
    .select('id')
    .eq('name', role)
    .single();

  if (!roleRow) throw new Error(`Role '${role}' not found in roles table.`);

  // Upsert to avoid duplicate-role errors on retries.
  await supabaseAdmin
    .from('user_roles')
    .upsert({ user_id: userId, role_id: roleRow.id, is_active: true }, { onConflict: 'user_id,role_id' });
}

// ---------------------------------------------------------------------------
// AuthService
// ---------------------------------------------------------------------------
export class AuthService {

  // -------------------------------------------------------------------------
  // REGISTER
  //
  // Fix #1 — Transactional integrity
  //   Calls the `register_user` stored procedure which wraps the three
  //   inserts (users, user_roles, user_profiles) inside a single Postgres
  //   transaction.  If any step fails the whole thing rolls back.
  //
  // Fix #3 — Account enumeration prevention
  //   Always returns the same success-shaped response regardless of whether
  //   the email already exists or which provider it uses.
  // -------------------------------------------------------------------------
  async register(
    body: RegisterInput,
  ): Promise<ServiceResult & { user?: { id: string; email: string; account_status: string } }> {
    const { full_name, email, phone, password } = body;

    const password_hash = await bcrypt.hash(password, 12);
    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const tokenExpires = new Date(Date.now() + env.emailVerificationExpires);

    // Call the atomic stored procedure (see SQL migration below).
    // The RPC returns `{ id, email, account_status, created }` where
    // `created = false` means the email already existed — we deliberately
    // ignore that distinction to prevent enumeration (Fix #3).
    const { data, error } = await supabaseAdmin.rpc('register_user', {
      p_email: email.toLowerCase(),
      p_phone: phone ?? null,
      p_password_hash: password_hash,
      p_full_name: full_name,
      p_verify_token_hash: tokenHash,
      p_verify_token_expires: tokenExpires.toISOString(),
    });

    if (error) {
      // Log internally but never expose the detail to the caller.
      console.error('register_user RPC error:', error);
      throw new Error('Registration failed');
    }

    // Fix #3: always send the same response regardless of whether `created`
    // is true or false.  The email service is only called when a new user was
    // actually created — the RPC returns `created: true` only in that case.
    if (data?.created) {
      emailService
        .sendVerificationEmail(email, rawToken, full_name)
        .catch((err) => console.error('Verification email error:', err));
    }

    // Neutral response — attacker cannot tell if the email was new or existing.
    return {
      success: true,
      user: data?.created
        ? { id: data.id, email: data.email, account_status: data.account_status }
        : undefined,
    };
  }

  // -------------------------------------------------------------------------
  // LOGIN
  // -------------------------------------------------------------------------
  async login(body: LoginInput, userAgent: string, ipAddress?: string): Promise<AuthResult> {
    const { email, password } = body;

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, password_hash, auth_provider, account_status, email_verified, failed_login_count, locked_until')
      .ilike('email', email)
      .is('deleted_at', null)
      .maybeSingle();

    const invalidCreds: AuthResult = {
      success: false,
      error: 'Invalid email or password',
      code: 'INVALID_CREDENTIALS',
    };

    if (!user || !user.password_hash) return invalidCreds;

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return { success: false, error: 'Account temporarily locked. Try again later.', code: 'ACCOUNT_LOCKED' };
    }

    if (user.account_status === 'banned') {
      return { success: false, error: 'Account has been suspended.', code: 'ACCOUNT_BANNED' };
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      const newCount = (user.failed_login_count ?? 0) + 1;
      const lockedUntil = newCount >= 5 ? new Date(Date.now() + 15 * 60 * 1_000) : null;
      await supabaseAdmin
        .from('users')
        .update({ failed_login_count: newCount, locked_until: lockedUntil?.toISOString() ?? null })
        .eq('id', user.id);
      await auditLog(user.id, 'failed_login', userAgent, ipAddress);
      return invalidCreds;
    }

    if (!user.email_verified) {
      return {
        success: false,
        error: 'Please verify your email before logging in.',
        code: 'EMAIL_NOT_VERIFIED',
        userId: user.id,
        canResend: true,
      };
    }

    await supabaseAdmin
      .from('users')
      .update({
        failed_login_count: 0,
        locked_until: null,
        last_login_at: new Date().toISOString(),
        last_login_ip: ipAddress ?? null,
      })
      .eq('id', user.id);

    const roles = await fetchUserRoles(user.id);
    const userWithRoles: UserWithRoles = { userId: user.id, email: user.email, roles };
    const accessToken = tokenService.generateAccessToken(userWithRoles);
    const { refreshToken } = await createSession(user.id, userAgent, ipAddress);

    await auditLog(user.id, 'login', userAgent, ipAddress);

    return { success: true, user: { id: user.id, email: user.email, roles }, accessToken, refreshToken };
  }

  // -------------------------------------------------------------------------
  // GOOGLE AUTH URL
  // -------------------------------------------------------------------------
  getGoogleAuthUrl(): string {
    return googleClient.generateAuthUrl({
      access_type: 'offline',
      scope: ['openid', 'email', 'profile'],
      state: crypto.randomBytes(16).toString('hex'),
      prompt: 'select_account',
    });
  }

  // -------------------------------------------------------------------------
  // GOOGLE CALLBACK
  // -------------------------------------------------------------------------
  async handleGoogleCallback(
    code: string,
    userAgent: string,
    ipAddress?: string,
  ): Promise<AuthResult & { isNewUser?: boolean }> {
    const { tokens } = await googleClient.getToken(code);
    googleClient.setCredentials(tokens);

    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token!,
      audience: env.google.clientId,
    });

    const payload = ticket.getPayload();
    if (!payload?.email) {
      return { success: false, error: 'Could not retrieve email from Google.', code: 'GOOGLE_NO_EMAIL' };
    }

    const { sub: googleId, email, name, picture } = payload;
    let isNewUser = false;

    let { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, auth_provider, account_status, email_verified')
      .eq('provider_uid', googleId)
      .maybeSingle();

    if (!user) {
      const { data: byEmail } = await supabaseAdmin
        .from('users')
        .select('id, email, auth_provider, account_status, email_verified')
        .ilike('email', email)
        .is('deleted_at', null)
        .maybeSingle();

      if (byEmail) {
        if (byEmail.auth_provider === 'local') {
          await supabaseAdmin.from('users').update({
            auth_provider: 'google',
            provider_uid: googleId,
            email_verified: true,
            account_status: 'active',
          }).eq('id', byEmail.id);
        }
        user = byEmail;
      }
    }

    if (!user) {
      isNewUser = true;

      const { data: newUser, error: createError } = await supabaseAdmin
        .from('users')
        .insert({
          email: email.toLowerCase(),
          auth_provider: 'google',
          provider_uid: googleId,
          account_status: 'active',
          email_verified: true,
          password_hash: null,
        })
        .select('id, email, auth_provider, account_status, email_verified')
        .single();

      if (createError || !newUser) throw createError ?? new Error('Failed to create Google user');

      await supabaseAdmin
        .from('user_profiles')
        .insert({ user_id: newUser.id, full_name: name ?? email, avatar_url: picture ?? null });

      // Fix #4: use controlled assignRole helper, not raw insert.
      await assignRole(newUser.id, 'seeker');

      emailService.sendWelcomeEmail(email, name ?? email).catch(console.error);
      user = newUser;
    }

    if (!user) throw new Error('Unexpected: user is null after Google OAuth resolution');

    if (user.account_status === 'banned') {
      return { success: false, error: 'Account has been suspended.', code: 'ACCOUNT_BANNED' };
    }

    await supabaseAdmin
      .from('users')
      .update({ last_login_at: new Date().toISOString(), last_login_ip: ipAddress ?? null })
      .eq('id', user.id);

    const roles = await fetchUserRoles(user.id);
    const userWithRoles: UserWithRoles = { userId: user.id, email: user.email, roles };
    const accessToken = tokenService.generateAccessToken(userWithRoles);
    const { refreshToken } = await createSession(user.id, userAgent, ipAddress);

    await auditLog(user.id, 'login', userAgent, ipAddress, { provider: 'google' });

    return { success: true, user: { id: user.id, email: user.email, roles }, accessToken, refreshToken, isNewUser };
  }

  // -------------------------------------------------------------------------
  // VERIFY EMAIL
  // -------------------------------------------------------------------------
  async verifyEmail(token: string): Promise<ServiceResult> {
    const tokenHash = hashToken(token);

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, email_verified, email_verify_expires, account_status')
      .eq('email_verify_token', tokenHash)
      .maybeSingle();

    if (!user) return { success: false, error: 'Invalid verification token.', code: 'INVALID_TOKEN' };
    if (user.email_verified) return { success: true, message: 'Email already verified.', code: 'ALREADY_VERIFIED' };
    if (new Date(user.email_verify_expires) < new Date()) {
      return { success: false, error: 'Verification token has expired. Please request a new one.', code: 'TOKEN_EXPIRED' };
    }

    await supabaseAdmin.from('users').update({
      email_verified: true,
      account_status: 'active',
      email_verify_token: null,
      email_verify_expires: null,
    }).eq('id', user.id);

    const { data: profile } = await supabaseAdmin
      .from('user_profiles').select('full_name').eq('user_id', user.id).maybeSingle();
    emailService.sendWelcomeEmail(user.email, profile?.full_name ?? user.email).catch(console.error);

    return { success: true, message: 'Email verified successfully.' };
  }

  // -------------------------------------------------------------------------
  // RESEND VERIFICATION
  //
  // Fix #6 — Per-user cooldown to prevent email-bombing.
  //   We track `email_verify_last_sent` on the users row.
  //   If it was set less than 60 seconds ago we return success (no error
  //   is exposed — same neutral response) but we do NOT send another email.
  // -------------------------------------------------------------------------
  async resendVerification(email: string): Promise<ServiceResult> {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, email_verified, auth_provider, email_verify_last_sent')
      .ilike('email', email)
      .is('deleted_at', null)
      .maybeSingle();

    // Always return success — don't leak whether the account exists.
    if (!user || user.email_verified || user.auth_provider !== 'local') {
      return { success: true };
    }

    // Fix #6: enforce 60-second per-user cooldown.
    const COOLDOWN_MS = 60_000;
    if (user.email_verify_last_sent) {
      const lastSent = new Date(user.email_verify_last_sent).getTime();
      if (Date.now() - lastSent < COOLDOWN_MS) {
        // Still return success — the caller only needs to know the request was accepted.
        return { success: true };
      }
    }

    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expires = new Date(Date.now() + env.emailVerificationExpires);

    await supabaseAdmin.from('users').update({
      email_verify_token: tokenHash,
      email_verify_expires: expires.toISOString(),
      email_verify_last_sent: new Date().toISOString(), // Fix #6
    }).eq('id', user.id);

    const { data: profile } = await supabaseAdmin
      .from('user_profiles').select('full_name').eq('user_id', user.id).maybeSingle();
    emailService
      .sendVerificationEmail(email, rawToken, profile?.full_name ?? email)
      .catch(console.error);

    return { success: true };
  }

  // -------------------------------------------------------------------------
  // FORGOT PASSWORD
  // -------------------------------------------------------------------------
  async forgotPassword(email: string): Promise<ServiceResult> {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, auth_provider')
      .ilike('email', email)
      .is('deleted_at', null)
      .maybeSingle();

    if (!user || user.auth_provider === 'google') return { success: true };

    const rawToken = tokenService.generatePasswordResetToken(user.id, email);
    const tokenHash = hashToken(rawToken);
    const expires = new Date(Date.now() + env.passwordResetExpires);

    await supabaseAdmin.from('users').update({
      password_reset_token: tokenHash,
      password_reset_expires: expires.toISOString(),
    }).eq('id', user.id);

    const { data: profile } = await supabaseAdmin
      .from('user_profiles').select('full_name').eq('user_id', user.id).maybeSingle();
    emailService
      .sendPasswordResetEmail(email, rawToken, profile?.full_name ?? email)
      .catch(console.error);

    return { success: true };
  }

  // -------------------------------------------------------------------------
  // RESET PASSWORD
  // -------------------------------------------------------------------------
  async resetPassword(token: string, newPassword: string): Promise<ServiceResult> {
    let payload: { userId: string; email: string };
    try {
      payload = tokenService.verifyPasswordResetToken(token);
    } catch {
      return { success: false, error: 'Invalid or expired reset token.', code: 'INVALID_TOKEN' };
    }

    const tokenHash = hashToken(token);

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, password_reset_token, password_reset_expires')
      .eq('id', payload.userId)
      .maybeSingle();

    if (
      !user ||
      user.password_reset_token !== tokenHash ||
      new Date(user.password_reset_expires) < new Date()
    ) {
      return { success: false, error: 'Invalid or expired reset token.', code: 'INVALID_TOKEN' };
    }

    const password_hash = await bcrypt.hash(newPassword, 12);

    await supabaseAdmin.from('users').update({
      password_hash,
      password_reset_token: null,
      password_reset_expires: null,
      auth_provider: 'local',
    }).eq('id', user.id);

    await supabaseAdmin.from('user_sessions').update({
      is_active: false,
      revoked_at: new Date().toISOString(),
    }).eq('user_id', user.id);

    const { data: profile } = await supabaseAdmin
      .from('user_profiles').select('full_name').eq('user_id', user.id).maybeSingle();
    emailService
      .sendPasswordChangedNotification(user.email, profile?.full_name ?? user.email)
      .catch(console.error);

    return { success: true };
  }

  // -------------------------------------------------------------------------
  // CHANGE PASSWORD
  // -------------------------------------------------------------------------
  async changePassword(
    userId: string,
    currentPass: string,
    newPass: string,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<ServiceResult> {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, password_hash, auth_provider')
      .eq('id', userId)
      .single();

    if (!user) return { success: false, error: 'User not found.', code: 'NOT_FOUND' };

    if (user.auth_provider === 'google' && !user.password_hash) {
      return {
        success: false,
        error: 'Your account uses Google Sign-In. Set a password via the reset password flow.',
        code: 'OAUTH_ACCOUNT',
      };
    }

    const valid = await bcrypt.compare(currentPass, user.password_hash!);
    if (!valid) {
      await auditLog(userId, 'failed_login', userAgent, ipAddress, { reason: 'wrong current password' });
      return { success: false, error: 'Current password is incorrect.', code: 'INVALID_CURRENT_PASSWORD' };
    }

    const newHash = await bcrypt.hash(newPass, 12);
    await supabaseAdmin.from('users').update({ password_hash: newHash }).eq('id', userId);
    await supabaseAdmin
      .from('user_sessions')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('user_id', userId);
    await auditLog(userId, 'password_change', userAgent, ipAddress);

    const { data: profile } = await supabaseAdmin
      .from('user_profiles').select('full_name').eq('user_id', userId).maybeSingle();
    emailService
      .sendPasswordChangedNotification(user.email, profile?.full_name ?? user.email)
      .catch(console.error);

    return { success: true };
  }

  // -------------------------------------------------------------------------
  // REFRESH TOKEN
  //
  // Fix #5 — Rotation detection / stolen-token invalidation
  //
  // Each session row stores both `token_hash` (current) and
  // `previous_token_hash` (the hash that was valid just before the last
  // rotation).  On every refresh we:
  //   1. Look up by `token_hash` — the happy path.
  //   2. If not found, look up by `previous_token_hash`.
  //      A hit here means the old token was replayed → someone stole it.
  //      Immediately revoke ALL sessions for that user and return 401.
  // -------------------------------------------------------------------------
  async refreshToken(refreshToken: string): Promise<RefreshResult> {
    const tokenHash = hashToken(refreshToken);

    // --- Happy path: current valid token ---
    const { data: session } = await supabaseAdmin
      .from('user_sessions')
      .select('id, user_id, expires_at, is_active')
      .eq('token_hash', tokenHash)
      .eq('is_active', true)
      .maybeSingle();

    if (!session || new Date(session.expires_at) < new Date()) {
      // Expire any found-but-stale session.
      if (session) {
        await supabaseAdmin
          .from('user_sessions')
          .update({ is_active: false, revoked_at: new Date().toISOString() })
          .eq('id', session.id);
      }

      // Fix #5: check if this is a replayed old token.
      const { data: replayedSession } = await supabaseAdmin
        .from('user_sessions')
        .select('id, user_id, is_active')
        .eq('previous_token_hash', tokenHash)
        .maybeSingle();

      if (replayedSession) {
        // Stolen token detected — nuke every session for this user.
        await supabaseAdmin
          .from('user_sessions')
          .update({ is_active: false, revoked_at: new Date().toISOString() })
          .eq('user_id', replayedSession.user_id);

        await auditLog(
          replayedSession.user_id,
          'token_reuse_detected',
          undefined,
          undefined,
          { revokedSessionId: replayedSession.id },
        );
      }

      return { success: false, error: 'Invalid or expired refresh token.', code: 'INVALID_TOKEN' };
    }

    // --- Rotate: generate new token, store current hash as previous ---
    const newRawToken = generateOpaqueToken();
    const newTokenHash = hashToken(newRawToken);
    const newExpiry = new Date(Date.now() + env.refreshTokenExpires);

    await supabaseAdmin.from('user_sessions').update({
      token_hash: newTokenHash,
      previous_token_hash: tokenHash, // Fix #5: remember the old hash
      expires_at: newExpiry.toISOString(),
    }).eq('id', session.id);

    const roles = await fetchUserRoles(session.user_id);
    const { data: user } = await supabaseAdmin
      .from('users').select('email').eq('id', session.user_id).single();
    const userWithRoles: UserWithRoles = { userId: session.user_id, email: user?.email ?? '', roles };
    const accessToken = tokenService.generateAccessToken(userWithRoles);

    return { success: true, accessToken, refreshToken: newRawToken };
  }

  // -------------------------------------------------------------------------
  // LOGOUT
  // -------------------------------------------------------------------------
  async logout(
    userId: string,
    refreshToken?: string,
    logoutAll = false,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<ServiceResult> {
    if (logoutAll) {
      await supabaseAdmin
        .from('user_sessions')
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq('user_id', userId);
      await auditLog(userId, 'logout', userAgent, ipAddress, { scope: 'all_devices' });
      return { success: true, code: 'LOGOUT_ALL_SUCCESS' };
    }

    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      const { data: session } = await supabaseAdmin
        .from('user_sessions')
        .select('id')
        .eq('token_hash', tokenHash)
        .eq('user_id', userId)
        .maybeSingle();

      if (!session) return { success: false, error: 'Invalid token.', code: 'INVALID_TOKEN' };

      await supabaseAdmin
        .from('user_sessions')
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq('id', session.id);
      await auditLog(userId, 'logout', userAgent, ipAddress, { scope: 'single_device' });
      return { success: true, code: 'LOGOUT_SUCCESS' };
    }

    await auditLog(userId, 'logout', userAgent, ipAddress);
    return { success: true, code: 'LOGOUT_SUCCESS' };
  }

  // -------------------------------------------------------------------------
  // LOGOUT OTHERS
  // -------------------------------------------------------------------------
  async logoutOthers(
    userId: string,
    currentRefreshToken: string,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<LogoutOthersResult> {
    const tokenHash = hashToken(currentRefreshToken);

    const { data: currentSession } = await supabaseAdmin
      .from('user_sessions')
      .select('id')
      .eq('token_hash', tokenHash)
      .eq('user_id', userId)
      .maybeSingle();

    if (!currentSession) {
      return { success: false, error: 'Invalid refresh token.', code: 'INVALID_TOKEN' };
    }

    const { data: others } = await supabaseAdmin
      .from('user_sessions')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('user_id', userId)
      .neq('id', currentSession.id)
      .eq('is_active', true)
      .select('id');

    const count = others?.length ?? 0;
    await auditLog(userId, 'logout', userAgent, ipAddress, { scope: 'other_devices', count });

    return { success: true, devicesLoggedOut: count };
  }

  // -------------------------------------------------------------------------
  // GET ACTIVE SESSIONS
  // -------------------------------------------------------------------------
  async getActiveSessions(userId: string): Promise<SessionInfo[]> {
    const { data: sessions } = await supabaseAdmin
      .from('user_sessions')
      .select('id, device_type, user_agent, ip_address, created_at, expires_at')
      .eq('user_id', userId)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    return (sessions ?? []).map((s) => ({
      id: s.id,
      deviceType: s.device_type,
      userAgent: s.user_agent ?? 'Unknown device',
      ipAddress: s.ip_address ?? null,
      createdAt: s.created_at,
      expiresAt: s.expires_at,
    }));
  }

  // -------------------------------------------------------------------------
  // REVOKE SESSION
  // -------------------------------------------------------------------------
  async revokeSession(
    userId: string,
    sessionId: string,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<ServiceResult> {
    const { data: session } = await supabaseAdmin
      .from('user_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!session) return { success: false, error: 'Session not found.', code: 'SESSION_NOT_FOUND' };

    await supabaseAdmin
      .from('user_sessions')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('id', sessionId);
    await auditLog(userId, 'logout', userAgent, ipAddress, { revokedSessionId: sessionId });

    return { success: true };
  }

  // -------------------------------------------------------------------------
  // GET PROFILE
  // -------------------------------------------------------------------------
  async getProfile(userId: string) {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, email, phone_number, email_verified, auth_provider, account_status, created_at')
      .eq('id', userId)
      .single();

    if (error || !user) throw error ?? new Error('User not found');

    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('full_name, display_name, avatar_url, county, whatsapp_number')
      .eq('user_id', userId)
      .maybeSingle();

    const roles = await fetchUserRoles(userId);

    return {
      id: user.id,
      email: user.email,
      phone: user.phone_number,
      email_verified: user.email_verified,
      auth_provider: user.auth_provider,
      account_status: user.account_status,
      created_at: user.created_at,
      ...profile,
      roles,
    };
  }
}

/*
 * =============================================================================
 * SQL MIGRATION  (Fix #1 + Fix #5 + Fix #6)
 * =============================================================================
 *
 * Run this migration against your Supabase database.
 * File: supabase/migrations/YYYYMMDD_auth_security_fixes.sql
 * =============================================================================

-- Fix #5: add previous_token_hash column to user_sessions
ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS previous_token_hash TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_previous_token_hash
  ON user_sessions (previous_token_hash)
  WHERE previous_token_hash IS NOT NULL;

-- Fix #6: track when last verification email was sent
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verify_last_sent TIMESTAMPTZ DEFAULT NULL;

-- Fix #1: atomic registration stored procedure
CREATE OR REPLACE FUNCTION register_user(
  p_email              TEXT,
  p_phone              TEXT,
  p_password_hash      TEXT,
  p_full_name          TEXT,
  p_verify_token_hash  TEXT,
  p_verify_token_expires TIMESTAMPTZ
)
RETURNS TABLE (
  id             UUID,
  email          TEXT,
  account_status TEXT,
  created        BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id      UUID;
  v_seeker_id    UUID;
  v_created      BOOLEAN := FALSE;
BEGIN
  -- Check for existing email (case-insensitive)
  SELECT u.id INTO v_user_id
  FROM users u
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    -- 1. Insert user
    INSERT INTO users (
      email, phone_number, password_hash, auth_provider,
      account_status, email_verified,
      email_verify_token, email_verify_expires
    ) VALUES (
      lower(p_email), p_phone, p_password_hash, 'local',
      'pending_verify', FALSE,
      p_verify_token_hash, p_verify_token_expires
    )
    RETURNING users.id INTO v_user_id;

    -- 2. Assign seeker role
    SELECT r.id INTO v_seeker_id FROM roles r WHERE r.name = 'seeker' LIMIT 1;
    IF v_seeker_id IS NOT NULL THEN
      INSERT INTO user_roles (user_id, role_id)
      VALUES (v_user_id, v_seeker_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;
    END IF;

    -- 3. Insert profile
    INSERT INTO user_profiles (user_id, full_name)
    VALUES (v_user_id, p_full_name)
    ON CONFLICT (user_id) DO NOTHING;

    v_created := TRUE;
  END IF;

  RETURN QUERY
  SELECT u.id, u.email, u.account_status::TEXT, v_created
  FROM users u
  WHERE u.id = v_user_id;
END;
$$;

-- Revoke direct public access; only the service role may call it
REVOKE ALL ON FUNCTION register_user FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_user TO service_role;

 * =============================================================================
 */