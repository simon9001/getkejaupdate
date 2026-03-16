export type PropertyCategory = 'commercial' | 'residential' | 'recreational';

export type PropertyStatus = 'draft' | 'active' | 'suspended' | 'sold';

export type PropertyType = 
    // Residential
    | 'bedsitter' 
    | 'studio' 
    | 'apartment' 
    | 'maisonette' 
    | 'bungalow' 
    | 'villa'
    // Commercial
    | 'office'
    | 'retail'
    | 'warehouse'
    | 'industrial'
    // Recreational
    | 'short_term'
    | 'vacation'
    | 'resort'
    | 'camp';

export type VerificationStatus = 'pending' | 'approved' | 'rejected';
export type LandmarkType = 'university' | 'hospital' | 'school' | 'market' | 'bus_stop' | 'road' | 'shopping_center';
export type RoadSurface = 'asphalt' | 'gravel' | 'dirt' | 'murram' | 'unknown';

export interface Property {
    id: string;
    owner_id: string;
    title: string;
    description?: string;
    property_type: PropertyType;
    category?: PropertyCategory;
    status: PropertyStatus;
    size_sqm?: number;
    bedrooms: number;
    bathrooms: number;
    floor_level?: string;
    furnished_status?: string;
    year_built?: number;
    renovation_details?: string;
    internet_speed?: string;
    price_per_month?: number;
    price_per_night?: number;
    currency: string;
    security_deposit?: number;
    cleaning_fee?: number;
    service_fee?: number;
    tax_amount?: number;
    is_verified: boolean;
    is_boosted: boolean;
    is_struck: boolean;
    verified_at?: string;
    verified_by?: string;
    created_at: string;
    updated_at: string;
    owner?: {
        full_name: string;
        email: string;
        phone: string;
        avatar_url?: string;
    };
    location?: PropertyLocation;
    images?: PropertyImage[];
    amenities?: Array<{
        id: string;
        name: string;
        icon_name?: string;
        details?: string;
    }>;
    neighborhood?: NeighborhoodMetadata;
    distanceToLandmark?: {
        landmark: string;
        distance: number;
    };
}

export interface PropertyLocation {
    property_id: string;
    address?: string;
    town?: string;
    county?: string;
    location: {
        type: 'Point';
        coordinates: [number, number]; // [lng, lat]
    };
    latitude?: number;
    longitude?: number;
}

export interface PropertyImage {
    id: string;
    property_id: string;
    image_url: string;
    is_primary: boolean;
    sort_order: number;
    created_at: string;
}

export interface Amenity {
    id: string;
    name: string;
    icon_name?: string;
}

export interface NeighborhoodMetadata {
    property_id: string;
    crime_rating?: string;
    noise_level?: string;
    community_vibe?: string;
    light_exposure?: string;
}

export interface Landmark {
    id: string;
    name: string;
    type: LandmarkType;
    location: {
        type: 'Point';
        coordinates: [number, number];
    };
}

export interface CreatePropertyInput {
    title: string;
    description?: string;
    property_type: PropertyType;
    status?: PropertyStatus;
    size_sqm?: number;
    bedrooms?: number;
    bathrooms?: number;
    floor_level?: string;
    furnished_status?: string;
    year_built?: number;
    renovation_details?: string;
    internet_speed?: string;
    price_per_month?: number;
    price_per_night?: number;
    currency?: string;
    security_deposit?: number;
    cleaning_fee?: number;
    service_fee?: number;
    tax_amount?: number;
    latitude: number;
    longitude: number;
    address?: string;
    town?: string;
    county?: string;
    neighborhood?: Partial<NeighborhoodMetadata>;
    amenity_ids?: string[];
    images?: Array<{
        url: string;
        isPrimary?: boolean;
        sortOrder?: number;
    }>;
}

export interface ParsedQuery {
    text: string;
    maxPrice?: number;
    minPrice?: number;
    bedrooms?: number;
    propertyType?: string;
    landmark?: string;
    town?: string;
    radius?: number;
    category?: PropertyCategory;
}

export interface CategoryInfo {
    description: string;
    typicalAmenities: string[];
    searchTips: string;
    propertyTypes: PropertyType[];
}

export interface CategoryStatistics {
    category: PropertyCategory;
    total: number;
    active: number;
    averagePrice: number;
    minPrice: number;
    maxPrice: number;
    mostCommonType: PropertyType;
}