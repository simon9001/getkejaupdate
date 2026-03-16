import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../utils/supabase.js';
import { tokenService } from '../utils/token.service.js';
import { emailService } from '../utils/email.service.js';
import { env } from '../config/environment.js';
import type {
    RegisterInput,
    LoginInput,
    UserWithRoles,
    SessionInfo
} from '../types/auth.types.js';

export class AuthService {
    async register(body: RegisterInput) {
        const { full_name, email, phone, password } = body;

        const { data: existingUser, error: checkError } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('email', email)
            .maybeSingle();

        if (checkError) throw checkError;
        if (existingUser) return { error: 'Email already registered', code: 'EMAIL_EXISTS' };

        const password_hash = await bcrypt.hash(password, 10);

        const { data: user, error: createError } = await supabaseAdmin
            .from('profiles')
            .insert({
                full_name,
                email,
                phone,
                password_hash,
                email_verified: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (createError || !user) throw createError || new Error('Failed to create user');

        await supabaseAdmin
            .from('user_roles')
            .insert({ user_id: user.id, role: 'user' });

        const verificationToken = tokenService.generateEmailVerificationToken(user.id, email);
        const hashedToken = tokenService.hashToken(verificationToken);
        const expiresAt = new Date(Date.now() + env.emailVerificationExpires);

        const { error: tokenError } = await supabaseAdmin
            .from('email_verifications')
            .upsert({
                user_id: user.id,
                token: hashedToken,
                expires_at: expiresAt.toISOString(),
                verified_at: null,
                created_at: new Date().toISOString()
            }, { onConflict: 'user_id' });

        if (tokenError) throw tokenError;

        try {
            await emailService.sendVerificationEmail(email, verificationToken, full_name);
        } catch (emailError) {
            console.error('Error sending verification email:', emailError);
        }

        return { user, verificationToken };
    }

    async login(body: LoginInput, userAgent: string, ipAddress?: string) {
        const { email, password } = body;

        const { data: userBasic, error: basicError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (basicError) throw basicError;
        if (!userBasic) return { error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' };

        const validPassword = await bcrypt.compare(password, userBasic.password_hash);
        if (!validPassword) return { error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' };

        if (!userBasic.email_verified) {
            const { data: existingVerification } = await supabaseAdmin
                .from('email_verifications')
                .select('expires_at')
                .eq('user_id', userBasic.id)
                .is('verified_at', null)
                .gt('expires_at', new Date().toISOString())
                .maybeSingle();

            return {
                error: 'Please verify your email before logging in',
                code: 'EMAIL_NOT_VERIFIED',
                canResend: !existingVerification,
                userId: userBasic.id
            };
        }

        const { data: roles } = await supabaseAdmin
            .from('user_roles')
            .select('role')
            .eq('user_id', userBasic.id);

        const userWithRoles: UserWithRoles = {
            ...userBasic,
            roles: roles?.map(r => r.role) || ['user']
        };

        const accessToken = tokenService.generateAccessToken(userWithRoles);
        const refreshToken = tokenService.generateRefreshToken();
        const hashedRefreshToken = tokenService.hashToken(refreshToken);

        await supabaseAdmin
            .from('user_tokens')
            .insert({
                user_id: userBasic.id,
                token: hashedRefreshToken,
                expires_at: new Date(Date.now() + env.refreshTokenExpires).toISOString(),
                device_info: userAgent || 'unknown',
                created_at: new Date().toISOString(),
                last_used_at: new Date().toISOString()
            });

        await this.logSecurityEvent(userBasic.id, 'LOGIN_SUCCESS', userAgent, ipAddress);

        return { user: userWithRoles, accessToken, refreshToken };
    }

    async verifyEmail(token: string) {
        const hashedToken = tokenService.hashToken(token);

        const { data: verification, error: verificationError } = await supabaseAdmin
            .from('email_verifications')
            .select(`
        *,
        profile:profiles!inner(id, email, full_name, email_verified)
      `)
            .eq('token', hashedToken)
            .is('verified_at', null)
            .gt('expires_at', new Date().toISOString())
            .maybeSingle();

        if (verificationError) throw verificationError;
        if (!verification) {
            const { data: expiredToken } = await supabaseAdmin
                .from('email_verifications')
                .select('expires_at')
                .eq('token', hashedToken)
                .maybeSingle();

            return {
                error: expiredToken ? 'Token expired' : 'Invalid token',
                code: expiredToken ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
            };
        }

        if (verification.profile.email_verified) {
            return { message: 'Already verified', code: 'ALREADY_VERIFIED' };
        }

        await supabaseAdmin
            .from('profiles')
            .update({ email_verified: true, updated_at: new Date().toISOString() })
            .eq('id', verification.user_id);

        await supabaseAdmin
            .from('email_verifications')
            .update({ verified_at: new Date().toISOString() })
            .eq('id', verification.id);

        try {
            await emailService.sendWelcomeEmail(verification.profile.email, verification.profile.full_name);
        } catch (err) {
            console.error('Welcome email error:', err);
        }

        return { success: true };
    }

    async logout(userId: string, refreshToken?: string, logoutAll = false, userAgent?: string, ipAddress?: string) {
        if (logoutAll) {
            await supabaseAdmin
                .from('user_tokens')
                .delete()
                .eq('user_id', userId);
            await this.logSecurityEvent(userId, 'LOGOUT_ALL', userAgent, ipAddress);
            return { code: 'LOGOUT_ALL_SUCCESS' };
        }

        if (refreshToken) {
            const hashedToken = tokenService.hashToken(refreshToken);
            const { count } = await supabaseAdmin
                .from('user_tokens')
                .delete({ count: 'exact' })
                .eq('token', hashedToken)
                .eq('user_id', userId);

            if (count === 0) return { error: 'Invalid token', code: 'INVALID_TOKEN' };
            await this.logSecurityEvent(userId, 'LOGOUT_DEVICE', userAgent, ipAddress);
            return { code: 'LOGOUT_SUCCESS' };
        }

        await this.logSecurityEvent(userId, 'LOGOUT', userAgent, ipAddress);
        return { code: 'LOGOUT_SUCCESS' };
    }

    async logoutOthers(userId: string, currentRefreshToken: string, userAgent?: string, ipAddress?: string) {
        const hashedCurrentToken = tokenService.hashToken(currentRefreshToken);

        const { data: currentToken, error: findError } = await supabaseAdmin
            .from('user_tokens')
            .select('id')
            .eq('token', hashedCurrentToken)
            .eq('user_id', userId)
            .single();

        if (findError || !currentToken) return { error: 'Invalid refresh token', code: 'INVALID_TOKEN' };

        const { count } = await supabaseAdmin
            .from('user_tokens')
            .delete()
            .eq('user_id', userId)
            .neq('id', currentToken.id);

        await this.logSecurityEvent(userId, 'LOGOUT_OTHERS', userAgent, ipAddress, { devicesLoggedOut: count });

        try {
            const { data: userData } = await supabaseAdmin
                .from('profiles')
                .select('email, full_name')
                .eq('id', userId)
                .single();

            if (userData) {
                await emailService.sendSecurityNotification(userData.email, userData.full_name, 'OTHER_DEVICES_LOGOUT', {
                    deviceCount: count,
                    timestamp: new Date().toISOString(),
                    currentDevice: userAgent
                });
            }
        } catch (err) { console.error('Security email error:', err); }

        return { devicesLoggedOut: count || 0 };
    }

    async getActiveSessions(userId: string, currentAccessToken?: string) {
        const { data: sessions, error } = await supabaseAdmin
            .from('user_tokens')
            .select('id, device_info, created_at, expires_at, last_used_at')
            .eq('user_id', userId)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Identifying current session is tricky without storing a sessionId in access token.
        // Simplifying for now.
        const formattedSessions: SessionInfo[] = sessions.map(session => ({
            id: session.id,
            deviceInfo: session.device_info || 'Unknown device',
            createdAt: session.created_at,
            expiresAt: session.expires_at,
            lastUsedAt: session.last_used_at || session.created_at,
            isCurrentSession: false // Needs better identification logic
        }));

        return formattedSessions;
    }

    async revokeSession(userId: string, sessionId: string, userAgent?: string, ipAddress?: string) {
        const { data: session, error: fetchError } = await supabaseAdmin
            .from('user_tokens')
            .select('id, device_info')
            .eq('id', sessionId)
            .eq('user_id', userId)
            .single();

        if (fetchError || !session) return { error: 'Session not found', code: 'SESSION_NOT_FOUND' };

        await supabaseAdmin
            .from('user_tokens')
            .delete()
            .eq('id', sessionId)
            .eq('user_id', userId);

        await this.logSecurityEvent(userId, 'SESSION_REVOKED', userAgent, ipAddress, {
            revokedSessionId: sessionId,
            revokedDeviceInfo: session.device_info
        });

        try {
            const { data: userData } = await supabaseAdmin
                .from('profiles')
                .select('email, full_name')
                .eq('id', userId)
                .single();

            if (userData) {
                await emailService.sendSecurityNotification(userData.email, userData.full_name, 'SESSION_REVOKED', {
                    deviceInfo: session.device_info,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (err) { console.error('Security email error:', err); }

        return { success: true };
    }

    async getProfile(userId: string) {
        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .select(`
        id, full_name, email, phone, avatar_url, created_at, email_verified,
        roles:user_roles(role),
        verification:user_verifications(status)
      `)
            .eq('id', userId)
            .single();

        if (error) throw error;
        return {
            id: profile.id,
            full_name: profile.full_name,
            email: profile.email,
            phone: profile.phone,
            avatar_url: profile.avatar_url,
            created_at: profile.created_at,
            email_verified: profile.email_verified,
            roles: profile.roles?.map((r: any) => r.role) || [],
            verification_status: profile.verification?.[0]?.status || null
        };
    }

    async resendVerification(email: string) {
        const { data: user, error: userError } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, email_verified')
            .eq('email', email)
            .maybeSingle();

        if (userError) throw userError;
        if (!user) return { success: true };

        if (user.email_verified) return { message: 'Already verified', code: 'ALREADY_VERIFIED' };

        const verificationToken = tokenService.generateEmailVerificationToken(user.id, email);
        const hashedToken = tokenService.hashToken(verificationToken);
        const expiresAt = new Date(Date.now() + env.emailVerificationExpires);

        await supabaseAdmin
            .from('email_verifications')
            .upsert({
                user_id: user.id,
                token: hashedToken,
                expires_at: expiresAt.toISOString(),
                verified_at: null,
                created_at: new Date().toISOString()
            }, { onConflict: 'user_id' });

        await emailService.sendVerificationEmail(email, verificationToken, user.full_name);
        return { success: true };
    }

    async refreshToken(refreshToken: string) {
        const hashedToken = tokenService.hashToken(refreshToken);

        const { data: tokenData, error: tokenError } = await supabaseAdmin
            .from('user_tokens')
            .select(`*, profile:profiles!inner(id, email, full_name, roles:user_roles(role))`)
            .eq('token', hashedToken)
            .gt('expires_at', new Date().toISOString())
            .maybeSingle();

        if (tokenError) throw tokenError;
        if (!tokenData) return { error: 'Invalid or expired token', code: 'INVALID_TOKEN' };

        await supabaseAdmin
            .from('user_tokens')
            .update({ last_used_at: new Date().toISOString() })
            .eq('id', tokenData.id);

        const userWithRoles: UserWithRoles = {
            id: tokenData.profile.id,
            email: tokenData.profile.email,
            full_name: tokenData.profile.full_name,
            roles: tokenData.profile.roles?.map((r: any) => r.role) || ['user'],
            password_hash: '',
            email_verified: true,
            created_at: new Date(),
            updated_at: new Date()
        };

        const newAccessToken = tokenService.generateAccessToken(userWithRoles);
        const newRefreshToken = tokenService.generateRefreshToken();
        const newHashedToken = tokenService.hashToken(newRefreshToken);

        await supabaseAdmin
            .from('user_tokens')
            .update({
                token: newHashedToken,
                created_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + env.refreshTokenExpires).toISOString(),
                last_used_at: new Date().toISOString()
            })
            .eq('id', tokenData.id);

        return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    }

    async changePassword(userId: string, currentPass: string, newPass: string, userAgent?: string, ipAddress?: string) {
        const { data: userData, error: userError } = await supabaseAdmin
            .from('profiles')
            .select('password_hash, full_name, email')
            .eq('id', userId)
            .single();

        if (userError || !userData) throw userError || new Error('User not found');

        const validPassword = await bcrypt.compare(currentPass, userData.password_hash);
        if (!validPassword) {
            await this.logSecurityEvent(userId, 'PASSWORD_CHANGE_FAILED', userAgent, ipAddress);
            return { error: 'Incorrect current password', code: 'INVALID_CURRENT_PASSWORD' };
        }

        const newPasswordHash = await bcrypt.hash(newPass, 10);

        await supabaseAdmin
            .from('profiles')
            .update({ password_hash: newPasswordHash, updated_at: new Date().toISOString() })
            .eq('id', userId);

        await supabaseAdmin
            .from('user_tokens')
            .delete()
            .eq('user_id', userId);

        await this.logSecurityEvent(userId, 'PASSWORD_CHANGE_SUCCESS', userAgent, ipAddress);

        try {
            await emailService.sendPasswordChangedNotification(userData.email, userData.full_name);
        } catch (err) { console.error('Password change email error:', err); }

        return { success: true };
    }

    async forgotPassword(email: string) {
        const { data: user, error: userError } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, email')
            .eq('email', email)
            .maybeSingle();

        if (userError) throw userError;
        if (!user) return { success: true }; // Don't leak user existence

        const resetToken = tokenService.generatePasswordResetToken(user.id, email);
        const hashedToken = tokenService.hashToken(resetToken);
        const expiresAt = new Date(Date.now() + env.passwordResetExpires);

        const { error: tokenError } = await supabaseAdmin
            .from('password_resets')
            .upsert({
                user_id: user.id,
                token: hashedToken,
                expires_at: expiresAt.toISOString(),
                created_at: new Date().toISOString()
            }, { onConflict: 'user_id' });

        if (tokenError) throw tokenError;

        await emailService.sendPasswordResetEmail(email, resetToken, user.full_name);
        return { success: true };
    }

    async resetPassword(token: string, newPass: string) {
        let payload;
        try {
            payload = tokenService.verifyPasswordResetToken(token);
        } catch (err: any) {
            return { error: err.message || 'Invalid or expired token', code: 'INVALID_TOKEN' };
        }

        const hashedToken = tokenService.hashToken(token);
        const { data: resetRecord, error: fetchError } = await supabaseAdmin
            .from('password_resets')
            .select('*')
            .eq('token', hashedToken)
            .eq('user_id', payload.userId)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!resetRecord) return { error: 'Invalid reset link', code: 'INVALID_TOKEN' };

        const password_hash = await bcrypt.hash(newPass, 10);

        await supabaseAdmin
            .from('profiles')
            .update({ password_hash, updated_at: new Date().toISOString() })
            .eq('id', payload.userId);

        // Delete the reset token
        await supabaseAdmin
            .from('password_resets')
            .delete()
            .eq('id', resetRecord.id);

        // Invalidate all sessions for security
        await supabaseAdmin
            .from('user_tokens')
            .delete()
            .eq('user_id', payload.userId);

        try {
            await emailService.sendPasswordChangedNotification(payload.email, '');
        } catch (err) { console.error('Password changed email error:', err); }

        return { success: true };
    }

    async blacklistToken(token: string, userId: string) {
        try {
            const hashedToken = tokenService.hashToken(token);
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await supabaseAdmin
                .from('token_blacklist')
                .insert({
                    token: hashedToken,
                    user_id: userId,
                    expires_at: expiresAt.toISOString(),
                    blacklisted_at: new Date().toISOString()
                });
        } catch (err) { console.error('Blacklist error:', err); }
    }

    private async logSecurityEvent(userId: string, event: string, userAgent?: string, ipAddress?: string, metadata?: any) {
        try {
            await supabaseAdmin
                .from('security_logs')
                .insert({
                    user_id: userId,
                    event,
                    user_agent: userAgent,
                    ip_address: ipAddress,
                    metadata: metadata || {},
                    created_at: new Date().toISOString()
                });
        } catch (err) { console.error('Security log error:', err); }
    }
}
