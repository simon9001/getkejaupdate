import { createClient } from '@supabase/supabase-js';
import { env } from '../config/environment.js';

// ✅ Use service role key only for admin/server operations
export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Alias if you want
export const supabase = supabaseAdmin;

// Test connection function
export async function testSupabaseConnection() {
  try {
    const { data, error, status, statusText } = await supabaseAdmin
      .from('users')
      .select('id')
      .limit(1);

    if (error) {
      console.error('❌ Supabase connection failed:');
      console.error('Code:', error.code);
      console.error('Message:', error.message);
      console.error('Details:', error.details);
      console.error('Hint:', error.hint);
      console.error('HTTP Status:', status, statusText);

      if (error.code === '42P01') {
        console.warn('💡 Hint: The "profiles" table might not exist in your database.');
      } else if (error.code === '42501') {
        console.warn('💡 Hint: Permission denied. Check your service key or schema permissions.');
      }
    } else {
      console.log('✅ Supabase connected successfully. Found profiles:', data?.length || 0);
    }
  } catch (err: any) {
    console.error('❌ Unexpected error during Supabase connection:', err.message);
  }
}
