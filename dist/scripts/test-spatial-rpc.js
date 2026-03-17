import { supabaseAdmin } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';
import '../config/environment.js';
async function testRpc() {
    const lat = -0.5142;
    const lng = 37.4592;
    const radius = 2000;
    console.log(`Testing RPC get_properties_within_radius with: lat=${lat}, lng=${lng}, radius=${radius}`);
    const { data, error } = await supabaseAdmin.rpc('get_properties_within_radius', {
        lon: lng,
        lat: lat,
        radius_m: radius,
        max_price: undefined,
        min_beds: undefined,
        search_query: undefined
    });
    if (error) {
        console.error('❌ RPC Error:', error);
    }
    else {
        console.log('✅ RPC Success:', data?.length, 'properties found');
    }
}
testRpc().catch(console.error);
