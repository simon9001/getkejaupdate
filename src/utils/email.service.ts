// backend/src/utils/email.service.ts
import { Resend } from 'resend';
import { env } from '../config/environment.js';
import { tokenService } from './token.service.js';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
}

export interface WelcomeEmailData {
  fullName: string;
  loginUrl: string;
}

export interface VerificationEmailData {
  fullName: string;
  verificationLink: string;
  expiresIn: number; // hours
}

export interface PasswordResetEmailData {
  fullName: string;
  resetLink: string;
  expiresIn: number; // hours
}

export interface PasswordChangedEmailData {
  fullName: string;
  supportEmail: string;
}

export interface ReminderEmailData {
  fullName: string;
  verificationLink: string;
  expiresIn: number; // hours
}

// Custom error classes
export class EmailError extends Error {
  constructor(message: string, public code: string, public originalError?: any) {
    super(message);
    this.name = 'EmailError';
  }
}

export class EmailService {
  private resend: Resend;
  private defaultFrom: string;
  private defaultFromName: string;
  private supportEmail: string;

  constructor() {
    // Initialize Resend with API key
    if (!env.smtp.pass) {
      console.warn('⚠️ RESEND_API_KEY not configured. Email service will not function.');
    }

    this.resend = new Resend(env.smtp.pass);
    this.defaultFrom = env.smtp.fromEmail;
    this.defaultFromName = env.smtp.fromName;
    this.supportEmail = env.smtp.fromEmail; // Use same email for support
  }

  /**
   * Send an email using Resend
   */
  private async sendEmail(options: EmailOptions): Promise<{ id: string }> {
    try {
      if (!env.smtp.pass) {
        throw new EmailError(
          'Email service not configured',
          'EMAIL_SERVICE_NOT_CONFIGURED'
        );
      }

      const from = options.from || `${this.defaultFromName} <${this.defaultFrom}>`;

      const { data, error } = await this.resend.emails.send({
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || this.stripHtml(options.html),
        replyTo: options.replyTo || this.supportEmail,
        attachments: options.attachments,
      });

      if (error) {
        throw new EmailError(
          'Failed to send email',
          'EMAIL_SEND_FAILED',
          error
        );
      }

      console.log(`✅ Email sent successfully to ${options.to}: ${data?.id}`);
      return { id: data?.id || 'unknown' };
    } catch (error) {
      if (error instanceof EmailError) {
        throw error;
      }
      throw new EmailError(
        'Unexpected error sending email',
        'EMAIL_UNEXPECTED_ERROR',
        error
      );
    }
  }

  /**
   * Strip HTML tags for plain text version
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, ' ') // Remove HTML tags
      .replace(/\s+/g, ' ') // Collapse whitespace
      .trim();
  }

  /**
   * Get base URL for links
   */
  private getBaseUrl(): string {
    return env.frontendUrl;
  }

  /**
   * Generate email verification link
   */
  private generateVerificationLink(email: string, token: string): string {
    return `${this.getBaseUrl()}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  }

  /**
   * Generate password reset link
   */
  private generatePasswordResetLink(email: string, token: string): string {
    return `${this.getBaseUrl()}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  }

