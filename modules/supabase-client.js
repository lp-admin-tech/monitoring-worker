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
      const { data: result, error } = await supabase
        .from(table)
        .insert(data)
        .select();

      const duration = Date.now() - startTime;
      if (error) {
        await this.logDbOperation('INSERT', table, 'failure', duration, 1, error, data);
        throw error;
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
      const { data: result, error } = await supabase
        .from(table)
        .update(data)
        .eq('id', id)
        .select();

      const duration = Date.now() - startTime;
      if (error) {
        await this.logDbOperation('UPDATE', table, 'failure', duration, 1, error, { id, fieldsUpdated: Object.keys(data) });
        throw error;
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
          query = query.eq(key, value);
        });
      }

      const { data, error } = await query;
      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('SELECT', table, 'failure', duration, 0, error, { filters });
        throw error;
      }
      await this.logDbOperation('SELECT', table, 'success', duration, data?.length || 0, null, { filters });
      return data;
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', table, 'failure', duration, 0, err, { filters });
      throw err;
    }
  }

  async getContentAnalysis(publisherId, limit = 100) {
    const startTime = Date.now();
    try {
      const { data, error } = await supabase
        .from('content_analysis_results')
        .select('*')
        .eq('publisher_id', publisherId)
        .order('analysis_timestamp', { ascending: false })
        .limit(limit);

      const duration = Date.now() - startTime;
      if (error) {
        await this.logDbOperation('SELECT', 'content_analysis_results', 'failure', duration, 0, error, { publisherId, limit });
        throw error;
      }
      await this.logDbOperation('SELECT', 'content_analysis_results', 'success', duration, data?.length || 0, null, { publisherId, limit });
      return data;
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', 'content_analysis_results', 'failure', duration, 0, err, { publisherId });
      throw err;
    }
  }

  async queryBySimilarity(simhash) {
    const startTime = Date.now();
    try {
      const { data, error } = await supabase
        .from('similarity_fingerprints')
        .select('*')
        .eq('simhash', simhash);

      const duration = Date.now() - startTime;
      if (error) {
        await this.logDbOperation('SELECT', 'similarity_fingerprints', 'failure', duration, 0, error, { simhash });
        throw error;
      }
      await this.logDbOperation('SELECT', 'similarity_fingerprints', 'success', duration, data?.length || 0, null, { simhash });
      return data;
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', 'similarity_fingerprints', 'failure', duration, 0, err);
      throw err;
    }
  }

  async batchInsertAnalysis(records) {
    const startTime = Date.now();
    try {
      const { error } = await supabase
        .from('content_analysis_results')
        .insert(records);

      const duration = Date.now() - startTime;
      if (error) {
        await this.logDbOperation('INSERT', 'content_analysis_results', 'failure', duration, records.length, error);
        throw error;
      }
      await this.logDbOperation('INSERT', 'content_analysis_results', 'success', duration, records.length, null);
      return true;
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('INSERT', 'content_analysis_results', 'failure', duration, records.length, err);
      throw err;
    }
  }

  async getContentTrends(publisherId, daysBack = 30) {
    const startTime = Date.now();
    try {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - daysBack);

      const { data, error } = await supabase
        .from('content_risk_trends')
        .select('*')
        .eq('publisher_id', publisherId)
        .gte('analysis_date', fromDate.toISOString().split('T')[0])
        .order('analysis_date', { ascending: false });

      const duration = Date.now() - startTime;
      if (error) {
        await this.logDbOperation('SELECT', 'content_risk_trends', 'failure', duration, 0, error, { publisherId, daysBack });
        throw error;
      }
      await this.logDbOperation('SELECT', 'content_risk_trends', 'success', duration, data?.length || 0, null, { publisherId, daysBack });
      return data;
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', 'content_risk_trends', 'failure', duration, 0, err, { publisherId, daysBack });
      throw err;
    }
  }

  async compareContentVersions(contentAnalysisId, previousId) {
    const startTime = Date.now();
    try {
      const current = await supabase
        .from('content_analysis_results')
        .select('*')
        .eq('id', contentAnalysisId)
        .single();

      const previous = previousId
        ? await supabase
            .from('content_analysis_results')
            .select('*')
            .eq('id', previousId)
            .single()
        : null;

      const duration = Date.now() - startTime;
      if (current.error) {
        await this.logDbOperation('SELECT', 'content_analysis_results', 'failure', duration, 0, current.error, { contentAnalysisId });
        throw current.error;
      }

      await this.logDbOperation('SELECT', 'content_analysis_results', 'success', duration, 1, null, { contentAnalysisId });

      return {
        current: current.data,
        previous: previous?.data || null,
        hasChanged: previous?.data ? current.data.simhash !== previous.data.simhash : true,
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', 'content_analysis_results', 'failure', duration, 0, err);
      throw err;
    }
  }

  async getAnalysisHistory(publisherId, limit = 50) {
    const startTime = Date.now();
    try {
      const { data, error } = await supabase
        .from('content_analysis_history')
        .select('*')
        .eq('publisher_id', publisherId)
        .order('created_at', { ascending: false })
        .limit(limit);

      const duration = Date.now() - startTime;
      if (error) {
        await this.logDbOperation('SELECT', 'content_analysis_history', 'failure', duration, 0, error, { publisherId, limit });
        throw error;
      }
      await this.logDbOperation('SELECT', 'content_analysis_history', 'success', duration, data?.length || 0, null, { publisherId, limit });
      return data;
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', 'content_analysis_history', 'failure', duration, 0, err, { publisherId });
      throw err;
    }
  }
}

module.exports = new SupabaseIntegration();
