import { supabaseAdmin } from '../utils/supabase.js';
export class UsersService {
    async getAllUsers(page = 1, limit = 10, search = '') {
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        let query = supabaseAdmin
            .from('profiles')
            .select(`
                *,
                roles:user_roles!user_id(role),
                verification:user_verifications!user_id(status)
            `, { count: 'exact' });
        if (search) {
            query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
        }
        const { data, count, error } = await query
            .order('created_at', { ascending: false })
            .range(from, to);
        if (error)
            throw error;
        const users = data.map((u) => ({
            id: u.id,
            full_name: u.full_name,
            email: u.email,
            phone: u.phone,
            avatar_url: u.avatar_url,
            created_at: u.created_at,
            email_verified: u.email_verified,
            is_active: u.is_active !== undefined ? u.is_active : true, // Default to true if column missing
            roles: u.roles?.map((r) => r.role) || [],
            status: u.verification?.[0]?.status || 'pending'
        }));
        return { users, total: count || 0 };
    }
    async updateUserRole(id, roles) {
        // First delete existing roles
        const { error: deleteError } = await supabaseAdmin
            .from('user_roles')
            .delete()
            .eq('user_id', id);
        if (deleteError)
            throw deleteError;
        // Insert new roles
        const roleInserts = roles.map(role => ({ user_id: id, role }));
        const { error: insertError } = await supabaseAdmin
            .from('user_roles')
            .insert(roleInserts);
        if (insertError)
            throw insertError;
        return { success: true };
    }
    async updateUserStatus(id, status) {
        if (typeof status === 'boolean') {
            const { error } = await supabaseAdmin
                .from('profiles')
                .update({ is_active: status, updated_at: new Date().toISOString() })
                .eq('id', id);
            if (error)
                throw error;
        }
        else {
            const { error } = await supabaseAdmin
                .from('user_verifications')
                .upsert({ user_id: id, status, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
            if (error)
                throw error;
        }
        return { success: true };
    }
    async deleteUser(id) {
        const { error } = await supabaseAdmin
            .from('profiles')
            .delete()
            .eq('id', id);
        if (error)
            throw error;
        return { success: true };
    }
}
export const usersService = new UsersService();
