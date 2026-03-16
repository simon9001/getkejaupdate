import { supabaseAdmin } from './src/utils/supabase.ts';
async function checkSchema() {
    const { data: columns, error } = await supabaseAdmin
        .rpc('get_table_columns', { table_name: 'properties' });
    // Fallback if RPC doesn't exist: use a query that returns columns
    if (error) {
        const { data, error: queryError } = await supabaseAdmin
            .from('properties')
            .select('*')
            .limit(1);
        if (queryError) {
            console.error('Error fetching one row:', queryError);
            return;
        }
        if (data && data.length > 0) {
            console.log('Columns in properties table:', Object.keys(data[0]));
        }
        else {
            console.log('Table is empty, cannot determine columns via select *');
        }
        return;
    }
    console.log('Columns:', columns);
}
checkSchema();