  /**
   * Send verification email
   */
  async sendVerificationEmail(
    email: string,
    verificationToken: string,
    fullName: string
  ): Promise<{ id: string }> {
    const subject = 'Verify Your Email Address - Getkeja';
    const verificationLink = this.generateVerificationLink(email, verificationToken);
    const expiresInHours = env.emailVerificationExpires / (60 * 60 * 1000);

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #1B2430;
            margin: 0;
            padding: 0;
            background-color: #FCFAF2;
          }
          .container {
            max-width: 600px;
            margin: 20px auto;
            background: white;
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          }
          .header {
            background: #1B2430;
            padding: 40px 30px;
            text-align: center;
          }
          .header h1 {
            color: white;
            margin: 0;
            font-size: 28px;
            font-weight: 700;
            letter-spacing: -0.5px;
          }
          .header span {
            color: #D4A373;
          }
          .content {
            padding: 40px 30px;
            background: white;
          }
          .content h2 {
            color: #1B2430;
            margin-top: 0;
            font-size: 24px;
            font-weight: 700;
          }
          .content p {
            color: #4A5568;
            margin: 20px 0;
            font-size: 16px;
          }
          .button {
            display: inline-block;
            background: #D4A373;
            color: white;
            text-decoration: none;
            padding: 14px 32px;
            border-radius: 12px;
            font-weight: 600;
            font-size: 16px;
            margin: 20px 0;
            transition: background-color 0.2s;
          }
          .button:hover {
            background: #E6B17E;
          }
          .footer {
            padding: 30px;
            background: #FCFAF2;
            text-align: center;
            border-top: 1px solid #E2E8F0;
          }
          .footer p {
            color: #718096;
            font-size: 14px;
            margin: 5px 0;
          }
          .expiry {
            background: #FCFAF2;
            padding: 16px;
            border-radius: 12px;
            margin: 20px 0;
            font-size: 14px;
            color: #8B6E4E;
            text-align: center;
          }
          .link {
            word-break: break-all;
            color: #D4A373;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to <span>Getkeja</span></h1>
          </div>
          <div class="content">
            <h2>Hello ${fullName},</h2>
            <p>Thank you for registering with Getkeja! We're excited to help you find your dream property.</p>
            <p>Please verify your email address to activate your account and start exploring luxury properties.</p>
            
            <div style="text-align: center;">
              <a href="${verificationLink}" class="button">Verify Email Address</a>
            </div>

            <div class="expiry">
              ⏰ This verification link will expire in ${expiresInHours} hours.
            </div>

            <p style="font-size: 14px; color: #718096;">
              If the button doesn't work, copy and paste this link into your browser:
            </p>
            <p class="link">${verificationLink}</p>

            <p style="margin-top: 30px; font-size: 14px; color: #718096;">
              If you didn't create an account with Getkeja, please ignore this email.
            </p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Getkeja. All rights reserved.</p>
            <p>Luxury Living, Redefined.</p>
            <p style="font-size: 12px;">This email was sent to ${email}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({ to: email, subject, html });
  }

  /**
   * Send verification reminder email
   */
  async sendVerificationReminderEmail(
    email: string,
    fullName: string
  ): Promise<{ id: string }> {
    const subject = '⏰ Reminder: Verify Your Email Address - Getkeja';

    // Generate new token for reminder
    const user = await this.getUserIdByEmail(email); // You'll need to implement this
    if (!user) throw new EmailError('User not found', 'USER_NOT_FOUND');

    const verificationToken = tokenService.generateEmailVerificationToken(user.id, email);
    const verificationLink = this.generateVerificationLink(email, verificationToken);
    const expiresInHours = env.emailVerificationExpires / (60 * 60 * 1000);

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reminder: Verify Your Email</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #1B2430;
            margin: 0;
            padding: 0;
            background-color: #FCFAF2;
          }
          .container {
            max-width: 600px;
            margin: 20px auto;
            background: white;
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          }
          .header {
            background: #1B2430;
            padding: 40px 30px;
            text-align: center;
          }
          .header h1 {
            color: white;
            margin: 0;
            font-size: 28px;
            font-weight: 700;
            letter-spacing: -0.5px;
          }
          .header span {
            color: #D4A373;
          }
          .content {
            padding: 40px 30px;
            background: white;
          }
          .content h2 {
            color: #1B2430;
            margin-top: 0;
            font-size: 24px;
            font-weight: 700;
          }
          .reminder-badge {
            background: #FEEBC8;
            color: #8B6E4E;
            padding: 12px 24px;
            border-radius: 50px;
            display: inline-block;
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 20px;
          }
          .button {
            display: inline-block;
            background: #D4A373;
            color: white;
            text-decoration: none;
            padding: 14px 32px;
            border-radius: 12px;
            font-weight: 600;
            font-size: 16px;
            margin: 20px 0;
            transition: background-color 0.2s;
          }
          .button:hover {
            background: #E6B17E;
          }
          .footer {
            padding: 30px;
            background: #FCFAF2;
            text-align: center;
            border-top: 1px solid #E2E8F0;
          }
          .expiry {
            background: #FCFAF2;
            padding: 16px;
            border-radius: 12px;
            margin: 20px 0;
            font-size: 14px;
            color: #8B6E4E;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Getkeja <span>Reminder</span></h1>
          </div>
          <div class="content">
            <div style="text-align: center;">
              <span class="reminder-badge">⏰ Action Required</span>
            </div>
            
            <h2>Hello ${fullName},</h2>
            <p>We noticed you haven't verified your email address yet. Your account is almost ready!</p>
            <p>Please verify your email to:</p>
            <ul style="color: #4A5568; margin: 20px 0;">
              <li>✓ Access your account dashboard</li>
              <li>✓ Save your favorite properties</li>
              <li>✓ Receive updates on new listings</li>
              <li>✓ Contact property managers</li>
            </ul>
            
            <div style="text-align: center;">
              <a href="${verificationLink}" class="button">Verify Email Now</a>
            </div>

            <div class="expiry">
              ⏰ This verification link will expire in ${expiresInHours} hours.
            </div>

            <p style="font-size: 14px; color: #718096; margin-top: 30px;">
              If you're having trouble, please contact our support team.
            </p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Getkeja. All rights reserved.</p>
            <p>Luxury Living, Redefined.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({ to: email, subject, html });
  }

