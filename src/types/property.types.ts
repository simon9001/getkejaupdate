/**
 * property.types.ts
 *
 * All types derived directly from the PostgreSQL schema enums and table columns.
 * Nothing is invented — every field maps to a real column or enum value.
 */

import { z } from 'zod';

// =============================================================================
// Enums (mirror PostgreSQL enum types exactly)
// =============================================================================

export type ListingCategory = 'for_sale' | 'long_term_rent' | 'short_term_rent' | 'commercial';

/** Alias used by nlp.utils.ts */
export type PropertyCategory = string;

/** Structured result of a natural-language property search query */
export interface ParsedQuery {
  text:          string;
  minPrice?:     number;
  maxPrice?:     number;
  bedrooms?:     number;
  area?:         string;
  county?:       string;
  town?:         string;
  landmark?:     string;
  radius?:       number;
  category?:     PropertyCategory;
  propertyType?: string;
  listingType?:  string;
  furnished?:    boolean;
}

export type ListingType =
  | 'apartment' | 'house' | 'bedsitter' | 'plot' | 'maisonette'
  | 'studio'    | 'villa' | 'off_plan';

export type ManagementModel =
  | 'owner_direct' | 'agent_managed' | 'caretaker_managed' | 'developer_held';

export type PropertyStatus = 'available' | 'let' | 'sold' | 'off_market' | 'under_offer';

export type ConstructionStatus = 'completed' | 'off_plan' | 'under_construction';

export type WaterSupply    = 'nairobi_water' | 'borehole' | 'both' | 'tank_only';
export type ElectricitySupply = 'kplc_prepaid' | 'kplc_postpaid' | 'solar' | 'generator';
export type WasteManagement   = 'ncc_collection' | 'private' | 'septic_tank';
export type FurnishedStatus   = 'unfurnished' | 'semi_furnished' | 'fully_furnished';

export type ContactRole = 'landlord' | 'caretaker' | 'agent' | 'developer' | 'property_manager';

export type RentFrequency       = 'monthly' | 'quarterly' | 'annually';
export type WaterBillType       = 'included' | 'metered' | 'shared_split';
export type ElectricityBillType = 'included' | 'prepaid_token' | 'own_meter';

export type MediaType = 'photo' | 'video' | 'floor_plan' | 'virtual_tour' | 'drone';

export type AmenityCategory = 'security' | 'recreation' | 'utilities' | 'green' | 'transport' | 'other';

export type PlaceType =
  | 'school' | 'hospital' | 'clinic' | 'supermarket' | 'mall'
  | 'matatu_stage' | 'petrol_station' | 'church' | 'mosque'
  | 'police' | 'park' | 'gym';

export type ShortTermType = 'airbnb_bnb' | 'party_home' | 'holiday_home' | 'serviced_apartment';

export type CommercialType =
  | 'event_space' | 'store' | 'godown' | 'office' | 'showroom'
  | 'restaurant_shell' | 'kiosk';

export type TenureType =
  | 'freehold' | 'leasehold_999yr' | 'leasehold_99yr'
  | 'leasehold_33yr' | 'allotment';

export type DocType =
  | 'title_deed' | 'allotment_letter' | 'lease_agreement' | 'building_approval'
  | 'occupation_cert' | 'survey_map' | 'nema_cert' | 'county_permit';

// =============================================================================
// Rental Building & Unit Types
// =============================================================================

export type UnitType = 'bedsitter' | '1_bed' | '2_bed' | '3_bed' | 'studio' | 'penthouse';
export type UnitFaces = 'road_facing' | 'compound_facing' | 'corner';
export type ParkingType = 'basement' | 'open_compound' | 'street';
export type Terrain = 'flat' | 'sloped' | 'ridge' | 'valleyside';
export type ZoningUse = 'residential' | 'commercial' | 'agricultural' | 'mixed';

export interface RentalBuilding {
  id: string;
  name: string;
  total_units?: number;
  floors?: number;
  has_lift?: boolean;
  has_backup_generator?: boolean;
  has_swimming_pool?: boolean;
  has_gym?: boolean;
  has_rooftop?: boolean;
  parking_type?: ParkingType;
  compound_shared_spaces?: string[];
  management_company?: string;
  year_built?: number;
  created_at: string;
}

