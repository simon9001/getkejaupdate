import { supabaseAdmin } from './src/utils/supabase.js';
async function testQuery() {
    const propId = 'bd86dfd4-ed19-4385-9c09-41cb00aaf10c';
    const landmarkId = '5f5e3f67-0303-478c-9946-30b2866739b9';
    console.log(`Testing ST_Distance between prop:${propId} and landmark:${landmarkId}`);
    const { data, error } = await supabaseAdmin.rpc('calculate_property_landmark_distance', {
        prop_id: propId,
        land_id: landmarkId
    });
    if (error) {
        console.error('RPC ERROR:', error);
    }
    else {
        console.log('RPC SUCCESS - Distance:', data);
    }
    // Attempt direct SQL if possible (via another RPC or just checking why it fails)
    // Since we can't run raw SQL easily without an RPC, let's check for postgis extension version
    const { data: pgVersion, error: pgErr } = await supabaseAdmin.rpc('get_postgis_version');
    console.log('PostGIS Version:', pgVersion, pgErr);
}
// Note: I might need to create 'get_postgis_version' if it doesn't exist, 
// but let's see if calculate_property_landmark_distance gives a more detailed error now.
testQuery();
