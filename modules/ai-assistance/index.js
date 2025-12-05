const logger = require('../logger');
const PromptBuilder = require('./prompt-builder');
const AnalysisInterpreter = require('./analysis');
const ReportFormatter = require('./formatter');
const { OpenRouterRateLimiter } = require('./rate-limiter');
const aiDb = require('./db');

let supabaseClient = null;

function getSupabaseClient() {
  if (supabaseClient === null && supabaseClient !== false) {
    try {
      const supabaseModule = require('../supabase-client');
      supabaseClient = supabaseModule.supabaseClient || supabaseModule;
    } catch (err) {
      supabaseClient = false;
      logger.warn('Supabase client not available for AI results persistence');
    }
  }
  return supabaseClient || null;
}

class AIAssistanceModule {
  constructor(envConfig = {}) {
    this.config = envConfig;
    this.promptBuilder = new PromptBuilder();
    this.analysisInterpreter = new AnalysisInterpreter();
    this.reportFormatter = new ReportFormatter();
    this.rateLimiter = new OpenRouterRateLimiter();

    this.aiModel = {
      apiKey: envConfig?.aiModel?.apiKey || process.env.AI_MODEL_API_KEY || '',
      model: envConfig?.aiModel?.model || process.env.AI_MODEL_NAME || 'alibaba/tongyi-qwen-plus',
      provider: envConfig?.aiModel?.provider || process.env.AI_MODEL_PROVIDER || 'alibaba',
    };

    this.openRouter = {
      apiKey: envConfig?.openRouter?.apiKey || process.env.OPENROUTER_API_KEY || '',
      model: envConfig?.openRouter?.model || process.env.OPENROUTER_MODEL || 'alibaba/tongyi-deepresearch-30b-a3b:free',
    };

    const hasAlibabaKey = !!this.aiModel.apiKey;
    const hasOpenRouterKey = !!this.openRouter.apiKey;

    if (hasOpenRouterKey && !hasAlibabaKey) {
      this.apiKey = this.openRouter.apiKey;
      this.model = this.openRouter.model;
      this.provider = 'openrouter';
    } else if (hasOpenRouterKey && hasAlibabaKey) {
      this.apiKey = this.openRouter.apiKey;
      this.model = this.openRouter.model;
      this.provider = 'openrouter';
    } else {
      this.apiKey = this.aiModel.apiKey;
      this.model = this.aiModel.model;
      this.provider = this.aiModel.provider;
    }
  }

  async persistAIResults(result, siteAuditId, publisherId, previousResult = null) {
    if (!siteAuditId) {
      logger.warn('Cannot persist AI results - missing siteAuditId', { siteAuditId });
      return;
    }

    try {
      const startTime = Date.now();

      logger.info('Starting AI results persistence', {
        siteAuditId,
        publisherId
      });

      const saveLLMResponse = await aiDb.saveLLMResponse(
        siteAuditId,
        publisherId,
        result.llmResponse || '',
        result.metadata || {}
      );

      const analysisResultId = saveLLMResponse.data?.id;
      if (!analysisResultId) {
        throw new Error('Failed to create analysis result record');
      }

      await aiDb.saveInterpretation(
        analysisResultId,
        result.interpretation || {},
        publisherId
      );

      await aiDb.saveRiskCategorization(
        analysisResultId,
        result.interpretation?.categorization?.primaryCategory || null,
        result.interpretation?.riskAssessment?.riskLevel || null
      );

      if (result.interpretation?.recommendations) {
        await aiDb.saveRecommendations(
          siteAuditId,
          publisherId,
          analysisResultId,
          result.interpretation.recommendations
        );
      }

      const metadataPayload = {
        model: result.metadata?.model || this.model,
        tokenCount: result.metadata?.tokenCount || 0,
        processingTimeMs: Date.now() - startTime,
        provider: result.metadata?.provider || this.provider,
        metadata: result.metadata || {}
      };

      await aiDb.saveMetadata(analysisResultId, metadataPayload);

      if (result.interpretation) {
        await aiDb.trackInterpretationVersion(
          analysisResultId,
          publisherId,
          result.interpretation,
          previousResult?.interpretation || null
        );
      }

      if (result.qualityMetrics) {
        await aiDb.saveQualityMetrics(analysisResultId, {
          publisherId,
          ...result.qualityMetrics
        });
      }

      logger.info('AI analysis results persisted to database successfully', {
        siteAuditId,
        publisherId,
        analysisResultId,
        category: result.interpretation?.categorization?.primaryCategory,
        processingTimeMs: Date.now() - startTime
      });

      return { success: true, analysisResultId, data: saveLLMResponse.data };
    } catch (err) {
      logger.error('Error persisting AI results', err, {
        siteAuditId,
        publisherId
      });
      return { success: false, error: err.message };
    }
  }