export interface RentalUnit {
  id: string;
  property_id: string;
  building_id: string;
  unit_number?: string;
  floor_level?: number;
  unit_type?: UnitType;
  faces?: UnitFaces;
  has_balcony?: boolean;
  is_corner_unit?: boolean;
  availability_date?: string;
  current_tenant_vacating?: boolean;
  buildings?: RentalBuilding;
}

export const rentalUnitInputSchema = z.object({
  building_id:              z.string().uuid(),
  unit_number:              z.string().max(20).optional(),
  floor_level:              z.number().int().min(0).optional(),
  unit_type:                z.enum(['bedsitter','1_bed','2_bed','3_bed','studio','penthouse']).optional(),
  faces:                    z.enum(['road_facing','compound_facing','corner']).optional(),
  has_balcony:              z.boolean().default(false),
  is_corner_unit:           z.boolean().default(false),
  availability_date:        z.string().date().optional(),
  current_tenant_vacating:  z.boolean().default(false),
});

export type RentalUnitInput = z.infer<typeof rentalUnitInputSchema>;

// =============================================================================
// Short-term Rental Types
// =============================================================================

export type CalendarStatus = 'booked' | 'blocked_owner' | 'pending';

export interface ShortTermConfig {
  id: string;
  property_id: string;
  short_term_type: ShortTermType;
  price_per_night: number;
  price_per_weekend?: number;
  price_per_event?: number;
  min_nights: number;
  max_nights?: number;
  max_guests?: number;
  max_event_capacity?: number;
  noise_curfew_time?: string;
  check_in_time: string;
  check_out_time: string;
  instant_book: boolean;
  cleaning_fee?: number;
  damage_deposit?: number;
  rules?: string[];
  airbnb_listing_url?: string;
  catering_available: boolean;
}

export interface AvailabilityBlock {
  id: string;
  property_id: string;
  date_from: string;
  date_to: string;
  status: CalendarStatus;
  booking_ref?: string;
  price_override?: number;
  notes?: string;
  created_at: string;
}

export const shortTermConfigInputSchema = z.object({
  short_term_type:      z.enum(['airbnb_bnb','party_home','holiday_home','serviced_apartment']),
  price_per_night:      z.number().positive(),
  price_per_weekend:    z.number().positive().optional(),
  price_per_event:      z.number().positive().optional(),
  min_nights:           z.number().int().min(1).default(1),
  max_nights:           z.number().int().min(1).optional(),
  max_guests:           z.number().int().min(1).optional(),
  max_event_capacity:   z.number().int().min(1).optional(),
  noise_curfew_time:    z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  check_in_time:        z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).default('14:00'),
  check_out_time:       z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).default('10:00'),
  instant_book:         z.boolean().default(false),
  cleaning_fee:         z.number().nonnegative().optional(),
  damage_deposit:       z.number().nonnegative().optional(),
  rules:                z.array(z.string()).optional(),
  airbnb_listing_url:   z.string().url().optional(),
  catering_available:   z.boolean().default(false),
});

export const availabilityBlockSchema = z.object({
  date_from:      z.string().date(),
  date_to:        z.string().date(),
  status:         z.enum(['booked','blocked_owner','pending']).default('pending'),
  booking_ref:    z.string().max(60).optional(),
  price_override: z.number().positive().optional(),
  notes:          z.string().optional(),
}).refine((data) => new Date(data.date_to) > new Date(data.date_from), {
  message: 'date_to must be after date_from',
});

export type ShortTermConfigInput = z.infer<typeof shortTermConfigInputSchema>;
export type AvailabilityBlockInput = z.infer<typeof availabilityBlockSchema>;

// =============================================================================
// Commercial Property Types
// =============================================================================

export interface CommercialConfig {
  id: string;
  property_id: string;
  commercial_type: CommercialType;
  floor_area_sqft?: number;
  ceiling_height_m?: number;
  loading_bay: boolean;
  drive_in_access: boolean;
  three_phase_power: boolean;
  event_capacity_seated?: number;
  event_capacity_standing?: number;
  has_catering_kitchen: boolean;
  has_pa_system: boolean;
  has_projector_screen: boolean;
  outdoor_space_sqm?: number;
  zoning_classification?: string;
  alcohol_license_possible: boolean;
}