  /**
   * Send welcome email after verification
   */
  async sendWelcomeEmail(
    email: string,
    fullName: string
  ): Promise<{ id: string }> {
    const subject = 'Welcome to Getkeja - Your Account is Verified!';
    const loginUrl = `${this.getBaseUrl()}/login`;

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Getkeja</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #1B2430;
            margin: 0;
            padding: 0;
            background-color: #FCFAF2;
          }
          .container {
            max-width: 600px;
            margin: 20px auto;
            background: white;
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          }
          .header {
            background: #1B2430;
            padding: 40px 30px;
            text-align: center;
          }
          .header h1 {
            color: white;
            margin: 0;
            font-size: 28px;
            font-weight: 700;
            letter-spacing: -0.5px;
          }
          .header span {
            color: #D4A373;
          }
          .content {
            padding: 40px 30px;
            background: white;
          }
          .success-badge {
            background: #C6F6D5;
            color: #22543D;
            padding: 12px 24px;
            border-radius: 50px;
            display: inline-block;
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 20px;
          }
          .feature-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
            margin: 30px 0;
          }
          .feature-item {
            text-align: center;
            padding: 20px;
            background: #FCFAF2;
            border-radius: 16px;
          }
          .feature-icon {
            font-size: 32px;
            margin-bottom: 10px;
          }
          .button {
            display: inline-block;
            background: #D4A373;
            color: white;
            text-decoration: none;
            padding: 14px 32px;
            border-radius: 12px;
            font-weight: 600;
            font-size: 16px;
            margin: 20px 0;
            transition: background-color 0.2s;
          }
          .footer {
            padding: 30px;
            background: #FCFAF2;
            text-align: center;
            border-top: 1px solid #E2E8F0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to <span>Getkeja</span></h1>
          </div>
          <div class="content">
            <div style="text-align: center;">
              <span class="success-badge">✓ Email Verified Successfully</span>
            </div>
            
            <h2>Hello ${fullName},</h2>
            <p>Your email has been verified and your account is now active! We're thrilled to have you join the Getkeja community.</p>

            <div class="feature-grid">
              <div class="feature-item">
                <div class="feature-icon">🏠</div>
                <h3 style="margin: 10px 0 5px; font-size: 18px;">Browse Properties</h3>
                <p style="font-size: 14px; color: #718096;">Explore luxury listings</p>
              </div>
              <div class="feature-item">
                <div class="feature-icon">❤️</div>
                <h3 style="margin: 10px 0 5px; font-size: 18px;">Save Favorites</h3>
                <p style="font-size: 14px; color: #718096;">Create your wishlist</p>
              </div>
              <div class="feature-item">
                <div class="feature-icon">📞</div>
                <h3 style="margin: 10px 0 5px; font-size: 18px;">Contact Agents</h3>
                <p style="font-size: 14px; color: #718096;">Schedule viewings</p>
              </div>
              <div class="feature-item">
                <div class="feature-icon">🔔</div>
                <h3 style="margin: 10px 0 5px; font-size: 18px;">Get Alerts</h3>
                <p style="font-size: 14px; color: #718096;">New property matches</p>
              </div>
            </div>

            <div style="text-align: center;">
              <a href="${loginUrl}" class="button">Login to Your Account</a>
            </div>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Getkeja. All rights reserved.</p>
            <p>Luxury Living, Redefined.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({ to: email, subject, html });
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(
    email: string,
    resetToken: string,
    fullName: string
  ): Promise<{ id: string }> {
    const subject = 'Reset Your Password - Getkeja';
    const resetLink = this.generatePasswordResetLink(email, resetToken);
    const expiresInHours = env.passwordResetExpires / (60 * 60 * 1000);

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #1B2430;
            margin: 0;
            padding: 0;
            background-color: #FCFAF2;
          }
          .container {
            max-width: 600px;
            margin: 20px auto;
            background: white;
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          }
          .header {
            background: #1B2430;
            padding: 40px 30px;
            text-align: center;
          }
          .header h1 {
            color: white;
            margin: 0;
            font-size: 28px;
            font-weight: 700;
            letter-spacing: -0.5px;
          }
          .header span {
            color: #D4A373;
          }
          .content {
            padding: 40px 30px;
            background: white;
          }
          .warning-badge {
            background: #FEEBC8;
            color: #8B6E4E;
            padding: 12px 24px;
            border-radius: 50px;
            display: inline-block;
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 20px;
          }
          .button {
            display: inline-block;
            background: #D4A373;
            color: white;
            text-decoration: none;
            padding: 14px 32px;
            border-radius: 12px;
            font-weight: 600;
            font-size: 16px;
            margin: 20px 0;
            transition: background-color 0.2s;
          }
          .button:hover {
            background: #E6B17E;
          }
          .footer {
            padding: 30px;
            background: #FCFAF2;
            text-align: center;
            border-top: 1px solid #E2E8F0;
          }
          .expiry {
            background: #FCFAF2;
            padding: 16px;
            border-radius: 12px;
            margin: 20px 0;
            font-size: 14px;
            color: #8B6E4E;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password <span>Reset</span></h1>
          </div>
          <div class="content">
            <div style="text-align: center;">
              <span class="warning-badge">🔐 Password Reset Request</span>
            </div>
            
            <h2>Hello ${fullName},</h2>
            <p>We received a request to reset your password for your Getkeja account.</p>
            <p>Click the button below to create a new password:</p>
            
            <div style="text-align: center;">
              <a href="${resetLink}" class="button">Reset Password</a>
            </div>

            <div class="expiry">
              ⏰ This reset link will expire in ${expiresInHours} hours.
            </div>

            <p style="font-size: 14px; color: #718096; margin-top: 30px;">
              If you didn't request a password reset, please ignore this email or contact support if you have concerns.
            </p>

            <p style="font-size: 14px; color: #718096;">
              For security, this link can only be used once.
            </p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Getkeja. All rights reserved.</p>
            <p>Luxury Living, Redefined.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({ to: email, subject, html });
  }

  /**
   * Send password changed notification
   */
  async sendPasswordChangedNotification(
    email: string,
    fullName: string
  ): Promise<{ id: string }> {
    const subject = 'Your Password Has Been Changed - Getkeja';
    const supportEmail = this.supportEmail;

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Changed</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #1B2430;
            margin: 0;
            padding: 0;
            background-color: #FCFAF2;
          }
          .container {
            max-width: 600px;
            margin: 20px auto;
            background: white;
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          }
          .header {
            background: #1B2430;
            padding: 40px 30px;
            text-align: center;
          }
          .header h1 {
            color: white;
            margin: 0;
            font-size: 28px;
            font-weight: 700;
            letter-spacing: -0.5px;
          }
          .header span {
            color: #D4A373;
          }
          .content {
            padding: 40px 30px;
            background: white;
          }
          .success-badge {
            background: #C6F6D5;
            color: #22543D;
            padding: 12px 24px;
            border-radius: 50px;
            display: inline-block;
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 20px;
          }
          .button {
            display: inline-block;
            background: #D4A373;
            color: white;
            text-decoration: none;
            padding: 14px 32px;
            border-radius: 12px;
            font-weight: 600;
            font-size: 16px;
            margin: 20px 0;
          }
          .footer {
            padding: 30px;
            background: #FCFAF2;
            text-align: center;
            border-top: 1px solid #E2E8F0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Security <span>Alert</span></h1>
          </div>
          <div class="content">
            <div style="text-align: center;">
              <span class="success-badge">✓ Password Updated Successfully</span>
            </div>
            
            <h2>Hello ${fullName},</h2>
            <p>Your Getkeja account password was successfully changed.</p>
            
            <div style="background: #FCFAF2; padding: 20px; border-radius: 12px; margin: 20px 0;">
              <p style="margin: 0; color: #4A5568;">
                <strong>Time:</strong> ${new Date().toLocaleString()}
              </p>
            </div>

            <p style="color: #4A5568;">
              If you did not make this change, please contact our support team immediately at 
              <a href="mailto:${supportEmail}" style="color: #D4A373; text-decoration: none;">${supportEmail}</a>
            </p>

            <div style="text-align: center;">
              <a href="${this.getBaseUrl()}/login" class="button">Login to Your Account</a>
            </div>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Getkeja. All rights reserved.</p>
            <p>Luxury Living, Redefined.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({ to: email, subject, html });
  }

  async sendSecurityNotification(
    email: string,
    fullName: string,
    type: 'OTHER_DEVICES_LOGOUT' | 'SESSION_REVOKED',
    data: any
  ): Promise<{ id: string }> {
    let subject = 'Security Alert - Getkeja';
    let message = '';
    let detailsHtml = '';

    if (type === 'OTHER_DEVICES_LOGOUT') {
      subject = 'Security Alert: Other Devices Logged Out';
      message = 'All other devices have been logged out from your Getkeja account.';
      detailsHtml = `
        <div style="background: #FCFAF2; padding: 20px; border-radius: 12px; margin: 20px 0;">
          <p style="margin: 0; color: #4A5568;">
            <strong>Devices Logged Out:</strong> ${data.deviceCount || 0}<br>
            <strong>Time:</strong> ${new Date(data.timestamp).toLocaleString()}<br>
            <strong>Current Device:</strong> ${data.currentDevice || 'Unknown'}
          </p>
        </div>
      `;
    } else if (type === 'SESSION_REVOKED') {
      subject = 'Security Alert: Session Revoked';
      message = 'A specific session has been revoked from your Getkeja account.';
      detailsHtml = `
        <div style="background: #FCFAF2; padding: 20px; border-radius: 12px; margin: 20px 0;">
          <p style="margin: 0; color: #4A5568;">
            <strong>Device:</strong> ${data.deviceInfo || 'Unknown'}<br>
            <strong>Time:</strong> ${new Date(data.timestamp).toLocaleString()}
          </p>
        </div>
      `;
    }

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Security Alert</title>
        <style>
          body { font-family: -apple-system, sans-serif; line-height: 1.6; color: #1B2430; background-color: #FCFAF2; }
          .container { max-width: 600px; margin: 20px auto; background: white; border-radius: 24px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .header { background: #1B2430; padding: 30px; text-align: center; color: white; }
          .content { padding: 40px 30px; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #718096; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header"><h1>Security Alert</h1></div>
          <div class="content">
            <h2>Hello ${fullName},</h2>
            <p>${message}</p>
            ${detailsHtml}
            <p>If this wasn't you, please change your password immediately and contact support.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Getkeja. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({ to: email, subject, html });
  }

  /**
   * Helper method to get user ID by email (you'll need to implement this)
   */
  private async getUserIdByEmail(email: string): Promise<{ id: string } | null> {
    // This should be implemented to fetch user from your database
    // For now, return null - you'll need to inject this dependency
    return null;
  }
}

export const emailService = new EmailService();