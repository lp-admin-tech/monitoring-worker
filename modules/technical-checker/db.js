const logger = require('../logger');
const { supabaseClient: supabase } = require('../supabase-client');

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

class TechnicalCheckerDb {
  constructor() {
    this.tableName = 'technical_check_results';
    this.historyTableName = 'technical_check_history';
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async retryOperation(operation, operationName, context = {}) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const startTime = Date.now();
        const result = await operation();
        const duration = Date.now() - startTime;

        logger.info(`${operationName} succeeded`, {
          module: 'technical-checker-db',
          attempt,
          durationMs: duration,
          ...context,
        });

        return { success: true, data: result, duration };
      } catch (error) {
        lastError = error;

        logger.warn(`${operationName} failed (attempt ${attempt}/${MAX_RETRIES})`, {
          module: 'technical-checker-db',
          attempt,
          error: error.message,
          ...context,
        });

        if (attempt < MAX_RETRIES) {
          const delayMs = RETRY_DELAY_MS * attempt;
          await this.sleep(delayMs);
        }
      }
    }

    const error = new Error(`${operationName} failed after ${MAX_RETRIES} retries: ${lastError?.message}`);
    logger.error(`${operationName} failed permanently`, lastError, {
      module: 'technical-checker-db',
      retries: MAX_RETRIES,
      ...context,
    });

    throw error;
  }

  async saveTechnicalCheck(publisherId, siteAuditId, technicalCheckResults) {
    if (!publisherId || !technicalCheckResults) {
      throw new Error('Missing required parameters: publisherId, technicalCheckResults');
    }

    return this.retryOperation(
      async () => {
        const componentScores = this.extractComponentScores(technicalCheckResults.components);
        const recommendations = this.extractRecommendations(technicalCheckResults.components);

        const checkData = {
          publisher_id: publisherId,
          site_audit_id: siteAuditId || null,
          check_data: technicalCheckResults,
          components_data: technicalCheckResults.components || {},
          ssl_score: componentScores.ssl || null,
          performance_score: componentScores.performance || null,
          ads_txt_status: componentScores.adsTxtStatus || null,
          broken_link_count: componentScores.brokenLinkCount || null,
          domain_intelligence_rating: componentScores.domainIntelRating || null,
          viewport_occlusion_percentage: componentScores.viewportOcclusion || null,
          component_recommendations: recommendations,
          risk_score: technicalCheckResults.technicalHealthScore || 0,
          timestamp: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.tableName)
          .insert(checkData)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save technical check',
      { publisherId, siteAuditId }
    );
  }

  async saveComponentScores(publisherId, siteAuditId, components) {
    if (!publisherId || !components) {
      throw new Error('Missing required parameters: publisherId, components');
    }

    return this.retryOperation(
      async () => {
        const scores = this.extractComponentScores(components);

        const updateData = {
          ssl_score: scores.ssl || null,
          performance_score: scores.performance || null,
          ads_txt_status: scores.adsTxtStatus || null,
          broken_link_count: scores.brokenLinkCount || null,
          domain_intelligence_rating: scores.domainIntelRating || null,
          viewport_occlusion_percentage: scores.viewportOcclusion || null,
        };

        const { data, error } = await supabase
          .from(this.tableName)
          .update(updateData)
          .eq('publisher_id', publisherId)
          .eq('site_audit_id', siteAuditId)
          .order('created_at', { ascending: false })
          .limit(1)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save component scores',
      { publisherId, siteAuditId }
    );
  }

  async saveComponentRecommendations(publisherId, siteAuditId, recommendations) {
    if (!publisherId || !recommendations) {
      throw new Error('Missing required parameters: publisherId, recommendations');
    }

    return this.retryOperation(
      async () => {
        const updateData = {
          component_recommendations: recommendations,
        };

        const { data, error } = await supabase
          .from(this.tableName)
          .update(updateData)
          .eq('publisher_id', publisherId)
          .eq('site_audit_id', siteAuditId)
          .order('created_at', { ascending: false })
          .limit(1)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save component recommendations',
      { publisherId, siteAuditId }
    );
  }

  async trackVersionHistory(publisherId, siteAuditId, currentHealthScore, previousCheckId = null) {
    if (!publisherId || currentHealthScore === undefined) {
      throw new Error('Missing required parameters: publisherId, currentHealthScore');
    }

    return this.retryOperation(
      async () => {
        let previousCheck = null;
        if (previousCheckId) {
          const { data } = await supabase
            .from(this.tableName)
            .select('*')
            .eq('id', previousCheckId)
            .maybeSingle();
          previousCheck = data;
        } else {
          const { data } = await supabase
            .from(this.tableName)
            .select('*')
            .eq('publisher_id', publisherId)
            .order('created_at', { ascending: false })
            .limit(2);
          previousCheck = data?.[1] || null;
        }

        const healthScoreDelta = previousCheck
          ? currentHealthScore - (previousCheck.risk_score || 0)
          : null;

        const detectedChanges = this.detectComponentChanges(
          previousCheck?.components_data,
          currentHealthScore,
          previousCheck?.risk_score
        );

        const performanceDegraded = healthScoreDelta !== null && healthScoreDelta < -5;
        const sslIssuesDetected = this.detectSSLIssues(previousCheck?.components_data);

        const historyEntry = {
          site_audit_id: siteAuditId || null,
          publisher_id: publisherId,
          technical_check_result_id: null,
          previous_health_score: previousCheck?.risk_score || null,
          current_health_score: currentHealthScore,
          health_score_delta: healthScoreDelta,
          detected_changes: detectedChanges,
          component_changes: this.getComponentChangesDetail(previousCheck?.components_data),
          performance_degradation_detected: performanceDegraded,
          ssl_certificate_issues: sslIssuesDetected,
          comparison_timestamp: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.historyTableName)
          .insert(historyEntry)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Track version history',
      { publisherId, siteAuditId }
    );
  }

  extractComponentScores(components) {
    return {
      ssl: components?.ssl?.score || null,
      performance: components?.performance?.performanceScore || null,
      adsTxtStatus: components?.adsTxt?.valid ? 'valid' : (components?.adsTxt?.found ? 'invalid' : 'missing'),
      brokenLinkCount: components?.brokenLinks?.brokenCount || null,
      domainIntelRating: components?.domainIntel?.severity || null,
      viewportOcclusion: components?.viewportOcclusion?.occlusionPercentage || null,
    };
  }

  extractRecommendations(components) {
    const recommendations = {};

    if (components?.performance?.recommendations && components.performance.recommendations.length > 0) {
      recommendations.performance = components.performance.recommendations;
    }

    if (components?.viewportOcclusion?.reasoning) {
      recommendations.viewportOcclusion = [components.viewportOcclusion.reasoning];
    }

    if (components?.ssl?.warnings && components.ssl.warnings.length > 0) {
      recommendations.ssl = components.ssl.warnings;
    }

    if (components?.brokenLinks?.brokenCount > 0) {
      recommendations.brokenLinks = [
        `Found ${components.brokenLinks.brokenCount} broken links`,
      ];
    }

    if (components?.adsTxt && !components.adsTxt.found && !components.adsTxt.skipped) {
      recommendations.adsTxt = ['ads.txt file not found'];
    }

    return Object.keys(recommendations).length > 0 ? recommendations : null;
  }

  detectComponentChanges(previousComponents, currentScore, previousScore) {
    if (!previousComponents) {
      return ['new_technical_check_created'];
    }

    const changes = [];

    if ((previousScore || 0) !== currentScore) {
      changes.push('health_score_changed');
    }

    if ((previousComponents?.ssl?.score || 0) !== (currentScore || 0)) {
      changes.push('ssl_status_changed');
    }

    if ((previousComponents?.performance?.performanceScore || 0) !== (currentScore || 0)) {
      changes.push('performance_changed');
    }

    if ((previousComponents?.brokenLinks?.brokenCount || 0) !== (currentScore || 0)) {
      changes.push('broken_links_changed');
    }

    if ((previousComponents?.viewportOcclusion?.occlusionPercentage || 0) !== (currentScore || 0)) {
      changes.push('viewport_occlusion_changed');
    }

    return changes.length > 0 ? changes : ['no_changes_detected'];
  }

  detectSSLIssues(previousComponents) {
    if (!previousComponents?.ssl) {
      return null;
    }

    const issues = {};

    if (!previousComponents.ssl.valid) {
      issues.certificateInvalid = true;
      issues.error = previousComponents.ssl.error;
    }

    if (previousComponents.ssl.riskScore && previousComponents.ssl.riskScore > 0) {
      issues.riskDetected = true;
      issues.riskScore = previousComponents.ssl.riskScore;
    }

    if (previousComponents.ssl.warnings && previousComponents.ssl.warnings.length > 0) {
      issues.warnings = previousComponents.ssl.warnings;
    }

    return Object.keys(issues).length > 0 ? issues : null;
  }

  getComponentChangesDetail(previousComponents) {
    if (!previousComponents) {
      return null;
    }

    return {
      ssl: {
        previous: previousComponents?.ssl?.score,
        changed: true,
      },
      performance: {
        previous: previousComponents?.performance?.performanceScore,
        changed: true,
      },
      brokenLinks: {
        previous: previousComponents?.brokenLinks?.brokenCount,
        changed: true,
      },
      viewportOcclusion: {
        previous: previousComponents?.viewportOcclusion?.occlusionPercentage,
        changed: true,
      },
    };
  }

  async getTrendData(publisherId, daysBack = 30, limit = 100) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        const startDateStr = startDate.toISOString().split('T')[0];

        const { data, error } = await supabase
          .from(this.tableName)
          .select(
            'id, ssl_score, performance_score, broken_link_count, viewport_occlusion_percentage, domain_intelligence_rating, risk_score, created_at'
          )
          .eq('publisher_id', publisherId)
          .gte('created_at', startDateStr)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;

        const trends = this.aggregateTrendMetrics(data);
        return {
          publisherId,
          daysBack,
          dataPoints: data?.length || 0,
          trends,
          aggregatedAt: new Date().toISOString(),
        };
      },
      'Get trend data',
      { publisherId, daysBack }
    );
  }

  aggregateTrendMetrics(dataPoints) {
    if (!dataPoints || dataPoints.length === 0) {
      return {
        healthScoreTrend: [],
        performanceTrend: [],
        sslScoreTrend: [],
        brokenLinksTrend: [],
        viewportOcclusionTrend: [],
        statistics: {},
      };
    }

    const healthScoreTrend = [];
    const performanceTrend = [];
    const sslScoreTrend = [];
    const brokenLinksTrend = [];
    const viewportOcclusionTrend = [];

    dataPoints.forEach(point => {
      if (point.risk_score !== null) {
        healthScoreTrend.push({
          date: point.created_at,
          score: point.risk_score,
        });
      }

      if (point.performance_score !== null) {
        performanceTrend.push({
          date: point.created_at,
          score: point.performance_score,
        });
      }

      if (point.ssl_score !== null) {
        sslScoreTrend.push({
          date: point.created_at,
          score: point.ssl_score,
        });
      }

      if (point.broken_link_count !== null) {
        brokenLinksTrend.push({
          date: point.created_at,
          count: point.broken_link_count,
        });
      }

      if (point.viewport_occlusion_percentage !== null) {
        viewportOcclusionTrend.push({
          date: point.created_at,
          percentage: point.viewport_occlusion_percentage,
        });
      }
    });

    return {
      healthScoreTrend,
      performanceTrend,
      sslScoreTrend,
      brokenLinksTrend,
      viewportOcclusionTrend,
      statistics: this.calculateStatistics(dataPoints),
    };
  }

  calculateStatistics(dataPoints) {
    const stats = {};

    const healthScores = dataPoints.map(p => p.risk_score).filter(s => s !== null && s !== undefined);
    if (healthScores.length > 0) {
      stats.healthScore = {
        average: (healthScores.reduce((a, b) => a + b) / healthScores.length).toFixed(2),
        min: Math.min(...healthScores),
        max: Math.max(...healthScores),
        dataPoints: healthScores.length,
      };
    }

    const performanceScores = dataPoints
      .map(p => p.performance_score)
      .filter(s => s !== null && s !== undefined);
    if (performanceScores.length > 0) {
      stats.performance = {
        average: (performanceScores.reduce((a, b) => a + b) / performanceScores.length).toFixed(2),
        min: Math.min(...performanceScores),
        max: Math.max(...performanceScores),
        dataPoints: performanceScores.length,
      };
    }

    const sslScores = dataPoints.map(p => p.ssl_score).filter(s => s !== null && s !== undefined);
    if (sslScores.length > 0) {
      stats.ssl = {
        average: (sslScores.reduce((a, b) => a + b) / sslScores.length).toFixed(2),
        min: Math.min(...sslScores),
        max: Math.max(...sslScores),
        dataPoints: sslScores.length,
      };
    }

    const brokenLinkCounts = dataPoints
      .map(p => p.broken_link_count)
      .filter(c => c !== null && c !== undefined);
    if (brokenLinkCounts.length > 0) {
      stats.brokenLinks = {
        average: (brokenLinkCounts.reduce((a, b) => a + b) / brokenLinkCounts.length).toFixed(2),
        min: Math.min(...brokenLinkCounts),
        max: Math.max(...brokenLinkCounts),
        dataPoints: brokenLinkCounts.length,
      };
    }

    return stats;
  }

  async getSSLCertificateIssues(publisherId, daysBack = 30) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        const startDateStr = startDate.toISOString().split('T')[0];

        const { data, error } = await supabase
          .from(this.tableName)
          .select('id, ssl_score, components_data, created_at')
          .eq('publisher_id', publisherId)
          .gte('created_at', startDateStr)
          .order('created_at', { ascending: false })
          .limit(100);

        if (error) throw error;

        const sslIssues = data
          ?.filter(record => {
            const sslComponent = record.components_data?.ssl;
            return sslComponent && (!sslComponent.valid || (sslComponent.riskScore && sslComponent.riskScore > 0));
          })
          .map(record => ({
            id: record.id,
            date: record.created_at,
            valid: record.components_data?.ssl?.valid || false,
            error: record.components_data?.ssl?.error || null,
            riskScore: record.components_data?.ssl?.riskScore || 0,
            warnings: record.components_data?.ssl?.warnings || [],
          })) || [];

        return {
          publisherId,
          daysBack,
          issuesFound: sslIssues.length,
          issues: sslIssues,
          analyzedAt: new Date().toISOString(),
        };
      },
      'Get SSL certificate issues',
      { publisherId, daysBack }
    );
  }

  async getPerformanceDegradationTrends(publisherId, daysBack = 30) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        const startDateStr = startDate.toISOString().split('T')[0];

        const { data, error } = await supabase
          .from(this.historyTableName)
          .select('id, current_health_score, previous_health_score, health_score_delta, performance_degradation_detected, created_at')
          .eq('publisher_id', publisherId)
          .gte('created_at', startDateStr)
          .order('created_at', { ascending: false })
          .limit(100);

        if (error) throw error;

        const degradationEvents = data
          ?.filter(record => record.performance_degradation_detected)
          .map(record => ({
            id: record.id,
            date: record.created_at,
            previousScore: record.previous_health_score,
            currentScore: record.current_health_score,
            delta: record.health_score_delta,
          })) || [];

        return {
          publisherId,
          daysBack,
          degradationEventsFound: degradationEvents.length,
          events: degradationEvents,
          analyzedAt: new Date().toISOString(),
        };
      },
      'Get performance degradation trends',
      { publisherId, daysBack }
    );
  }

  async getLatestCheck(publisherId, siteAuditId = null) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        let query = supabase
          .from(this.tableName)
          .select('*')
          .eq('publisher_id', publisherId);

        if (siteAuditId) {
          query = query.eq('site_audit_id', siteAuditId);
        }

        const { data, error } = await query
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        return data;
      },
      'Get latest check',
      { publisherId, siteAuditId }
    );
  }

  async getCheckHistory(publisherId, limit = 20) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        const { data, error } = await supabase
          .from(this.tableName)
          .select('*')
          .eq('publisher_id', publisherId)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;
        return data || [];
      },
      'Get check history',
      { publisherId, limit }
    );
  }
}

module.exports = new TechnicalCheckerDb();
module.exports.TechnicalCheckerDb = TechnicalCheckerDb;
