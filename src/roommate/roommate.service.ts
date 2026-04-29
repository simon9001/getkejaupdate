/**
 * roommate.service.ts — Roommate Finder feature
 */
import { supabaseAdmin } from '../utils/supabase.js';
import { logger }        from '../utils/logger.js';

interface ListFilters {
  search?:     string;
  gender?:     string;
  budgetMax?:  number;
  area?:       string;
  page?:       number;
  limit?:      number;
}

export class RoommateService {

  async listProfiles(filters: ListFilters = {}) {
    const { search, gender, budgetMax, area, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    let q = supabaseAdmin
      .from('roommate_profiles')
      .select('*', { count: 'exact' })
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      q = q.or(
        `display_name.ilike.%${search}%,area.ilike.%${search}%,occupation.ilike.%${search}%`,
      );
    }
    if (gender && gender !== 'all') {
      q = q.in('gender', [gender, 'any']);
    }
    if (budgetMax) {
      q = q.lte('budget_min', budgetMax);
    }
    if (area) {
      q = q.or(`area.ilike.%${area}%,county.ilike.%${area}%`);
    }

    const { data, count, error } = await q;
    if (error) throw new Error(error.message);

    return {
      profiles: (data ?? []).map(this.#formatProfile),
      total:    count ?? 0,
      page,
      limit,
    };
  }

  async createProfile(userId: string, body: {
    displayName: string; age: number; gender: string;
    occupation?: string; budgetMin: number; budgetMax: number;
    moveInDate: string; area: string; county: string;
    bio: string; lifestyle?: string[];
  }) {
    const { data, error } = await supabaseAdmin
      .from('roommate_profiles')
      .insert({
        user_id:      userId,
        display_name: body.displayName,
        age:          body.age,
        gender:       body.gender,
        occupation:   body.occupation ?? null,
        budget_min:   body.budgetMin,
        budget_max:   body.budgetMax,
        move_in_date: body.moveInDate,
        area:         body.area,
        county:       body.county,
        bio:          body.bio,
        lifestyle:    body.lifestyle ?? [],
        is_active:    true,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return this.#formatProfile(data);
  }

  async sendConnect(requesterId: string, profileId: string) {
    // Prevent connecting to own profile
    const { data: profile } = await supabaseAdmin
      .from('roommate_profiles')
      .select('user_id, connected_count')
      .eq('id', profileId)
      .single();

    if (profile?.user_id === requesterId) {
      throw new Error('Cannot connect to your own profile');
    }

    // Upsert connection
    const { error } = await supabaseAdmin
      .from('roommate_connections')
      .upsert(
        { requester_id: requesterId, profile_id: profileId, status: 'pending' },
        { onConflict: 'requester_id,profile_id', ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);

    // Increment connected_count on the profile
    await supabaseAdmin.rpc('increment_roommate_connected_count', { profile_id: profileId });

    return { status: 'pending' };
  }

  async getMyConnections(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('roommate_connections')
      .select('profile_id, status')
      .eq('requester_id', userId);

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  #formatProfile(r: any) {
    return {
      id:             r.id,
      displayName:    r.display_name,
      age:            r.age,
      gender:         r.gender,
      occupation:     r.occupation,
      budgetMin:      r.budget_min,
      budgetMax:      r.budget_max,
      moveInDate:     r.move_in_date,
      area:           r.area,
      county:         r.county,
      bio:            r.bio,
      lifestyle:      r.lifestyle ?? [],
      photoUrl:       r.photo_url,
      connectedCount: r.connected_count ?? 0,
      postedAt:       r.created_at,
    };
  }
}

export const roommateService = new RoommateService();
