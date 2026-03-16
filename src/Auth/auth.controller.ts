import type { Context } from 'hono';
import type { AuthService } from './auth.service.js';
import type {
  RegisterInput,
  LoginInput,
  ChangePasswordInput,
  RefreshTokenInput,
  ResendVerificationInput,
  LogoutInput,
} from '../types/auth.types.js';

export class AuthController {
  constructor(private authService: AuthService) { }

  async register(c: Context) {
    try {
      const body = await c.req.json() as RegisterInput;
      const result = await this.authService.register(body);

      if (result.error) {
        return c.json({ message: result.error, code: result.code }, 400);
      }

      return c.json({
        message: 'Registration successful. Please check your email to verify your account.',
        user: result.user,
        code: 'REGISTRATION_SUCCESS'
      }, 201);
    } catch (error) {
      console.error('Registration error:', error);
      return c.json({ message: 'Registration failed', code: 'SERVER_ERROR' }, 500);
    }
  }

  async login(c: Context) {
    try {
      const body = await c.req.json() as LoginInput;
      const userAgent = c.req.header('user-agent') || 'unknown';
      const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');

      const result = await this.authService.login(body, userAgent, ipAddress);

      if (result.error) {
        const status = result.code === 'EMAIL_NOT_VERIFIED' ? 403 : 401;
        return c.json({
          message: result.error,
          code: result.code,
          userId: result.userId,
          canResend: result.canResend
        }, status as any);
      }

      return c.json({
        message: 'Login successful',
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        code: 'LOGIN_SUCCESS'
      });
    } catch (error) {
      console.error('Login error:', error);
      return c.json({ message: 'Login failed', code: 'SERVER_ERROR' }, 500);
    }
  }

  async verifyEmail(c: Context) {
    try {
      const token = c.req.query('token');

      if (!token) {
        return c.json({ message: 'Verification token is required', code: 'MISSING_TOKEN' }, 400);
      }

      const result = await this.authService.verifyEmail(token);

      if (result.error) {
        return c.json({ message: result.error, code: result.code }, 400);
      }

      return c.json({
        message: result.message || 'Email verified successfully',
        code: result.code || 'VERIFICATION_SUCCESS'
      });
    } catch (error) {
      console.error('Email verification error:', error);
      return c.json({ message: 'Verification failed', code: 'SERVER_ERROR' }, 500);
    }
  }

  async resendVerification(c: Context) {
    try {
      const { email } = await c.req.json() as ResendVerificationInput;

      if (!email) {
        return c.json({ message: 'Email is required', code: 'MISSING_EMAIL' }, 400);
      }

      const result = await this.authService.resendVerification(email);

      return c.json({
        message: 'If an account exists with that email, a new verification link has been sent.',
        code: 'RESEND_SUCCESS'
      });
    } catch (error) {
      console.error('Resend verification error:', error);
      return c.json({ message: 'Failed to resend verification', code: 'SERVER_ERROR' }, 500);
    }
  }

  async refreshToken(c: Context) {
    try {
      const { refreshToken } = await c.req.json() as RefreshTokenInput;

      if (!refreshToken) {
        return c.json({ message: 'Refresh token is required', code: 'MISSING_TOKEN' }, 400);
      }

      const result = await this.authService.refreshToken(refreshToken);

      if (result.error) {
        return c.json({ message: result.error, code: result.code }, 401);
      }

      return c.json({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        code: 'TOKEN_REFRESHED'
      });
    } catch (error) {
      console.error('Token refresh error:', error);
      return c.json({ message: 'Token refresh failed', code: 'SERVER_ERROR' }, 500);
    }
  }

  async changePassword(c: Context) {
    try {
      const body = await c.req.json() as ChangePasswordInput;
      const user = c.get('user');
      const userAgent = c.req.header('user-agent');
      const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');

      const result = await this.authService.changePassword(
        user.userId,
        body.currentPassword,
        body.newPassword,
        userAgent,
        ipAddress
      );

      if (result.error) {
        return c.json({ message: result.error, code: result.code }, 400);
      }

      return c.json({ message: 'Password changed successfully', code: 'PASSWORD_CHANGED' });
    } catch (error) {
      console.error('Password change error:', error);
      return c.json({ message: 'Failed to change password', code: 'SERVER_ERROR' }, 500);
    }
  }

