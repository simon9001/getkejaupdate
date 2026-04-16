import { z } from 'zod';
// =============================================================================
// TYPE GUARDS — use these in controllers instead of checking `result.error`
// =============================================================================
export function isAuthError(result) {
    return result.success === false;
}
export function isRefreshError(result) {
    return result.success === false;
}
export function isServiceError(result) {
    return result.success === false;
}
export function isLogoutOthersError(result) {
    return result.success === false;
}
// =============================================================================
// ZOD VALIDATION SCHEMAS
// =============================================================================
const passwordSchema = z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]/, 'Password must contain at least one letter, one number, and one special character');
export const registerSchema = z.object({
    full_name: z.string().min(2, 'Full name must be at least 2 characters').max(150),
    email: z.string().email('Valid email is required').toLowerCase(),
    phone: z
        .string()
        .regex(/^\+?[\d\s\-()]{7,15}$/, 'Invalid phone number format')
        .optional(),
    password: passwordSchema,
});
export const loginSchema = z.object({
    email: z.string().email('Valid email is required').toLowerCase(),
    password: z.string().min(1, 'Password is required'),
});
export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
}).refine((data) => data.currentPassword !== data.newPassword, { message: 'New password must differ from current password', path: ['newPassword'] });
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
    token: z.string().min(1, 'Token is required'),
    password: passwordSchema,
});
export const logoutSchema = z.object({
    refreshToken: z.string().optional(),
    logoutAll: z.boolean().optional().default(false),
});
