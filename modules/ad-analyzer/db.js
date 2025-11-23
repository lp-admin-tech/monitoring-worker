const { createClient } = require('@supabase/supabase-js');
const logger = require('../logger');

class AdAnalyzerDB {
  constructor(supabaseUrl, supabaseServiceKey) {
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase URL and service key are required');
    }
    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
    this.logger = logger;
  }

  async saveDensityAnalysis(publisherId, siteAuditId, densityData) {
    try {
      this.logger.info('Saving density analysis', {
        publisherId,
        siteAuditId,
        density: densityData.density_percentage,
      });

      const record = {
        publisher_id: publisherId,
        site_audit_id: siteAuditId,
        density_percentage: densityData.density_percentage || 0,
        total_viewport_pixels: densityData.total_viewport_pixels || 0,
        total_ad_pixels: densityData.total_ad_pixels || 0,
        compliance_status: densityData.compliance_status || 'unknown',
        viewport_width: densityData.viewport_width,
        viewport_height: densityData.viewport_height,
        version: 1,
      };

      const { data, error } = await this.supabase
        .from('ad_density_history')
        .insert(record)
        .select();

      if (error) {
        throw new Error(`Density insert failed: ${error.message}`);
      }

      this.logger.info('Density analysis saved successfully', { id: data[0]?.id });
      return { success: true, data: data[0] };
    } catch (error) {
      this.logger.error('Error saving density analysis', error);
      return { success: false, error: error.message };
    }
  }

  async saveAutoRefreshDetection(publisherId, siteAuditId, refreshData) {
    try {
      this.logger.info('Saving auto-refresh detection', {
        publisherId,
        siteAuditId,
        detected: refreshData.auto_refresh_detected,
      });

      const record = {
        publisher_id: publisherId,
        site_audit_id: siteAuditId,
        auto_refresh_detected: refreshData.auto_refresh_detected || false,
        refresh_count: refreshData.refresh_count || 0,
        refresh_intervals: refreshData.refresh_intervals || [],
        affected_ad_slots: refreshData.affected_ad_slots || 0,
        risk_level: refreshData.risk_level || 'low',
        version: 1,
      };

      const { data, error } = await this.supabase
        .from('auto_refresh_tracking')
        .insert(record)
        .select();

      if (error) {
        throw new Error(`Auto-refresh insert failed: ${error.message}`);
      }

      this.logger.info('Auto-refresh detection saved successfully', { id: data[0]?.id });
      return { success: true, data: data[0] };
    } catch (error) {
      this.logger.error('Error saving auto-refresh detection', error);
      return { success: false, error: error.message };
    }
  }

  async saveVisibilityCompliance(publisherId, siteAuditId, visibilityData) {
    try {
      this.logger.info('Saving visibility compliance', {
        publisherId,
        siteAuditId,
        status: visibilityData.compliance_status,
      });

      const record = {
        publisher_id: publisherId,
        site_audit_id: siteAuditId,
        compliance_status: visibilityData.compliance_status || 'unknown',
        visible_ads_percentage: visibilityData.visible_ads_percentage || 0,
        visible_ads_count: visibilityData.visible_ads_count || 0,
        hidden_ads_count: visibilityData.hidden_ads_count || 0,
        total_ads_count: visibilityData.total_ads_count || 0,
        recommendations: visibilityData.recommendations || [],
      };

      const { data, error } = await this.supabase
        .from('visibility_compliance')
        .insert(record)
        .select();

      if (error) {
        throw new Error(`Visibility insert failed: ${error.message}`);
      }

      this.logger.info('Visibility compliance saved successfully', { id: data[0]?.id });
      return { success: true, data: data[0] };
    } catch (error) {
      this.logger.error('Error saving visibility compliance', error);
      return { success: false, error: error.message };
    }
  }

  async savePatternDetection(publisherId, siteAuditId, patternData) {
    try {
      this.logger.info('Saving pattern detection', {
        publisherId,
        siteAuditId,
        mfaRiskScore: patternData.mfa_risk_score,
      });

      const record = {
        publisher_id: publisherId,
        site_audit_id: siteAuditId,
        network_diversity: patternData.network_diversity || 0,
        detected_networks: patternData.detected_networks || [],
        suspicious_patterns: patternData.suspicious_patterns || 0,
        mfa_risk_score: patternData.mfa_risk_score || 0,
        mfa_indicators: patternData.mfa_indicators || {},
        detected_anomalies: patternData.detected_anomalies || [],
        correlation_data: patternData.correlation_data || {},
        version: 1,
      };

      const { data, error } = await this.supabase
        .from('pattern_correlations')
        .insert(record)
        .select();

      if (error) {
        throw new Error(`Pattern detection insert failed: ${error.message}`);
      }

      this.logger.info('Pattern detection saved successfully', { id: data[0]?.id });
      return { success: true, data: data[0] };
    } catch (error) {
      this.logger.error('Error saving pattern detection', error);
      return { success: false, error: error.message };
    }
  }

  async saveBatchAdElements(publisherId, siteAuditId, adElements) {
    try {
      if (!Array.isArray(adElements) || adElements.length === 0) {
        this.logger.warn('No ad elements to batch insert', { publisherId, siteAuditId });
        return { success: true, data: [] };
      }

      this.logger.info('Saving batch ad elements', {
        publisherId,
        siteAuditId,
        count: adElements.length,
      });

      const records = adElements.map((element, index) => ({
        publisher_id: publisherId,
        site_audit_id: siteAuditId,
        element_index: index,
        element_id: element.id || null,
        element_class: element.className || null,
        width: element.width || null,
        height: element.height || null,
        is_visible: element.isVisible || false,
        network_type: element.networkType || null,
        risk_indicators: element.riskIndicators || {},
      }));

      const { data, error } = await this.supabase
        .from('ad_element_batch')
        .insert(records)
        .select();

      if (error) {
        throw new Error(`Batch insert failed: ${error.message}`);
      }

      this.logger.info('Batch ad elements saved successfully', { count: data?.length });
      return { success: true, data };
    } catch (error) {
      this.logger.error('Error saving batch ad elements', error);
      return { success: false, error: error.message };
    }
  }

  async saveMultipleAnalysis(publisherId, siteAuditId, analysisResults) {
    try {
      this.logger.info('Saving multiple analysis results', {
        publisherId,
        siteAuditId,
      });

      const results = {};

      if (analysisResults.densityData) {
        const densityResult = await this.saveDensityAnalysis(
          publisherId,
          siteAuditId,
          analysisResults.densityData
        );
        results.density = densityResult;
      }

      if (analysisResults.autoRefreshData) {
        const refreshResult = await this.saveAutoRefreshDetection(
          publisherId,
          siteAuditId,
          analysisResults.autoRefreshData
        );
        results.autoRefresh = refreshResult;
      }

      if (analysisResults.visibilityData) {
        const visibilityResult = await this.saveVisibilityCompliance(
          publisherId,
          siteAuditId,
          analysisResults.visibilityData
        );
        results.visibility = visibilityResult;
      }

      if (analysisResults.patternData) {
        const patternResult = await this.savePatternDetection(
          publisherId,
          siteAuditId,
          analysisResults.patternData
        );
        results.pattern = patternResult;
      }

      if (analysisResults.videoData) {
        const videoResult = await this.saveVideoDetection(
          publisherId,
          siteAuditId,
          analysisResults.videoData
        );
        results.video = videoResult;
      }

      if (analysisResults.adElements && Array.isArray(analysisResults.adElements)) {
        const elementResult = await this.saveBatchAdElements(
          publisherId,
          siteAuditId,
          analysisResults.adElements
        );
        results.elements = elementResult;
      }

      const allSuccess = Object.values(results).every(r => r?.success !== false);
      return {
        success: allSuccess,
        results,
      };
    } catch (error) {
      this.logger.error('Error saving multiple analysis results', error);
      return { success: false, error: error.message };
    }
  }

  async saveVideoDetection(publisherId, siteAuditId, videoData) {
    try {
      this.logger.info('Saving video detection', {
        publisherId,
        siteAuditId,
        videoCount: videoData.video_player_count,
      });

      const record = {
        publisher_id: publisherId,
        site_audit_id: siteAuditId,
        video_player_count: videoData.video_player_count || 0,
        autoplay_count: videoData.autoplay_count || 0,
        video_stuffing_detected: videoData.video_stuffing_detected || false,
        risk_score: videoData.risk_score || 0,
        video_players_data: videoData.video_players_data || [],
      };

      const { data, error } = await this.supabase
        .from('video_detection_history')
        .insert(record)
        .select();

      if (error) {
        throw new Error(`Video detection insert failed: ${error.message}`);
      }

      this.logger.info('Video detection saved successfully', { id: data[0]?.id });
      return { success: true, data: data[0] };
    } catch (error) {
      this.logger.error('Error saving video detection', error);
      return { success: false, error: error.message };
    }
  }

  async getDensityHistory(publisherId, limit = 30) {
    try {
      this.logger.info('Fetching density history', { publisherId, limit });

      const { data, error } = await this.supabase
        .from('ad_density_history')
        .select('*')
        .eq('publisher_id', publisherId)
        .order('audit_timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Density history query failed: ${error.message}`);
      }

      this.logger.info('Density history fetched successfully', { count: data?.length });
      return { success: true, data };
    } catch (error) {
      this.logger.error('Error fetching density history', error);
      return { success: false, error: error.message };
    }
  }

  async calculateDensityTrend(publisherId, days = 30) {
    try {
      this.logger.info('Calculating density trend', { publisherId, days });

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await this.supabase
        .from('ad_density_history')
        .select('density_percentage, audit_timestamp')
        .eq('publisher_id', publisherId)
        .gte('audit_timestamp', startDate.toISOString())
        .order('audit_timestamp', { ascending: true });

      if (error) {
        throw new Error(`Density trend query failed: ${error.message}`);
      }

      const trend = {
        dataPoints: data?.length || 0,
        values: data?.map(d => d.density_percentage) || [],
        timestamps: data?.map(d => d.audit_timestamp) || [],
        average: data?.length > 0 ?
          data.reduce((sum, d) => sum + d.density_percentage, 0) / data.length : 0,
        min: data?.length > 0 ? Math.min(...data.map(d => d.density_percentage)) : 0,
        max: data?.length > 0 ? Math.max(...data.map(d => d.density_percentage)) : 0,
      };

      this.logger.info('Density trend calculated', { trend });
      return { success: true, data: trend };
    } catch (error) {
      this.logger.error('Error calculating density trend', error);
      return { success: false, error: error.message };
    }
  }

  async getAutoRefreshHistory(publisherId, limit = 30) {
    try {
      this.logger.info('Fetching auto-refresh history', { publisherId, limit });

      const { data, error } = await this.supabase
        .from('auto_refresh_tracking')
        .select('*')
        .eq('publisher_id', publisherId)
        .order('audit_timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Auto-refresh history query failed: ${error.message}`);
      }

      this.logger.info('Auto-refresh history fetched successfully', { count: data?.length });
      return { success: true, data };
    } catch (error) {
      this.logger.error('Error fetching auto-refresh history', error);
      return { success: false, error: error.message };
    }
  }

  async analyzeRefreshEvolution(publisherId, days = 30) {
    try {
      this.logger.info('Analyzing refresh evolution', { publisherId, days });

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await this.supabase
        .from('auto_refresh_tracking')
        .select('auto_refresh_detected, refresh_count, risk_level, audit_timestamp')
        .eq('publisher_id', publisherId)
        .gte('audit_timestamp', startDate.toISOString())
        .order('audit_timestamp', { ascending: true });

      if (error) {
        throw new Error(`Refresh evolution query failed: ${error.message}`);
      }

      const detectedCount = data?.filter(d => d.auto_refresh_detected).length || 0;
      const totalCount = data?.length || 0;
      const detectionRate = totalCount > 0 ? (detectedCount / totalCount) * 100 : 0;

      const riskLevels = {
        critical: data?.filter(d => d.risk_level === 'critical').length || 0,
        high: data?.filter(d => d.risk_level === 'high').length || 0,
        medium: data?.filter(d => d.risk_level === 'medium').length || 0,
        low: data?.filter(d => d.risk_level === 'low').length || 0,
      };

      const evolution = {
        totalAudits: totalCount,
        detectedAudits: detectedCount,
        detectionRate: parseFloat(detectionRate.toFixed(2)),
        riskLevelBreakdown: riskLevels,
        avgRefreshCount: data?.length > 0 ?
          data.reduce((sum, d) => sum + d.refresh_count, 0) / data.length : 0,
      };

      this.logger.info('Refresh evolution analyzed', { evolution });
      return { success: true, data: evolution };
    } catch (error) {
      this.logger.error('Error analyzing refresh evolution', error);
      return { success: false, error: error.message };
    }
  }

  async getPatternHistory(publisherId, limit = 30) {
    try {
      this.logger.info('Fetching pattern history', { publisherId, limit });

      const { data, error } = await this.supabase
        .from('pattern_correlations')
        .select('*')
        .eq('publisher_id', publisherId)
        .order('audit_timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Pattern history query failed: ${error.message}`);
      }

      this.logger.info('Pattern history fetched successfully', { count: data?.length });
      return { success: true, data };
    } catch (error) {
      this.logger.error('Error fetching pattern history', error);
      return { success: false, error: error.message };
    }
  }

  async queryCorrelations(publisherId, siteAuditId) {
    try {
      this.logger.info('Querying correlations', { publisherId, siteAuditId });

      const { data, error } = await this.supabase
        .from('pattern_correlations')
        .select('*')
        .eq('publisher_id', publisherId)
        .eq('site_audit_id', siteAuditId)
        .order('audit_timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(`Correlation query failed: ${error.message}`);
      }

      this.logger.info('Correlations queried successfully', { found: !!data });
      return { success: true, data };
    } catch (error) {
      this.logger.error('Error querying correlations', error);
      return { success: false, error: error.message };
    }
  }

  async getHistoricalTrends(publisherId, days = 30) {
    try {
      this.logger.info('Fetching historical trends', { publisherId, days });

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [density, refresh, patterns] = await Promise.all([
        this.supabase
          .from('ad_density_history')
          .select('density_percentage, audit_timestamp')
          .eq('publisher_id', publisherId)
          .gte('audit_timestamp', startDate.toISOString()),
        this.supabase
          .from('auto_refresh_tracking')
          .select('auto_refresh_detected, audit_timestamp')
          .eq('publisher_id', publisherId)
          .gte('audit_timestamp', startDate.toISOString()),
        this.supabase
          .from('pattern_correlations')
          .select('mfa_risk_score, audit_timestamp')
          .eq('publisher_id', publisherId)
          .gte('audit_timestamp', startDate.toISOString()),
      ]);

      const trends = {
        densityTrend: density.data?.map(d => ({
          value: d.density_percentage,
          timestamp: d.audit_timestamp,
        })) || [],
        refreshTrend: refresh.data?.map(d => ({
          detected: d.auto_refresh_detected,
          timestamp: d.audit_timestamp,
        })) || [],
        riskTrend: patterns.data?.map(p => ({
          mfaScore: p.mfa_risk_score,
          timestamp: p.audit_timestamp,
        })) || [],
      };

      this.logger.info('Historical trends fetched successfully', {
        densityPoints: trends.densityTrend.length,
        refreshPoints: trends.refreshTrend.length,
        riskPoints: trends.riskTrend.length,
      });

      return { success: true, data: trends };
    } catch (error) {
      this.logger.error('Error fetching historical trends', error);
      return { success: false, error: error.message };
    }
  }

  async compareVersions(publisherId, siteAuditId, metricType) {
    try {
      this.logger.info('Comparing versions', { publisherId, siteAuditId, metricType });

      let tableName;
      switch (metricType) {
        case 'density':
          tableName = 'ad_density_history';
          break;
        case 'refresh':
          tableName = 'auto_refresh_tracking';
          break;
        case 'pattern':
          tableName = 'pattern_correlations';
          break;
        default:
          throw new Error(`Unknown metric type: ${metricType}`);
      }

      const { data, error } = await this.supabase
        .from(tableName)
        .select('*')
        .eq('publisher_id', publisherId)
        .eq('site_audit_id', siteAuditId)
        .order('version', { ascending: false });

      if (error) {
        throw new Error(`Version comparison query failed: ${error.message}`);
      }

      this.logger.info('Versions compared successfully', { count: data?.length });
      return { success: true, data };
    } catch (error) {
      this.logger.error('Error comparing versions', error);
      return { success: false, error: error.message };
    }
  }

  async getPublisherTimeline(publisherId, days = 90, limit = 100) {
    try {
      this.logger.info('Fetching publisher timeline', { publisherId, days, limit });

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [density, refresh, visibility, patterns, elements] = await Promise.all([
        this.supabase
          .from('ad_density_history')
          .select('id, density_percentage, compliance_status, audit_timestamp')
          .eq('publisher_id', publisherId)
          .gte('audit_timestamp', startDate.toISOString())
          .order('audit_timestamp', { ascending: false })
          .limit(limit),
        this.supabase
          .from('auto_refresh_tracking')
          .select('id, auto_refresh_detected, risk_level, audit_timestamp')
          .eq('publisher_id', publisherId)
          .gte('audit_timestamp', startDate.toISOString())
          .order('audit_timestamp', { ascending: false })
          .limit(limit),
        this.supabase
          .from('visibility_compliance')
          .select('id, compliance_status, visible_ads_percentage, audit_timestamp')
          .eq('publisher_id', publisherId)
          .gte('audit_timestamp', startDate.toISOString())
          .order('audit_timestamp', { ascending: false })
          .limit(limit),
        this.supabase
          .from('pattern_correlations')
          .select('id, mfa_risk_score, network_diversity, audit_timestamp')
          .eq('publisher_id', publisherId)
          .gte('audit_timestamp', startDate.toISOString())
          .order('audit_timestamp', { ascending: false })
          .limit(limit),
        this.supabase
          .from('ad_element_batch')
          .select('id, audit_timestamp')
          .eq('publisher_id', publisherId)
          .gte('audit_timestamp', startDate.toISOString())
          .order('audit_timestamp', { ascending: false })
          .limit(limit),
      ]);

      const timeline = {
        densityHistory: density.data || [],
        refreshHistory: refresh.data || [],
        visibilityHistory: visibility.data || [],
        patternHistory: patterns.data || [],
        elementCount: elements.data?.length || 0,
      };

      this.logger.info('Publisher timeline fetched successfully', {
        densityCount: timeline.densityHistory.length,
        refreshCount: timeline.refreshHistory.length,
      });

      return { success: true, data: timeline };
    } catch (error) {
      this.logger.error('Error fetching publisher timeline', error);
      return { success: false, error: error.message };
    }
  }

  async batchInsert(tableName, records) {
    try {
      if (!Array.isArray(records) || records.length === 0) {
        this.logger.warn('No records to batch insert', { tableName });
        return { success: true, data: [] };
      }

      this.logger.info('Performing batch insert', {
        tableName,
        recordCount: records.length,
      });

      const { data, error } = await this.supabase
        .from(tableName)
        .insert(records)
        .select();

      if (error) {
        throw new Error(`Batch insert to ${tableName} failed: ${error.message}`);
      }

      this.logger.info('Batch insert completed successfully', {
        tableName,
        insertedCount: data?.length,
      });

      return { success: true, data };
    } catch (error) {
      this.logger.error('Error performing batch insert', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = AdAnalyzerDB;
