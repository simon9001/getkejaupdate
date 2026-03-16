import { z } from 'zod';

export type UserRole = 'user' | 'landlord' | 'caretaker' | 'agent' | 'admin' | 'special';
export type VerificationStatus = 'pending' | 'approved' | 'rejected';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone?: string;
  password_hash: string;
  avatar_url?: string;
  email_verified: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UserWithRoles extends Profile {
  roles: UserRole[];
}

// Validation Schemas
export const registerSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  email: z.string().email('Valid email is required'),
  phone: z.string().optional(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]/,
      'Password must contain at least one letter, one number, and one special character')
});

export const loginSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(1, 'Password is required')
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string()
    .min(8, 'New password must be at least 8 characters')
    .regex(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]/,
      'New password must contain at least one letter, one number, and one special character')
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required')
});

export const resendVerificationSchema = z.object({
  email: z.string().email('Valid email is required')
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Valid email is required')
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]/,
      'Password must contain at least one letter, one number, and one special character')
});
// Add these to your auth.types.ts

export interface LogoutInput {
  refreshToken?: string;
  logoutAll?: boolean;
}

export interface LogoutAllInput {
  confirm?: boolean; // Optional confirmation for security
}

export interface SessionInfo {
  id: string;
  deviceInfo: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
  isCurrentSession: boolean;
}


// Add these to your existing auth.types.ts

export interface LogoutInput {
  refreshToken?: string;
  logoutAll?: boolean;
}

export interface LogoutAllInput {
  confirm?: boolean; // Optional confirmation for security
}

export interface SessionInfo {
  id: string;
  deviceInfo: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
  isCurrentSession: boolean;
}

// Optional: For token blacklisting
export interface BlacklistedToken {
  token: string;
  user_id: string;
  expires_at: string;
  blacklisted_at: string;
}

// Optional: For security logs
export interface SecurityLog {
  id: string;
  user_id: string;
  event: string;
  user_agent?: string;
  ip_address?: string;
  metadata: Record<string, any>;
  created_at: string;
}

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;