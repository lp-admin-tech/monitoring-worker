const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

class SupabaseIntegration {
  async logDbOperation(operation, table, status, duration, recordCount, error, details) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level: status === 'success' ? 'INFO' : 'ERROR',
        operation,
        table_name: table,
        status,
        message: `${status === 'success' ? 'Successfully' : 'Failed to'} ${operation.toLowerCase()} ${recordCount || 0} record(s) in ${table}`,
        details: details || {},
        error_message: error?.message || null,
        duration_ms: duration,
        record_count: recordCount || 0,
        created_at: new Date().toISOString(),
      };

      await supabase
        .from('db_operation_logs')
        .insert(logEntry);

      if (status === 'success') {
        console.log(`[DB_LOG] ${operation} ${table}: ${recordCount} record(s) in ${duration}ms`);
      } else {
        console.error(`[DB_LOG] ${operation} ${table} FAILED: ${error?.message || 'Unknown error'}`);
      }
    } catch (err) {
      console.error(`[DB_LOG] Failed to log database operation: ${err.message}`);
    }
  }

  async getReportHistorical(publisherId) {
    const startTime = Date.now();
    try {
      const { data, error } = await supabase
        .from('report_historical')
        .select('*')
        .eq('publisher_id', publisherId);

      const duration = Date.now() - startTime;
      if (error) {
        await this.logDbOperation('SELECT', 'report_historical', 'failure', duration, 0, error, { publisherId });
        throw error;
      }
      await this.logDbOperation('SELECT', 'report_historical', 'success', duration, data?.length || 0, null, { publisherId });
      return data;
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', 'report_historical', 'failure', duration, 0, err, { publisherId });
      throw err;
    }
  }

  async getReportDimensional(publisherId, dateRange) {
    const startTime = Date.now();
    try {
      let query = supabase
        .from('reports_dimensional')
        .select('*')
        .eq('publisher_id', publisherId);

      if (dateRange) {
        query = query
          .gte('date', dateRange.start)
          .lte('date', dateRange.end);
      }

      const { data, error } = await query;
      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('SELECT', 'reports_dimensional', 'failure', duration, 0, error, { publisherId, dateRange });
        throw error;
      }
      await this.logDbOperation('SELECT', 'reports_dimensional', 'success', duration, data?.length || 0, null, { publisherId, dateRange });
      return data;
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', 'reports_dimensional', 'failure', duration, 0, err, { publisherId, dateRange });
      throw err;
    }
  }

  async batchInsert(table, data) {
    const startTime = Date.now();
    try {
      const { error } = await supabase
        .from(table)
        .insert(data);

      const duration = Date.now() - startTime;
      if (error) {
        await this.logDbOperation('INSERT', table, 'failure', duration, data.length, error, { recordCount: data.length });
        throw error;
      }
      await this.logDbOperation('INSERT', table, 'success', duration, data.length, null, { recordCount: data.length });
      return true;
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('INSERT', table, 'failure', duration, data.length, err);
      throw err;
    }
  }

  async insert(table, data) {
    const startTime = Date.now();
    try {
      if (!data) {
        throw new Error('Insert data cannot be null or undefined');
      }

      const { data: result, error } = await supabase
        .from(table)
        .insert(data)
        .select();

      const duration = Date.now() - startTime;
      if (error) {
        const errorMsg = error.message || JSON.stringify(error);
        console.error(`[INSERT] Error for table ${table}: ${errorMsg}`);
        await this.logDbOperation('INSERT', table, 'failure', duration, 1, error, data);
        throw new Error(`Failed to insert into ${table}: ${errorMsg}`);
      }
      await this.logDbOperation('INSERT', table, 'success', duration, result?.length || 1, null, { insertedId: result?.[0]?.id });
      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('INSERT', table, 'failure', duration, 1, err, data);
      throw err;
    }
  }

  async update(table, id, data) {
    const startTime = Date.now();
    try {
      if (!id) {
        throw new Error('Update ID cannot be null or undefined');
      }
      if (!data || Object.keys(data).length === 0) {
        throw new Error('Update data cannot be empty');
      }

      const { data: result, error } = await supabase
        .from(table)
        .update(data)
        .eq('id', id)
        .select();

      const duration = Date.now() - startTime;
      if (error) {
        const errorMsg = error.message || JSON.stringify(error);
        console.error(`[UPDATE] Error for table ${table} id ${id}: ${errorMsg}`);
        await this.logDbOperation('UPDATE', table, 'failure', duration, 1, error, { id, fieldsUpdated: Object.keys(data) });
        throw new Error(`Failed to update ${table}: ${errorMsg}`);
      }
      await this.logDbOperation('UPDATE', table, 'success', duration, result?.length || 1, null, { id, fieldsUpdated: Object.keys(data) });
      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('UPDATE', table, 'failure', duration, 1, err, { id });
      throw err;
    }
  }

  async query(table, filters) {
    const startTime = Date.now();
    try {
      let query = supabase.from(table).select('*');

      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            query = query.eq(key, value);
          }
        });
      }

      const { data, error } = await query;
      const duration = Date.now() - startTime;

      if (error) {
        const errorMsg = error.message || JSON.stringify(error);
        console.error(`[SELECT] Error for table ${table}: ${errorMsg}`);
        await this.logDbOperation('SELECT', table, 'failure', duration, 0, error, { filters });
        throw new Error(`Failed to query ${table}: ${errorMsg}`);
      }
      await this.logDbOperation('SELECT', table, 'success', duration, data?.length || 0, null, { filters });
      return data || [];
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', table, 'failure', duration, 0, err, { filters });
      throw err;
    }
  }

}

module.exports = new SupabaseIntegration();
module.exports.supabaseClient = supabase;
