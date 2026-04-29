/**
 * moving.service.ts — Moving Services feature
 */
import { supabaseAdmin } from '../utils/supabase.js';
import { logger }        from '../utils/logger.js';

interface CompanyFilters {
  search?:      string;
  priceRange?:  string;
  service?:     string;
}

export class MovingService {

  async listCompanies(filters: CompanyFilters = {}) {
    const { search, priceRange, service } = filters;

    let q = supabaseAdmin
      .from('moving_companies')
      .select('*')
      .eq('is_active', true)
      .order('rating', { ascending: false });

    if (search) {
      q = q.or(`name.ilike.%${search}%`);
    }
    if (priceRange && priceRange !== 'all') {
      q = q.eq('price_range', priceRange);
    }
    if (service && service !== 'all') {
      q = q.contains('services', [service]);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    return { companies: (data ?? []).map(this.#formatCompany) };
  }

  async submitQuote(body: {
    companyId:      string;
    userId?:        string;
    fromLocation:   string;
    toLocation:     string;
    moveDate:       string;
    furnitureCount?: number;
    boxCount?:      number;
    specialItems?:  string;
    name:           string;
    phone:          string;
    estimatedKes?:  number;
  }) {
    const { data: company } = await supabaseAdmin
      .from('moving_companies')
      .select('price_range')
      .eq('id', body.companyId)
      .single();

    if (!company) throw new Error('Company not found');

    // Compute estimated quote
    const base      = company.price_range === 'budget' ? 3500 : company.price_range === 'mid' ? 7000 : 15000;
    const furniture = (body.furnitureCount ?? 0) * 800;
    const boxes     = (body.boxCount ?? 0) * 200;
    const special   = (body.specialItems?.trim()) ? 2000 : 0;
    const estimated = base + furniture + boxes + special;

    const { data, error } = await supabaseAdmin
      .from('moving_quote_requests')
      .insert({
        company_id:      body.companyId,
        user_id:         body.userId ?? null,
        from_location:   body.fromLocation,
        to_location:     body.toLocation,
        move_date:       body.moveDate,
        furniture_count: body.furnitureCount ?? null,
        box_count:       body.boxCount ?? null,
        special_items:   body.specialItems ?? null,
        contact_name:    body.name,
        contact_phone:   body.phone,
        estimated_kes:   estimated,
      })
      .select('id, estimated_kes')
      .single();

    if (error) throw new Error(error.message);
    return { id: data.id, estimatedKes: estimated };
  }

  async registerCompany(body: {
    companyName:  string;
    contactName:  string;
    phone:        string;
    email:        string;
    areas?:       string;
  }) {
    const { error } = await supabaseAdmin
      .from('moving_company_registrations')
      .insert({
        company_name: body.companyName,
        contact_name: body.contactName,
        phone:        body.phone,
        email:        body.email,
        areas:        body.areas ?? null,
      });

    if (error) throw new Error(error.message);
    return { message: 'Registration submitted. Our team will be in touch shortly.' };
  }

  #formatCompany(c: any) {
    return {
      id:             c.id,
      name:           c.name,
      logoInitials:   c.logo_initials,
      logoColor:      c.logo_color,
      rating:         Number(c.rating),
      reviewCount:    c.review_count,
      coverageAreas:  c.coverage_areas ?? [],
      services:       c.services ?? [],
      priceRange:     c.price_range,
      phone:          c.phone,
      whatsapp:       c.whatsapp,
      email:          c.email,
      verified:       c.verified,
      tagline:        c.tagline,
      yearsActive:    c.years_active,
      totalMoves:     c.total_moves,
    };
  }
}

export const movingService = new MovingService();
