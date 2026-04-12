/**
 * properties.service.ts
 *
 * All Supabase queries reference the exact table and column names from the schema.
 * Tables used:
 *   properties, property_locations, property_pricing, property_contacts,
 *   property_media, property_amenities, nearby_places, listing_search_scores,
 *   rental_units, rental_buildings, short_term_config, availability_calendar,
 *   commercial_config, plot_details, offplan_details, caretaker_assignments
 *
 * Nearby-places distance calculation:
 *   The caller supplies lat/lng for each place.  We compute distance, walk time,
 *   and drive time using the Haversine formula and store the results in
 *   nearby_places.distance_m, walk_minutes, drive_minutes.
 *   No external geocoding API is required.
 */

import { supabaseAdmin } from '../utils/supabase.js';
import { logger }        from '../utils/logger.js';
import {
  uploadPropertyMedia,
  uploadPropertyMediaBatch,
  deletePropertyMedia,
  deletePropertyMediaByTag,
  type PropertyMediaType,
} from '../utils/cloudinary.js';
import type {
  CreatePropertyInput,
  UpdatePropertyInput,
  ListPropertiesInput,
  NearbyPlaceInput,
  DistanceResult,
  RentalUnitInput,
  ShortTermConfigInput,
  CommercialConfigInput,
  PlotDetailsInput,
  OffplanDetailsInput,
  AvailabilityBlockInput,
} from '../types/property.types.js';

// =============================================================================
// Haversine helpers  (pure functions — no DB, no network)
// =============================================================================

const EARTH_RADIUS_M        = 6_371_000; // metres
const AVG_WALK_SPEED_M_MIN  = 80;        // ~5 km/h
const AVG_DRIVE_SPEED_M_MIN = 500;       // ~30 km/h in Nairobi traffic

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Returns distance in metres between two WGS-84 coordinates.
 */
function haversineMetres(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function computeDistanceResult(
  propLat: number, propLon: number,
  placeLat: number, placeLon: number,
): DistanceResult {
  const distanceM    = Math.round(haversineMetres(propLat, propLon, placeLat, placeLon));
  const walkMinutes  = Math.round(distanceM / AVG_WALK_SPEED_M_MIN);
  const driveMinutes = Math.max(1, Math.round(distanceM / AVG_DRIVE_SPEED_M_MIN));
  return { distanceM, walkMinutes, driveMinutes };
}


// =============================================================================
// Cloudinary helper
// =============================================================================

/**
 * Extract the Cloudinary public_id from a full secure_url.
 * e.g. "https://res.cloudinary.com/dwuizf438/image/upload/v12345/getkeja/properties/abc/photos/xyz.webp"
 *      → "getkeja/properties/abc/photos/xyz"
 */
function extractCloudinaryPublicId(url: string): string {
  try {
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i);
    return match?.[1] ?? url;
  } catch {
    return url;
  }
}

