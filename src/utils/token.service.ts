// backend/src/utils/token.service.ts
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/environment.js';
import type { UserWithRoles, UserRole } from '../types/auth.types.js';

export interface TokenPayload {
  userId: string;
  email: string;
  roles: UserRole[];
}

export interface EmailVerificationPayload {
  userId: string;
  email: string;
  type: 'email-verification';
}

export interface PasswordResetPayload {
  userId: string;
  email: string;
  type: 'password-reset';
}

// Custom error classes for better error handling
export class TokenError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'TokenError';
  }
}

export class TokenExpiredError extends TokenError {
  constructor(message: string = 'Token has expired') {
    super(message, 'TOKEN_EXPIRED');
    this.name = 'TokenExpiredError';
  }
}

export class TokenInvalidError extends TokenError {
  constructor(message: string = 'Invalid token') {
    super(message, 'TOKEN_INVALID');
    this.name = 'TokenInvalidError';
  }
}

export class TokenService {
  private getEmailVerificationSecret(): string {
    const secret = env.emailVerificationSecret || env.jwtSecret;
    if (!secret) {
      throw new TokenError(
        'Email verification secret not configured. Please set EMAIL_VERIFICATION_SECRET or JWT_SECRET in environment variables.',
        'MISSING_EMAIL_SECRET'
      );
    }
    return secret;
  }

  private getPasswordResetSecret(): string {
    const secret = env.passwordResetSecret || env.jwtSecret;
    if (!secret) {
      throw new TokenError(
        'Password reset secret not configured. Please set PASSWORD_RESET_SECRET or JWT_SECRET in environment variables.',
        'MISSING_PASSWORD_SECRET'
      );
    }
    return secret;
  }

  private validateJwtSecret(): void {
    if (!env.jwtSecret) {
      throw new TokenError(
        'JWT secret not configured. Please set JWT_SECRET in environment variables.',
        'MISSING_JWT_SECRET'
      );
    }
  }

  // Access Token Methods
  generateAccessToken(user: UserWithRoles): string {
    this.validateJwtSecret();
    
    const payload: TokenPayload = { 
      userId: user.id, 
      email: user.email,
      roles: user.roles 
    };
    
    return jwt.sign(
      payload,
      env.jwtSecret,
      { 
        expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
        algorithm: 'HS256',
        issuer: 'getkeja-api',
        audience: 'getkeja-client'
      }
    );
  }

  verifyAccessToken(token: string): TokenPayload {
    this.validateJwtSecret();

    try {
      const decoded = jwt.verify(token, env.jwtSecret, {
        algorithms: ['HS256'],
        issuer: 'getkeja-api',
        audience: 'getkeja-client'
      }) as TokenPayload;
      
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new TokenExpiredError('Access token has expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new TokenInvalidError('Invalid access token');
      } else {
        throw new TokenInvalidError('Token verification failed');
      }
    }
  }

  decodeAccessToken(token: string): TokenPayload | null {
    try {
      const decoded = jwt.decode(token) as TokenPayload;
      return decoded || null;
    } catch (error) {
      return null;
    }
  }

  // Refresh Token Methods
  generateRefreshToken(): string {
    return crypto.randomBytes(40).toString('hex');
  }

  getRefreshTokenExpiry(): Date {
    return new Date(Date.now() + env.refreshTokenExpires);
  }

  // Email Verification Token Methods
  generateEmailVerificationToken(userId: string, email: string): string {
    const secret = this.getEmailVerificationSecret();
    
    const payload: EmailVerificationPayload = {
      userId,
      email,
      type: 'email-verification'
    };

    // Calculate expiration in seconds and convert to string with 's' suffix
    const expiresInSeconds = Math.floor(env.emailVerificationExpires / 1000);
    const expiresIn = `${expiresInSeconds}s`;

    return jwt.sign(
      payload,
      secret,
      {
        expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
        algorithm: 'HS256',
        issuer: 'getkeja-api'
      }
    );
  }

  verifyEmailVerificationToken(token: string): EmailVerificationPayload {
    const secret = this.getEmailVerificationSecret();

    try {
      const decoded = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: 'getkeja-api'
      }) as EmailVerificationPayload;

      if (decoded.type !== 'email-verification') {
        throw new TokenInvalidError('Invalid token type');
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new TokenExpiredError('Email verification token has expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new TokenInvalidError('Invalid email verification token');
      } else if (error instanceof TokenError) {
        throw error;
      } else {
        throw new TokenInvalidError('Email verification failed');
      }
    }
  }

  // Password Reset Token Methods
  generatePasswordResetToken(userId: string, email: string): string {
    const secret = this.getPasswordResetSecret();
    
    const payload: PasswordResetPayload = {
      userId,
      email,
      type: 'password-reset'
    };

    // Calculate expiration in seconds and convert to string with 's' suffix
    const expiresInSeconds = Math.floor(env.passwordResetExpires / 1000);
    const expiresIn = `${expiresInSeconds}s`;

    return jwt.sign(
      payload,
      secret,
      {
        expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
        algorithm: 'HS256',
        issuer: 'getkeja-api'
      }
    );
  }

  verifyPasswordResetToken(token: string): PasswordResetPayload {
    const secret = this.getPasswordResetSecret();

    try {
      const decoded = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: 'getkeja-api'
      }) as PasswordResetPayload;

      if (decoded.type !== 'password-reset') {
        throw new TokenInvalidError('Invalid token type');
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new TokenExpiredError('Password reset token has expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new TokenInvalidError('Invalid password reset token');
      } else if (error instanceof TokenError) {
        throw error;
      } else {
        throw new TokenInvalidError('Password reset verification failed');
      }
    }
  }

  // Legacy hash token method (for backward compatibility)
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // Generate a secure random token (for refresh tokens, etc.)
  generateSecureToken(bytes: number = 32): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  // Generate a numeric OTP (for future use)
  generateOTP(length: number = 6): string {
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
  getTokenExpirationTime(token: string): number | null {
    try {
      const decoded = jwt.decode(token) as any;
      if (decoded && decoded.exp) {
        return decoded.exp * 1000; // Convert seconds to milliseconds
      }
      return null;
    } catch {
      return null;
    }
  }

  // Check if token is expired
  isTokenExpired(token: string): boolean {
    const expTime = this.getTokenExpirationTime(token);
    if (!expTime) return true;
    return Date.now() >= expTime;
  }

  // Get remaining time for token in milliseconds
  getTokenRemainingTime(token: string): number {
    const expTime = this.getTokenExpirationTime(token);
    if (!expTime) return 0;
    return Math.max(0, expTime - Date.now());
  }

  // Validate token without throwing (returns boolean)
  validateToken(token: string, type: 'access' | 'email' | 'password'): boolean {
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
    } catch {
      return false;
    }
  }
}

export const tokenService = new TokenService();