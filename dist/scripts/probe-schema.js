import { supabaseAdmin } from '../utils/supabase.js';
import '../config/environment.js';
async function probeSchema() {
    console.log('Probing tables...');
    const tables = ['profiles', 'password_resets', 'email_verifications', 'user_roles', 'user_tokens', 'security_logs', 'token_blacklist'];
    for (const table of tables) {
        const { data, error, count } = await supabaseAdmin
            .from(table)
            .select('*', { count: 'exact', head: true });
        if (error) {
            console.log(`❌ Table ${table} error:`, error.message);
        }
        else {
            console.log(`✅ Table ${table} exists. Row count:`, count);
            // Get one row to see columns
            const { data: row } = await supabaseAdmin.from(table).select('*').limit(1);
            if (row && row.length > 0) {
                console.log(`Columns for ${table}:`, Object.keys(row[0]));
            }
        }
    }
}
probeSchema().catch(console.error);
