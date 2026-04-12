/**
 * landlord.types.ts
 * Type definitions for landlord dashboard
 */

export interface LandlordDashboardStats {
    properties: { total: number };
    tenancies: { active: number; pending_applications: number };
    visits: { pending: number };
    messages: { unread: number };
    short_stay: { upcoming_bookings: number };
    earnings: { total_kes: number };
    boosts: { active: number };
    generated_at: string;
  }
  
  export interface LandlordProperty {
    id: string;
    title: string;
    listing_category: string;
    listing_type: string;
    status: string;
    bedrooms: number;
    bathrooms: number;
    is_furnished: string;
    created_at: string;
    published_at: string | null;
    is_featured: boolean;
    property_locations: {
      county: string;
      area: string;
      estate_name: string;
    };
    property_pricing: {
      monthly_rent: number | null;
      asking_price: number | null;
      currency: string;
    };
    cover_photo: string | null;
    active_boost: {
      id: string;
      ends_at: string;
      boost_packages: { name: string; badge_label: string };
    } | null;
  }
  
  export interface TenancyApplication {
    id: string;
    booking_ref: string;
    status: string;
    desired_move_in: string;
    agreed_monthly_rent_kes: number | null;
    agreed_deposit_kes: number | null;
    lease_start_date: string | null;
    lease_end_date: string | null;
    created_at: string;
    cover_letter: string;
    properties: {
      id: string;
      title: string;
      property_locations: { county: string; area: string };
    };
    tenant: {
      id: string;
      email: string;
      phone_number: string;
      user_profiles: {
        full_name: string;
        display_name: string;
        avatar_url: string;
      };
    };
  }
  
  export interface ShortStayBooking {
    id: string;
    booking_ref: string;
    status: string;
    check_in_date: string;
    check_out_date: string;
    nights: number;
    guests_count: number;
    total_charged_kes: number;
    host_payout_kes: number;
    requested_at: string;
    guest_name: string;
    properties: {
      id: string;
      title: string;
      property_locations: { county: string; area: string };
    };
    guest: {
      id: string;
      email: string;
      user_profiles: { full_name: string; display_name: string; avatar_url: string };
    };
  }
  
  export interface VisitSchedule {
    id: string;
    proposed_datetime: string;
    confirmed_datetime: string | null;
    status: string;
    visit_type: string;
    meeting_point: string | null;
    notes_from_seeker: string | null;
    properties: {
      id: string;
      title: string;
      property_locations: { county: string; area: string };
    };
    seeker: {
      id: string;
      email: string;
      user_profiles: { full_name: string; display_name: string; avatar_url: string; phone_number: string };
    };
  }
  
  export interface Conversation {
    id: string;
    type: string;
    last_message_at: string | null;
    last_message_text: string | null;
    unread_b: number;
    property_id: string;
    properties: {
      id: string;
      title: string;
      property_locations: { county: string; area: string };
    };
    participant_a: {
      id: string;
      email: string;
      user_profiles: { full_name: string; display_name: string; avatar_url: string };
    };
  }
  
  export interface TeamMember {
    id: string;
    can_collect_rent: boolean;
    can_edit_listing: boolean;
    assigned_at: string;
    property_id: string | null;
    building_id: string | null;
    properties: { id: string; title: string } | null;
    rental_buildings: { id: string; name: string } | null;
    caretaker: {
      id: string;
      email: string;
      phone_number: string;
      user_profiles: { full_name: string; display_name: string; avatar_url: string };
      caretaker_profiles: { rating: number | null; lives_on_compound: boolean };
    };
  }
  
  export interface BoostPackage {
    id: string;
    name: string;
    duration_days: number;
    price_kes: number;
    visibility_score_bonus: number;
    badge_label: string;
    homepage_slot: boolean;
    push_notification: boolean;
  }
  
  export interface RevenueSummary {
    period: 'week' | 'month' | 'year';
    total_kes: number;
    breakdown: {
      short_stay_payouts_kes: number;
      monthly_rent_recurring_kes: number;
    };
    monthly_series: Array<{ month: string; total_kes: number }>;
  }
  
  export interface LandlordProfile {
    id: string;
    email: string;
    phone_number: string;
    email_verified: boolean;
    phone_verified: boolean;
    user_profiles: {
      full_name: string;
      display_name: string;
      avatar_url: string;
      county: string;
      whatsapp_number: string;
      notification_prefs: any;
    };
    landlord_profiles: {
      id_type: string | null;
      id_verified: boolean;
      is_company: boolean;
      company_name: string | null;
      kra_pin: string | null;
      rating: number | null;
    };
  }