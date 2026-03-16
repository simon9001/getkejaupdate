import { supabaseAdmin } from '../utils/supabase.js';
export class DashboardService {
    async getAdminStats() {
        const { count: totalUsers } = await supabaseAdmin
            .from('profiles')
            .select('*', { count: 'exact', head: true });
        const { count: totalProperties } = await supabaseAdmin
            .from('properties')
            .select('*', { count: 'exact', head: true });
        const { count: pendingVerifications } = await supabaseAdmin
            .from('user_verifications')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');
        return {
            totalUsers: totalUsers || 0,
            totalProperties: totalProperties || 0,
            pendingVerifications: pendingVerifications || 0,
            monthlyRevenue: 0, // Placeholder
        };
    }
    async getVerifierStats() {
        const { count: pendingProperties } = await supabaseAdmin
            .from('properties')
            .select('*', { count: 'exact', head: true })
            .eq('is_verified', false);
        const { count: pendingUserVerifications } = await supabaseAdmin
            .from('user_verifications')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');
        return {
            pendingProperties: pendingProperties || 0,
            pendingUserVerifications: pendingUserVerifications || 0,
            activeDisputes: 0, // Placeholder
        };
    }
    async getOwnerStats(userId) {
        const { count: ownedProperties } = await supabaseAdmin
            .from('properties')
            .select('*', { count: 'exact', head: true })
            .eq('owner_id', userId);
        const { count: activeBookings } = await supabaseAdmin
            .from('bookings')
            .select('*', { count: 'exact', head: true })
            .eq('owner_id', userId)
            .eq('status', 'confirmed');
        const { data: rentData } = await supabaseAdmin
            .from('properties')
            .select('price')
            .eq('owner_id', userId)
            .eq('listing_type', 'rent');
        const totalRent = rentData?.reduce((sum, p) => sum + (p.price || 0), 0) || 0;
        const { count: caretakers } = await supabaseAdmin
            .from('property_caretakers')
            .select('*', { count: 'exact', head: true })
            .eq('owner_id', userId);
        return {
            ownedProperties: ownedProperties || 0,
            activeBookings: activeBookings || 0,
            totalRent: totalRent,
            activeCaretakers: caretakers || 0
        };
    }
    async getCaretakerStats(userId) {
        // TBD: How are caretakers assigned to properties? 
        // For now, returning basic placeholder stats
        return {
            managedUnits: 0,
            openTickets: 0,
            completedJobs: 0,
        };
    }
}
export const dashboardService = new DashboardService();
