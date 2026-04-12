/**
 * staff.types.ts
 * Type definitions for staff dashboard
 */

export interface StaffKpiSnapshot {
    moderation_queues: {
      pending_id_verifications: number;
      open_disputes: number;
      fraud_reviews: number;
      reported_messages: number;
      pending_property_review: number;
    };
    platform_health: {
      total_users: number;
      suspended_users: number;
      total_properties: number;
    };
    generated_at: string;
  }
  
  export interface PendingVerification {
    id: string;
    doc_type: string;
    doc_number: string;
    status: string;
    submitted_at: string;
    front_image_url: string;
    back_image_url: string;
    selfie_url: string;
    users: {
      id: string;
      email: string;
      phone_number: string;
      created_at: string;
      user_profiles: {
        full_name: string;
        display_name: string;
        avatar_url: string;
      };
    };
  }
  
  export interface Dispute {
    id: string;
    reason: string;
    description: string;
    status: string;
    raised_at: string;
    raised_by_role: string;
    refund_amount_kes: number | null;
    short_stay_bookings: {
      id: string;
      booking_ref: string;
      check_in_date: string;
      check_out_date: string;
      total_charged_kes: number;
      properties: {
        id: string;
        title: string;
        property_locations: { county: string; area: string };
      };
    };
    raised_by_user: { id: string; email: string; user_profiles: { full_name: string } };
    against: { id: string; email: string; user_profiles: { full_name: string } };
  }
  
  export interface FraudReview {
    id: string;
    review_type: string;
    rating_overall: number;
    review_text: string;
    submitted_at: string;
    property: { id: string; title: string };
    reviewer: { id: string; email: string; user_profiles: { full_name: string; avatar_url: string } };
    review_fraud_signals: Array<{ id: string; signal: string; confidence: string; detail: string }>;
  }
  
  export interface ReportedMessage {
    id: string;
    reason: string;
    created_at: string;
    messages: {
      id: string;
      body: string;
      created_at: string;
      sender: { id: string; email: string; user_profiles: { full_name: string } };
    };
    reporter: { id: string; email: string; user_profiles: { full_name: string } };
  }
  
  export interface PendingProperty {
    id: string;
    title: string;
    listing_category: string;
    status: string;
    created_at: string;
    creator: { id: string; email: string; user_profiles: { full_name: string } };
    property_locations: { county: string; area: string };
    property_pricing: { monthly_rent: number; asking_price: number };
    has_cover_photo: boolean;
    has_legal_docs: boolean;
    has_pricing: boolean;
  }
  
  export interface StaffUser {
    id: string;
    email: string;
    phone_number: string;
    account_status: string;
    created_at: string;
    user_profiles: { full_name: string; display_name: string; avatar_url: string };
    user_roles: Array<{ roles: { name: string; display_name: string }; verified_at: string }>;
  }