export const commercialConfigInputSchema = z.object({
  commercial_type:            z.enum(['event_space','store','godown','office','showroom','restaurant_shell','kiosk']),
  floor_area_sqft:            z.number().positive().optional(),
  ceiling_height_m:           z.number().positive().optional(),
  loading_bay:                z.boolean().default(false),
  drive_in_access:            z.boolean().default(false),
  three_phase_power:          z.boolean().default(false),
  event_capacity_seated:      z.number().int().min(1).optional(),
  event_capacity_standing:    z.number().int().min(1).optional(),
  has_catering_kitchen:       z.boolean().default(false),
  has_pa_system:              z.boolean().default(false),
  has_projector_screen:       z.boolean().default(false),
  outdoor_space_sqm:          z.number().positive().optional(),
  zoning_classification:      z.string().max(60).optional(),
  alcohol_license_possible:   z.boolean().default(false),
});

export type CommercialConfigInput = z.infer<typeof commercialConfigInputSchema>;

// =============================================================================
// Plot/Land Property Types
// =============================================================================

export interface PlotDetails {
  id: string;
  property_id: string;
  size_acres?: number;
  size_sqft?: number;
  road_frontage_m?: number;
  is_corner_plot: boolean;
  terrain?: Terrain;
  soil_type?: string;
  is_serviced: boolean;
  zoning_use?: ZoningUse;
  payment_plan_available: boolean;
  installment_months?: number;
}

export const plotDetailsInputSchema = z.object({
  size_acres:               z.number().positive().optional(),
  size_sqft:                z.number().positive().optional(),
  road_frontage_m:          z.number().positive().optional(),
  is_corner_plot:           z.boolean().default(false),
  terrain:                  z.enum(['flat','sloped','ridge','valleyside']).optional(),
  soil_type:                z.string().max(60).optional(),
  is_serviced:              z.boolean().default(false),
  zoning_use:               z.enum(['residential','commercial','agricultural','mixed']).optional(),
  payment_plan_available:   z.boolean().default(false),
  installment_months:       z.number().int().min(1).max(360).optional(),
});

export type PlotDetailsInput = z.infer<typeof plotDetailsInputSchema>;

// =============================================================================
// Off-Plan Property Types
// =============================================================================

export interface OffplanDetails {
  id: string;
  property_id: string;
  project_name: string;
  developer_name?: string;
  completion_quarter?: string;
  construction_pct: number;
  total_units_in_project?: number;
  units_sold: number;
  payment_plan?: any; // JSONB
  escrow_bank?: string;
  nca_reg_number?: string;
}

export const offplanDetailsInputSchema = z.object({
  project_name:             z.string().min(3).max(200),
  developer_name:           z.string().max(200).optional(),
  completion_quarter:       z.string().max(10).optional(),
  construction_pct:         z.number().int().min(0).max(100).default(0),
  total_units_in_project:   z.number().int().min(1).optional(),
  units_sold:               z.number().int().min(0).default(0),
  payment_plan:             z.any().optional(), // JSONB - flexible structure
  escrow_bank:              z.string().max(100).optional(),
  nca_reg_number:           z.string().max(80).optional(),
});

export type OffplanDetailsInput = z.infer<typeof offplanDetailsInputSchema>;

// =============================================================================
// Building Creation Schema (Admin only)
// =============================================================================

export const createBuildingSchema = z.object({
  name:                    z.string().min(2).max(150),
  total_units:             z.number().int().min(1).optional(),
  floors:                  z.number().int().min(1).optional(),
  has_lift:                z.boolean().default(false),
  has_backup_generator:    z.boolean().default(false),
  has_swimming_pool:       z.boolean().default(false),
  has_gym:                 z.boolean().default(false),
  has_rooftop:             z.boolean().default(false),
  parking_type:            z.enum(['basement','open_compound','street']).optional(),
  compound_shared_spaces:  z.array(z.string()).optional(),
  management_company:      z.string().max(150).optional(),
  year_built:              z.number().int().min(1900).max(new Date().getFullYear()).optional(),
});

