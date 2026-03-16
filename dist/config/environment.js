// backend/src/config/environment.ts
import { config } from 'dotenv';
import { resolve } from 'path';
// Load .env from project root
config({ path: resolve(process.cwd(), '.env') });
// Required env vars
const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'JWT_SECRET'
];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
    }
}
// Helper function to parse boolean env vars
const parseBoolean = (value, defaultValue) => {
    if (value === undefined)
        return defaultValue;
    return value.toLowerCase() === 'true';
};
// Helper function to parse number env vars with fallback
const parseNumber = (value, defaultValue) => {
    if (value === undefined)
        return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
};
// Helper to ensure string values with fallback
const ensureString = (value, fallback) => {
    return value || fallback;
};
// Create the environment object with proper typing
const environment = {
    // Server
    port: parseNumber(process.env.PORT, 8000),
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV === 'development',
    isTest: process.env.NODE_ENV === 'test',
    // Supabase (these are guaranteed by required check)
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,
    // JWT & Sessions (jwtSecret is guaranteed by required check)
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshTokenExpires: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    // Email Verification
    emailVerificationExpires: 24 * 60 * 60 * 1000, // 24 hours in ms
    emailVerificationSecret: (process.env.EMAIL_VERIFICATION_SECRET || process.env.JWT_SECRET),
    // Password Reset
    passwordResetExpires: 1 * 60 * 60 * 1000, // 1 hour in ms
    passwordResetSecret: (process.env.PASSWORD_RESET_SECRET || process.env.JWT_SECRET),
    // Reminder Settings
    reminderTime: 12 * 60 * 60 * 1000, // 12 hours in ms
    // SMTP / Email
    smtp: {
        host: ensureString(process.env.SMTP_HOST, 'smtp.resend.com'),
        port: parseNumber(process.env.SMTP_PORT, 587),
        secure: parseBoolean(process.env.SMTP_SECURE, false),
        user: ensureString(process.env.SMTP_USER, 'resend'),
        pass: process.env.SMTP_PASS || '',
        fromEmail: ensureString(process.env.SMTP_FROM_EMAIL, 'no-reply@getkeja.online'),
        fromName: ensureString(process.env.SMTP_FROM_NAME, 'Getkeja'),
    },
    // Frontend
    frontendUrl: ensureString(process.env.FRONTEND_URL, 'http://localhost:5174'),
    // API URL (for links in emails)
    apiUrl: process.env.API_URL || `http://localhost:${process.env.PORT || 8000}`,
    // Rate Limiting
    rateLimit: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // Limit each IP to 100 requests per windowMs
    },
    // Security
    cors: {
        origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5174'],
        credentials: true,
    },
    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',
};
// Validate that all secret values are strings and have minimum length
const validateSecrets = () => {
    const secrets = {
        jwtSecret: environment.jwtSecret,
        emailVerificationSecret: environment.emailVerificationSecret,
        passwordResetSecret: environment.passwordResetSecret,
    };
    for (const [key, value] of Object.entries(secrets)) {
        if (typeof value !== 'string') {
            throw new Error(`${key} must be a string`);
        }
        if (value.length < 32) {
            console.warn(`⚠️ ${key} should be at least 32 characters long for security (current length: ${value.length})`);
        }
    }
};
// Run validation
validateSecrets();
// Create a typed version of the environment
export const env = environment;
// Log environment info in development
if (env.isDevelopment) {
    console.log('🚀 Environment loaded:', {
        nodeEnv: env.nodeEnv,
        port: env.port,
        frontendUrl: env.frontendUrl,
        apiUrl: env.apiUrl,
        emailVerificationExpires: `${env.emailVerificationExpires / (60 * 60 * 1000)} hours`,
        passwordResetExpires: `${env.passwordResetExpires / (60 * 60 * 1000)} hours`,
        reminderTime: `${env.reminderTime / (60 * 60 * 1000)} hours`,
        jwtSecret: '✓',
        emailVerificationSecret: env.emailVerificationSecret === env.jwtSecret ? 'using JWT_SECRET' : '✓',
        passwordResetSecret: env.passwordResetSecret === env.jwtSecret ? 'using JWT_SECRET' : '✓',
    });
}
