import { z } from 'zod';

// =============================================================================
// ENUMS — mirror your PostgreSQL enum types exactly
// =============================================================================

export type AuthProvider = 'local' | 'google' | 'apple';

export type AccountStatus = 'active' | 'suspended' | 'pending_verify' | 'banned';

export type DeviceType = 'web' | 'android' | 'ios' | 'unknown';

export type AuditEventType =
  | 'login'
  | 'logout'
  | 'failed_login'
  | 'password_change'
  | 'role_change'
  | 'listing_create'
  | 'listing_delete'
  | 'account_ban'
  | 'data_export';

export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/**
 * Roles that exist in the `roles` table.
 * 'user' is kept as a legacy alias for 'seeker' in case existing tokens reference it.
 */
export type UserRole =
  | 'super_admin'
  | 'staff'
  | 'landlord'
  | 'caretaker'
  | 'agent'
  | 'developer'
  | 'seeker'
  | 'user'; // legacy alias

// =============================================================================
// CORE USER SHAPE — matches the `users` table columns
// =============================================================================

export interface User {
  id: string;
  email: string;
  phone_number: string | null;
  password_hash: string | null;       // null for OAuth accounts
  auth_provider: AuthProvider;
  provider_uid: string | null;        // Google sub / Apple uid
  account_status: AccountStatus;
  email_verified: boolean;
  phone_verified: boolean;
  failed_login_count: number;
  locked_until: string | null;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
  deleted_at: string | null;
}

/** Lightweight shape used inside JWTs and service return values */
export interface UserWithRoles {
  userId: string;
  email: string;
  roles: UserRole[];
}

/** What the auth middleware attaches to `c.get('user')` */
export interface AuthUser {
  userId: string;
  email: string;
  roles: UserRole[];
  iat?: number;
  exp?: number;
}

// =============================================================================
// PROFILE — matches `user_profiles` table
// =============================================================================

export interface UserProfile {
  user_id: string;
  full_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  preferred_language: string;
  county: string | null;
  notification_prefs: {
    sms: boolean;
    email: boolean;
    push: boolean;
  };
  whatsapp_number: string | null;
  updated_at: string;
}

/** Combined profile returned by GET /auth/profile */
export interface FullProfile extends Partial<UserProfile> {
  id: string;
  email: string;
  phone_number: string | null;
  email_verified: boolean;
  auth_provider: AuthProvider;
  account_status: AccountStatus;
  created_at: string;
  roles: UserRole[];
}

// =============================================================================
// SESSIONS — matches `user_sessions` table
// =============================================================================

export interface UserSession {
  id: string;
  user_id: string;
  token_hash: string;
  device_fingerprint: string | null;
  device_type: DeviceType;
  ip_address: string | null;
  user_agent: string | null;
  location_country: string | null;
  is_active: boolean;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
}

/** Sanitised session info returned to the client (no token_hash) */
export interface SessionInfo {
  id: string;
  deviceType: DeviceType;
  userAgent: string;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
}

// =============================================================================
// SECURITY AUDIT LOG — matches `security_audit_log` table
// =============================================================================

export interface SecurityAuditLog {
  id: number;                          // BIGSERIAL
  user_id: string | null;
  event_type: AuditEventType;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  performed_by: string | null;
  created_at: string;
}

// =============================================================================
// GOOGLE OAUTH
// =============================================================================

/** Decoded payload from Google's id_token */
export interface GoogleTokenPayload {
  sub: string;           // Google user ID
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}

/** Result of a successful Google OAuth callback */
export interface OAuthCallbackResult {
  user: {
    id: string;
    email: string;
    roles: UserRole[];
  };
  accessToken: string;
  refreshToken: string;
  isNewUser: boolean;    // true = just registered via Google
}

// =============================================================================
// SERVICE RETURN TYPES — discriminated union on `success`
// =============================================================================

/**
 * Every success response carries `success: true`.
 * Every error response carries `success: false`.
 * This lets TypeScript narrow the union with a simple `if (isAuthError(result))` check.
 */

export interface AuthSuccess {
  success: true;
  user: {
    id: string;
    email: string;
    roles: UserRole[];
  };
  accessToken: string;
  refreshToken: string;
}

export interface AuthError {
  success: false;
  error: string;
  code: string;
  userId?: string;
  canResend?: boolean;
}

export type AuthResult = AuthSuccess | AuthError;

// --- token refresh ---
export interface RefreshSuccess {
  success: true;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshError {
  success: false;
  error: string;
  code: string;
}

export type RefreshResult = RefreshSuccess | RefreshError;

// --- generic service ops (verify, logout, change-pw, reset-pw, etc.) ---
export interface ServiceSuccess {
  success: true;
  message?: string;
  code?: string;
}

export interface ServiceError {
  success: false;
  error: string;
  code: string;
}

export type ServiceResult = ServiceSuccess | ServiceError;

// --- logout-others ---
export interface LogoutOthersSuccess {
  success: true;
  devicesLoggedOut: number;
}

export type LogoutOthersResult = LogoutOthersSuccess | ServiceError;

// =============================================================================
// TYPE GUARDS — use these in controllers instead of checking `result.error`
// =============================================================================

export function isAuthError(result: AuthResult): result is AuthError {
  return result.success === false;
}

export function isRefreshError(result: RefreshResult): result is RefreshError {
  return result.success === false;
}

export function isServiceError(result: ServiceResult): result is ServiceError {
  return result.success === false;
}

export function isLogoutOthersError(result: LogoutOthersResult): result is ServiceError {
  return result.success === false;
}

// =============================================================================
// INPUT / REQUEST TYPES (non-zod, used internally)
// =============================================================================

export interface LogoutInput {
  refreshToken?: string;
  logoutAll?: boolean;
}

// =============================================================================
// ZOD VALIDATION SCHEMAS
// =============================================================================

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(
    /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]/,
    'Password must contain at least one letter, one number, and one special character',
  );

export const registerSchema = z.object({
  full_name: z.string().min(2, 'Full name must be at least 2 characters').max(150),
  email:     z.string().email('Valid email is required').toLowerCase(),
  phone:     z
    .string()
    .regex(/^\+?[\d\s\-()]{7,15}$/, 'Invalid phone number format')
    .optional(),
  password:  passwordSchema,
});

export const loginSchema = z.object({
  email:    z.string().email('Valid email is required').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword:     passwordSchema,
}).refine(
  (data) => data.currentPassword !== data.newPassword,
  { message: 'New password must differ from current password', path: ['newPassword'] },
);

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email('Valid email is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Valid email is required'),
});

export const resetPasswordSchema = z.object({
  token:    z.string().min(1, 'Token is required'),
  password: passwordSchema,
});

export const logoutSchema = z.object({
  refreshToken: z.string().optional(),
  logoutAll:    z.boolean().optional().default(false),
});

// =============================================================================
// INFERRED INPUT TYPES from Zod schemas
// =============================================================================

export type RegisterInput         = z.infer<typeof registerSchema>;
export type LoginInput            = z.infer<typeof loginSchema>;
export type ChangePasswordInput   = z.infer<typeof changePasswordSchema>;
export type RefreshTokenInput     = z.infer<typeof refreshTokenSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type ForgotPasswordInput   = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput    = z.infer<typeof resetPasswordSchema>;
export type LogoutSchemaInput     = z.infer<typeof logoutSchema>;