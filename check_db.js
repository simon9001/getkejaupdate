import { supabaseAdmin } from './src/utils/supabase.js';

async function checkProperties() {
    const { data, error } = await supabaseAdmin
        .from('properties')
        .select('id, title, status, is_verified, is_struck, created_at')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching properties:', error);
        return;
    }

    console.log('Properties in Database:');
    console.table(data);
}

checkProperties();
