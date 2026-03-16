import { supabaseAdmin } from '../utils/supabase.js';
import '../config/environment.js';
async function seedAmenities() {
    console.log('Seeding basic amenities...');
    const basicAmenities = [
        { id: 'wifi', name: 'Fast WiFi', icon_name: 'wifi' },
        { id: 'parking', name: 'Parking', icon_name: 'parking' },
        { id: 'gym', name: 'Gym', icon_name: 'gym' },
        { id: 'pool', name: 'Swimming Pool', icon_name: 'pool' },
        { id: 'security', name: '24/7 Security', icon_name: 'security' },
        { id: 'borehole', name: 'Borehole Water', icon_name: 'water' },
    ];
    for (const amenity of basicAmenities) {
        const { error } = await supabaseAdmin
            .from('amenities')
            .upsert(amenity, { onConflict: 'id' });
        if (error) {
            console.error(`Failed to seed ${amenity.name}:`, error.message);
        }
        else {
            console.log(`Successfully seeded ${amenity.name}`);
        }
    }
}
seedAmenities().catch(console.error);
