// backend/src/utils/token.service.ts
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/environment.js';
// Custom error classes for better error handling
export class TokenError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'TokenError';
    }
}
export class TokenExpiredError extends TokenError {
    constructor(message = 'Token has expired') {
        super(message, 'TOKEN_EXPIRED');
        this.name = 'TokenExpiredError';
    }
}
export class TokenInvalidError extends TokenError {
    constructor(message = 'Invalid token') {
        super(message, 'TOKEN_INVALID');
        this.name = 'TokenInvalidError';
    }
}
export class TokenService {
    getEmailVerificationSecret() {
        const secret = env.emailVerificationSecret || env.jwtSecret;
        if (!secret) {
            throw new TokenError('Email verification secret not configured. Please set EMAIL_VERIFICATION_SECRET or JWT_SECRET in environment variables.', 'MISSING_EMAIL_SECRET');
        }
        return secret;
    }
    getPasswordResetSecret() {
        const secret = env.passwordResetSecret || env.jwtSecret;
        if (!secret) {
            throw new TokenError('Password reset secret not configured. Please set PASSWORD_RESET_SECRET or JWT_SECRET in environment variables.', 'MISSING_PASSWORD_SECRET');
        }
        return secret;
    }
    validateJwtSecret() {
        if (!env.jwtSecret) {
            throw new TokenError('JWT secret not configured. Please set JWT_SECRET in environment variables.', 'MISSING_JWT_SECRET');
        }
    }
    // Access Token Methods
    generateAccessToken(user) {
        this.validateJwtSecret();
        const payload = {
            userId: user.userId,
            email: user.email,
            roles: user.roles
        };
        return jwt.sign(payload, env.jwtSecret, {
            expiresIn: env.jwtExpiresIn,
            algorithm: 'HS256',
            issuer: 'getkeja-api',
            audience: 'getkeja-client'
        });
    }
    verifyAccessToken(token) {
        this.validateJwtSecret();
        try {
            const decoded = jwt.verify(token, env.jwtSecret, {
                algorithms: ['HS256'],
                issuer: 'getkeja-api',
                audience: 'getkeja-client'
            });
            return decoded;
        }
        catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new TokenExpiredError('Access token has expired');
            }
            else if (error instanceof jwt.JsonWebTokenError) {
                throw new TokenInvalidError('Invalid access token');
            }
            else {
                throw new TokenInvalidError('Token verification failed');
            }
        }
    }
    decodeAccessToken(token) {
        try {
            const decoded = jwt.decode(token);
            return decoded || null;
        }
        catch (error) {
            return null;
        }
    }
    // Refresh Token Methods
    generateRefreshToken() {
        return crypto.randomBytes(40).toString('hex');
    }
    getRefreshTokenExpiry() {
        return new Date(Date.now() + env.refreshTokenExpires);
    }
    // Email Verification Token Methods
    generateEmailVerificationToken(userId, email) {
        const secret = this.getEmailVerificationSecret();
        const payload = {
            userId,
            email,
            type: 'email-verification'
        };
        // Calculate expiration in seconds and convert to string with 's' suffix
        const expiresInSeconds = Math.floor(env.emailVerificationExpires / 1000);
        const expiresIn = `${expiresInSeconds}s`;
        return jwt.sign(payload, secret, {
            expiresIn: expiresIn,
            algorithm: 'HS256',
            issuer: 'getkeja-api'
        });
    }
    verifyEmailVerificationToken(token) {
        const secret = this.getEmailVerificationSecret();
        try {
            const decoded = jwt.verify(token, secret, {
                algorithms: ['HS256'],
                issuer: 'getkeja-api'
            });
            if (decoded.type !== 'email-verification') {
                throw new TokenInvalidError('Invalid token type');
            }
            return decoded;
        }
        catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new TokenExpiredError('Email verification token has expired');
            }
            else if (error instanceof jwt.JsonWebTokenError) {
                throw new TokenInvalidError('Invalid email verification token');
            }
            else if (error instanceof TokenError) {
                throw error;
            }
            else {
                throw new TokenInvalidError('Email verification failed');
            }
        }
    }
    // Password Reset Token Methods
    generatePasswordResetToken(userId, email) {
        const secret = this.getPasswordResetSecret();
        const payload = {
            userId,
            email,
            type: 'password-reset'
        };
        // Calculate expiration in seconds and convert to string with 's' suffix
        const expiresInSeconds = Math.floor(env.passwordResetExpires / 1000);
        const expiresIn = `${expiresInSeconds}s`;
        return jwt.sign(payload, secret, {
            expiresIn: expiresIn,
            algorithm: 'HS256',
            issuer: 'getkeja-api'
        });
    }
    verifyPasswordResetToken(token) {
        const secret = this.getPasswordResetSecret();
        try {
            const decoded = jwt.verify(token, secret, {
                algorithms: ['HS256'],
                issuer: 'getkeja-api'
            });
            if (decoded.type !== 'password-reset') {
                throw new TokenInvalidError('Invalid token type');
            }
            return decoded;
        }
        catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new TokenExpiredError('Password reset token has expired');
            }
            else if (error instanceof jwt.JsonWebTokenError) {
                throw new TokenInvalidError('Invalid password reset token');
            }
            else if (error instanceof TokenError) {
                throw error;
            }
            else {
                throw new TokenInvalidError('Password reset verification failed');
            }
        }
    }
    // Legacy hash token method (for backward compatibility)
    hashToken(token) {
        return crypto.createHash('sha256').update(token).digest('hex');
    }
    // Generate a secure random token (for refresh tokens, etc.)
    generateSecureToken(bytes = 32) {
        return crypto.randomBytes(bytes).toString('hex');
    }
    // Generate a numeric OTP (for future use)
    generateOTP(length = 6) {
        const digits = '0123456789';
        let otp = '';
        // Use crypto for secure random numbers
        const randomBytes = crypto.randomBytes(length);
        for (let i = 0; i < length; i++) {
            const randomIndex = randomBytes[i] % digits.length;
            otp += digits[randomIndex];
        }
        return otp;
    }
    // Get token expiration time in milliseconds
    getTokenExpirationTime(token) {
        try {
            const decoded = jwt.decode(token);
            if (decoded && decoded.exp) {
                return decoded.exp * 1000; // Convert seconds to milliseconds
            }
            return null;
        }
        catch {
            return null;
        }
    }
    // Check if token is expired
    isTokenExpired(token) {
        const expTime = this.getTokenExpirationTime(token);
        if (!expTime)
            return true;
        return Date.now() >= expTime;
    }
    // Get remaining time for token in milliseconds
    getTokenRemainingTime(token) {
        const expTime = this.getTokenExpirationTime(token);
        if (!expTime)
            return 0;
        return Math.max(0, expTime - Date.now());
    }
    // Validate token without throwing (returns boolean)
    validateToken(token, type) {
        try {
            switch (type) {
                case 'access':
                    this.verifyAccessToken(token);
                    break;
                case 'email':
                    this.verifyEmailVerificationToken(token);
                    break;
                case 'password':
                    this.verifyPasswordResetToken(token);
                    break;
            }
            return true;
        }
        catch {
            return false;
        }
    }
}
export const tokenService = new TokenService();
