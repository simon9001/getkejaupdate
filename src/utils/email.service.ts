// backend/src/utils/email.service.ts
import { Resend } from 'resend';
import { env } from '../config/environment.js';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

// Custom error class
export class EmailError extends Error {
  constructor(message: string, public code: string, public originalError?: any) {
    super(message);
    this.name = 'EmailError';
  }
}

// ---------------------------------------------------------------------------
// Helper: parse a duration value to hours for display in email templates.
// Handles both:
//   - number (milliseconds): env values like 86400000
//   - string (shorthand):    env values like '24h', '1h', '30m'
// ---------------------------------------------------------------------------
function toHours(duration: string | number): number {
  if (typeof duration === 'number') {
    return Math.round(duration / (1000 * 60 * 60));
  }
  const str = String(duration).trim().toLowerCase();
  if (str.endsWith('h')) return parseInt(str, 10);
  if (str.endsWith('m')) return Math.round(parseInt(str, 10) / 60);
  if (str.endsWith('d')) return parseInt(str, 10) * 24;
  // Fallback: assume milliseconds string
  return Math.round(Number(str) / (1000 * 60 * 60));
}

// ---------------------------------------------------------------------------
// EmailService
// ---------------------------------------------------------------------------
export class EmailService {
  private resend: Resend;
  private defaultFrom: string;
  private defaultFromName: string;
  private supportEmail: string;

