import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('[DB-CLIENT] Missing Supabase credentials in environment variables');
  throw new Error('Missing Supabase configuration');
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function createRetryDelay(attempt) {
  return RETRY_DELAY_MS * Math.pow(2, attempt - 1);
}

/**
 * Safe save or update an audit record with automatic conflict resolution.
 * @param {object} record - The audit record to save
 * @param {string} table - Target Supabase table (default: 'site_audits')
 * @param {object} options - Additional options
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
export async function saveAuditRecord(record, table = 'site_audits', options = {}) {
  const { retryCount = 0 } = options;

  try {
    if (!record.publisher_id || !record.domain) {
      console.warn('[DB-CLIENT] Validation failed: missing publisher_id or domain');
      return {
        success: false,
        data: null,
        error: 'Missing required fields: publisher_id and domain'
      };
    }

    console.log(`[DB-CLIENT] Attempting to save record for domain: ${record.domain} (attempt ${retryCount + 1}/${MAX_RETRIES})`);

    const { data, error } = await supabase
      .from(table)
      .upsert(record, {
        onConflict: 'publisher_id,domain'
      })
      .select();

    if (error) {
      const isDuplicateError = error.message && (
        error.message.includes('duplicate key') ||
        error.message.includes('unique constraint') ||
        error.message.includes('Conflicting row exists')
      );

      if (isDuplicateError && retryCount === 0) {
        console.warn(`[DB-CLIENT] Duplicate key detected for ${record.domain}, attempting update instead...`);

        const { data: updateData, error: updateError } = await supabase
          .from(table)
          .update(record)
          .eq('publisher_id', record.publisher_id)
          .eq('domain', record.domain)
          .select();

        if (updateError) {
          console.error(`[DB-CLIENT] Update failed for ${record.domain}:`, updateError.message);
          return {
            success: false,
            data: null,
            error: `Update operation failed: ${updateError.message}`
          };
        }

        console.log(`[DB-CLIENT] Successfully updated existing record for ${record.domain}`);
        return {
          success: true,
          data: updateData && updateData.length > 0 ? updateData[0] : null,
          error: null
        };
      }

      if (retryCount < MAX_RETRIES && !isDuplicateError) {
        const delayMs = createRetryDelay(retryCount + 1);
        console.warn(`[DB-CLIENT] Transient error for ${record.domain}, retrying in ${delayMs}ms: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));

        return saveAuditRecord(record, table, { retryCount: retryCount + 1 });
      }

      console.error(`[DB-CLIENT] Upsert failed for ${record.domain}:`, error.message);
      return {
        success: false,
        data: null,
        error: `Upsert operation failed: ${error.message}`
      };
    }

    if (data && data.length > 0) {
      console.log(`[DB-CLIENT] Successfully saved record for ${record.domain}`);
      return {
        success: true,
        data: data[0],
        error: null
      };
    }

    console.log(`[DB-CLIENT] Record saved (no return data) for ${record.domain}`);
    return {
      success: true,
      data: null,
      error: null
    };

  } catch (err) {
    console.error(`[DB-CLIENT] Unexpected error for ${record.domain}:`, err.message);

    if (retryCount < MAX_RETRIES) {
      const delayMs = createRetryDelay(retryCount + 1);
      console.warn(`[DB-CLIENT] Retrying after unexpected error in ${delayMs}ms`);
      await new Promise(resolve => setTimeout(resolve, delayMs));

      return saveAuditRecord(record, table, { retryCount: retryCount + 1 });
    }

    return {
      success: false,
      data: null,
      error: `Unexpected error: ${err.message}`
    };
  }
}

/**
 * Batch save multiple audit records with optimized database operations.
 * @param {array} records - Array of audit records to save
 * @param {string} table - Target Supabase table (default: 'site_audits')
 * @returns {Promise<{successful: number, failed: number, errors: array}>}
 */
export async function batchSaveAuditRecords(records, table = 'site_audits') {
  if (!Array.isArray(records) || records.length === 0) {
    console.warn('[DB-CLIENT] Batch save called with empty or invalid records array');
    return { successful: 0, failed: 0, errors: [] };
  }

  console.log(`[DB-CLIENT] Starting batch save for ${records.length} records`);

  const results = {
    successful: 0,
    failed: 0,
    errors: []
  };

  for (const record of records) {
    const result = await saveAuditRecord(record, table);
    if (result.success) {
      results.successful++;
    } else {
      results.failed++;
      results.errors.push({
        domain: record.domain,
        error: result.error
      });
    }
  }

  console.log(
    `[DB-CLIENT] Batch save completed: ${results.successful} successful, ${results.failed} failed`
  );

  return results;
}

/**
 * Check Supabase connection and table health.
 * @returns {Promise<{connected: boolean, message: string}>}
 */
export async function checkDatabaseHealth() {
  try {
    console.log('[DB-CLIENT] Checking database health...');

    const { error: testError, count } = await supabase
      .from('site_audits')
      .select('count', { count: 'exact', head: true });

    if (testError) {
      console.error('[DB-CLIENT] Database health check failed:', testError.message);
      return {
        connected: false,
        message: `Health check failed: ${testError.message}`
      };
    }

    console.log('[DB-CLIENT] Database health check passed');
    return {
      connected: true,
      message: `Connected successfully. Table has approximately ${count} records`
    };
  } catch (err) {
    console.error('[DB-CLIENT] Database health check error:', err.message);
    return {
      connected: false,
      message: `Health check exception: ${err.message}`
    };
  }
}

export default { supabase, saveAuditRecord, batchSaveAuditRecords, checkDatabaseHealth };
