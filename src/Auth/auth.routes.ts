import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  refreshTokenSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../types/auth.types.js';

const authRouter = new Hono();
const authService = new AuthService();
const authController = new AuthController(authService);

// Public routes
authRouter.post('/register', zValidator('json', registerSchema), (c) => authController.register(c));
authRouter.post('/login', zValidator('json', loginSchema), (c) => authController.login(c));
authRouter.get('/verify-email', (c) => authController.verifyEmail(c));
authRouter.post('/resend-verification', zValidator('json', resendVerificationSchema), (c) => authController.resendVerification(c));
authRouter.post('/refresh-token', zValidator('json', refreshTokenSchema), (c) => authController.refreshToken(c));
authRouter.post('/forgot-password', zValidator('json', forgotPasswordSchema), (c) => authController.forgotPassword(c));
authRouter.post('/reset-password', zValidator('json', resetPasswordSchema), (c) => authController.resetPassword(c));

// Protected routes
authRouter.post('/change-password', authenticate, zValidator('json', changePasswordSchema), (c) => authController.changePassword(c));
authRouter.post('/logout', authenticate, (c) => authController.logout(c));
authRouter.get('/profile', authenticate, (c) => authController.getProfile(c));

// Session management
authRouter.get('/sessions', authenticate, (c) => authController.getActiveSessions(c));
authRouter.post('/logout-others', authenticate, zValidator('json', refreshTokenSchema), (c) => authController.logoutOthers(c));
authRouter.delete('/sessions/:sessionId', authenticate, (c) => authController.revokeSession(c));

export { authRouter };