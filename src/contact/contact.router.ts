/**
 * contact.router.ts
 * Mounted at: /api/contact
 *
 *   POST /api/contact           — contact form → emails admin + confirms to sender
 *   POST /api/contact/subscribe — newsletter signup → emails admin + welcome to subscriber
 */

import { Hono }         from 'hono';
import { emailService } from '../utils/email.service.js';
import { logger }        from '../utils/logger.js';

export const contactRouter = new Hono();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/contact
// Body: { name, email, phone?, topic?, message }
// ─────────────────────────────────────────────────────────────────────────────
contactRouter.post('/', async (c) => {
  let body: any;
  try { body = await c.req.json(); }
  catch { return c.json({ message: 'Invalid JSON', code: 'BAD_REQUEST' }, 400); }

  const { name, email, phone, topic, message } = body ?? {};

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return c.json({ message: 'name, email and message are required', code: 'VALIDATION_ERROR' }, 422);
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ message: 'Invalid email address', code: 'VALIDATION_ERROR' }, 422);
  }

  try {
    await Promise.allSettled([
      emailService.sendContactNotification({ name, email, phone, topic, message }),
      emailService.sendContactConfirmation({ name, email, topic }),
    ]);
  } catch (err) {
    logger.error({ err }, 'contact.send.failed');
    return c.json({ message: 'Failed to send message', code: 'EMAIL_ERROR' }, 500);
  }

  logger.info({ email, topic }, 'contact.received');
  return c.json({ message: 'Message sent successfully' });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/contact/subscribe
// Body: { email }
// ─────────────────────────────────────────────────────────────────────────────
contactRouter.post('/subscribe', async (c) => {
  let body: any;
  try { body = await c.req.json(); }
  catch { return c.json({ message: 'Invalid JSON', code: 'BAD_REQUEST' }, 400); }

  const { email } = body ?? {};
  if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ message: 'Valid email is required', code: 'VALIDATION_ERROR' }, 422);
  }

  try {
    await emailService.sendNewsletterWelcome(email.trim().toLowerCase());
  } catch (err) {
    logger.error({ err, email }, 'newsletter.subscribe.failed');
    return c.json({ message: 'Subscription failed', code: 'EMAIL_ERROR' }, 500);
  }

  logger.info({ email }, 'newsletter.subscribed');
  return c.json({ message: 'Subscribed successfully' });
});
