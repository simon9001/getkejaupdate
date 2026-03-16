import { AuthService } from './Auth/auth.service.js';
import { supabaseAdmin } from './utils/supabase.js';

async function debug() {
    const authService = new AuthService();
    const testEmail = 'simon9001@example.com'; // Use a known email or one from profiles

    console.log(`Testing forgotPassword for: ${testEmail}`);

    try {
        // First check if user exists
        const { data: user } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('email', testEmail)
            .maybeSingle();

        if (!user) {
            console.log('User not found. Fetching any user to test...');
            const { data: anyUser } = await supabaseAdmin.from('profiles').select('email').limit(1).single();
            if (anyUser) {
                console.log(`Using user: ${anyUser.email}`);
                const result = await authService.forgotPassword(anyUser.email);
                console.log('Result:', result);
            } else {
                console.log('No users found in profiles table.');
            }
        } else {
            const result = await authService.forgotPassword(testEmail);
            console.log('Result:', result);
        }
    } catch (error: any) {
        console.error('ERROR during forgotPassword:', error);
        if (error.message) console.error('Error message:', error.message);
        if (error.details) console.error('Error details:', error.details);
        if (error.hint) console.error('Error hint:', error.hint);
        if (error.code) console.error('Error code:', error.code);
    }
}

debug();
