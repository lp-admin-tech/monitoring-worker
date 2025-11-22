const logger = require('../logger');
const { supabaseClient: supabase } = require('../supabase-client');

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

class AIAssistanceDb {
  constructor() {
    this.analysisResultsTable = 'ai_analysis_results';
    this.interpretationHistoryTable = 'ai_interpretation_history';
    this.promptTemplatesTable = 'ai_prompt_templates';
    this.qualityMetricsTable = 'ai_response_quality_metrics';
    this.recommendationTrendsTable = 'ai_recommendation_trends';
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
          module: 'ai-assistance-db',
          attempt,
          durationMs: duration,
          ...context,
        });

        return { success: true, data: result, duration };
      } catch (error) {
        lastError = error;

        logger.warn(`${operationName} failed (attempt ${attempt}/${MAX_RETRIES})`, {
          module: 'ai-assistance-db',
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
      module: 'ai-assistance-db',
      retries: MAX_RETRIES,
      ...context,
    });

    throw error;
  }

  async saveLLMResponse(siteAuditId, publisherId, llmResponse, metadata = {}) {
    if (!siteAuditId || !llmResponse) {
      throw new Error('Missing required parameters: siteAuditId, llmResponse');
    }

    return this.retryOperation(
      async () => {
        const responseData = {
          site_audit_id: siteAuditId,
          publisher_id: publisherId || null,
          llm_response: llmResponse,
          timestamp: new Date().toISOString(),
          metadata: metadata,
          created_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.analysisResultsTable)
          .insert(responseData)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save LLM response',
      { siteAuditId, publisherId }
    );
  }

  async saveInterpretation(analysisResultId, interpretation, publisherId) {
    if (!analysisResultId || !interpretation) {
      throw new Error('Missing required parameters: analysisResultId, interpretation');
    }

    return this.retryOperation(
      async () => {
        const updateData = {
          interpretation: interpretation,
          categorization: interpretation.categorization || null,
          updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.analysisResultsTable)
          .update(updateData)
          .eq('id', analysisResultId)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save interpretation',
      { analysisResultId }
    );
  }

  async saveRiskCategorization(analysisResultId, categorization, riskLevel) {
    if (!analysisResultId || !categorization) {
      throw new Error('Missing required parameters: analysisResultId, categorization');
    }

    return this.retryOperation(
      async () => {
        const updateData = {
          risk_categorization: categorization,
          risk_level: riskLevel || null,
          updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.analysisResultsTable)
          .update(updateData)
          .eq('id', analysisResultId)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save risk categorization',
      { analysisResultId, categorization }
    );
  }

  async saveRecommendations(siteAuditId, publisherId, analysisResultId, recommendations) {
    if (!analysisResultId || !recommendations) {
      throw new Error('Missing required parameters: analysisResultId, recommendations');
    }

    return this.retryOperation(
      async () => {
        const recommendationsArray = Array.isArray(recommendations) ? recommendations : [recommendations];

        const updateData = {
          recommendations: recommendationsArray,
          action_items: recommendationsArray,
          updated_at: new Date().toISOString(),
        };

        await supabase
          .from(this.analysisResultsTable)
          .update(updateData)
          .eq('id', analysisResultId);

        const trendEntries = recommendationsArray.map(rec => ({
          publisher_id: publisherId || null,
          ai_analysis_result_id: analysisResultId,
          recommendation_text: typeof rec === 'string' ? rec : rec.text || JSON.stringify(rec),
          recommendation_type: rec.type || 'general',
          severity_level: rec.severity || 'medium',
          action_items: rec.actionItems || null,
          status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));

        const { data, error } = await supabase
          .from(this.recommendationTrendsTable)
          .insert(trendEntries)
          .select();

        if (error) throw error;
        return data;
      },
      'Save recommendations',
      { analysisResultId }
    );
  }

  async saveMetadata(analysisResultId, metadata) {
    if (!analysisResultId || !metadata) {
      throw new Error('Missing required parameters: analysisResultId, metadata');
    }

    return this.retryOperation(
      async () => {
        const updateData = {
          model_used: metadata.model || null,
          token_count: metadata.tokenCount || null,
          processing_time_ms: metadata.processingTimeMs || null,
          metadata: {
            ...(metadata.metadata || {}),
            model: metadata.model,
            tokenCount: metadata.tokenCount,
            processingTimeMs: metadata.processingTimeMs,
            provider: metadata.provider,
            timestamp: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.analysisResultsTable)
          .update(updateData)
          .eq('id', analysisResultId)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save metadata',
      { analysisResultId }
    );
  }

  async trackInterpretationVersion(analysisResultId, publisherId, currentInterpretation, previousInterpretation = null) {
    if (!analysisResultId || !currentInterpretation) {
      throw new Error('Missing required parameters: analysisResultId, currentInterpretation');
    }

    return this.retryOperation(
      async () => {
        const detectedChanges = this.compareInterpretations(currentInterpretation, previousInterpretation);
        let versionNumber = 1;

        if (previousInterpretation) {
          const { data: lastVersion } = await supabase
            .from(this.interpretationHistoryTable)
            .select('version_number')
            .eq('ai_analysis_result_id', analysisResultId)
            .order('version_number', { ascending: false })
            .limit(1)
            .maybeSingle();

          versionNumber = (lastVersion?.version_number || 0) + 1;
        }

        const historyEntry = {
          ai_analysis_result_id: analysisResultId,
          publisher_id: publisherId || null,
          version_number: versionNumber,
          previous_categorization: previousInterpretation?.categorization?.primaryCategory || null,
          current_categorization: currentInterpretation.categorization?.primaryCategory || null,
          previous_risk_level: previousInterpretation?.riskAssessment?.riskLevel || null,
          current_risk_level: currentInterpretation.riskAssessment?.riskLevel || null,
          previous_recommendations: previousInterpretation?.recommendations || null,
          current_recommendations: currentInterpretation.recommendations || null,
          changes_detected: detectedChanges,
          created_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.interpretationHistoryTable)
          .insert(historyEntry)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Track interpretation version',
      { analysisResultId }
    );
  }

  compareInterpretations(current, previous) {
    const changes = [];

    if (!previous) {
      return ['initial_interpretation_created'];
    }

    if ((current.categorization?.primaryCategory || '') !== (previous.categorization?.primaryCategory || '')) {
      changes.push('primary_category_changed');
    }

    if ((current.riskAssessment?.riskLevel || '') !== (previous.riskAssessment?.riskLevel || '')) {
      changes.push('risk_level_changed');
    }

    if ((current.riskAssessment?.totalRiskScore || 0) !== (previous.riskAssessment?.totalRiskScore || 0)) {
      changes.push('risk_score_changed');
    }

    if (JSON.stringify(current.recommendations || []) !== JSON.stringify(previous.recommendations || [])) {
      changes.push('recommendations_changed');
    }

    if (JSON.stringify(current.findings || []) !== JSON.stringify(previous.findings || [])) {
      changes.push('findings_changed');
    }

    if ((current.confidence || 0) !== (previous.confidence || 0)) {
      changes.push('confidence_level_changed');
    }

    return changes.length > 0 ? changes : ['no_changes_detected'];
  }

  async queryHistoricalPatterns(publisherId, daysBack = 30, limit = 100) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        const startDateStr = startDate.toISOString();

        const { data, error } = await supabase
          .from(this.analysisResultsTable)
          .select('id, risk_categorization, risk_level, interpretation, metadata, created_at')
          .eq('publisher_id', publisherId)
          .gte('created_at', startDateStr)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;

        const patterns = this.aggregatePatterns(data || []);
        return {
          publisherId,
          daysBack,
          dataPoints: data?.length || 0,
          patterns,
          aggregatedAt: new Date().toISOString(),
        };
      },
      'Query historical patterns',
      { publisherId, daysBack }
    );
  }

  aggregatePatterns(dataPoints) {
    if (!dataPoints || dataPoints.length === 0) {
      return {
        categorization: {},
        riskLevelDistribution: {},
        timeline: [],
      };
    }

    const categorization = {};
    const riskLevelDistribution = {};
    const timeline = [];

    dataPoints.forEach(point => {
      const category = point.risk_categorization || 'unknown';
      const riskLevel = point.risk_level || 'unknown';

      categorization[category] = (categorization[category] || 0) + 1;
      riskLevelDistribution[riskLevel] = (riskLevelDistribution[riskLevel] || 0) + 1;

      timeline.push({
        date: point.created_at,
        category,
        riskLevel,
        confidence: point.interpretation?.confidence || 0,
      });
    });

    return {
      categorization,
      riskLevelDistribution,
      timeline,
      statistics: {
        totalAnalyses: dataPoints.length,
        mostCommonCategory: Object.entries(categorization).reduce((a, b) => a[1] > b[1] ? a : b)[0],
        highestRiskLevel: Object.entries(riskLevelDistribution).sort((a, b) => b[1] - a[1])[0]?.[0],
      },
    };
  }

  async queryRecommendationTrends(publisherId, daysBack = 30, limit = 100) {
    if (!publisherId) {
      throw new Error('Missing required parameter: publisherId');
    }

    return this.retryOperation(
      async () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        const startDateStr = startDate.toISOString();

        const { data, error } = await supabase
          .from(this.recommendationTrendsTable)
          .select('recommendation_text, recommendation_type, severity_level, status, effectiveness_score, created_at')
          .eq('publisher_id', publisherId)
          .gte('created_at', startDateStr)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;

        const trends = this.aggregateRecommendationTrends(data || []);
        return {
          publisherId,
          daysBack,
          dataPoints: data?.length || 0,
          trends,
          aggregatedAt: new Date().toISOString(),
        };
      },
      'Query recommendation trends',
      { publisherId, daysBack }
    );
  }

  aggregateRecommendationTrends(dataPoints) {
    if (!dataPoints || dataPoints.length === 0) {
      return {
        byType: {},
        bySeverity: {},
        byStatus: {},
        effectiveness: {},
      };
    }

    const byType = {};
    const bySeverity = {};
    const byStatus = {};
    const effectiveness = {};

    dataPoints.forEach(point => {
      const type = point.recommendation_type || 'general';
      const severity = point.severity_level || 'medium';
      const status = point.status || 'pending';

      byType[type] = (byType[type] || 0) + 1;
      bySeverity[severity] = (bySeverity[severity] || 0) + 1;
      byStatus[status] = (byStatus[status] || 0) + 1;

      if (point.effectiveness_score !== null && point.effectiveness_score !== undefined) {
        if (!effectiveness[type]) {
          effectiveness[type] = { total: 0, count: 0 };
        }
        effectiveness[type].total += point.effectiveness_score;
        effectiveness[type].count += 1;
      }
    });

    const effectivenessAverages = {};
    Object.entries(effectiveness).forEach(([type, data]) => {
      effectivenessAverages[type] = (data.total / data.count).toFixed(2);
    });

    return {
      byType,
      bySeverity,
      byStatus,
      effectivenessAverages,
      statistics: {
        totalRecommendations: dataPoints.length,
        mostCommonType: Object.entries(byType).reduce((a, b) => a[1] > b[1] ? a : b)?.[0],
        highestSeverity: Object.entries(bySeverity).sort((a, b) => {
          const severityMap = { critical: 4, high: 3, medium: 2, low: 1 };
          return (severityMap[b[0]] || 0) - (severityMap[a[0]] || 0);
        })[0]?.[0],
      },
    };
  }

  async savePromptTemplate(templateName, systemPrompt, userPromptTemplate, metadata = {}) {
    if (!templateName || !systemPrompt || !userPromptTemplate) {
      throw new Error('Missing required parameters: templateName, systemPrompt, userPromptTemplate');
    }

    return this.retryOperation(
      async () => {
        const templateData = {
          template_name: templateName,
          system_prompt: systemPrompt,
          user_prompt_template: userPromptTemplate,
          template_version: 1,
          description: metadata.description || null,
          tags: metadata.tags || null,
          model_optimized_for: metadata.modelOptimizedFor || null,
          created_by: metadata.createdBy || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.promptTemplatesTable)
          .insert(templateData)
          .select();

        if (error) {
          if (error.message.includes('duplicate')) {
            logger.warn('Prompt template already exists', { templateName });
            const { data: existing } = await supabase
              .from(this.promptTemplatesTable)
              .select('*')
              .eq('template_name', templateName)
              .maybeSingle();
            return existing;
          }
          throw error;
        }
        return data?.[0];
      },
      'Save prompt template',
      { templateName }
    );
  }

  async saveQualityMetrics(analysisResultId, qualityMetrics) {
    if (!analysisResultId || !qualityMetrics) {
      throw new Error('Missing required parameters: analysisResultId, qualityMetrics');
    }

    return this.retryOperation(
      async () => {
        const metricsData = {
          ai_analysis_result_id: analysisResultId,
          publisher_id: qualityMetrics.publisherId || null,
          quality_score: qualityMetrics.qualityScore || 0,
          confidence_score: qualityMetrics.confidenceScore || 0,
          accuracy_estimate: qualityMetrics.accuracyEstimate || null,
          relevance_score: qualityMetrics.relevanceScore || null,
          completeness_score: qualityMetrics.completenessScore || null,
          coherence_score: qualityMetrics.coherenceScore || null,
          model_used: qualityMetrics.modelUsed || 'unknown',
          llm_provider: qualityMetrics.llmProvider || null,
          response_tokens: qualityMetrics.responseTokens || null,
          prompt_tokens: qualityMetrics.promptTokens || null,
          total_tokens: qualityMetrics.totalTokens || null,
          processing_time_ms: qualityMetrics.processingTimeMs || null,
          error_detected: qualityMetrics.errorDetected || false,
          error_message: qualityMetrics.errorMessage || null,
          quality_flags: qualityMetrics.qualityFlags || null,
          created_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from(this.qualityMetricsTable)
          .insert(metricsData)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Save quality metrics',
      { analysisResultId }
    );
  }

  async getQualityMetrics(analysisResultId) {
    if (!analysisResultId) {
      throw new Error('Missing required parameter: analysisResultId');
    }

    return this.retryOperation(
      async () => {
        const { data, error } = await supabase
          .from(this.qualityMetricsTable)
          .select('*')
          .eq('ai_analysis_result_id', analysisResultId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        return data;
      },
      'Get quality metrics',
      { analysisResultId }
    );
  }

  async getAnalysisHistory(analysisResultId, limit = 20) {
    if (!analysisResultId) {
      throw new Error('Missing required parameter: analysisResultId');
    }

    return this.retryOperation(
      async () => {
        const { data, error } = await supabase
          .from(this.interpretationHistoryTable)
          .select('*')
          .eq('ai_analysis_result_id', analysisResultId)
          .order('version_number', { ascending: false })
          .limit(limit);

        if (error) throw error;
        return data || [];
      },
      'Get analysis history',
      { analysisResultId, limit }
    );
  }

  async getPromptTemplates(filters = {}) {
    return this.retryOperation(
      async () => {
        let query = supabase
          .from(this.promptTemplatesTable)
          .select('*');

        if (filters.templateName) {
          query = query.eq('template_name', filters.templateName);
        }

        if (filters.modelOptimizedFor) {
          query = query.eq('model_optimized_for', filters.modelOptimizedFor);
        }

        if (filters.tags && filters.tags.length > 0) {
          query = query.contains('tags', filters.tags);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
      },
      'Get prompt templates',
      { filters }
    );
  }

  async updatePromptTemplateUsage(templateId) {
    if (!templateId) {
      throw new Error('Missing required parameter: templateId');
    }

    return this.retryOperation(
      async () => {
        const { data: current } = await supabase
          .from(this.promptTemplatesTable)
          .select('usage_count')
          .eq('id', templateId)
          .maybeSingle();

        const { data, error } = await supabase
          .from(this.promptTemplatesTable)
          .update({
            usage_count: (current?.usage_count || 0) + 1,
            last_used_at: new Date().toISOString(),
          })
          .eq('id', templateId)
          .select();

        if (error) throw error;
        return data?.[0];
      },
      'Update prompt template usage',
      { templateId }
    );
  }
}

module.exports = new AIAssistanceDb();
module.exports.AIAssistanceDb = AIAssistanceDb;