  constructor() {
    if (!env.smtp.pass) {
      console.warn('⚠️  RESEND_API_KEY not set — emails will not be sent.');
    }
    this.resend        = new Resend(env.smtp.pass);
    this.defaultFrom   = env.smtp.fromEmail;
    this.defaultFromName = env.smtp.fromName;
    this.supportEmail  = env.smtp.fromEmail;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async sendEmail(options: EmailOptions): Promise<{ id: string }> {
    if (!env.smtp.pass) {
      console.warn(`📧 [DEV — no API key] Would send "${options.subject}" to ${options.to}`);
      return { id: 'dev-no-key' };
    }

    const from = options.from ?? `${this.defaultFromName} <${this.defaultFrom}>`;

    const { data, error } = await this.resend.emails.send({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text ?? this.stripHtml(options.html),
      replyTo: options.replyTo ?? this.supportEmail,
    });

    if (error) {
      console.error('Resend error:', error);
      throw new EmailError('Failed to send email', 'EMAIL_SEND_FAILED', error);
    }

    console.log(`✅ Email sent → ${options.to} | id: ${data?.id}`);
    return { id: data?.id ?? 'unknown' };
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private baseUrl(): string {
    return env.frontendUrl;
  }

  private verificationLink(email: string, token: string): string {
    return `${this.baseUrl()}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  }

  private resetLink(email: string, token: string): string {
    return `${this.baseUrl()}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  }

  // Shared email wrapper HTML
  private wrap(headerTitle: string, headerAccent: string, bodyHtml: string, footerEmail?: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.6;color:#1B2430;margin:0;padding:0;background:#FCFAF2}
    .wrap{max-width:600px;margin:20px auto;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,.25)}
    .hdr{background:#1B2430;padding:36px 30px;text-align:center}
    .hdr h1{color:#fff;margin:0;font-size:26px;font-weight:700}
    .hdr span{color:#D4A373}
    .body{padding:36px 30px}
    .body h2{color:#1B2430;margin-top:0;font-size:22px}
    .body p{color:#4A5568;margin:16px 0;font-size:15px}
    .btn{display:inline-block;background:#D4A373;color:#fff;text-decoration:none;padding:13px 30px;border-radius:12px;font-weight:600;font-size:15px;margin:16px 0}
    .pill{background:#FCFAF2;padding:14px;border-radius:12px;margin:16px 0;font-size:13px;color:#8B6E4E;text-align:center}
    .link{word-break:break-all;color:#D4A373;font-size:13px}
    .ftr{padding:24px 30px;background:#FCFAF2;text-align:center;border-top:1px solid #E2E8F0}
    .ftr p{color:#718096;font-size:13px;margin:4px 0}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hdr"><h1>${headerTitle} <span>${headerAccent}</span></h1></div>
    <div class="body">${bodyHtml}</div>
    <div class="ftr">
      <p>&copy; ${new Date().getFullYear()} Getkeja. All rights reserved.</p>
      <p>Luxury Living, Redefined.</p>
      ${footerEmail ? `<p style="font-size:12px">This email was sent to ${footerEmail}</p>` : ''}
    </div>
  </div>
</body>
</html>`;
  }

  // ── Public send methods ───────────────────────────────────────────────────

  async sendVerificationEmail(email: string, token: string, fullName: string): Promise<{ id: string }> {
    const link  = this.verificationLink(email, token);
    const hours = toHours(env.emailVerificationExpires);  // ← fixed: handles '24h' string

    const body = `
      <h2>Hello ${fullName},</h2>
      <p>Thank you for registering with Getkeja! Please verify your email address to activate your account.</p>
      <div style="text-align:center"><a href="${link}" class="btn">Verify Email Address</a></div>
      <div class="pill">⏰ This link expires in ${hours} hour${hours !== 1 ? 's' : ''}.</div>
      <p style="font-size:13px;color:#718096">We are so proud to have you onbord:</p>
      // <p class="link">${link}</p>
      <p style="font-size:13px;color:#718096;margin-top:24px">If you didn't create a Getkeja account, you can safely ignore this email.</p>
    `;

    return this.sendEmail({
      to: email,
      subject: 'Verify Your Email Address — Getkeja',
      html: this.wrap('Welcome to', 'Getkeja', body, email),
    });
  }

  async sendWelcomeEmail(email: string, fullName: string): Promise<{ id: string }> {
    const loginUrl = `${this.baseUrl()}/login`;

    const body = `
      <div style="text-align:center">
        <span style="background:#C6F6D5;color:#22543D;padding:10px 22px;border-radius:50px;font-weight:600;font-size:13px">✓ Email Verified Successfully</span>
      </div>
      <h2>Hello ${fullName},</h2>
      <p>Your email has been verified and your Getkeja account is now active!</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0">
        ${[['🏠','Browse Properties','Explore listings'],['❤️','Save Favorites','Build your wishlist'],['📞','Contact Agents','Schedule viewings'],['🔔','Get Alerts','New property matches']].map(([icon,title,sub])=>`
        <div style="text-align:center;padding:16px;background:#FCFAF2;border-radius:14px">
          <div style="font-size:28px">${icon}</div>
          <strong style="font-size:15px">${title}</strong>
          <p style="font-size:12px;color:#718096;margin:4px 0">${sub}</p>
        </div>`).join('')}
      </div>
      <div style="text-align:center"><a href="${loginUrl}" class="btn">Login to Your Account</a></div>
    `;

    return this.sendEmail({
      to: email,
      subject: 'Welcome to Getkeja — Your Account is Verified!',
      html: this.wrap('Welcome to', 'Getkeja', body),
    });
  }

  async sendPasswordResetEmail(email: string, token: string, fullName: string): Promise<{ id: string }> {
    const link  = this.resetLink(email, token);
    const hours = toHours(env.passwordResetExpires);  // ← fixed: handles '1h' string

    const body = `
      <div style="text-align:center">
        <span style="background:#FEEBC8;color:#8B6E4E;padding:10px 22px;border-radius:50px;font-weight:600;font-size:13px">🔐 Password Reset Request</span>
      </div>
      <h2>Hello ${fullName},</h2>
      <p>We received a request to reset your Getkeja account password. Click below to set a new password.</p>
      <div style="text-align:center"><a href="${link}" class="btn">Reset Password</a></div>
      <div class="pill">⏰ This link expires in ${hours} hour${hours !== 1 ? 's' : ''}. Use it only once.</div>
      <p style="font-size:13px;color:#718096;margin-top:24px">If you didn't request this, ignore this email — your password will not change.</p>
    `;

    return this.sendEmail({
      to: email,
      subject: 'Reset Your Password — Getkeja',
      html: this.wrap('Password', 'Reset', body),
    });
  }

  async sendPasswordChangedNotification(email: string, fullName: string): Promise<{ id: string }> {
    const body = `
      <div style="text-align:center">
        <span style="background:#C6F6D5;color:#22543D;padding:10px 22px;border-radius:50px;font-weight:600;font-size:13px">✓ Password Updated</span>
      </div>
      <h2>Hello ${fullName},</h2>
      <p>Your Getkeja account password was successfully changed.</p>
      <div style="background:#FCFAF2;padding:16px;border-radius:12px;margin:16px 0">
        <p style="margin:0;color:#4A5568"><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      </div>
      <p>If you did not make this change, contact support immediately at
        <a href="mailto:${this.supportEmail}" style="color:#D4A373">${this.supportEmail}</a>.
      </p>
      <div style="text-align:center"><a href="${this.baseUrl()}/login" class="btn">Login to Your Account</a></div>
    `;

    return this.sendEmail({
      to: email,
      subject: 'Your Password Has Been Changed — Getkeja',
      html: this.wrap('Security', 'Alert', body),
    });
  }

  async sendSecurityNotification(
    email: string,
    fullName: string,
    type: 'OTHER_DEVICES_LOGOUT' | 'SESSION_REVOKED',
    data: any,
  ): Promise<{ id: string }> {
    const isLogout = type === 'OTHER_DEVICES_LOGOUT';
    const subject  = isLogout
      ? 'Security Alert: Other Devices Logged Out — Getkeja'
      : 'Security Alert: Session Revoked — Getkeja';
    const message  = isLogout
      ? 'All other devices have been logged out from your Getkeja account.'
      : 'A specific session has been revoked from your Getkeja account.';

    const details = isLogout
      ? `<strong>Devices logged out:</strong> ${data.deviceCount ?? 0}<br>
         <strong>Time:</strong> ${new Date(data.timestamp).toLocaleString()}<br>
         <strong>Current device:</strong> ${data.currentDevice ?? 'Unknown'}`
      : `<strong>Device:</strong> ${data.deviceInfo ?? 'Unknown'}<br>
         <strong>Time:</strong> ${new Date(data.timestamp).toLocaleString()}`;

    const body = `
      <h2>Hello ${fullName},</h2>
      <p>${message}</p>
      <div style="background:#FCFAF2;padding:16px;border-radius:12px;margin:16px 0;color:#4A5568;font-size:14px">${details}</div>
      <p style="font-size:13px;color:#718096">If this wasn't you, change your password immediately and contact support.</p>
    `;

    return this.sendEmail({ to: email, subject, html: this.wrap('Security', 'Alert', body) });
  }

  async sendVerificationApprovedEmail(email: string, fullName: string, role: string): Promise<{ id: string }> {
    const dashboardUrl = `${this.baseUrl()}/dashboard`;
    const roleDisplay = role.charAt(0).toUpperCase() + role.slice(1).replace('_', ' ');

    const body = `
      <div style="text-align:center">
        <span style="background:#C6F6D5;color:#22543D;padding:10px 22px;border-radius:50px;font-weight:600;font-size:13px">🎊 Account Verified</span>
      </div>
      <h2>Congratulations ${fullName}!</h2>
      <p>Your identity verification has been approved by the Getkeja staff.</p>
      <p>Your account has been upgraded to a <strong>${roleDisplay}</strong> role. You now have full access to your professional dashboard.</p>
      <div style="background:#FCFAF2;padding:24px;border-radius:14px;margin:24px 0">
        <div style="display:flex;align-items:center;margin-bottom:12px">
          <div style="font-size:20px;margin-right:12px">🏠</div>
          <div><strong>Property Management</strong><br><span style="font-size:12px;color:#718096">List and manage your properties</span></div>
        </div>
        <div style="display:flex;align-items:center;margin-bottom:12px">
          <div style="font-size:20px;margin-right:12px">📈</div>
          <div><strong>Insightful Analytics</strong><br><span style="font-size:12px;color:#718096">Track your revenue and performance</span></div>
        </div>
        <div style="display:flex;align-items:center">
          <div style="font-size:20px;margin-right:12px">🤝</div>
          <div><strong>Team Collaboration</strong><br><span style="font-size:12px;color:#718096">Add Agents and Caretakers to your team</span></div>
        </div>
      </div>
      <div style="text-align:center"><a href="${dashboardUrl}" class="btn">Go to Dashboard</a></div>
    `;

    return this.sendEmail({
      to: email,
      subject: `Verification Approved — Welcome ${fullName}!`,
      html: this.wrap('Verification', 'Success', body, email),
    });
  }

  async sendVerificationRejectedEmail(email: string, fullName: string, reason: string): Promise<{ id: string }> {
    const body = `
      <div style="text-align:center">
        <span style="background:#FED7D7;color:#9B2C2C;padding:10px 22px;border-radius:50px;font-weight:600;font-size:13px">⚠ Verification Rejected</span>
      </div>
      <h2>Hello ${fullName},</h2>
      <p>We reviewed your identity verification submission, but unfortunately, we could not approve it at this time.</p>
      <div style="background:#FFF5F5;border-left:4px solid #F56565;padding:16px;margin:24px 0">
        <strong style="color:#C53030">Reason for Rejection:</strong>
        <p style="margin:8px 0 0 0;color:#742A2A">${reason}</p>
      </div>
      <p>You can re-submit your documents through your dashboard for review.</p>
      <div style="text-align:center"><a href="${this.baseUrl()}/dashboard/verify" class="btn" style="background:#4A5568">Re-submit Documents</a></div>
      <p style="font-size:13px;color:#718096;margin-top:24px">If you have questions, please contact our support team.</p>
    `;

    return this.sendEmail({
      to: email,
      subject: 'Update Regarding Your Identity Verification — Getkeja',
      html: this.wrap('Verification', 'Update', body, email),
    });
  }
}

export const emailService = new EmailService();