  async generateComprehensiveReport(auditData, scorerOutput, policyViolations = [], siteAuditId = null, publisherId = null, contextData = {}) {
    try {
      logger.info('Starting comprehensive AI report generation', {
        domain: auditData?.domain,
        auditId: scorerOutput?.auditId,
        siteAuditId
      });

      const promptData = this.promptBuilder.buildComprehensivePrompt(
        auditData,
        scorerOutput,
        policyViolations
      );

      logger.debug('Prompt prepared', {
        systemPrompt: promptData.systemPrompt.substring(0, 100),
        userPromptLength: promptData.userPrompt.length
      });

      const llmResponse = await this.callLLM(promptData.systemPrompt, promptData.userPrompt, contextData);

      logger.info('LLM response received', {
        responseLength: llmResponse?.length,
        preview: llmResponse ? llmResponse.substring(0, 100) : 'EMPTY'
      });

      const interpretation = this.analysisInterpreter.interpretLLMResponse(
        llmResponse,
        auditData,
        scorerOutput
      );

      logger.info('Response interpreted', {
        category: interpretation.categorization.primaryCategory,
        hasParsedFindings: !!interpretation.parsedFindings,
        hasMfaScoreReasoning: !!interpretation.parsedFindings?.mfaScoreReasoning
      });

      const result = {
        llmResponse,
        interpretation,
        timestamp: new Date().toISOString(),
        metadata: {
          model: this.model,
          promptVersion: promptData.metadata
        }
      };

      // DEBUG: Log the final result object before returning
      logger.info('[DEBUG] AI Module Result:', {
        hasLlmResponse: !!result.llmResponse,
        llmResponseLength: result.llmResponse?.length,
        hasInterpretation: !!result.interpretation,
        interpretationKeys: result.interpretation ? Object.keys(result.interpretation) : []
      });

      await this.persistAIResults(result, siteAuditId, publisherId);

      return result;
    } catch (error) {
      logger.error('Error generating comprehensive report', error);
      throw error;
    }
  }

  async callLLM(systemPrompt, userPrompt, contextData = {}) {
    let primaryError = null;

    // 1. Try Primary Model (if configured)
    if (this.apiKey) {
      try {
        // Add delay to avoid rate limits on free tier
        const delayMs = parseInt(process.env.AI_REQUEST_DELAY_MS || '5000', 10);
        logger.debug('Waiting before LLM call to avoid rate limits', { delayMs });
        await new Promise(resolve => setTimeout(resolve, delayMs));

        logger.debug('Calling Primary LLM', {
          model: this.model,
          provider: this.provider
        });

        let response = '';
        if (this.provider === 'alibaba') {
          response = await this.callAlibabaLLM(systemPrompt, userPrompt);
        } else {
          response = await this.callOpenRouterLLM(systemPrompt, userPrompt);
        }

        if (response && response.trim().length > 0) {
          return response;
        }
        logger.warn('Primary LLM returned empty response, attempting backup');
      } catch (error) {
        primaryError = error;
        logger.warn('Primary LLM failed, attempting backup', { error: error.message });
      }
    } else {
      logger.info('No primary API key configured, skipping to backup');
    }

    // 2. Try Backup Model (DeepSeek via OpenRouter)
    // Check if we have an OpenRouter key (either as primary or specifically for backup)
    const openRouterKey = this.openRouter.apiKey || (this.provider === 'openrouter' ? this.apiKey : null);

    if (openRouterKey) {
      try {
        const response = await this.callBackupLLM(systemPrompt, userPrompt, openRouterKey);
        if (response && response.trim().length > 0) {
          return response;
        }
        logger.warn('Backup LLM returned empty response');
      } catch (error) {
        logger.warn('Backup LLM failed', { error: error.message });
      }
    } else {
      logger.warn('No OpenRouter key available for backup LLM');
    }

    // 3. Fallback to Rule-Based Analysis (Reviewer Summary)
    logger.warn('All LLM attempts failed, using robust reviewer summary fallback');
    return this.generateFallbackAnalysis(userPrompt, contextData);
  }

  // ... (callAlibabaLLM, callOpenRouterLLM, callBackupLLM, performOpenRouterCall remain unchanged)

