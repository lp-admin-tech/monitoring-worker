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
        // Try to select the recommendations column to verify it exists
        const { error: selectError } = await supabase
            .from('visibility_compliance')
            .select('recommendations')
            .limit(1);

        if (selectError && selectError.code === 'PGRST204') { // Column not found
            logger.error('CRITICAL: Column "recommendations" missing in "visibility_compliance" table.');
            logger.info('Please run migration: migrations/fix_visibility_compliance_schema.sql');
        } else if (selectError && selectError.code === '42P01') { // Table not found
            logger.error('CRITICAL: Table "visibility_compliance" missing.');
        } else if (selectError) {
            logger.warn('visibility_compliance check returned error:', { code: selectError.code, message: selectError.message });
        } else {
            logger.info('Table "visibility_compliance" and column "recommendations" verified.');
        }

        // 2. Verify audit_data_quality table
        const { error: qualityError } = await supabase
            .from('audit_data_quality')
            .select('id')
            .limit(1);

        if (qualityError && qualityError.code === '42P01') {
            logger.error('CRITICAL: Table "audit_data_quality" missing.');
        } else if (qualityError) {
            logger.warn('audit_data_quality check returned error:', { code: qualityError.code, message: qualityError.message });
        } else {
            logger.info('Table "audit_data_quality" verified.');
        }

        // 3. Schema reload is handled by migration files with NOTIFY pgrst command
        logger.info('Schema verification completed.');

    } catch (err) {
        logger.error('Schema verification failed:', err);
    }
}

module.exports = verifySchema;
