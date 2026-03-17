import { z } from 'zod';
// Validation Schemas
export const registerSchema = z.object({
    full_name: z.string().min(1, 'Full name is required'),
    email: z.string().email('Valid email is required'),
    phone: z.string().optional(),
    password: z.string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]/, 'Password must contain at least one letter, one number, and one special character')
});
export const loginSchema = z.object({
    email: z.string().email('Valid email is required'),
    password: z.string().min(1, 'Password is required')
});
export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string()
        .min(8, 'New password must be at least 8 characters')
        .regex(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]/, 'New password must contain at least one letter, one number, and one special character')
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
        .regex(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]/, 'Password must contain at least one letter, one number, and one special character')
});
