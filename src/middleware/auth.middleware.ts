import type { Context, Next } from 'hono';
import { tokenService } from '../utils/token.service.js';
import { supabaseAdmin } from '../utils/supabase.js';

export interface AuthUser {
  userId: string;
  email: string;
  roles: string[];
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

export const authenticate = async (c: Context, next: Next) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ message: 'No token provided' }, 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = tokenService.verifyAccessToken(token);

    if (!decoded) {
      return c.json({ message: 'Invalid or expired token' }, 401);
    }

    // Check if email is verified using Supabase Admin
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('email_verified')
      .eq('id', decoded.userId)
      .single();

    if (error || !profile) {
      return c.json({ message: 'User not found' }, 401);
    }

    if (!profile.email_verified) {
      return c.json({
        message: 'Email not verified. Please verify your email before proceeding.',
        code: 'EMAIL_NOT_VERIFIED'
      }, 403);
    }

    c.set('user', {
      userId: decoded.userId,
      email: decoded.email,
      roles: decoded.roles || []
    });

    await next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return c.json({ message: 'Authentication failed' }, 401);
  }
};

export const requireRoles = (...roles: string[]) => {
  return async (c: Context, next: Next) => {
    const user = c.get('user');

    if (!user || !user.roles) {
      return c.json({ message: 'No roles found' }, 403);
    }

    const hasRequiredRole = roles.some(role => user.roles.includes(role));

    if (!hasRequiredRole) {
      return c.json({ message: 'Insufficient permissions' }, 403);
    }

    await next();
  };
};