export type CreateBuildingInput = z.infer<typeof createBuildingSchema>;

// =============================================================================
// Haversine distance result (computed, not stored)
// =============================================================================
export interface DistanceResult {
  distanceM:    number;  // metres
  walkMinutes:  number;  // approximate walking time
  driveMinutes: number;  // approximate driving time
}

// =============================================================================
// Zod validation schemas
// =============================================================================

// ── Nearby place submitted by the user ──────────────────────────────────────
export const nearbyPlaceInputSchema = z.object({
  place_type:        z.enum([
    'school','hospital','clinic','supermarket','mall','matatu_stage',
    'petrol_station','church','mosque','police','park','gym',
  ]),
  name:              z.string().min(2).max(150),
  latitude:          z.number().min(-90).max(90),
  longitude:         z.number().min(-180).max(180),
  school_type:       z.string().max(60).optional(),
  matatu_stage_name: z.string().max(100).optional(),
  google_maps_url:   z.string().url().optional(),
});

// ── Contact on the property ──────────────────────────────────────────────────
export const contactInputSchema = z.object({
  role:               z.enum(['landlord','caretaker','agent','developer','property_manager']),
  full_name:          z.string().min(2).max(150),
  display_name:       z.string().max(100).optional(),
  phone_primary:      z.string().regex(/^\+?[\d\s\-()]{7,15}$/),
  phone_secondary:    z.string().regex(/^\+?[\d\s\-()]{7,15}$/).optional(),
  whatsapp_number:    z.string().regex(/^\+?[\d\s\-()]{7,15}$/).optional(),
  email:              z.string().email().optional(),
  is_primary_contact: z.boolean().default(false),
  is_on_site:         z.boolean().default(false),
  availability_hours: z.string().max(100).optional(),
  languages:          z.array(z.string()).optional(),
  agent_license_no:   z.string().max(80).optional(),
});

// ── Media item ───────────────────────────────────────────────────────────────
export const mediaInputSchema = z.object({
  media_type:  z.enum(['photo','video','floor_plan','virtual_tour','drone']),
  file:        z.string().min(1, 'file is required'),
  caption:     z.string().max(200).optional(),
  sort_order:  z.number().int().min(0).default(0),
  is_cover:    z.boolean().default(false),
});

// ── Amenity ──────────────────────────────────────────────────────────────────
export const amenityInputSchema = z.object({
  category:    z.enum(['security','recreation','utilities','green','transport','other']),
  name:        z.string().min(1).max(100),
  is_included: z.boolean().default(true),
  notes:       z.string().optional(),
});

// ── Pricing ──────────────────────────────────────────────────────────────────
// Base schema (no refinement) — used for updates where both fields are optional
export const pricingBaseSchema = z.object({
  currency:              z.string().length(3).default('KES'),
  asking_price:          z.number().positive().optional(),
  monthly_rent:          z.number().positive().optional(),
  rent_frequency:        z.enum(['monthly','quarterly','annually']).default('monthly'),
  deposit_months:        z.number().int().min(0).optional(),
  deposit_amount:        z.number().positive().optional(),
  goodwill_fee:          z.number().nonnegative().optional(),
  service_charge:        z.number().nonnegative().optional(),
  caretaker_fee:         z.number().nonnegative().optional(),
  garbage_fee:           z.number().nonnegative().optional(),
  water_bill_type:       z.enum(['included','metered','shared_split']).default('metered'),
  electricity_bill_type: z.enum(['included','prepaid_token','own_meter']).default('prepaid_token'),
  negotiable:            z.boolean().default(false),
  agent_commission_pct:  z.number().min(0).max(100).optional(),
});

// For creates: at least one of asking_price or monthly_rent is required
export const pricingInputSchema = pricingBaseSchema.refine(
  (d) => d.asking_price || d.monthly_rent,
  { message: 'At least one of asking_price or monthly_rent is required' },
);

