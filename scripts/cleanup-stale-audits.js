const { envConfig } = require('../modules/env-config');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function cleanupStaleAudits() {
    console.log('Starting cleanup of stale audits...');

    try {
        // Delete audits that are stuck in 'processing' for more than 1 hour
        // referencing the 'started_at' column or 'created_at'
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        const { data, error } = await supabase
            .from('site_audits')
            .delete()
            .eq('status', 'processing')
            .lt('created_at', oneHourAgo)
            .select();

        if (error) {
            console.error('Error deleting stale audits:', error);
        } else {
            console.log(`Successfully deleted ${data.length} stale 'processing' audits.`);
        }
    } catch (err) {
        console.error('Unexpected error:', err);
    }
}

cleanupStaleAudits();