  generateFallbackAnalysis(userPrompt, contextData = {}) {
    logger.info('Generating fallback analysis using Reviewer Summary logic');

    // If we have context data, use the robust summary generator
    if (contextData && contextData.url) {
      return this.generateReviewerSummary(contextData);
    }

    // Legacy fallback if no context data provided (should not happen with new call)
    logger.warn('No context data provided for fallback, using legacy regex extraction');
    const analysisHints = this.extractAnalysisHints(userPrompt);
    return this.generateLegacyFallbackReport(analysisHints);
  }

  generateReviewerSummary(results) {
    const {
      url,
      networkFindings = [],
      adBehavior = {},
      contentIndicators = {},
      performance = {},
      seo = {},
    } = results;

    const issues = [];
    const positives = [];

    if (networkFindings.length === 0) {
      positives.push("No third-party ad networks detected — clean setup.");
    } else {
      issues.push(
        `Detected ${networkFindings.length} external advertising/auction sources: ` +
        networkFindings.map(n => n.domain).join(", ")
      );
    }

    if (!adBehavior.popups && !adBehavior.redirects) {
      positives.push("No intrusive ads (popups/redirects) detected.");
    } else {
      if (adBehavior.popups) issues.push("Popup behavior triggered during scan.");
      if (adBehavior.redirects) issues.push("Unexpected redirect behavior observed.");
    }

    if (contentIndicators.textEntropy === 0) {
      issues.push("Content entropy is 0 — page likely inaccessible or empty.");
    }

    if (contentIndicators.aiLikelihood && contentIndicators.aiLikelihood > 60) {
      issues.push("High chance of AI-generated content.");
    }

    if (performance.lcp && performance.lcp > 3500) {
      issues.push("Slow page load detected (high LCP).");
    } else if (performance.lcp) {
      positives.push("Page loads within acceptable LCP timing.");
    }

    if (!seo.title || seo.title.length < 10) {
      issues.push("SEO title missing or too short.");
    }

    if (issues.length === 0 && positives.length === 0) {
      positives.push("No major warnings triggered — site looks stable.");
    }

    return `
  🔎 Human Reviewer Summary — ${url}
  
  ${positives.length ? "✅ Positive:\n- " + positives.join("\n- ") : ""}
  
  ${issues.length ? "\n\n⚠ Issues:\n- " + issues.join("\n- ") : ""}
  
  ${issues.length === 0
        ? "\n\n🟢 Overall: Site looks stable."
        : "\n\n🟠 Overall: Some issues detected."
      }
  `;
  }

  generateLegacyFallbackReport(analysisHints) {
    return `# Compliance Assessment Report (Rule-Based Analysis)

## Executive Summary

${analysisHints.mfaProbability > 0.7 ?
        'This site shows multiple indicators consistent with Made-For-Advertising patterns. Investigation is recommended.' :
        analysisHints.mfaProbability > 0.5 ?
          'This site has several concerning patterns that warrant further investigation.' :
          'This site appears to meet baseline compliance standards based on available metrics.'}

## Primary Findings

${this.generateFallbackFindings(analysisHints).join('\n')}

## Content Quality Assessment

${analysisHints.contentQuality.join('\n')}

## Ad Behavior Analysis

${analysisHints.adBehavior.join('\n')}

## Risk Categorization

**Primary Category:** ${analysisHints.category}
**Risk Level:** ${analysisHints.riskLevel}
**Confidence:** ${analysisHints.confidence}%

## Recommended Actions

${analysisHints.recommendations.join('\n')}`;
  }

  async generateDashboardReport(auditData, scorerOutput, policyViolations = []) {
    try {
      logger.info('Generating dashboard report', {
        domain: auditData?.domain
      });

      const comprehensiveReport = await this.generateComprehensiveReport(
        auditData,
        scorerOutput,
        policyViolations
      );

      const dashboardReport = this.reportFormatter.formatForDashboard(
        comprehensiveReport.interpretation,
        auditData,
        scorerOutput
      );

      logger.info('Dashboard report generated', {
        domain: auditData?.domain
      });

      return dashboardReport;
    } catch (error) {
      logger.error('Error generating dashboard report', error);
      throw error;
    }
  }

  async generateEmailReport(auditData, scorerOutput, policyViolations = [], recipientType = 'team') {
    try {
      logger.info('Generating email report', {
        domain: auditData?.domain,
        recipient: recipientType
      });

      const comprehensiveReport = await this.generateComprehensiveReport(
        auditData,
        scorerOutput,
        policyViolations
      );

      const emailReport = this.reportFormatter.formatForEmail(
        comprehensiveReport.interpretation,
        auditData,
        scorerOutput,
        recipientType
      );

      logger.info('Email report generated', {
        domain: auditData?.domain
      });

      return emailReport;
    } catch (error) {
      logger.error('Error generating email report', error);
      throw error;
    }
  }