// =============================================================================
// PropertiesService
// =============================================================================
export class PropertiesService {

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a property with all sub-records in the correct dependency order.
   *
   * Dependency order (all reference property.id):
   *   1. properties          (root)
   *   2. property_locations  (needs property.id)
   *   3. property_pricing    (needs property.id)
   *   4. property_contacts   (needs property.id)
   *   5. property_media      (needs property.id)
   *   6. property_amenities  (needs property.id)
   *   7. nearby_places       (needs property.id + property lat/lng for Haversine)
   *   8. Type-specific tables (rental_units, short_term_config, etc.)
   *   9. listing_search_scores (seed row so triggers have something to update)
   */
  async createProperty(createdBy: string, input: CreatePropertyInput) {
    const {
      location,
      pricing,
      contacts,
      media        = [],
      amenities    = [],
      nearby_places = [],
      rental_unit,
      short_term_config,
      commercial_config,
      plot_details,
      offplan_details,
      ...coreFields
    } = input;

    // ── 1. Core property row ─────────────────────────────────────────────
    const { data: property, error: propErr } = await supabaseAdmin
      .from('properties')
      .insert({
        listing_category:    coreFields.listing_category,
        listing_type:        coreFields.listing_type,
        management_model:    coreFields.management_model,
        title:               coreFields.title,
        description:         coreFields.description          ?? null,
        status:              'available',    // always starts available
        construction_status: coreFields.construction_status,
        year_built:          coreFields.year_built           ?? null,
        floor_area_sqm:      coreFields.floor_area_sqm       ?? null,
        plot_area_sqft:      coreFields.plot_area_sqft       ?? null,
        bedrooms:            coreFields.bedrooms             ?? null,
        bathrooms:           coreFields.bathrooms            ?? null,
        is_ensuite:          coreFields.is_ensuite,
        parking_spaces:      coreFields.parking_spaces,
        compound_is_gated:   coreFields.compound_is_gated,
        security_type:       coreFields.security_type        ?? null,
        water_supply:        coreFields.water_supply         ?? null,
        has_borehole:        coreFields.has_borehole,
        electricity_supply:  coreFields.electricity_supply   ?? null,
        waste_management:    coreFields.waste_management     ?? null,
        is_furnished:        coreFields.is_furnished,
        is_featured:         false,
        created_by:          createdBy,
      })
      .select('id')
      .single();

    if (propErr || !property) {
      logger.error({ propErr, createdBy }, 'properties.create.failed');
      throw new Error(`Failed to create property: ${propErr?.message}`);
    }

    const propertyId = property.id;
    logger.info({ propertyId, createdBy }, 'properties.core.created');

    // ── 2. Location ──────────────────────────────────────────────────────
    const { error: locErr } = await supabaseAdmin
      .from('property_locations')
      .insert({
        property_id:          propertyId,
        county:               location.county,
        sub_county:           location.sub_county           ?? null,
        area:                 location.area                 ?? null,
        estate_name:          location.estate_name          ?? null,
        road_street:          location.road_street          ?? null,
        plot_number:          location.plot_number          ?? null,
        directions:           location.directions           ?? null,
        nearest_landmark:     location.nearest_landmark     ?? null,
        latitude:             location.latitude,
        longitude:            location.longitude,
        geom:                 `POINT(${location.longitude} ${location.latitude})`,
        display_full_address: location.display_full_address,
        matatu_routes:        location.matatu_routes        ?? null,
      });

    if (locErr) {
      logger.error({ locErr, propertyId }, 'properties.location.insert.failed');
    }

    // ── 3. Pricing ───────────────────────────────────────────────────────
    const { error: priceErr } = await supabaseAdmin
      .from('property_pricing')
      .insert({
        property_id:           propertyId,
        currency:              pricing.currency,
        asking_price:          pricing.asking_price          ?? null,
        monthly_rent:          pricing.monthly_rent          ?? null,
        rent_frequency:        pricing.rent_frequency,
        deposit_months:        pricing.deposit_months        ?? null,
        deposit_amount:        pricing.deposit_amount        ?? null,
        goodwill_fee:          pricing.goodwill_fee          ?? null,
        service_charge:        pricing.service_charge        ?? null,
        caretaker_fee:         pricing.caretaker_fee         ?? null,
        garbage_fee:           pricing.garbage_fee           ?? null,
        water_bill_type:       pricing.water_bill_type,
        electricity_bill_type: pricing.electricity_bill_type,
        negotiable:            pricing.negotiable,
        agent_commission_pct:  pricing.agent_commission_pct  ?? null,
      });

    if (priceErr) {
      logger.error({ priceErr, propertyId }, 'properties.pricing.insert.failed');
    }

    // ── 4. Contacts ──────────────────────────────────────────────────────
    if (contacts.length > 0) {
      const { error: contactErr } = await supabaseAdmin
        .from('property_contacts')
        .insert(
          contacts.map((c) => ({
            property_id:        propertyId,
            role:               c.role,
            full_name:          c.full_name,
            display_name:       c.display_name       ?? null,
            phone_primary:      c.phone_primary,
            phone_secondary:    c.phone_secondary    ?? null,
            whatsapp_number:    c.whatsapp_number    ?? null,
            email:              c.email              ?? null,
            is_primary_contact: c.is_primary_contact,
            is_on_site:         c.is_on_site,
            availability_hours: c.availability_hours ?? null,
            languages:          c.languages          ?? null,
            agent_license_no:   c.agent_license_no   ?? null,
          })),
        );

      if (contactErr) {
        logger.error({ contactErr, propertyId }, 'properties.contacts.insert.failed');
      }
    }

    // ── 5. Media — upload to Cloudinary, store only the returned URL ────
    if (media.length > 0) {
      try {
        const uploaded = await uploadPropertyMediaBatch(
          media.map((m, idx) => ({
            fileSource: m.file,
            options: {
              mediaType:     m.media_type as PropertyMediaType,
              propertyId,
              publicIdSuffix: `${idx}-${crypto.randomUUID()}`,
              isCover:       m.is_cover,
            },
          })),
        );

        const { error: mediaErr } = await supabaseAdmin
          .from('property_media')
          .insert(
            uploaded.map((result, idx) => ({
              property_id:   propertyId,
              media_type:    media[idx].media_type,
              url:           result.url,
              thumbnail_url: result.thumbnail_url,
              caption:       media[idx].caption     ?? null,
              sort_order:    media[idx].sort_order  ?? idx,
              is_cover:      media[idx].is_cover,
            })),
          );

        if (mediaErr) {
          logger.error({ mediaErr, propertyId }, 'properties.media.db_insert.failed');
        } else {
          logger.info({ propertyId, count: uploaded.length }, 'properties.media.uploaded');
        }
      } catch (uploadErr: any) {
        logger.error(
          { err: uploadErr?.message, propertyId },
          'properties.media.cloudinary_upload.failed',
        );
      }
    }

    // ── 6. Amenities ─────────────────────────────────────────────────────
    if (amenities.length > 0) {
      const { error: amenityErr } = await supabaseAdmin
        .from('property_amenities')
        .insert(
          amenities.map((a) => ({
            property_id: propertyId,
            category:    a.category,
            name:        a.name,
            is_included: a.is_included,
            notes:       a.notes ?? null,
          })),
        );

      if (amenityErr) {
        logger.error({ amenityErr, propertyId }, 'properties.amenities.insert.failed');
      }
    }

    // ── 7. Nearby places with Haversine distance calculation ─────────────
    if (nearby_places.length > 0) {
      const propLat = location.latitude;
      const propLon = location.longitude;

      const placesRows = nearby_places.map((place) => {
        const { distanceM, walkMinutes, driveMinutes } = computeDistanceResult(
          propLat, propLon,
          place.latitude, place.longitude,
        );

        return {
          property_id:       propertyId,
          place_type:        place.place_type,
          name:              place.name,
          distance_m:        distanceM,
          walk_minutes:      walkMinutes,
          drive_minutes:     driveMinutes,
          matatu_stage_name: place.matatu_stage_name ?? null,
          school_type:       place.school_type       ?? null,
          google_maps_url:   place.google_maps_url   ?? null,
          verified:          false,
        };
      });

      const { error: placesErr } = await supabaseAdmin
        .from('nearby_places')
        .insert(placesRows);

      if (placesErr) {
        logger.error({ placesErr, propertyId }, 'properties.nearby_places.insert.failed');
      } else {
        logger.info(
          { propertyId, count: placesRows.length },
          'properties.nearby_places.inserted',
        );
      }
    }

    // ── 8. Type-specific tables ──────────────────────────────────────────
    
    // 8a. Rental Unit (for properties in rental buildings)
    if (rental_unit) {
      await this.createRentalUnit(propertyId, rental_unit);
    }

    // 8b. Short-term configuration (for short_term_rent category)
    if (short_term_config) {
      await this.createShortTermConfig(propertyId, short_term_config);
    }

    // 8c. Commercial configuration (for commercial category)
    if (commercial_config) {
      await this.createCommercialConfig(propertyId, commercial_config);
    }

    // 8d. Plot details (for plot listing_type)
    if (plot_details) {
      await this.createPlotDetails(propertyId, plot_details);
    }

    // 8e. Off-plan details (for off_plan construction_status)
    if (offplan_details) {
      await this.createOffplanDetails(propertyId, offplan_details);
    }

    // ── 9. Seed search score row ─────────────────────────────────────────
    await supabaseAdmin
      .from('listing_search_scores')
      .upsert({ property_id: propertyId }, { onConflict: 'property_id' });

    return this.getPropertyById(propertyId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Type-specific creation helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async createRentalUnit(propertyId: string, input: RentalUnitInput) {
    const { error } = await supabaseAdmin
      .from('rental_units')
      .insert({
        property_id: propertyId,
        building_id: input.building_id,
        unit_number: input.unit_number ?? null,
        floor_level: input.floor_level ?? null,
        unit_type: input.unit_type ?? null,
        faces: input.faces ?? null,
        has_balcony: input.has_balcony ?? false,
        is_corner_unit: input.is_corner_unit ?? false,
        availability_date: input.availability_date ?? null,
        current_tenant_vacating: input.current_tenant_vacating ?? false,
      });

    if (error) {
      logger.error({ error, propertyId }, 'properties.rental_unit.create.failed');
      throw new Error(`Failed to create rental unit: ${error.message}`);
    }
  }

  private async createShortTermConfig(propertyId: string, input: ShortTermConfigInput) {
    const { error } = await supabaseAdmin
      .from('short_term_config')
      .insert({
        property_id: propertyId,
        short_term_type: input.short_term_type,
        price_per_night: input.price_per_night,
        price_per_weekend: input.price_per_weekend ?? null,
        price_per_event: input.price_per_event ?? null,
        min_nights: input.min_nights ?? 1,
        max_nights: input.max_nights ?? null,
        max_guests: input.max_guests ?? null,
        max_event_capacity: input.max_event_capacity ?? null,
        noise_curfew_time: input.noise_curfew_time ?? null,
        check_in_time: input.check_in_time ?? '14:00',
        check_out_time: input.check_out_time ?? '10:00',
        instant_book: input.instant_book ?? false,
        cleaning_fee: input.cleaning_fee ?? null,
        damage_deposit: input.damage_deposit ?? null,
        rules: input.rules ?? null,
        airbnb_listing_url: input.airbnb_listing_url ?? null,
        catering_available: input.catering_available ?? false,
      });

    if (error) {
      logger.error({ error, propertyId }, 'properties.short_term_config.create.failed');
      throw new Error(`Failed to create short-term config: ${error.message}`);
    }
  }

  private async createCommercialConfig(propertyId: string, input: CommercialConfigInput) {
    const { error } = await supabaseAdmin
      .from('commercial_config')
      .insert({
        property_id: propertyId,
        commercial_type: input.commercial_type,
        floor_area_sqft: input.floor_area_sqft ?? null,
        ceiling_height_m: input.ceiling_height_m ?? null,
        loading_bay: input.loading_bay ?? false,
        drive_in_access: input.drive_in_access ?? false,
        three_phase_power: input.three_phase_power ?? false,
        event_capacity_seated: input.event_capacity_seated ?? null,
        event_capacity_standing: input.event_capacity_standing ?? null,
        has_catering_kitchen: input.has_catering_kitchen ?? false,
        has_pa_system: input.has_pa_system ?? false,
        has_projector_screen: input.has_projector_screen ?? false,
        outdoor_space_sqm: input.outdoor_space_sqm ?? null,
        zoning_classification: input.zoning_classification ?? null,
        alcohol_license_possible: input.alcohol_license_possible ?? false,
      });

    if (error) {
      logger.error({ error, propertyId }, 'properties.commercial_config.create.failed');
      throw new Error(`Failed to create commercial config: ${error.message}`);
    }
  }

  private async createPlotDetails(propertyId: string, input: PlotDetailsInput) {
    const { error } = await supabaseAdmin
      .from('plot_details')
      .insert({
        property_id: propertyId,
        size_acres: input.size_acres ?? null,
        size_sqft: input.size_sqft ?? null,
        road_frontage_m: input.road_frontage_m ?? null,
        is_corner_plot: input.is_corner_plot ?? false,
        terrain: input.terrain ?? null,
        soil_type: input.soil_type ?? null,
        is_serviced: input.is_serviced ?? false,
        zoning_use: input.zoning_use ?? null,
        payment_plan_available: input.payment_plan_available ?? false,
        installment_months: input.installment_months ?? null,
      });

    if (error) {
      logger.error({ error, propertyId }, 'properties.plot_details.create.failed');
      throw new Error(`Failed to create plot details: ${error.message}`);
    }
  }

  private async createOffplanDetails(propertyId: string, input: OffplanDetailsInput) {
    const { error } = await supabaseAdmin
      .from('offplan_details')
      .insert({
        property_id: propertyId,
        project_name: input.project_name,
        developer_name: input.developer_name ?? null,
        completion_quarter: input.completion_quarter ?? null,
        construction_pct: input.construction_pct ?? 0,
        total_units_in_project: input.total_units_in_project ?? null,
        units_sold: input.units_sold ?? 0,
        payment_plan: input.payment_plan ?? null,
        escrow_bank: input.escrow_bank ?? null,
        nca_reg_number: input.nca_reg_number ?? null,
      });

    if (error) {
      logger.error({ error, propertyId }, 'properties.offplan_details.create.failed');
      throw new Error(`Failed to create off-plan details: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // READ — single property (full join including type-specific tables)
  // ─────────────────────────────────────────────────────────────────────────
  async getPropertyById(propertyId: string) {
    const { data, error } = await supabaseAdmin
      .from('properties')
      .select(`
        id, listing_category, listing_type, management_model, title, description,
        status, construction_status, year_built, floor_area_sqm, plot_area_sqft,
        bedrooms, bathrooms, is_ensuite, parking_spaces, compound_is_gated,
        security_type, water_supply, has_borehole, electricity_supply,
        waste_management, is_furnished, is_featured, published_at,
        created_by, created_at, updated_at,
        property_locations (
          county, sub_county, area, estate_name, road_street, plot_number,
          directions, nearest_landmark, latitude, longitude,
          display_full_address, matatu_routes
        ),
        property_pricing (
          currency, asking_price, monthly_rent, rent_frequency,
          deposit_months, deposit_amount, goodwill_fee, service_charge,
          caretaker_fee, garbage_fee, water_bill_type, electricity_bill_type,
          negotiable, agent_commission_pct, price_history
        ),
        property_contacts (
          id, role, full_name, display_name, phone_primary, phone_secondary,
          whatsapp_number, email, is_primary_contact, is_on_site,
          availability_hours, languages, agent_license_no,
          license_verified, id_verified, verified_at
        ),
        property_media (
          id, media_type, url, thumbnail_url, caption, sort_order, is_cover, uploaded_at
        ),
        property_amenities (
          id, category, name, is_included, notes
        ),
        nearby_places (
          id, place_type, name, distance_m, walk_minutes, drive_minutes,
          matatu_stage_name, school_type, google_maps_url, verified
        ),
        listing_search_scores (
          total_score, boost_score, base_score, engagement_score, verification_score
        ),
        rental_units (
          id, building_id, unit_number, floor_level, unit_type, faces,
          has_balcony, is_corner_unit, availability_date, current_tenant_vacating,
          buildings:rental_buildings (id, name, total_units, floors, has_lift, has_backup_generator, has_swimming_pool, has_gym, has_rooftop, parking_type, compound_shared_spaces, management_company, year_built)
        ),
        short_term_config (
          id, short_term_type, price_per_night, price_per_weekend, price_per_event,
          min_nights, max_nights, max_guests, max_event_capacity, noise_curfew_time,
          check_in_time, check_out_time, instant_book, cleaning_fee, damage_deposit,
          rules, airbnb_listing_url, catering_available
        ),
        commercial_config (
          id, commercial_type, floor_area_sqft, ceiling_height_m, loading_bay,
          drive_in_access, three_phase_power, event_capacity_seated,
          event_capacity_standing, has_catering_kitchen, has_pa_system,
          has_projector_screen, outdoor_space_sqm, zoning_classification,
          alcohol_license_possible
        ),
        plot_details (
          id, size_acres, size_sqft, road_frontage_m, is_corner_plot,
          terrain, soil_type, is_serviced, zoning_use,
          payment_plan_available, installment_months
        ),
        offplan_details (
          id, project_name, developer_name, completion_quarter, construction_pct,
          total_units_in_project, units_sold, payment_plan, escrow_bank, nca_reg_number
        )
      `)
      .eq('id', propertyId)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      throw new Error(`Property not found: ${error?.message ?? propertyId}`);
    }

    return this.formatProperty(data);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // READ — paginated list (basic info only, type details fetched separately if needed)
  // ─────────────────────────────────────────────────────────────────────────
  async listProperties(filters: ListPropertiesInput) {
    const {
      page, limit,
      listing_category, listing_type, status,
      county, area,
      min_price, max_price,
      bedrooms, is_furnished, is_featured, construction_status,
      lat, lng, radius,
    } = filters;

    const from = (page - 1) * limit;
    const to   = from + limit - 1;

    let query = supabaseAdmin
      .from('properties')
      .select(
        `id, listing_category, listing_type, title, status, bedrooms, bathrooms,
         is_furnished, is_featured, published_at, created_at,
         property_locations ( county, area, estate_name, latitude, longitude ),
         property_pricing   ( asking_price, monthly_rent, currency, negotiable ),
         property_media     ( url, thumbnail_url, is_cover, sort_order ),
         listing_search_scores ( total_score )`,
        { count: 'exact' },
      )
      .is('deleted_at', null)
      .eq('status', status ?? 'available');

    if (listing_category)    query = query.eq('listing_category', listing_category);
    if (listing_type)        query = query.eq('listing_type', listing_type);
    if (bedrooms !== undefined) query = query.eq('bedrooms', bedrooms);
    if (is_furnished)        query = query.eq('is_furnished', is_furnished);
    if (is_featured !== undefined) query = query.eq('is_featured', is_featured);
    if (construction_status) query = query.eq('construction_status', construction_status);

    // Price range — applied on the joined pricing row via PostgREST
    if (min_price !== undefined) {
      query = query.gte('property_pricing.monthly_rent', min_price)
                   .gte('property_pricing.asking_price', min_price);
    }
    if (max_price !== undefined) {
      query = query.lte('property_pricing.monthly_rent', max_price)
                   .lte('property_pricing.asking_price', max_price);
    }

    // Location text filters
    if (county) query = query.ilike('property_locations.county', `%${county}%`);
    if (area)   query = query.ilike('property_locations.area',   `%${area}%`);

    const { data, count, error } = await query
      .order('listing_search_scores.total_score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      logger.error({ error, filters }, 'properties.list.failed');
      throw new Error(`Failed to list properties: ${error.message}`);
    }

    // If geo filter requested, apply Haversine post-filter in JS
    let properties = (data ?? [])
      .map((row) => this.formatProperty(row))
      .filter((p): p is NonNullable<ReturnType<typeof this.formatProperty>> => p !== null);
    if (lat !== undefined && lng !== undefined) {
      const radiusM = (radius ?? 5) * 1_000;
      properties = properties.filter((p) => {
        const loc = p.location;
        if (!loc?.latitude || !loc?.longitude) return false;
        return haversineMetres(lat, lng, loc.latitude, loc.longitude) <= radiusM;
      });
    }

    return {
      properties,
      total: count ?? 0,
      page,
      limit,
      pages: Math.ceil((count ?? 0) / limit),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE
  // ─────────────────────────────────────────────────────────────────────────
  async updateProperty(
    propertyId: string,
    userId: string,
    input: UpdatePropertyInput,
    isAdmin = false,
  ) {
    // Ownership check (admins bypass)
    if (!isAdmin) {
      await this.assertOwnership(propertyId, userId);
    }

    const {
      location,
      pricing,
      contacts,
      media,
      amenities,
      nearby_places,
      rental_unit,
      short_term_config,
      commercial_config,
      plot_details,
      offplan_details,
      ...coreUpdates
    } = input;

    // ── Core fields ──────────────────────────────────────────────────────
    if (Object.keys(coreUpdates).length > 0) {
      const { error } = await supabaseAdmin
        .from('properties')
        .update({ ...coreUpdates, updated_at: new Date().toISOString() })
        .eq('id', propertyId);

      if (error) throw new Error(`Failed to update property: ${error.message}`);
    }

    // ── Location ─────────────────────────────────────────────────────────
    if (location) {
      const patch: Record<string, unknown> = { ...location };
      if (location.latitude && location.longitude) {
        patch.geom = `POINT(${location.longitude} ${location.latitude})`;
      }
      const { error } = await supabaseAdmin
        .from('property_locations')
        .update(patch)
        .eq('property_id', propertyId);

      if (error) logger.error({ error, propertyId }, 'properties.location.update.failed');
    }

    // ── Pricing ──────────────────────────────────────────────────────────
    if (pricing) {
      const { error } = await supabaseAdmin
        .from('property_pricing')
        .update({ ...pricing, updated_at: new Date().toISOString() })
        .eq('property_id', propertyId);

      if (error) logger.error({ error, propertyId }, 'properties.pricing.update.failed');
    }

    // ── Contacts — full replace if provided ──────────────────────────────
    if (contacts && contacts.length > 0) {
      await supabaseAdmin.from('property_contacts').delete().eq('property_id', propertyId);
      await supabaseAdmin.from('property_contacts').insert(
        contacts.map((c) => ({ property_id: propertyId, ...c })),
      );
    }

    // ── Media — upload new files to Cloudinary, full replace in DB ─────
    if (media && media.length > 0) {
      // First fetch existing media so we can delete from Cloudinary
      const { data: existingMedia } = await supabaseAdmin
        .from('property_media')
        .select('url, thumbnail_url, media_type')
        .eq('property_id', propertyId);

      // Delete old Cloudinary assets (best-effort — non-fatal)
      if (existingMedia && existingMedia.length > 0) {
        await Promise.allSettled(
          existingMedia.map((m: any) =>
            deletePropertyMedia(
              extractCloudinaryPublicId(m.url),
              (m.media_type === 'video' || m.media_type === 'drone') ? 'video' : 'image',
            ),
          ),
        );
      }

      // Upload new files to Cloudinary
      const uploaded = await uploadPropertyMediaBatch(
        media.map((m, idx) => ({
          fileSource: m.file,
          options: {
            mediaType:     m.media_type as PropertyMediaType,
            propertyId,
            publicIdSuffix: `${idx}-${crypto.randomUUID()}`,
            isCover:       m.is_cover,
          },
        })),
      );

      // Replace DB rows
      await supabaseAdmin.from('property_media').delete().eq('property_id', propertyId);
      await supabaseAdmin.from('property_media').insert(
        uploaded.map((result, idx) => ({
          property_id:   propertyId,
          media_type:    media[idx].media_type,
          url:           result.url,
          thumbnail_url: result.thumbnail_url,
          caption:       media[idx].caption    ?? null,
          sort_order:    media[idx].sort_order ?? idx,
          is_cover:      media[idx].is_cover,
        })),
      );
    }

    // ── Amenities — full replace if provided ─────────────────────────────
    if (amenities && amenities.length > 0) {
      await supabaseAdmin.from('property_amenities').delete().eq('property_id', propertyId);
      await supabaseAdmin.from('property_amenities').insert(
        amenities.map((a) => ({ property_id: propertyId, ...a })),
      );
    }

    // ── Nearby places — recalculate distances if lat/lng changed ─────────
    if (nearby_places && nearby_places.length > 0) {
      // Get current property lat/lng (may differ from input if location not updated)
      const { data: loc } = await supabaseAdmin
        .from('property_locations')
        .select('latitude, longitude')
        .eq('property_id', propertyId)
        .maybeSingle();

      const propLat = location?.latitude ?? loc?.latitude;
      const propLon = location?.longitude ?? loc?.longitude;

      if (propLat && propLon) {
        await supabaseAdmin.from('nearby_places').delete().eq('property_id', propertyId);
        await supabaseAdmin.from('nearby_places').insert(
          nearby_places.map((place) => {
            const { distanceM, walkMinutes, driveMinutes } = computeDistanceResult(
              propLat, propLon, place.latitude, place.longitude,
            );
            return {
              property_id:       propertyId,
              place_type:        place.place_type,
              name:              place.name,
              distance_m:        distanceM,
              walk_minutes:      walkMinutes,
              drive_minutes:     driveMinutes,
              matatu_stage_name: place.matatu_stage_name ?? null,
              school_type:       place.school_type       ?? null,
              google_maps_url:   place.google_maps_url   ?? null,
              verified:          false,
            };
          }),
        );
      }
    }

    // ── Type-specific updates (upsert) ────────────────────────────────────
    
    if (rental_unit !== undefined) {
      await this.upsertRentalUnit(propertyId, rental_unit);
    }

    if (short_term_config !== undefined) {
      await this.upsertShortTermConfig(propertyId, short_term_config);
    }

    if (commercial_config !== undefined) {
      await this.upsertCommercialConfig(propertyId, commercial_config);
    }

    if (plot_details !== undefined) {
      await this.upsertPlotDetails(propertyId, plot_details);
    }

    if (offplan_details !== undefined) {
      await this.upsertOffplanDetails(propertyId, offplan_details);
    }

    return this.getPropertyById(propertyId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Type-specific upsert helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async upsertRentalUnit(propertyId: string, input: RentalUnitInput | null) {
    if (input === null) {
      // Delete if exists
      await supabaseAdmin.from('rental_units').delete().eq('property_id', propertyId);
      return;
    }

    const { error } = await supabaseAdmin
      .from('rental_units')
      .upsert({
        property_id: propertyId,
        building_id: input.building_id,
        unit_number: input.unit_number ?? null,
        floor_level: input.floor_level ?? null,
        unit_type: input.unit_type ?? null,
        faces: input.faces ?? null,
        has_balcony: input.has_balcony ?? false,
        is_corner_unit: input.is_corner_unit ?? false,
        availability_date: input.availability_date ?? null,
        current_tenant_vacating: input.current_tenant_vacating ?? false,
      }, { onConflict: 'property_id' });

    if (error) {
      logger.error({ error, propertyId }, 'properties.rental_unit.upsert.failed');
      throw new Error(`Failed to update rental unit: ${error.message}`);
    }
  }

  private async upsertShortTermConfig(propertyId: string, input: ShortTermConfigInput | null) {
    if (input === null) {
      await supabaseAdmin.from('short_term_config').delete().eq('property_id', propertyId);
      return;
    }

    const { error } = await supabaseAdmin
      .from('short_term_config')
      .upsert({
        property_id: propertyId,
        short_term_type: input.short_term_type,
        price_per_night: input.price_per_night,
        price_per_weekend: input.price_per_weekend ?? null,
        price_per_event: input.price_per_event ?? null,
        min_nights: input.min_nights ?? 1,
        max_nights: input.max_nights ?? null,
        max_guests: input.max_guests ?? null,
        max_event_capacity: input.max_event_capacity ?? null,
        noise_curfew_time: input.noise_curfew_time ?? null,
        check_in_time: input.check_in_time ?? '14:00',
        check_out_time: input.check_out_time ?? '10:00',
        instant_book: input.instant_book ?? false,
        cleaning_fee: input.cleaning_fee ?? null,
        damage_deposit: input.damage_deposit ?? null,
        rules: input.rules ?? null,
        airbnb_listing_url: input.airbnb_listing_url ?? null,
        catering_available: input.catering_available ?? false,
      }, { onConflict: 'property_id' });

    if (error) {
      logger.error({ error, propertyId }, 'properties.short_term_config.upsert.failed');
      throw new Error(`Failed to update short-term config: ${error.message}`);
    }
  }

  private async upsertCommercialConfig(propertyId: string, input: CommercialConfigInput | null) {
    if (input === null) {
      await supabaseAdmin.from('commercial_config').delete().eq('property_id', propertyId);
      return;
    }

    const { error } = await supabaseAdmin
      .from('commercial_config')
      .upsert({
        property_id: propertyId,
        commercial_type: input.commercial_type,
        floor_area_sqft: input.floor_area_sqft ?? null,
        ceiling_height_m: input.ceiling_height_m ?? null,
        loading_bay: input.loading_bay ?? false,
        drive_in_access: input.drive_in_access ?? false,
        three_phase_power: input.three_phase_power ?? false,
        event_capacity_seated: input.event_capacity_seated ?? null,
        event_capacity_standing: input.event_capacity_standing ?? null,
        has_catering_kitchen: input.has_catering_kitchen ?? false,
        has_pa_system: input.has_pa_system ?? false,
        has_projector_screen: input.has_projector_screen ?? false,
        outdoor_space_sqm: input.outdoor_space_sqm ?? null,
        zoning_classification: input.zoning_classification ?? null,
        alcohol_license_possible: input.alcohol_license_possible ?? false,
      }, { onConflict: 'property_id' });

    if (error) {
      logger.error({ error, propertyId }, 'properties.commercial_config.upsert.failed');
      throw new Error(`Failed to update commercial config: ${error.message}`);
    }
  }

  private async upsertPlotDetails(propertyId: string, input: PlotDetailsInput | null) {
    if (input === null) {
      await supabaseAdmin.from('plot_details').delete().eq('property_id', propertyId);
      return;
    }

    const { error } = await supabaseAdmin
      .from('plot_details')
      .upsert({
        property_id: propertyId,
        size_acres: input.size_acres ?? null,
        size_sqft: input.size_sqft ?? null,
        road_frontage_m: input.road_frontage_m ?? null,
        is_corner_plot: input.is_corner_plot ?? false,
        terrain: input.terrain ?? null,
        soil_type: input.soil_type ?? null,
        is_serviced: input.is_serviced ?? false,
        zoning_use: input.zoning_use ?? null,
        payment_plan_available: input.payment_plan_available ?? false,
        installment_months: input.installment_months ?? null,
      }, { onConflict: 'property_id' });

    if (error) {
      logger.error({ error, propertyId }, 'properties.plot_details.upsert.failed');
      throw new Error(`Failed to update plot details: ${error.message}`);
    }
  }

  private async upsertOffplanDetails(propertyId: string, input: OffplanDetailsInput | null) {
    if (input === null) {
      await supabaseAdmin.from('offplan_details').delete().eq('property_id', propertyId);
      return;
    }

    const { error } = await supabaseAdmin
      .from('offplan_details')
      .upsert({
        property_id: propertyId,
        project_name: input.project_name,
        developer_name: input.developer_name ?? null,
        completion_quarter: input.completion_quarter ?? null,
        construction_pct: input.construction_pct ?? 0,
        total_units_in_project: input.total_units_in_project ?? null,
        units_sold: input.units_sold ?? 0,
        payment_plan: input.payment_plan ?? null,
        escrow_bank: input.escrow_bank ?? null,
        nca_reg_number: input.nca_reg_number ?? null,
      }, { onConflict: 'property_id' });

    if (error) {
      logger.error({ error, propertyId }, 'properties.offplan_details.upsert.failed');
      throw new Error(`Failed to update off-plan details: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SHORT-TERM AVAILABILITY CALENDAR
  // ─────────────────────────────────────────────────────────────────────────

  async addAvailabilityBlocks(
    propertyId: string,
    userId: string,
    blocks: AvailabilityBlockInput[],
    isAdmin = false,
  ) {
    if (!isAdmin) await this.assertOwnership(propertyId, userId);

    // Verify property is short-term rental
    const { data: prop } = await supabaseAdmin
      .from('properties')
      .select('listing_category')
      .eq('id', propertyId)
      .single();

    if (prop?.listing_category !== 'short_term_rent') {
      throw new Error('Availability calendar only applies to short-term rentals');
    }

    const rows = blocks.map((block) => ({
      property_id: propertyId,
      date_from: block.date_from,
      date_to: block.date_to,
      status: block.status ?? 'pending',
      booking_ref: block.booking_ref ?? null,
      price_override: block.price_override ?? null,
      notes: block.notes ?? null,
    }));

    const { data, error } = await supabaseAdmin
      .from('availability_calendar')
      .insert(rows)
      .select();

    if (error) throw new Error(`Failed to add availability blocks: ${error.message}`);
    return data;
  }

  async getAvailability(propertyId: string, startDate: string, endDate: string) {
    const { data, error } = await supabaseAdmin
      .from('availability_calendar')
      .select('*')
      .eq('property_id', propertyId)
      .gte('date_from', startDate)
      .lte('date_to', endDate)
      .order('date_from', { ascending: true });

    if (error) throw new Error(`Failed to fetch availability: ${error.message}`);
    return data;
  }

  async deleteAvailabilityBlock(blockId: string, propertyId: string, userId: string, isAdmin = false) {
    if (!isAdmin) await this.assertOwnership(propertyId, userId);

    const { error } = await supabaseAdmin
      .from('availability_calendar')
      .delete()
      .eq('id', blockId)
      .eq('property_id', propertyId);

    if (error) throw new Error(`Failed to delete availability block: ${error.message}`);
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BUILDINGS API (for rental units)
  // ─────────────────────────────────────────────────────────────────────────

  async getBuildings() {
    const { data, error } = await supabaseAdmin
      .from('rental_buildings')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw new Error(`Failed to fetch buildings: ${error.message}`);
    return data;
  }

  async getBuildingById(buildingId: string) {
    const { data, error } = await supabaseAdmin
      .from('rental_buildings')
      .select(`
        *,
        rental_units (
          id, property_id, unit_number, floor_level, unit_type, faces,
          has_balcony, is_corner_unit, availability_date,
          properties (id, title, status, bedrooms, bathrooms, is_furnished)
        )
      `)
      .eq('id', buildingId)
      .single();

    if (error) throw new Error(`Building not found: ${error.message}`);
    return data;
  }

  async createBuilding(input: any) {
    const { data, error } = await supabaseAdmin
      .from('rental_buildings')
      .insert(input)
      .select()
      .single();

    if (error) throw new Error(`Failed to create building: ${error.message}`);
    return data;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SOFT DELETE
  // ─────────────────────────────────────────────────────────────────────────
  async deleteProperty(propertyId: string, userId: string, isAdmin = false) {
    if (!isAdmin) {
      await this.assertOwnership(propertyId, userId);
    }

    const { error } = await supabaseAdmin
      .from('properties')
      .update({ deleted_at: new Date().toISOString(), status: 'off_market' })
      .eq('id', propertyId)
      .is('deleted_at', null);

    if (error) throw new Error(`Failed to delete property: ${error.message}`);

    // Delete all Cloudinary assets for this property (best-effort, non-fatal)
    deletePropertyMediaByTag(propertyId).catch((err) =>
      logger.error({ err, propertyId }, 'cloudinary.delete_on_property_delete.failed'),
    );

    logger.info({ propertyId, userId }, 'properties.soft_deleted');
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ADMIN — change status
  // ─────────────────────────────────────────────────────────────────────────
  async setPropertyStatus(propertyId: string, status: string) {
    const VALID = ['available', 'let', 'sold', 'off_market', 'under_offer'];
    if (!VALID.includes(status)) throw new Error(`Invalid status: ${status}`);

    const patch: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === 'available') {
      patch.published_at = new Date().toISOString();
    }

    const { error } = await supabaseAdmin
      .from('properties')
      .update(patch)
      .eq('id', propertyId);

    if (error) throw new Error(`Failed to update status: ${error.message}`);
    return this.getPropertyById(propertyId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ADMIN — toggle featured
  // ─────────────────────────────────────────────────────────────────────────
  async setFeatured(propertyId: string, featured: boolean) {
    const { error } = await supabaseAdmin
      .from('properties')
      .update({ is_featured: featured, updated_at: new Date().toISOString() })
      .eq('id', propertyId);

    if (error) throw new Error(`Failed to update featured: ${error.message}`);
    return this.getPropertyById(propertyId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OWNER — my properties
  // ─────────────────────────────────────────────────────────────────────────
  async getMyProperties(userId: string, filters: { status?: string } = {}) {
    let query = supabaseAdmin
      .from('properties')
      .select(`
        id, listing_category, listing_type, title, status, bedrooms,
        is_furnished, is_featured, published_at, created_at,
        property_locations ( county, area, latitude, longitude ),
        property_pricing   ( asking_price, monthly_rent, currency ),
        property_media     ( url, is_cover, sort_order )
      `)
      .eq('created_by', userId)
      .is('deleted_at', null);

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch your properties: ${error.message}`);
    return (data ?? [])
      .map((row) => this.formatProperty(row))
      .filter((p): p is NonNullable<ReturnType<typeof this.formatProperty>> => p !== null);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ADMIN — all properties (paginated)
  // ─────────────────────────────────────────────────────────────────────────
  async getAllPropertiesAdmin(page = 1, limit = 20) {
    const from = (page - 1) * limit;

    const { data, count, error } = await supabaseAdmin
      .from('properties')
      .select(
        `id, listing_category, listing_type, title, status, created_by,
         created_at, deleted_at,
         property_locations ( county, area ),
         property_pricing   ( asking_price, monthly_rent, currency )`,
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (error) throw new Error(`Failed to fetch properties: ${error.message}`);

    return {
      properties: (data ?? [])
        .map((row) => this.formatProperty(row))
        .filter((p): p is NonNullable<ReturnType<typeof this.formatProperty>> => p !== null),
      total: count ?? 0,
      page,
      limit,
      pages: Math.ceil((count ?? 0) / limit),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MEDIA — upload to Cloudinary and store URL in DB
  // ─────────────────────────────────────────────────────────────────────────
  async uploadMediaForProperty(
    propertyId: string,
    userId: string,
    mediaItems: Array<{
      media_type: PropertyMediaType;
      file:       string;
      caption?:   string;
      sort_order?: number;
      is_cover?:  boolean;
    }>,
    isAdmin = false,
  ) {
    if (!isAdmin) await this.assertOwnership(propertyId, userId);

    if (mediaItems.length === 0) {
      throw new Error('At least one media item is required');
    }

    // Get the current highest sort_order so new items slot in at the end
    const { data: existing } = await supabaseAdmin
      .from('property_media')
      .select('sort_order')
      .eq('property_id', propertyId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const baseOrder = (existing?.sort_order ?? -1) + 1;

    // Upload to Cloudinary
    const uploaded = await uploadPropertyMediaBatch(
      mediaItems.map((m, idx) => ({
        fileSource: m.file,
        options: {
          mediaType:     m.media_type,
          propertyId,
          publicIdSuffix: `${Date.now()}-${idx}`,
          isCover:       m.is_cover ?? false,
        },
      })),
    );

    // Insert into DB
    const { data, error } = await supabaseAdmin
      .from('property_media')
      .insert(
        uploaded.map((result, idx) => ({
          property_id:   propertyId,
          media_type:    mediaItems[idx].media_type,
          url:           result.url,
          thumbnail_url: result.thumbnail_url,
          caption:       mediaItems[idx].caption    ?? null,
          sort_order:    mediaItems[idx].sort_order ?? baseOrder + idx,
          is_cover:      mediaItems[idx].is_cover   ?? false,
        })),
      )
      .select('id, media_type, url, thumbnail_url, caption, sort_order, is_cover, uploaded_at');

    if (error) throw new Error(`Failed to save media: ${error.message}`);

    logger.info(
      { propertyId, userId, count: uploaded.length },
      'properties.media.upload_to_cloudinary.success',
    );

    return data;
  }

  async deleteMediaItem(
    mediaId: string,
    propertyId: string,
    userId: string,
    isAdmin = false,
  ) {
    if (!isAdmin) await this.assertOwnership(propertyId, userId);

    const { data: mediaRow, error: fetchErr } = await supabaseAdmin
      .from('property_media')
      .select('id, url, media_type')
      .eq('id', mediaId)
      .eq('property_id', propertyId)
      .maybeSingle();

    if (fetchErr || !mediaRow) throw new Error('Media item not found');

    // Delete from Cloudinary (best-effort)
    const resourceType =
      mediaRow.media_type === 'video' || mediaRow.media_type === 'drone' ? 'video' : 'image';
    await deletePropertyMedia(extractCloudinaryPublicId(mediaRow.url), resourceType);

    // Delete from DB
    const { error: delErr } = await supabaseAdmin
      .from('property_media')
      .delete()
      .eq('id', mediaId)
      .eq('property_id', propertyId);

    if (delErr) throw new Error(`Failed to delete media: ${delErr.message}`);

    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NEARBY PLACES — add to existing property
  // ─────────────────────────────────────────────────────────────────────────
  async addNearbyPlaces(propertyId: string, userId: string, places: NearbyPlaceInput[], isAdmin = false) {
    if (!isAdmin) await this.assertOwnership(propertyId, userId);

    const { data: loc } = await supabaseAdmin
      .from('property_locations')
      .select('latitude, longitude')
      .eq('property_id', propertyId)
      .single();

    if (!loc?.latitude || !loc?.longitude) {
      throw new Error('Property has no location set — add location before adding nearby places');
    }

    const rows = places.map((place) => {
      const { distanceM, walkMinutes, driveMinutes } = computeDistanceResult(
        loc.latitude, loc.longitude,
        place.latitude, place.longitude,
      );
      return {
        property_id:       propertyId,
        place_type:        place.place_type,
        name:              place.name,
        distance_m:        distanceM,
        walk_minutes:      walkMinutes,
        drive_minutes:     driveMinutes,
        matatu_stage_name: place.matatu_stage_name ?? null,
        school_type:       place.school_type       ?? null,
        google_maps_url:   place.google_maps_url   ?? null,
        verified:          false,
      };
    });

    const { data, error } = await supabaseAdmin
      .from('nearby_places')
      .insert(rows)
      .select();

    if (error) throw new Error(`Failed to add nearby places: ${error.message}`);
    return data;
  }

  async deleteNearbyPlace(placeId: string, propertyId: string, userId: string, isAdmin = false) {
    if (!isAdmin) await this.assertOwnership(propertyId, userId);

    const { error } = await supabaseAdmin
      .from('nearby_places')
      .delete()
      .eq('id', placeId)
      .eq('property_id', propertyId);

    if (error) throw new Error(`Failed to delete nearby place: ${error.message}`);
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async assertOwnership(propertyId: string, userId: string): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from('properties')
      .select('created_by')
      .eq('id', propertyId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) throw new Error('Property not found');
    if (data.created_by !== userId) throw new Error('Forbidden: you do not own this property');
  }

  /**
   * Normalise the raw Supabase join result into a clean response shape.
   */
  private formatProperty(raw: any): ReturnType<PropertiesService['_buildProperty']> | null {
    if (!raw) return null;
    return this._buildProperty(raw);
  }

  /** Separated so the return type is fully inferred and never includes `null`. */
  private _buildProperty(raw: any) {
    const loc     = Array.isArray(raw.property_locations)    ? raw.property_locations[0]    : raw.property_locations;
    const pricing = Array.isArray(raw.property_pricing)      ? raw.property_pricing[0]      : raw.property_pricing;
    const score   = Array.isArray(raw.listing_search_scores) ? raw.listing_search_scores[0] : raw.listing_search_scores;
    const rentalUnit = Array.isArray(raw.rental_units) ? raw.rental_units[0] : raw.rental_units;
    const shortTerm = Array.isArray(raw.short_term_config) ? raw.short_term_config[0] : raw.short_term_config;
    const commercial = Array.isArray(raw.commercial_config) ? raw.commercial_config[0] : raw.commercial_config;
    const plot = Array.isArray(raw.plot_details) ? raw.plot_details[0] : raw.plot_details;
    const offplan = Array.isArray(raw.offplan_details) ? raw.offplan_details[0] : raw.offplan_details;

    return {
      id:                 raw.id,
      listing_category:   raw.listing_category,
      listing_type:       raw.listing_type,
      management_model:   raw.management_model,
      title:              raw.title,
      description:        raw.description,
      status:             raw.status,
      construction_status: raw.construction_status,
      year_built:         raw.year_built,
      floor_area_sqm:     raw.floor_area_sqm,
      plot_area_sqft:     raw.plot_area_sqft,
      bedrooms:           raw.bedrooms,
      bathrooms:          raw.bathrooms,
      is_ensuite:         raw.is_ensuite,
      parking_spaces:     raw.parking_spaces,
      compound_is_gated:  raw.compound_is_gated,
      security_type:      raw.security_type,
      water_supply:       raw.water_supply,
      has_borehole:       raw.has_borehole,
      electricity_supply: raw.electricity_supply,
      waste_management:   raw.waste_management,
      is_furnished:       raw.is_furnished,
      is_featured:        raw.is_featured,
      published_at:       raw.published_at,
      created_by:         raw.created_by,
      created_at:         raw.created_at,
      updated_at:         raw.updated_at,

      location:      loc     ?? null,
      pricing:       pricing ?? null,
      contacts:      raw.property_contacts  ?? [],
      media:         (raw.property_media    ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order),
      amenities:     raw.property_amenities ?? [],
      nearby_places: (raw.nearby_places     ?? []).sort((a: any, b: any) => a.distance_m - b.distance_m),
      score: score ? {
        total:        score.total_score,
        boost:        score.boost_score,
        base:         score.base_score,
        engagement:   score.engagement_score,
        verification: score.verification_score,
      } : null,
      
      // Type-specific details
      rental_unit: rentalUnit ?? null,
      short_term_config: shortTerm ?? null,
      commercial_config: commercial ?? null,
      plot_details: plot ?? null,
      offplan_details: offplan ?? null,
    };
  }
}

export const propertiesService = new PropertiesService();