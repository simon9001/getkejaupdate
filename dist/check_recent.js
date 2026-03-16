import { supabaseAdmin } from './src/utils/supabase.ts';
async function checkRecentProperty() {
    const { data, error } = await supabaseAdmin
        .from('properties')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);
    if (error) {
        console.error('Error:', error);
        return;
    }
    if (data && data.length > 0) {
        console.log('Most Recent Property:');
        console.log({
            id: data[0].id,
            title: data[0].title,
            is_verified: data[0].is_verified,
            status: data[0].status,
            owner_id: data[0].owner_id
        });
    }
    else {
        console.log('No properties found.');
    }
}
checkRecentProperty();
