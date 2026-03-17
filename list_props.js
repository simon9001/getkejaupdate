import { supabaseAdmin } from './src/utils/supabase.js';
async function list() {
    const { data, error } = await supabaseAdmin.from('properties').select('id, title').limit(5);
    if (error) {
        console.error('ERROR:', error);
    }
    else {
        console.log('PROPERTIES:', JSON.stringify(data, null, 2));
    }
}
list();