  setLLMModel(modelName) {
    this.model = modelName;
    logger.info('LLM model changed', { model: modelName });
  }

  setLLMApiKey(apiKey) {
    this.apiKey = apiKey;
    logger.info('LLM API key updated');
  }

  extractCausesAndFixes(llmResponse) {
    const causes = [];
    const fixes = [];

    const causePatterns = [
      /Cause[s]?:\s*\n([\s\S]*?)(?=\n(?:Fix|Recommendation|Solution)|$)/gi,
      /Root Cause[s]?:\s*\n([\s\S]*?)(?=\n(?:Fix|Recommendation|Solution)|$)/gi,
      /Why:\s*\n([\s\S]*?)(?=\n(?:Fix|Recommendation|Solution|How to|What to)|$)/gi,
      /Issue[s]?:\s*\n([\s\S]*?)(?=\n(?:Fix|Recommendation|Solution)|$)/gi,
    ];

    const fixPatterns = [
      /Fix[es]?:\s*\n([\s\S]*?)(?=\n(?:Cause|Recommendation|Alternative)|$)/gi,
      /Solution[s]?:\s*\n([\s\S]*?)(?=\n(?:Cause|Recommendation|Alternative)|$)/gi,
      /Recommendation[s]?:\s*\n([\s\S]*?)(?=\n(?:Cause|Fix|Alternative)|$)/gi,
      /How to [^:]*:\s*\n([\s\S]*?)(?=\n(?:Cause|Fix|Why|Alternative)|$)/gi,
    ];

    causePatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(llmResponse)) !== null) {
        const items = match[1]
          .split(/\n-\s*|\n\d+\.\s*/)
          .filter((item) => item.trim().length > 0);
        causes.push(...items.map((item) => item.trim()));
      }
    });

    fixPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(llmResponse)) !== null) {
        const items = match[1]
          .split(/\n-\s*|\n\d+\.\s*/)
          .filter((item) => item.trim().length > 0);
        fixes.push(...items.map((item) => item.trim()));
      }
    });

    return {
      causes: causes.slice(0, 10),
      fixes: fixes.slice(0, 10),
    };
  }

  getConfiguration() {
    return {
      model: this.model,
      hasApiKey: !!this.apiKey,
      promptBuilder: 'active',
      analysisInterpreter: 'active',
      reportFormatter: 'active',
      persistenceDb: 'active'
    };
  }

  async getHistoricalPatterns(publisherId, daysBack = 30) {
    try {
      logger.info('Fetching historical AI patterns', { publisherId, daysBack });
      return await aiDb.queryHistoricalPatterns(publisherId, daysBack);
    } catch (err) {
      logger.error('Error fetching historical patterns', err, { publisherId });
      throw err;
    }
  }

  async getRecommendationTrends(publisherId, daysBack = 30) {
    try {
      logger.info('Fetching recommendation trends', { publisherId, daysBack });
      return await aiDb.queryRecommendationTrends(publisherId, daysBack);
    } catch (err) {
      logger.error('Error fetching recommendation trends', err, { publisherId });
      throw err;
    }
  }

  async getAnalysisHistory(analysisResultId, limit = 20) {
    try {
      logger.info('Fetching analysis history', { analysisResultId, limit });
      return await aiDb.getAnalysisHistory(analysisResultId, limit);
    } catch (err) {
      logger.error('Error fetching analysis history', err, { analysisResultId });
      throw err;
    }
  }

  async savePromptTemplate(templateName, systemPrompt, userPromptTemplate, metadata = {}) {
    try {
      logger.info('Saving prompt template', { templateName });
      return await aiDb.savePromptTemplate(templateName, systemPrompt, userPromptTemplate, metadata);
    } catch (err) {
      logger.error('Error saving prompt template', err, { templateName });
      throw err;
    }
  }

  async getPromptTemplates(filters = {}) {
    try {
      logger.info('Fetching prompt templates', { filters });
      return await aiDb.getPromptTemplates(filters);
    } catch (err) {
      logger.error('Error fetching prompt templates', err, { filters });
      throw err;
    }
  }

  async getQualityMetrics(analysisResultId) {
    try {
      logger.info('Fetching quality metrics', { analysisResultId });
      return await aiDb.getQualityMetrics(analysisResultId);
    } catch (err) {
      logger.error('Error fetching quality metrics', err, { analysisResultId });
      throw err;
    }
  }
}

module.exports = AIAssistanceModule;