  async logout(c: Context) {
    try {
      const body = await c.req.json().catch(() => ({})) as LogoutInput;
      const { refreshToken, logoutAll = false } = body;
      const user = c.get('user');
      const userAgent = c.req.header('user-agent');
      const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');

      const result = await this.authService.logout(user.userId, refreshToken, logoutAll, userAgent, ipAddress);

      if (result.error) return c.json({ message: result.error, code: result.code }, 400);

      return c.json({
        message: logoutAll ? 'Successfully logged out from all devices' : 'Logged out successfully',
        code: result.code
      });
    } catch (error) {
      console.error('Logout error:', error);
      return c.json({ message: 'Logout failed', code: 'SERVER_ERROR' }, 500);
    }
  }

  async logoutOthers(c: Context) {
    try {
      const body = await c.req.json() as RefreshTokenInput;
      const user = c.get('user');
      const userAgent = c.req.header('user-agent');
      const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');

      const result = await this.authService.logoutOthers(user.userId, body.refreshToken, userAgent, ipAddress);

      if (result.error) return c.json({ message: result.error, code: result.code }, 400);

      return c.json({
        message: `Successfully logged out from ${result.devicesLoggedOut} other devices`,
        code: 'LOGOUT_OTHERS_SUCCESS',
        devicesLoggedOut: result.devicesLoggedOut
      });
    } catch (error) {
      console.error('Logout others error:', error);
      return c.json({ message: 'Failed to logout from other devices', code: 'SERVER_ERROR' }, 500);
    }
  }

  async getActiveSessions(c: Context) {
    try {
      const user = c.get('user');
      const sessions = await this.authService.getActiveSessions(user.userId);

      return c.json({
        sessions,
        total: sessions.length,
        code: 'SESSIONS_FETCHED'
      });
    } catch (error) {
      console.error('Get active sessions error:', error);
      return c.json({ message: 'Failed to fetch active sessions', code: 'SERVER_ERROR' }, 500);
    }
  }

  async revokeSession(c: Context) {
    try {
      const sessionId = c.req.param('sessionId');
      const user = c.get('user');
      const userAgent = c.req.header('user-agent');
      const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');

      const result = await this.authService.revokeSession(user.userId, sessionId, userAgent, ipAddress);

      if (result.error) return c.json({ message: result.error, code: result.code }, 404);

      return c.json({ message: 'Session revoked successfully', code: 'SESSION_REVOKED' });
    } catch (error) {
      console.error('Revoke session error:', error);
      return c.json({ message: 'Failed to revoke session', code: 'SERVER_ERROR' }, 500);
    }
  }

  async getProfile(c: Context) {
    try {
      const user = c.get('user');
      const profile = await this.authService.getProfile(user.userId);

      return c.json({
        user: profile,
        code: 'PROFILE_FETCHED'
      });
    } catch (error) {
      console.error('Profile fetch error:', error);
      return c.json({ message: 'Failed to fetch profile', code: 'SERVER_ERROR' }, 500);
    }
  }

  async forgotPassword(c: Context) {
    try {
      const { email } = await c.req.json() as { email: string };

      if (!email) {
        return c.json({ message: 'Email is required', code: 'MISSING_EMAIL' }, 400);
      }

      const result = await this.authService.forgotPassword(email);

      return c.json({
        message: 'If an account exists with that email, a reset link has been sent.',
        code: 'FORGOT_PASSWORD_SUCCESS'
      });
    } catch (error) {
      console.error('Forgot password error:', error);
      return c.json({ message: 'Failed to request password reset', code: 'SERVER_ERROR' }, 500);
    }
  }

  async resetPassword(c: Context) {
    try {
      const { token, password } = await c.req.json() as { token: string; password: string };

      if (!token || !password) {
        return c.json({ message: 'Token and password are required', code: 'MISSING_DATA' }, 400);
      }

      const result = await this.authService.resetPassword(token, password);

      if (result.error) {
        return c.json({ message: result.error, code: result.code }, 400);
      }

      return c.json({
        message: 'Password reset successfully. You can now login with your new password.',
        code: 'RESET_PASSWORD_SUCCESS'
      });
    } catch (error) {
      console.error('Reset password error:', error);
      return c.json({ message: 'Failed to reset password', code: 'SERVER_ERROR' }, 500);
    }
  }
}