// ── Location ─────────────────────────────────────────────────────────────────
export const locationInputSchema = z.object({
  county:               z.string().min(2).max(60),
  sub_county:           z.string().max(80).optional(),
  area:                 z.string().max(100).optional(),
  estate_name:          z.string().max(150).optional(),
  road_street:          z.string().max(200).optional(),
  plot_number:          z.string().max(60).optional(),
  directions:           z.string().optional(),
  nearest_landmark:     z.string().max(200).optional(),
  latitude:             z.number().min(-90).max(90),
  longitude:            z.number().min(-180).max(180),
  display_full_address: z.boolean().default(true),
  matatu_routes:        z.array(z.string()).optional(),
});

// ── Core create-property body (now includes all type-specific configs) ─────
export const createPropertySchema = z.object({
  // Core
  listing_category:    z.enum(['for_sale','long_term_rent','short_term_rent','commercial']),
  listing_type:        z.enum(['apartment','house','bedsitter','plot','maisonette','studio','villa','off_plan']),
  management_model:    z.enum(['owner_direct','agent_managed','caretaker_managed','developer_held']).default('owner_direct'),
  title:               z.string().min(5).max(200),
  description:         z.string().optional(),
  construction_status: z.enum(['completed','off_plan','under_construction']).default('completed'),
  year_built:          z.number().int().min(1900).max(new Date().getFullYear() + 5).optional(),
  floor_area_sqm:      z.number().positive().optional(),
  plot_area_sqft:      z.number().positive().optional(),
  bedrooms:            z.number().int().min(0).max(50).optional(),
  bathrooms:           z.number().min(0).max(50).optional(),
  is_ensuite:          z.boolean().default(false),
  parking_spaces:      z.number().int().min(0).default(0),
  compound_is_gated:   z.boolean().default(false),
  security_type:       z.array(z.string()).optional(),
  water_supply:        z.enum(['nairobi_water','borehole','both','tank_only']).optional(),
  has_borehole:        z.boolean().default(false),
  electricity_supply:  z.enum(['kplc_prepaid','kplc_postpaid','solar','generator']).optional(),
  waste_management:    z.enum(['ncc_collection','private','septic_tank']).optional(),
  is_furnished:        z.enum(['unfurnished','semi_furnished','fully_furnished']).default('unfurnished'),

  // Sub-objects (all optional — can be added after creation)
  location:      locationInputSchema,
  pricing:       pricingInputSchema,
  contacts:      z.array(contactInputSchema).min(1, 'At least one contact is required'),
  media:         z.array(mediaInputSchema).optional(),
  amenities:     z.array(amenityInputSchema).optional(),
  nearby_places: z.array(nearbyPlaceInputSchema).optional(),
  
  // Type-specific configurations
  rental_unit:         rentalUnitInputSchema.optional(),
  short_term_config:   shortTermConfigInputSchema.optional(),
  commercial_config:   commercialConfigInputSchema.optional(),
  plot_details:        plotDetailsInputSchema.optional(),
  offplan_details:     offplanDetailsInputSchema.optional(),
});

// updatePropertySchema — written manually (Zod v4: .partial() disallowed on schemas
// containing nested .refine() calls, so we cannot derive this from createPropertySchema)
export const updatePropertySchema = z.object({
  // Core fields — all optional on update
  listing_category:    z.enum(['for_sale','long_term_rent','short_term_rent','commercial']).optional(),
  listing_type:        z.enum(['apartment','house','bedsitter','plot','maisonette','studio','villa','off_plan']).optional(),
  management_model:    z.enum(['owner_direct','agent_managed','caretaker_managed','developer_held']).optional(),
  title:               z.string().min(5).max(200).optional(),
  description:         z.string().optional(),
  construction_status: z.enum(['completed','off_plan','under_construction']).optional(),
  year_built:          z.number().int().min(1900).max(new Date().getFullYear() + 5).optional(),
  floor_area_sqm:      z.number().positive().optional(),
  plot_area_sqft:      z.number().positive().optional(),
  bedrooms:            z.number().int().min(0).max(50).optional(),
  bathrooms:           z.number().min(0).max(50).optional(),
  is_ensuite:          z.boolean().optional(),
  parking_spaces:      z.number().int().min(0).optional(),
  compound_is_gated:   z.boolean().optional(),
  security_type:       z.array(z.string()).optional(),
  water_supply:        z.enum(['nairobi_water','borehole','both','tank_only']).optional(),
  has_borehole:        z.boolean().optional(),
  electricity_supply:  z.enum(['kplc_prepaid','kplc_postpaid','solar','generator']).optional(),
  waste_management:    z.enum(['ncc_collection','private','septic_tank']).optional(),
  is_furnished:        z.enum(['unfurnished','semi_furnished','fully_furnished']).optional(),

  // Sub-objects — all optional, nested fields also optional
  location:            locationInputSchema.partial().optional(),
  pricing:             pricingBaseSchema.partial().optional(),  // no required-field check on updates
  contacts:            z.array(contactInputSchema).optional(),
  media:               z.array(mediaInputSchema).optional(),
  amenities:           z.array(amenityInputSchema).optional(),
  nearby_places:       z.array(nearbyPlaceInputSchema).optional(),

  // Type-specific configs — nullable so callers can explicitly remove them
  rental_unit:         rentalUnitInputSchema.nullable().optional(),
  short_term_config:   shortTermConfigInputSchema.nullable().optional(),
  commercial_config:   commercialConfigInputSchema.nullable().optional(),
  plot_details:        plotDetailsInputSchema.nullable().optional(),
  offplan_details:     offplanDetailsInputSchema.nullable().optional(),
});

