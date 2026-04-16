/**
 * statuses.router.ts — Property Stories (24-hour statuses)
 *
 * Who can post:  landlord | agent | developer | caretaker | staff | super_admin
 * Who can view:  everyone (GET is public)
 * Auto-delete:   rows with expires_at < NOW() — purged on every GET and
 *                by the cleanup cron (hourly)
 *
 * Boost:         POST /api/statuses/:id/boost  — marks is_boosted=true
 *                Boosted statuses are returned first in the list.
 *                (Payment verification follows the same Paystack pattern as subscriptions)
 */

import { Hono }         from 'hono';
import { supabaseAdmin } from '../utils/supabase.js';
import { logger }        from '../utils/logger.js';
import { authenticate as requireAuth, requireRoles } from '../middleware/auth.middleware.js';
import { deletePropertyMedia }       from '../utils/cloudinary.js';

export const statusesRouter = new Hono();

const POSTER_ROLES = ['landlord', 'agent', 'developer', 'caretaker', 'staff', 'super_admin'];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Purge expired statuses from DB + Cloudinary — fire-and-forget */
async function purgeExpired(): Promise<void> {
  try {
    const { data: expired, error } = await supabaseAdmin
      .from('property_statuses')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id, media');

    if (error || !expired?.length) return;

    // Delete Cloudinary assets in the background
    for (const row of expired) {
      const mediaItems: Array<{ cloudinary_public_id?: string; resource_type?: string }> =
        Array.isArray(row.media) ? row.media : [];

      for (const item of mediaItems) {
        if (item.cloudinary_public_id) {
          await deletePropertyMedia(
            item.cloudinary_public_id,
            (item.resource_type === 'video' ? 'video' : 'image') as 'image' | 'video',
          );
        }
      }
    }

    logger.info({ purged: expired.length }, 'statuses.purge.complete');
  } catch (err) {
    logger.error({ err }, 'statuses.purge.failed');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/statuses  — list active statuses (boosted first, then newest)
// ─────────────────────────────────────────────────────────────────────────────
statusesRouter.get('/', async (c) => {
  // Opportunistically purge expired ones on every GET
  purgeExpired().catch(() => {});

  const { data, error } = await supabaseAdmin
    .from('property_statuses')
    .select(`
      id,
      owner_user_id,
      property_id,
      media,
      caption,
      views,
      is_boosted,
      boost_expires_at,
      created_at,
      expires_at,
      user_profiles!property_statuses_owner_user_id_fkey (
        full_name,
        display_name,
        avatar_url
      ),
      properties (
        id,
        title,
        listing_category,
        property_media ( url, is_cover )
      )
    `)
    .gte('expires_at', new Date().toISOString())  // only non-expired
    .order('is_boosted', { ascending: false })      // boosted first
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ error }, 'statuses.list.failed');
    return c.json({ message: 'Failed to load statuses', code: 'DB_ERROR' }, 500);
  }

  return c.json({ statuses: data ?? [], total: data?.length ?? 0 });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/statuses/:id/view  — increment view count (public, fire-and-forget)
// ─────────────────────────────────────────────────────────────────────────────
statusesRouter.post('/:id/view', async (c) => {
  const id = c.req.param('id');
  // Non-blocking — viewer doesn't wait for this
  supabaseAdmin.rpc('increment_status_views', { p_status_id: id }).then(({ error }) => {
    if (error) logger.warn({ error, id }, 'status.view.increment.failed');
  });
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/statuses  — create a new status (protected: poster roles only)
// Body: { property_id?, caption?, media: [{ url, cloudinary_public_id, resource_type, thumbnail_url }] }
// ─────────────────────────────────────────────────────────────────────────────
statusesRouter.post('/', requireAuth, requireRoles(...POSTER_ROLES), async (c) => {
  const user = c.get('user' as any) as { userId: string };

  let body: any;
  try { body = await c.req.json(); }
  catch { return c.json({ message: 'Invalid JSON body', code: 'BAD_REQUEST' }, 400); }

  const { property_id, caption, media } = body;

  if (!Array.isArray(media) || media.length === 0) {
    return c.json({ message: 'At least one media item is required', code: 'VALIDATION_ERROR' }, 422);
  }
  if (media.length > 10) {
    return c.json({ message: 'Maximum 10 media items per status', code: 'VALIDATION_ERROR' }, 422);
  }

  const { data, error } = await supabaseAdmin
    .from('property_statuses')
    .insert({
      owner_user_id: user.userId,
      property_id:   property_id ?? null,
      caption:       caption ?? null,
      media,
    })
    .select()
    .single();

  if (error) {
    logger.error({ error, userId: user.userId }, 'status.create.failed');
    return c.json({ message: 'Failed to create status', code: 'DB_ERROR' }, 500);
  }

  logger.info({ statusId: data.id, userId: user.userId }, 'status.created');
  return c.json({ status: data }, 201);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/statuses/:id/boost  — boost a status (protected: owner only)
// Body: { paystack_reference, billing_cycle? }
// Paystack verification follows the same pattern as subscriptions
// ─────────────────────────────────────────────────────────────────────────────
statusesRouter.post('/:id/boost', requireAuth, async (c) => {
  const id   = c.req.param('id');
  const user = c.get('user' as any) as { userId: string };

  // Verify ownership
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('property_statuses')
    .select('id, owner_user_id, expires_at')
    .eq('id', id)
    .single();

  if (fetchErr || !existing) {
    return c.json({ message: 'Status not found', code: 'NOT_FOUND' }, 404);
  }
  if (existing.owner_user_id !== user.userId) {
    return c.json({ message: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  if (new Date(existing.expires_at) < new Date()) {
    return c.json({ message: 'Status has expired', code: 'EXPIRED' }, 410);
  }

  let body: any;
  try { body = await c.req.json(); }
  catch { return c.json({ message: 'Invalid JSON body', code: 'BAD_REQUEST' }, 400); }

  const { paystack_reference, amount_kes = 200 } = body;

  if (!paystack_reference) {
    return c.json({ message: 'paystack_reference is required', code: 'VALIDATION_ERROR' }, 422);
  }

  // Verify Paystack payment
  const psRes = await fetch(
    `https://api.paystack.co/transaction/verify/${paystack_reference}`,
    { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } },
  );
  const psData: any = await psRes.json();

  if (!psData.status || psData.data?.status !== 'success') {
    return c.json({ message: 'Payment not confirmed by Paystack', code: 'PAYMENT_FAILED' }, 402);
  }

  const paidKes = (psData.data.amount ?? 0) / 100;
  if (paidKes < amount_kes) {
    return c.json({ message: `Paid KES ${paidKes} but KES ${amount_kes} required`, code: 'INSUFFICIENT_PAYMENT' }, 402);
  }

  // Mark boosted — boost lasts for the remaining life of the status
  const { data: boosted, error: updateErr } = await supabaseAdmin
    .from('property_statuses')
    .update({
      is_boosted:       true,
      boost_expires_at: existing.expires_at,
      boost_amount_kes: paidKes,
    })
    .eq('id', id)
    .select()
    .single();

  if (updateErr) {
    logger.error({ updateErr, id }, 'status.boost.update.failed');
    return c.json({ message: 'Failed to apply boost', code: 'DB_ERROR' }, 500);
  }

  logger.info({ id, userId: user.userId, paidKes }, 'status.boosted');
  return c.json({ status: boosted });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/statuses/:id  — manual delete (owner or staff/admin)
// ─────────────────────────────────────────────────────────────────────────────
statusesRouter.delete('/:id', requireAuth, async (c) => {
  const id   = c.req.param('id');
  const user = c.get('user' as any) as { userId: string; roles?: string[] };

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('property_statuses')
    .select('id, owner_user_id, media')
    .eq('id', id)
    .single();

  if (fetchErr || !existing) {
    return c.json({ message: 'Status not found', code: 'NOT_FOUND' }, 404);
  }

  const isOwner = existing.owner_user_id === user.userId;
  const isAdmin = user.roles?.some((r) => ['staff', 'super_admin'].includes(r));

  if (!isOwner && !isAdmin) {
    return c.json({ message: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  // Delete Cloudinary assets first
  const mediaItems: Array<{ cloudinary_public_id?: string; resource_type?: string }> =
    Array.isArray(existing.media) ? existing.media : [];

  await Promise.allSettled(
    mediaItems
      .filter((m) => m.cloudinary_public_id)
      .map((m) =>
        deletePropertyMedia(
          m.cloudinary_public_id!,
          (m.resource_type === 'video' ? 'video' : 'image') as 'image' | 'video',
        ),
      ),
  );

  const { error: deleteErr } = await supabaseAdmin
    .from('property_statuses')
    .delete()
    .eq('id', id);

  if (deleteErr) {
    logger.error({ deleteErr, id }, 'status.delete.db.failed');
    return c.json({ message: 'Failed to delete status', code: 'DB_ERROR' }, 500);
  }

  logger.info({ id, deletedBy: user.userId }, 'status.deleted');
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/statuses/cleanup  — internal/admin cron trigger
// Call this from a pg_cron job or external cron every hour
// ─────────────────────────────────────────────────────────────────────────────
statusesRouter.post('/cleanup', requireAuth, requireRoles('super_admin', 'staff'), async (c) => {
  await purgeExpired();
  return c.json({ ok: true });
});
