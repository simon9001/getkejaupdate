/**
 * auth.router.ts
 *
 * Changes from original:
 *  - Rate limiting applied to every public route (Fix #2)
 *    · register:             5 / 15 min per IP, per-email
 *    · login:               10 / 15 min per IP
 *    · resend-verification:  3 / 10 min per IP, per-email  (Fix #6)
 *    · forgot-password:      5 / 15 min per IP, per-email
 *    · refresh-token:       20 / 15 min per IP
 *    · reset-password:       5 / 15 min per IP
 *    · verify-email:        10 / 15 min per IP
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { rateLimit } from '../middleware/rateLimiter.js';
import { registerSchema, loginSchema, changePasswordSchema, refreshTokenSchema, resendVerificationSchema, forgotPasswordSchema, resetPasswordSchema, } from '../types/auth.types.js';
const authRouter = new Hono();
const authService = new AuthService();
const authController = new AuthController(authService);
// ---------------------------------------------------------------------------
// Shared rate-limit presets
// ---------------------------------------------------------------------------
const WINDOW_15M = 15 * 60_000;
const WINDOW_10M = 10 * 60_000;
// ---------------------------------------------------------------------------
// Public routes — no JWT required
// ---------------------------------------------------------------------------
authRouter.post('/register', rateLimit({ windowMs: WINDOW_15M, max: 5, limitByEmail: true }), zValidator('json', registerSchema), (c) => authController.register(c));
authRouter.post('/login', rateLimit({ windowMs: WINDOW_15M, max: 10 }), zValidator('json', loginSchema), (c) => authController.login(c));
authRouter.get('/verify-email', rateLimit({ windowMs: WINDOW_15M, max: 10 }), (c) => authController.verifyEmail(c));
// Fix #6: tight limit + per-email to prevent email-bombing
authRouter.post('/resend-verification', rateLimit({ windowMs: WINDOW_10M, max: 3, limitByEmail: true }), zValidator('json', resendVerificationSchema), (c) => authController.resendVerification(c));
authRouter.post('/refresh-token', rateLimit({ windowMs: WINDOW_15M, max: 20 }), zValidator('json', refreshTokenSchema), (c) => authController.refreshToken(c));
authRouter.post('/forgot-password', rateLimit({ windowMs: WINDOW_15M, max: 5, limitByEmail: true }), zValidator('json', forgotPasswordSchema), (c) => authController.forgotPassword(c));
authRouter.post('/reset-password', rateLimit({ windowMs: WINDOW_15M, max: 5 }), zValidator('json', resetPasswordSchema), (c) => authController.resetPassword(c));
// ---------------------------------------------------------------------------
// Google OAuth routes — public (Google redirects here, no JWT)
// ---------------------------------------------------------------------------
authRouter.get('/google', (c) => authController.googleSignIn(c));
authRouter.get('/google/callback', (c) => authController.googleCallback(c));
// ---------------------------------------------------------------------------
// Protected routes — JWT required
// ---------------------------------------------------------------------------
authRouter.post('/logout', authenticate, (c) => authController.logout(c));
authRouter.post('/change-password', authenticate, zValidator('json', changePasswordSchema), (c) => authController.changePassword(c));
authRouter.get('/profile', authenticate, (c) => authController.getProfile(c));
// Session management
authRouter.get('/sessions', authenticate, (c) => authController.getActiveSessions(c));
authRouter.post('/logout-others', authenticate, zValidator('json', refreshTokenSchema), (c) => authController.logoutOthers(c));
authRouter.delete('/sessions/:sessionId', authenticate, (c) => authController.revokeSession(c));
export { authRouter };
