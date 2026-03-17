import { supabaseAdmin } from './src/utils/supabase.js';
async function checkSchema() {
    console.log('--- Checking property_locations ---');
    const { data: cols, error: err } = await supabaseAdmin
        .from('property_locations')
        .select('*')
        .limit(1);
    if (err) {
        console.error('Error fetching property_locations:', err);
    }
    else {
        console.log('Sample record from property_locations:', JSON.stringify(cols, null, 2));
    }
    console.log('\n--- Checking landmarks ---');
    const { data: lCols, error: lErr } = await supabaseAdmin
        .from('landmarks')
        .select('*')
        .limit(1);
    if (lErr) {
        console.error('Error fetching landmarks:', lErr);
    }
    else {
        console.log('Sample record from landmarks:', JSON.stringify(lCols, null, 2));
    }
}
checkSchema();