export const listPropertiesSchema = z.object({
  page:                z.coerce.number().int().min(1).default(1),
  limit:               z.coerce.number().int().min(1).max(100).default(20),
  listing_category:    z.enum(['for_sale','long_term_rent','short_term_rent','commercial']).optional(),
  listing_type:        z.enum(['apartment','house','bedsitter','plot','maisonette','studio','villa','off_plan']).optional(),
  status:              z.enum(['available','let','sold','off_market','under_offer']).optional(),
  county:              z.string().optional(),
  area:                z.string().optional(),
  min_price:           z.coerce.number().positive().optional(),
  max_price:           z.coerce.number().positive().optional(),
  bedrooms:            z.coerce.number().int().min(0).optional(),
  is_furnished:        z.enum(['unfurnished','semi_furnished','fully_furnished']).optional(),
  is_featured:         z.coerce.boolean().optional(),
  construction_status: z.enum(['completed','off_plan','under_construction']).optional(),
  // Geo search
  lat:    z.coerce.number().min(-90).max(90).optional(),
  lng:    z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().positive().default(5),  // km
});

// Inferred TypeScript types
export type CreatePropertyInput  = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput  = z.infer<typeof updatePropertySchema>;
export type ListPropertiesInput  = z.infer<typeof listPropertiesSchema>;
export type NearbyPlaceInput     = z.infer<typeof nearbyPlaceInputSchema>;
export type ContactInput         = z.infer<typeof contactInputSchema>;
export type MediaInput           = z.infer<typeof mediaInputSchema>;
export type AmenityInput         = z.infer<typeof amenityInputSchema>;
export type PricingInput         = z.infer<typeof pricingInputSchema>;
export type LocationInput        = z.infer<typeof locationInputSchema>;

// Full property response type (matches the service's formatProperty output)
export interface PropertyResponse {
  id: string;
  listing_category: ListingCategory;
  listing_type: ListingType;
  management_model: ManagementModel;
  title: string;
  description?: string;
  status: PropertyStatus;
  construction_status: ConstructionStatus;
  year_built?: number;
  floor_area_sqm?: number;
  plot_area_sqft?: number;
  bedrooms?: number;
  bathrooms?: number;
  is_ensuite: boolean;
  parking_spaces: number;
  compound_is_gated: boolean;
  security_type?: string[];
  water_supply?: WaterSupply;
  has_borehole: boolean;
  electricity_supply?: ElectricitySupply;
  waste_management?: WasteManagement;
  is_furnished: FurnishedStatus;
  is_featured: boolean;
  published_at?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  
  location?: any;
  pricing?: any;
  contacts: any[];
  media: any[];
  amenities: any[];
  nearby_places: any[];
  score?: {
    total: number;
    boost: number;
    base: number;
    engagement: number;
    verification: number;
  };
  
  // Type-specific fields
  rental_unit?: RentalUnit | null;
  short_term_config?: ShortTermConfig | null;
  commercial_config?: CommercialConfig | null;
  plot_details?: PlotDetails | null;
  offplan_details?: OffplanDetails | null;
}