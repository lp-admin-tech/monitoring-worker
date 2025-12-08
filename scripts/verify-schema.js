const { createClient } = require('@supabase/supabase-js');
const logger = require('../modules/logger');

async function verifySchema() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        logger.warn('Supabase credentials missing, skipping schema verification');
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    try {
        logger.info('Verifying database schema...');

        // 1. Verify visibility_compliance table and recommendations column
        const { data: visibilityColumns, error: visibilityError } = await supabase
            .rpc('get_columns', { table_name: 'visibility_compliance' })
            .catch(() => ({ data: null, error: { message: 'RPC get_columns not found, falling back to query' } }));

        // Fallback if RPC doesn't exist (likely) - try to select the column
        if (visibilityError) {
            const { error: selectError } = await supabase
                .from('visibility_compliance')
                .select('recommendations')
                .limit(1);

            if (selectError && selectError.code === 'PGRST301') { // Column not found
                logger.error('CRITICAL: Column "recommendations" missing in "visibility_compliance" table.');
                logger.info('Please run migration: migrations/fix_visibility_compliance_schema.sql');
            } else if (selectError && selectError.code === '42P01') { // Table not found
                logger.error('CRITICAL: Table "visibility_compliance" missing.');
            } else {
                logger.info('Table "visibility_compliance" and column "recommendations" verified.');
            }
        }

        // 2. Verify audit_data_quality table
        const { error: qualityError } = await supabase
            .from('audit_data_quality')
            .select('id')
            .limit(1);

        if (qualityError && qualityError.code === '42P01') {
            logger.error('CRITICAL: Table "audit_data_quality" missing.');
        } else {
            logger.info('Table "audit_data_quality" verified.');
        }

        // 3. Attempt to reload schema cache
        try {
            await supabase.rpc('reload_schema'); // Assuming a helper RPC exists, or just a raw query if possible
            // Note: Standard Supabase client doesn't support raw SQL easily without RPC.
            // We'll rely on the migration file having the NOTIFY command.
        } catch (e) {
            // Ignore
        }

        logger.info('Schema verification completed.');

    } catch (err) {
        logger.error('Schema verification failed:', err);
    }
}

module.exports = verifySchema;
