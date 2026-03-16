import { supabaseAdmin } from '../utils/supabase.js';
import '../config/environment.js';

async function listFunctions() {
    console.log('--- Probing Spatial RPC Functions ---');

    console.log('\nTesting get_properties_within_radius...');
    const test0 = await supabaseAdmin.rpc('get_properties_within_radius', {
        lat: -0.5142,
        lon: 37.4592,
        radius_m: 2000,
        max_price: null,
        min_beds: null,
        search_query: null
    });
    console.log('Result:', test0.error ? test0.error.message : 'Success');

    console.log('\nTesting geometry_within...');
    const test1 = await supabaseAdmin.rpc('geometry_within', {
        lat: -0.5142,
        lon: 37.4592,
        radius_m: 2000
    });
    console.log('Result:', test1.error ? test1.error.message : 'Success');

    console.log('\nTesting get_nearest_landmarks...');
    const test2 = await supabaseAdmin.rpc('get_nearest_landmarks', {
        px: 37.4592,
        py: -0.5142,
        lim: 5
    });
    console.log('Result:', test2.error ? test2.error.message : 'Success');

    console.log('\nTesting get_nearest_road...');
    const test3 = await supabaseAdmin.rpc('get_nearest_road', {
        px: 37.4592,
        py: -0.5142
    });
    console.log('Result:', test3.error ? test3.error.message : 'Success');
}

listFunctions().catch(console.error);
