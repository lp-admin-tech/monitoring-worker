const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

class SupabaseIntegration {
  async getReportHistorical(publisherId) {
    const { data, error } = await supabase
      .from('report_historical')
      .select('*')
      .eq('publisher_id', publisherId);

    if (error) throw error;
    return data;
  }

  async getReportDimensional(publisherId, dateRange) {
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

    if (error) throw error;
    return data;
  }

  async batchInsert(table, data) {
    const { error } = await supabase
      .from(table)
      .insert(data);

    if (error) throw error;
    return true;
  }

  async insert(table, data) {
    const { data: result, error } = await supabase
      .from(table)
      .insert(data)
      .select();

    if (error) throw error;
    return result;
  }

  async update(table, id, data) {
    const { data: result, error } = await supabase
      .from(table)
      .update(data)
      .eq('id', id)
      .select();

    if (error) throw error;
    return result;
  }

  async query(table, filters) {
    let query = supabase.from(table).select('*');

    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        query = query.eq(key, value);
      });
    }

    const { data, error } = await query;

    if (error) throw error;
    return data;
  }

  async getContentAnalysis(publisherId, limit = 100) {
    const { data, error } = await supabase
      .from('content_analysis_results')
      .select('*')
      .eq('publisher_id', publisherId)
      .order('analysis_timestamp', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  }

  async queryBySimilarity(simhash) {
    const { data, error } = await supabase
      .from('similarity_fingerprints')
      .select('*')
      .eq('simhash', simhash);

    if (error) throw error;
    return data;
  }

  async batchInsertAnalysis(records) {
    const { error } = await supabase
      .from('content_analysis_results')
      .insert(records);

    if (error) throw error;
    return true;
  }

  async getContentTrends(publisherId, daysBack = 30) {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - daysBack);

    const { data, error } = await supabase
      .from('content_risk_trends')
      .select('*')
      .eq('publisher_id', publisherId)
      .gte('analysis_date', fromDate.toISOString().split('T')[0])
      .order('analysis_date', { ascending: false });

    if (error) throw error;
    return data;
  }

  async compareContentVersions(contentAnalysisId, previousId) {
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

    if (current.error) throw current.error;

    return {
      current: current.data,
      previous: previous?.data || null,
      hasChanged: previous?.data ? current.data.simhash !== previous.data.simhash : true,
    };
  }

  async getAnalysisHistory(publisherId, limit = 50) {
    const { data, error } = await supabase
      .from('content_analysis_history')
      .select('*')
      .eq('publisher_id', publisherId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  }
}

module.exports = new SupabaseIntegration();
