/**
 * user.router.ts  — authenticated self-service endpoints for any logged-in user
 *
 * Mounted at: /api/user
 *
 * Routes:
 *   GET    /api/user/saved-properties          → list saved properties
 *   POST   /api/user/saved-properties          → save a property
 *   DELETE /api/user/saved-properties/:id      → remove a saved property
 *   POST   /api/user/saved-properties/sync     → bulk-replace saved list
 */

import { Hono } from 'hono';
import { supabaseAdmin } from '../utils/supabase.js';
import { logger }        from '../utils/logger.js';
import { authenticate }  from '../middleware/auth.middleware.js';

export const userRouter = new Hono();

// All routes require auth
userRouter.use('*', authenticate);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/saved-properties
// Returns the authenticated user's saved properties with joined property data
// ─────────────────────────────────────────────────────────────────────────────
userRouter.get('/saved-properties', async (c) => {
  const user = c.get('user') as { userId: string };

  const { data, error } = await supabaseAdmin
    .from('saved_properties')
    .select(`
      id,
      property_id,
      saved_at,
      properties (
        id,
        title,
        listing_category,
        bedrooms,
        bathrooms,
        property_locations ( area, county ),
        property_pricing ( monthly_rent, asking_price, currency ),
        property_media ( url, is_cover )
      )
    `)
    .eq('user_id', user.userId)
    .order('saved_at', { ascending: false });

  if (error) {
    logger.error({ error, userId: user.userId }, 'saved_properties.list.failed');
    return c.json({ message: 'Failed to load saved properties', code: 'DB_ERROR' }, 500);
  }

  // Shape data to match the frontend SavedProperty interface
  const shaped = (data ?? []).map((row: any) => {
    const p       = row.properties ?? {};
    const loc     = Array.isArray(p.property_locations) ? p.property_locations[0] : p.property_locations;
    const pricing = Array.isArray(p.property_pricing)   ? p.property_pricing[0]   : p.property_pricing;
    const media   = (p.property_media ?? []);
    const cover   = media.find((m: any) => m.is_cover)?.url ?? media[0]?.url ?? '';
    const amount  = pricing?.monthly_rent ?? pricing?.asking_price ?? 0;
    const currency = pricing?.currency ?? 'KES';

    return {
      id:        row.property_id,
      type:      p.listing_category ?? 'property',
      name:      p.title ?? 'Unnamed Property',
      price:     amount ? `${currency} ${Number(amount).toLocaleString()}` : 'Price on request',
      location:  [loc?.area, loc?.county].filter(Boolean).join(', ') || 'Kenya',
      bedrooms:  p.bedrooms  ?? 0,
      bathrooms: p.bathrooms ?? 0,
      image:     cover,
      savedAt:   row.saved_at,
    };
  });

  return c.json(shaped);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/user/saved-properties
// Body: { propertyId: string }
// ─────────────────────────────────────────────────────────────────────────────
userRouter.post('/saved-properties', async (c) => {
  const user = c.get('user') as { userId: string };

  let body: any;
  try { body = await c.req.json(); }
  catch { return c.json({ message: 'Invalid JSON', code: 'BAD_REQUEST' }, 400); }

  const propertyId = body.propertyId ?? body.property_id;
  if (!propertyId) {
    return c.json({ message: 'propertyId is required', code: 'VALIDATION_ERROR' }, 422);
  }

  const { error } = await supabaseAdmin
    .from('saved_properties')
    .upsert(
      { user_id: user.userId, property_id: String(propertyId) },
      { onConflict: 'user_id,property_id', ignoreDuplicates: true },
    );

  if (error) {
    logger.error({ error, userId: user.userId, propertyId }, 'saved_properties.save.failed');
    return c.json({ message: 'Failed to save property', code: 'DB_ERROR' }, 500);
  }

  return c.json({ message: 'Property saved' }, 201);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/user/saved-properties/sync  (must be before /:id to avoid conflict)
// Body: { properties: SavedProperty[] }  — replaces the entire saved list
// ─────────────────────────────────────────────────────────────────────────────
userRouter.post('/saved-properties/sync', async (c) => {
  const user = c.get('user') as { userId: string };

  let body: any;
  try { body = await c.req.json(); }
  catch { return c.json({ message: 'Invalid JSON', code: 'BAD_REQUEST' }, 400); }

  const properties: Array<{ id: string | number }> = body.properties ?? [];

  // Delete all existing, then re-insert
  await supabaseAdmin.from('saved_properties').delete().eq('user_id', user.userId);

  if (properties.length > 0) {
    const rows = properties.map((p) => ({
      user_id:     user.userId,
      property_id: String(p.id),
    }));

    const { error } = await supabaseAdmin.from('saved_properties').insert(rows);
    if (error) {
      logger.error({ error, userId: user.userId }, 'saved_properties.sync.failed');
      return c.json({ message: 'Sync partially failed', code: 'DB_ERROR' }, 500);
    }
  }

  return c.json({ message: 'Saved properties synced' });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/user/saved-properties/:id
// ─────────────────────────────────────────────────────────────────────────────
userRouter.delete('/saved-properties/:id', async (c) => {
  const user       = c.get('user') as { userId: string };
  const propertyId = c.req.param('id');

  const { error } = await supabaseAdmin
    .from('saved_properties')
    .delete()
    .eq('user_id', user.userId)
    .eq('property_id', propertyId);

  if (error) {
    logger.error({ error, userId: user.userId, propertyId }, 'saved_properties.delete.failed');
    return c.json({ message: 'Failed to remove saved property', code: 'DB_ERROR' }, 500);
  }

  return c.json({ message: 'Property removed from saved' });
});
