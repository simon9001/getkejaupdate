import type { Context } from 'hono';
import { env } from '../config/environment.js';
import type { AuthService } from './auth.service.js';
import {
  isAuthError,
  isRefreshError,
  isServiceError,
  isLogoutOthersError,
} from '../types/auth.types.js';
import type {
  RegisterInput,
  LoginInput,
  ChangePasswordInput,
  RefreshTokenInput,
  ResendVerificationInput,
  LogoutInput,
} from '../types/auth.types.js';

export class AuthController {
  constructor(private authService: AuthService) {}

  // -------------------------------------------------------------------------
  // POST /auth/register
  // -------------------------------------------------------------------------
  async register(c: Context) {
    try {
      const body = (await c.req.json()) as RegisterInput;
      const result = await this.authService.register(body);

      if (isServiceError(result)) {
        return c.json({ message: result.error, code: result.code }, 400);
      }

      return c.json(
        {
          message: 'Registration successful. Please check your email to verify your account.',
          user: result.user,
          code: 'REGISTRATION_SUCCESS',
        },
        201,
      );
    } catch (error) {
      console.error('Registration error:', error);
      return c.json({ message: 'Registration failed', code: 'SERVER_ERROR' }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // POST /auth/login
  // -------------------------------------------------------------------------
  async login(c: Context) {
    try {
      const body = (await c.req.json()) as LoginInput;
      const userAgent = c.req.header('user-agent') || 'unknown';
      const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');

      const result = await this.authService.login(body, userAgent, ipAddress);

      if (isAuthError(result)) {
        const status = result.code === 'EMAIL_NOT_VERIFIED' ? 403 : 401;
        return c.json(
          { message: result.error, code: result.code, userId: result.userId, canResend: result.canResend },
          status as any,
        );
      }

      // result is AuthSuccess here — TypeScript knows user, accessToken, refreshToken exist
      return c.json({
        message: 'Login successful',
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        code: 'LOGIN_SUCCESS',
      });
    } catch (error) {
      console.error('Login error:', error);
      return c.json({ message: 'Login failed', code: 'SERVER_ERROR' }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // GET /auth/google
  // -------------------------------------------------------------------------
  async googleSignIn(c: Context) {
    try {
      const url = this.authService.getGoogleAuthUrl();
      return c.redirect(url);
    } catch (error) {
      console.error('Google sign-in error:', error);
      return c.json({ message: 'Failed to initiate Google sign-in', code: 'SERVER_ERROR' }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // GET /auth/google/callback
  // -------------------------------------------------------------------------
  async googleCallback(c: Context) {
    try {
      const code = c.req.query('code');
      const error = c.req.query('error');

      if (error || !code) {
        return c.redirect(`${env.frontendUrl}/auth/callback?error=access_denied`);
      }

      const userAgent = c.req.header('user-agent') || 'unknown';
      const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');

      const result = await this.authService.handleGoogleCallback(code, userAgent, ipAddress);

      if (isAuthError(result)) {
        return c.redirect(
          `${env.frontendUrl}/auth/callback?error=${encodeURIComponent(result.code)}`,
        );
      }

      // result is AuthSuccess — all fields safely accessible
      const params = new URLSearchParams({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        provider: 'google',
      });

      return c.redirect(`${env.frontendUrl}/auth/callback?${params.toString()}`);
    } catch (error) {
      console.error('Google callback error:', error);
      return c.redirect(`${env.frontendUrl}/auth/callback?error=server_error`);
    }
  }

  // -------------------------------------------------------------------------
  // GET /auth/verify-email?token=…
  // -------------------------------------------------------------------------
  async verifyEmail(c: Context) {
    try {
      const token = c.req.query('token');

      if (!token) {
        return c.json({ message: 'Verification token is required', code: 'MISSING_TOKEN' }, 400);
      }

      const result = await this.authService.verifyEmail(token);

      if (isServiceError(result)) {
        return c.json({ message: result.error, code: result.code }, 400);
      }

      return c.json({ message: result.message ?? 'Email verified successfully', code: result.code ?? 'VERIFICATION_SUCCESS' });
    } catch (error) {
      console.error('Email verification error:', error);
      return c.json({ message: 'Verification failed', code: 'SERVER_ERROR' }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // POST /auth/resend-verification
  // -------------------------------------------------------------------------
  async resendVerification(c: Context) {
    try {
      const { email } = (await c.req.json()) as ResendVerificationInput;

      if (!email) {
        return c.json({ message: 'Email is required', code: 'MISSING_EMAIL' }, 400);
      }

      await this.authService.resendVerification(email);

      return c.json({
        message: 'If an account exists with that email, a new verification link has been sent.',
        code: 'RESEND_SUCCESS',
      });
    } catch (error) {
      console.error('Resend verification error:', error);
      return c.json({ message: 'Failed to resend verification', code: 'SERVER_ERROR' }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // POST /auth/refresh-token
  // -------------------------------------------------------------------------
  async refreshToken(c: Context) {
    try {
      const { refreshToken } = (await c.req.json()) as RefreshTokenInput;

      if (!refreshToken) {
        return c.json({ message: 'Refresh token is required', code: 'MISSING_TOKEN' }, 400);
      }

      const result = await this.authService.refreshToken(refreshToken);

      if (isRefreshError(result)) {
        return c.json({ message: result.error, code: result.code }, 401);
      }

      // result is RefreshSuccess — accessToken and refreshToken safely accessible
      return c.json({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        code: 'TOKEN_REFRESHED',
      });
    } catch (error) {
      console.error('Token refresh error:', error);
      return c.json({ message: 'Token refresh failed', code: 'SERVER_ERROR' }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // POST /auth/forgot-password
  // -------------------------------------------------------------------------
  async forgotPassword(c: Context) {
    try {
      const { email } = (await c.req.json()) as { email: string };

      if (!email) {
        return c.json({ message: 'Email is required', code: 'MISSING_EMAIL' }, 400);
      }

      await this.authService.forgotPassword(email);

      return c.json({
        message: 'If an account exists with that email, a password reset link has been sent.',
        code: 'FORGOT_PASSWORD_SUCCESS',
      });
    } catch (error) {
      console.error('Forgot password error:', error);
      return c.json({ message: 'Failed to request password reset', code: 'SERVER_ERROR' }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // POST /auth/reset-password
  // -------------------------------------------------------------------------
  async resetPassword(c: Context) {
    try {
      const { token, password } = (await c.req.json()) as { token: string; password: string };

      if (!token || !password) {
        return c.json({ message: 'Token and new password are required', code: 'MISSING_DATA' }, 400);
      }

      const result = await this.authService.resetPassword(token, password);

      if (isServiceError(result)) {
        return c.json({ message: result.error, code: result.code }, 400);
      }

      return c.json({
        message: 'Password reset successfully. You can now sign in with your new password.',
        code: 'RESET_PASSWORD_SUCCESS',
      });
    } catch (error) {
      console.error('Reset password error:', error);
      return c.json({ message: 'Failed to reset password', code: 'SERVER_ERROR' }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // POST /auth/change-password  (authenticated)
  // -------------------------------------------------------------------------
  async changePassword(c: Context) {
    try {
      const body = (await c.req.json()) as ChangePasswordInput;
      const user = c.get('user');
      const userAgent = c.req.header('user-agent');
      const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');

      const result = await this.authService.changePassword(
        user.userId,
        body.currentPassword,
        body.newPassword,
        userAgent,
        ipAddress,
      );

      if (isServiceError(result)) {
        return c.json({ message: result.error, code: result.code }, 400);
      }

      return c.json({ message: 'Password changed successfully', code: 'PASSWORD_CHANGED' });
    } catch (error) {
      console.error('Password change error:', error);
      return c.json({ message: 'Failed to change password', code: 'SERVER_ERROR' }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // POST /auth/logout  (authenticated)
  // -------------------------------------------------------------------------
  async logout(c: Context) {
    try {
      const body = (await c.req.json().catch(() => ({}))) as LogoutInput;
      const { refreshToken, logoutAll = false } = body;
      const user = c.get('user');
      const userAgent = c.req.header('user-agent');
      const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');

      const result = await this.authService.logout(user.userId, refreshToken, logoutAll, userAgent, ipAddress);

      if (isServiceError(result)) {
        return c.json({ message: result.error, code: result.code }, 400);
      }

      return c.json({
        message: logoutAll ? 'Logged out from all devices' : 'Logged out successfully',
        code: result.code,
      });
    } catch (error) {
      console.error('Logout error:', error);
      return c.json({ message: 'Logout failed', code: 'SERVER_ERROR' }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // POST /auth/logout-others  (authenticated)
  // -------------------------------------------------------------------------
  async logoutOthers(c: Context) {
    try {
      const body = (await c.req.json()) as RefreshTokenInput;
      const user = c.get('user');
      const userAgent = c.req.header('user-agent');
      const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');

      const result = await this.authService.logoutOthers(user.userId, body.refreshToken, userAgent, ipAddress);

      if (isLogoutOthersError(result)) {
        return c.json({ message: result.error, code: result.code }, 400);
      }

      // result is LogoutOthersSuccess — devicesLoggedOut safely accessible
      return c.json({
        message: `Logged out from ${result.devicesLoggedOut} other device(s)`,
        code: 'LOGOUT_OTHERS_SUCCESS',
        devicesLoggedOut: result.devicesLoggedOut,
      });
    } catch (error) {
      console.error('Logout others error:', error);
      return c.json({ message: 'Failed to logout from other devices', code: 'SERVER_ERROR' }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // GET /auth/sessions  (authenticated)
  // -------------------------------------------------------------------------
  async getActiveSessions(c: Context) {
    try {
      const user = c.get('user');
      const sessions = await this.authService.getActiveSessions(user.userId);
      return c.json({ sessions, total: sessions.length, code: 'SESSIONS_FETCHED' });
    } catch (error) {
      console.error('Get active sessions error:', error);
      return c.json({ message: 'Failed to fetch sessions', code: 'SERVER_ERROR' }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // DELETE /auth/sessions/:sessionId  (authenticated)
  // -------------------------------------------------------------------------
  async revokeSession(c: Context) {
    try {
      const sessionId = c.req.param('sessionId');
      const user = c.get('user');
      const userAgent = c.req.header('user-agent');
      const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');

      const result = await this.authService.revokeSession(user.userId, sessionId, userAgent, ipAddress);

      if (isServiceError(result)) {
        return c.json({ message: result.error, code: result.code }, 404);
      }

      return c.json({ message: 'Session revoked', code: 'SESSION_REVOKED' });
    } catch (error) {
      console.error('Revoke session error:', error);
      return c.json({ message: 'Failed to revoke session', code: 'SERVER_ERROR' }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // GET /auth/profile  (authenticated)
  // -------------------------------------------------------------------------
  async getProfile(c: Context) {
    try {
      const user = c.get('user');
      const profile = await this.authService.getProfile(user.userId);
      return c.json({ user: profile, code: 'PROFILE_FETCHED' });
    } catch (error) {
      console.error('Profile fetch error:', error);
      return c.json({ message: 'Failed to fetch profile', code: 'SERVER_ERROR' }, 500);
    }
  }
}