export const authConfig = {
    jwt: {
        secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
        expiresIn: '15m',
    },
    refreshToken: {
        expiresIn: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    },
    emailVerification: {
        tokenExpires: 24 * 60 * 60 * 1000, // 24 hours
    },
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    resend: {
        from: process.env.RESEND_FROM_EMAIL || 'noreply@Getkeja.online',
    },
    supabase: {
        url: process.env.SUPABASE_URL,
    }
};
