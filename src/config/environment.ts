import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

// ---------------------------------------------------------------------------
// Required env vars — app will not start if any are missing
// ---------------------------------------------------------------------------
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'JWT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean =>
  value === undefined ? defaultValue : value.toLowerCase() === 'true';

const parseNumber = (value: string | undefined, defaultValue: number): number => {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

const ensureString = (value: string | undefined, fallback: string): string =>
  value || fallback;

// ---------------------------------------------------------------------------
// Environment object
// ---------------------------------------------------------------------------
const environment = {
  // Server
  port:          parseNumber(process.env.PORT, 8000),
  nodeEnv:       process.env.NODE_ENV || 'development',
  isProduction:  process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development',
  isTest:        process.env.NODE_ENV === 'test',

  // Supabase
  supabaseUrl:        process.env.SUPABASE_URL!,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,

  // JWT & sessions
  jwtSecret:             process.env.JWT_SECRET!,
  jwtExpiresIn:          process.env.JWT_EXPIRES_IN || '15m',
  refreshTokenExpires:   7 * 24 * 60 * 60 * 1000,   // 7 days ms

  // Email verification
  emailVerificationExpires: 24 * 60 * 60 * 1000,    // 24 hours ms
  emailVerificationSecret:  (process.env.EMAIL_VERIFICATION_SECRET || process.env.JWT_SECRET)!,

  // Password reset
  passwordResetExpires: 1 * 60 * 60 * 1000,         // 1 hour ms
  passwordResetSecret:  (process.env.PASSWORD_RESET_SECRET || process.env.JWT_SECRET)!,

  // Google OAuth  ← NEW
  google: {
    clientId:     process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri:  process.env.GOOGLE_REDIRECT_URI!,
  },

  // SMTP / email
  smtp: {
    host:      ensureString(process.env.SMTP_HOST, 'smtp.resend.com'),
    port:      parseNumber(process.env.SMTP_PORT, 587),
    secure:    parseBoolean(process.env.SMTP_SECURE, false),
    user:      ensureString(process.env.SMTP_USER, 'resend'),
    pass:      process.env.SMTP_PASS || '',
    fromEmail: ensureString(process.env.SMTP_FROM_EMAIL, 'no-reply@getkeja.online'),
    fromName:  ensureString(process.env.SMTP_FROM_NAME, 'GetKeja'),
  },

  // Frontend (for email links & OAuth redirects)
  frontendUrl: ensureString(process.env.FRONTEND_URL, 'http://localhost:5174'),
  apiUrl:      process.env.API_URL || `http://localhost:${process.env.PORT || 8000}`,

  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max:      100,
  },

  // CORS
  cors: {
    origin:      process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5174'],
    credentials: true,
  },

  // Cloudinary
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey:    process.env.CLOUDINARY_API_KEY    || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
} as const;

// ---------------------------------------------------------------------------
// Secret length validation
// ---------------------------------------------------------------------------
const validateSecrets = () => {
  const secrets: Record<string, string> = {
    jwtSecret:             environment.jwtSecret,
    emailVerificationSecret: environment.emailVerificationSecret,
    passwordResetSecret:   environment.passwordResetSecret,
    googleClientSecret:    environment.google.clientSecret,
  };

  for (const [key, value] of Object.entries(secrets)) {
    if (typeof value !== 'string') throw new Error(`${key} must be a string`);
    if (value.length < 16) {
      console.warn(`⚠️  ${key} looks very short (${value.length} chars) — double-check your .env`);
    }
  }
};

validateSecrets();

export const env = environment;
export type Env = typeof environment;

// ---------------------------------------------------------------------------
// Dev logging
// ---------------------------------------------------------------------------
if (environment.isDevelopment) {
  console.log('🚀 Environment loaded:', {
    nodeEnv:                 environment.nodeEnv,
    port:                    environment.port,
    frontendUrl:             environment.frontendUrl,
    googleRedirectUri:       environment.google.redirectUri,
    emailVerificationExpires: `${environment.emailVerificationExpires / 3_600_000}h`,
    passwordResetExpires:    `${environment.passwordResetExpires / 3_600_000}h`,
    jwtSecret:               '✓',
    googleClientId:          environment.google.clientId ? '✓' : '✗ MISSING',
  });
}