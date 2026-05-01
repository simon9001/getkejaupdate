/**
 * roommate.service.ts — Roommate Finder v2.0
 * Two-sided matching: host (has room) ↔ seeker (needs place)
 * 3-layer algorithm: hard filters → house rules gate → lifestyle score
 */
import { supabaseAdmin } from '../utils/supabase.js';
import { logger }        from '../utils/logger.js';

// House rule key → lifestyle tags that conflict with it (hard gate)
const RULE_CONFLICTS: Record<string, string[]> = {
  no_smoking:            ['smoker'],
  no_pets:               ['pet_friendly'],
  no_loud_music:         ['music_lover'],
  quiet_after_10pm:      ['night_owl'],
  no_parties:            ['social'],
};

function passesHardFilters(host: any, seeker: any): boolean {
  if (host.rent_amount && seeker.budget_max && seeker.budget_max < host.rent_amount) return false;
  if (host.county && seeker.county &&
      host.county.trim().toLowerCase() !== seeker.county.trim().toLowerCase()) return false;
  if (host.available_from && seeker.preferred_move_in) {
    const diff = Math.abs(
      new Date(host.available_from).getTime() - new Date(seeker.preferred_move_in).getTime()
    ) / 86_400_000;
    if (diff > 45) return false;
  }
  if (host.housemate_gender && host.housemate_gender !== 'any') {
    if (seeker.gender && seeker.gender !== 'any' && seeker.gender !== host.housemate_gender) return false;
  }
  if (seeker.age) {
    if (host.housemate_age_min && seeker.age < host.housemate_age_min) return false;
    if (host.housemate_age_max && seeker.age > host.housemate_age_max) return false;
  }
  return true;
}

function passesHouseRules(rules: string[], seekerLifestyle: string[]): boolean {
  for (const rule of (rules ?? [])) {
    for (const conflict of (RULE_CONFLICTS[rule] ?? [])) {
      if ((seekerLifestyle ?? []).includes(conflict)) return false;
    }
  }
  return true;
}

function computeLifestyleScore(a: string[], b: string[]): number {
  if (!a?.length || !b?.length) return 50;
  const bSet = new Set(b);
  const intersection = a.filter(t => bSet.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return Math.round((intersection / union) * 100);
}

function computeSoftScore(host: any, seeker: any): number {
  let total = 0, checks = 0;
  if (host.work_schedule && seeker.work_schedule) {
    checks++;
    if (host.work_schedule === seeker.work_schedule) total += 100;
    else if (
      (host.work_schedule === 'day_shift'  && seeker.work_schedule === 'night_shift') ||
      (host.work_schedule === 'night_shift' && seeker.work_schedule === 'day_shift')
    ) total += 20;
    else total += 65;
  }
  if (seeker.room_type_pref?.length && host.room_type) {
    checks++;
    total += seeker.room_type_pref.includes(host.room_type) ? 100 : 40;
  }
  return checks > 0 ? Math.round(total / checks) : 50;
}

function scoreMatch(host: any, seeker: any) {
  const lifestyleScore = computeLifestyleScore(host.lifestyle ?? [], seeker.lifestyle ?? []);
  const softScore      = computeSoftScore(host, seeker);
  const totalScore     = Math.round(lifestyleScore * 0.7 + softScore * 0.3);
  return { lifestyleScore, softScore, totalScore };
}

export class RoommateService {

  async getMyProfiles(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('roommate_profiles')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(p => this.#formatProfile(p, false));
  }

  async createProfile(userId: string, body: any) {
    const profileType = body.profileType as 'host' | 'seeker';

    if (profileType === 'host') {
      const { count } = await supabaseAdmin
        .from('roommate_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('profile_type', 'host')
        .eq('is_active', true);
      if ((count ?? 0) >= 1) throw new Error('You already have an active host profile');
    }

    const row: any = {
      user_id:        userId,
      profile_type:   profileType,
      display_name:   body.displayName,
      age:            body.age,
      gender:         body.gender ?? 'any',
      occupation:     body.occupation ?? null,
      bio:            body.bio,
      lifestyle:      body.lifestyle ?? [],
      area:           body.area,
      county:         body.county,
      photo_url:      body.photoUrl ?? null,
      whatsapp_number: body.whatsappNumber ?? null,
      is_active:      true,
      work_schedule:  body.workSchedule ?? null,
      deal_breakers:  body.dealBreakers ?? [],
      last_active_at: new Date().toISOString(),
    };

    if (profileType === 'host') {
      Object.assign(row, {
        room_type:        body.roomType,
        bathrooms:        body.bathrooms,
        furnishing:       body.furnishing,
        parking:          body.parking ?? false,
        wifi:             body.wifi ?? true,
        available_from:   body.availableFrom,
        rent_amount:      body.rentAmount,
        bills_included:   body.billsIncluded ?? false,
        current_tenants:  body.currentTenants ?? 0,
        housemate_gender: body.housemateGender ?? 'any',
        housemate_age_min: body.housemateAgeMin ?? 18,
        housemate_age_max: body.housemateAgeMax ?? 99,
        house_rules:      body.houseRules ?? [],
        property_address: body.propertyAddress ?? null,
        budget_min:       body.rentAmount,
        budget_max:       body.rentAmount,
      });
    } else {
      Object.assign(row, {
        budget_min:       body.budgetMin,
        budget_max:       body.budgetMax,
        preferred_move_in: body.preferredMoveIn,
        move_in_date:     body.preferredMoveIn,
        max_housemates:   body.maxHousemates ?? 4,
        room_type_pref:   body.roomTypePref ?? [],
      });
    }

    const { data, error } = await supabaseAdmin
      .from('roommate_profiles')
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return this.#formatProfile(data, false);
  }

  async deactivateProfile(userId: string, profileId: string) {
    const { error } = await supabaseAdmin
      .from('roommate_profiles')
      .update({ is_active: false })
      .eq('id', profileId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    return { success: true };
  }

  async getMatchesAsHost(userId: string, page = 1, limit = 15) {
    const { data: hostProfile, error: hErr } = await supabaseAdmin
      .from('roommate_profiles')
      .select('*')
      .eq('user_id', userId)
      .eq('profile_type', 'host')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (hErr) throw new Error(hErr.message);
    if (!hostProfile) throw new Error('No active host profile found — please create one first');

    const { data: seekers, error: sErr } = await supabaseAdmin
      .from('roommate_profiles')
      .select('*')
      .eq('profile_type', 'seeker')
      .eq('is_active', true)
      .neq('user_id', userId);
    if (sErr) throw new Error(sErr.message);

    const scored = (seekers ?? [])
      .filter(s => passesHardFilters(hostProfile, s))
      .filter(s => passesHouseRules(hostProfile.house_rules ?? [], s.lifestyle ?? []))
      .map(s => ({ ...s, ...scoreMatch(hostProfile, s) }))
      .filter(s => s.totalScore >= 55)
      .sort((a, b) => b.totalScore - a.totalScore);

    const total = scored.length;
    const slice = scored.slice((page - 1) * limit, page * limit);

    return {
      hostProfile: this.#formatProfile(hostProfile, false),
      matches:     slice.map(s => this.#formatMatchCard(s)),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getMatchesAsSeeker(userId: string, page = 1, limit = 15) {
    const { data: seekerProfile, error: sErr } = await supabaseAdmin
      .from('roommate_profiles')
      .select('*')
      .eq('user_id', userId)
      .eq('profile_type', 'seeker')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sErr) throw new Error(sErr.message);
    if (!seekerProfile) throw new Error('No active seeker profile found — please create one first');

    const { data: hosts, error: hErr } = await supabaseAdmin
      .from('roommate_profiles')
      .select('*')
      .eq('profile_type', 'host')
      .eq('is_active', true)
      .neq('user_id', userId);
    if (hErr) throw new Error(hErr.message);

    const scored = (hosts ?? [])
      .filter(h => passesHardFilters(h, seekerProfile))
      .filter(h => passesHouseRules(h.house_rules ?? [], seekerProfile.lifestyle ?? []))
      .map(h => ({ ...h, ...scoreMatch(h, seekerProfile) }))
      .filter(h => h.totalScore >= 55)
      .sort((a, b) => b.totalScore - a.totalScore);

    const total = scored.length;
    const slice = scored.slice((page - 1) * limit, page * limit);

    return {
      seekerProfile: this.#formatProfile(seekerProfile, false),
      matches:       slice.map(h => this.#formatMatchCard(h)),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async sendConnection(userId: string, targetProfileId: string, myProfileId: string) {
    const { data: myProfile, error: mpErr } = await supabaseAdmin
      .from('roommate_profiles')
      .select('*')
      .eq('id', myProfileId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (mpErr || !myProfile) throw new Error('Your profile not found');

    // Rate limit: 10 per 7 days
    const now = new Date();
    const resetAt = myProfile.week_reset_at ? new Date(myProfile.week_reset_at) : new Date(0);
    const daysSince = (now.getTime() - resetAt.getTime()) / 86_400_000;
    let weekCount = myProfile.connections_this_week ?? 0;
    if (daysSince >= 7) {
      weekCount = 0;
      await supabaseAdmin
        .from('roommate_profiles')
        .update({ connections_this_week: 0, week_reset_at: now.toISOString() })
        .eq('id', myProfileId);
    }
    if (weekCount >= 10) throw new Error('Rate limit: maximum 10 connection requests per 7 days');

    const { data: target } = await supabaseAdmin
      .from('roommate_profiles')
      .select('id, user_id, profile_type')
      .eq('id', targetProfileId)
      .eq('is_active', true)
      .single();

    if (!target) throw new Error('Target profile not found');
    if (target.user_id === userId) throw new Error('Cannot connect to your own profile');

    const myRole         = myProfile.profile_type as 'host' | 'seeker';
    const hostProfileId  = myRole === 'host'   ? myProfileId    : targetProfileId;
    const seekerProfileId = myRole === 'seeker' ? myProfileId   : targetProfileId;

    const { data: existing } = await supabaseAdmin
      .from('roommate_connections')
      .select('id')
      .eq('host_profile_id', hostProfileId)
      .eq('seeker_profile_id', seekerProfileId)
      .maybeSingle();

    if (existing) throw new Error('Connection already exists between these profiles');

    const { data, error } = await supabaseAdmin
      .from('roommate_connections')
      .insert({
        requester_id:      userId,
        profile_id:        targetProfileId,
        host_profile_id:   hostProfileId,
        seeker_profile_id: seekerProfileId,
        initiated_by_role: myRole,
        host_accepted:     myRole === 'host',
        seeker_accepted:   myRole === 'seeker',
        status:            'pending',
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    await supabaseAdmin
      .from('roommate_profiles')
      .update({ connections_this_week: weekCount + 1, last_active_at: now.toISOString() })
      .eq('id', myProfileId);

    return { connectionId: data.id, status: 'pending' };
  }

  async respondToConnection(userId: string, connectionId: string, action: 'accept' | 'reject') {
    const { data: conn, error: cErr } = await supabaseAdmin
      .from('roommate_connections')
      .select(`
        *,
        host_profile:roommate_profiles!host_profile_id(id, user_id),
        seeker_profile:roommate_profiles!seeker_profile_id(id, user_id)
      `)
      .eq('id', connectionId)
      .single();

    if (cErr || !conn) throw new Error('Connection not found');

    const connHp = conn.host_profile   as any;
    const connSp = conn.seeker_profile as any;
    const isHost   = connHp?.user_id === userId;
    const isSeeker = connSp?.user_id === userId;
    if (!isHost && !isSeeker) throw new Error('Forbidden: not a party to this connection');

    if (action === 'reject') {
      await supabaseAdmin.from('roommate_connections').update({ status: 'rejected' }).eq('id', connectionId);
      return { status: 'rejected' };
    }

    const updates: any = {};
    if (isHost)   updates.host_accepted   = true;
    if (isSeeker) updates.seeker_accepted = true;

    const { data: updated, error: uErr } = await supabaseAdmin
      .from('roommate_connections')
      .update(updates)
      .eq('id', connectionId)
      .select()
      .single();

    if (uErr) throw new Error(uErr.message);

    if (updated.host_accepted && updated.seeker_accepted) {
      await supabaseAdmin
        .from('roommate_connections')
        .update({ status: 'connected' })
        .eq('id', connectionId);
      return { status: 'connected', mutual: true };
    }
    return { status: 'pending', mutual: false };
  }

  async getMyConnections(userId: string) {
    const { data: myProfiles } = await supabaseAdmin
      .from('roommate_profiles')
      .select('id, profile_type')
      .eq('user_id', userId);

    const ids = (myProfiles ?? []).map(p => p.id);
    if (ids.length === 0) return [];

    const orFilter = `host_profile_id.in.(${ids.join(',')}),seeker_profile_id.in.(${ids.join(',')})`;

    const { data, error } = await supabaseAdmin
      .from('roommate_connections')
      .select(`
        id, status, initiated_by_role, host_accepted, seeker_accepted, created_at,
        host_profile:roommate_profiles!host_profile_id(
          id, user_id, display_name, area, county, bio, lifestyle, photo_url,
          room_type, rent_amount, available_from, house_rules, whatsapp_number
        ),
        seeker_profile:roommate_profiles!seeker_profile_id(
          id, user_id, display_name, area, county, bio, lifestyle, photo_url,
          budget_min, budget_max, preferred_move_in, whatsapp_number
        )
      `)
      .or(orFilter)
      .neq('status', 'rejected')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    return (data ?? []).map(c => {
      const isMutual     = c.status === 'connected';
      const hp = c.host_profile   as any;
      const sp = c.seeker_profile as any;
      const isHostParty   = ids.includes((hp as any)?.id  ?? '');
      const isSeekerParty = ids.includes((sp as any)?.id  ?? '');

      return {
        id:              c.id,
        status:          c.status,
        hostAccepted:    c.host_accepted,
        seekerAccepted:  c.seeker_accepted,
        initiatedByRole: c.initiated_by_role,
        isMutual,
        isHostParty,
        isSeekerParty,
        hostProfile: hp ? {
          id:           hp.id,
          displayName:  hp.display_name,
          area:         hp.area,
          county:       hp.county,
          bio:          hp.bio,
          lifestyle:    hp.lifestyle ?? [],
          photoUrl:     hp.photo_url,
          roomType:     hp.room_type,
          rentAmount:   hp.rent_amount,
          availableFrom: hp.available_from,
          houseRules:   hp.house_rules ?? [],
          whatsappNumber: isMutual ? hp.whatsapp_number : null,
        } : null,
        seekerProfile: sp ? {
          id:             sp.id,
          displayName:    sp.display_name,
          area:           sp.area,
          county:         sp.county,
          bio:            sp.bio,
          lifestyle:      sp.lifestyle ?? [],
          photoUrl:       sp.photo_url,
          budgetMin:      sp.budget_min,
          budgetMax:      sp.budget_max,
          preferredMoveIn: sp.preferred_move_in,
          whatsappNumber: isMutual ? sp.whatsapp_number : null,
        } : null,
        postedAt: c.created_at,
      };
    });
  }

  #formatProfile(r: any, forPublic = true) {
    const base = {
      id:           r.id,
      profileType:  r.profile_type ?? 'seeker',
      displayName:  r.display_name,
      age:          r.age,
      gender:       r.gender,
      occupation:   r.occupation,
      bio:          r.bio,
      lifestyle:    r.lifestyle ?? [],
      photoUrl:     r.photo_url,
      area:         r.area,
      county:       r.county,
      workSchedule: r.work_schedule,
      isActive:     r.is_active,
      postedAt:     r.created_at,
    };

    if ((r.profile_type ?? 'seeker') === 'host') {
      return {
        ...base,
        roomType:        r.room_type,
        bathrooms:       r.bathrooms,
        furnishing:      r.furnishing,
        parking:         r.parking,
        wifi:            r.wifi,
        availableFrom:   r.available_from,
        rentAmount:      r.rent_amount,
        billsIncluded:   r.bills_included,
        currentTenants:  r.current_tenants,
        housemateGender: r.housemate_gender,
        housemateAgeMin: r.housemate_age_min,
        housemateAgeMax: r.housemate_age_max,
        houseRules:      r.house_rules ?? [],
        whatsappNumber:  forPublic ? undefined : r.whatsapp_number,
      };
    }
    return {
      ...base,
      budgetMin:       r.budget_min,
      budgetMax:       r.budget_max,
      preferredMoveIn: r.preferred_move_in ?? r.move_in_date,
      maxHousemates:   r.max_housemates,
      roomTypePref:    r.room_type_pref ?? [],
      whatsappNumber:  forPublic ? undefined : r.whatsapp_number,
    };
  }

  #formatMatchCard(r: any) {
    const isHost = (r.profile_type ?? 'seeker') === 'host';
    return {
      id:           r.id,
      profileType:  r.profile_type,
      displayName:  r.display_name,
      age:          r.age,
      gender:       r.gender,
      occupation:   r.occupation,
      bio:          r.bio,
      lifestyle:    r.lifestyle ?? [],
      photoUrl:     r.photo_url,
      area:         r.area,
      county:       r.county,
      workSchedule: r.work_schedule,
      totalScore:      r.totalScore,
      lifestyleScore:  r.lifestyleScore,
      softScore:       r.softScore,
      isStrongMatch:   r.totalScore >= 80,
      ...(isHost ? {
        roomType:       r.room_type,
        furnishing:     r.furnishing,
        parking:        r.parking,
        wifi:           r.wifi,
        availableFrom:  r.available_from,
        rentAmount:     r.rent_amount,
        billsIncluded:  r.bills_included,
        houseRules:     r.house_rules ?? [],
        currentTenants: r.current_tenants,
      } : {
        budgetMin:       r.budget_min,
        budgetMax:       r.budget_max,
        preferredMoveIn: r.preferred_move_in ?? r.move_in_date,
        maxHousemates:   r.max_housemates,
        roomTypePref:    r.room_type_pref ?? [],
      }),
    };
  }
}

export const roommateService = new RoommateService();
