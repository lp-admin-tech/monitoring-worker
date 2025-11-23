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

  async generateComprehensiveReport(auditData, scorerOutput, policyViolations = [], siteAuditId = null, publisherId = null) {
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

      const llmResponse = await this.callLLM(promptData.systemPrompt, promptData.userPrompt);

      logger.info('LLM response received', {
        responseLength: llmResponse?.length
      });

      const interpretation = this.analysisInterpreter.interpretLLMResponse(
        llmResponse,
        auditData,
        scorerOutput
      );

      logger.info('Response interpreted', {
        category: interpretation.categorization.primaryCategory
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

      await this.persistAIResults(result, siteAuditId, publisherId);

      return result;
    } catch (error) {
      logger.error('Error generating comprehensive report', error);
      throw error;
    }
  }

  async callLLM(systemPrompt, userPrompt) {
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

    // 3. Fallback to Rule-Based Analysis
    logger.warn('All LLM attempts failed, using rule-based fallback');
    return this.generateFallbackAnalysis(userPrompt);
  }

  async callAlibabaLLM(systemPrompt, userPrompt) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
      const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          parameters: {
            temperature: 0.3,
            top_p: 0.9,
            max_tokens: 8192
          }
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);


      if (!response.ok) {
        throw new Error(`Alibaba LLM API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.code && data.code !== 'Success') {
        throw new Error(`Alibaba LLM returned error: ${data.message}`);
      }

      return data.output?.text || '';
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  async callOpenRouterLLM(systemPrompt, userPrompt) {
    return this.performOpenRouterCall(this.model, this.apiKey, systemPrompt, userPrompt);
  }

  async callBackupLLM(systemPrompt, userPrompt, apiKey) {
    const backupModel = 'deepseek/deepseek-r1-distill-llama-70b:free';
    logger.info('Calling Backup LLM (DeepSeek)', { model: backupModel });
    return this.performOpenRouterCall(backupModel, apiKey, systemPrompt, userPrompt);
  }

  async performOpenRouterCall(model, apiKey, systemPrompt, userPrompt) {
    const makeRequest = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://compliance-monitor.local',
            'X-Title': 'Compliance AI Assistant'
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.3,
            top_p: 0.9,
            max_tokens: 8192
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const error = new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
          error.status = response.status;
          error.data = errorData;
          throw error;
        }

        const data = await response.json();

        if (data.error) {
          throw new Error(`OpenRouter returned error: ${JSON.stringify(data.error)}`);
        }

        return data.choices?.[0]?.message?.content || '';
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      }
    };

    const result = await this.rateLimiter.executeWithRetry(makeRequest, 3);

    if (!result.success) {
      throw result.error || new Error('OpenRouter request failed after retries');
    }

    return result.data;
  }

  generateFallbackAnalysis(userPrompt) {
    logger.info('Generating fallback analysis without LLM');

    const analysisHints = this.extractAnalysisHints(userPrompt);

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

  extractAnalysisHints(userPrompt) {
    const mfaProbabilityMatch = userPrompt.match(/Overall MFA Probability[:\s]+([0-9.]+)%/);
    const mfaProbability = mfaProbabilityMatch ? parseFloat(mfaProbabilityMatch[1]) / 100 : 0.5;

    const adDensityMatch = userPrompt.match(/Ad Density[:\s]+([0-9.]+)%/);
    const adDensity = adDensityMatch ? parseFloat(adDensityMatch[1]) : 25;

    const aiLikelihoodMatch = userPrompt.match(/AI-Generated Likelihood[:\s]+([0-9.]+)%/);
    const aiLikelihood = aiLikelihoodMatch ? parseFloat(aiLikelihoodMatch[1]) : 30;

    const scrollJackingMatch = userPrompt.match(/Scroll Jacking Detected[:\s]+(Yes|No)/i);
    const scrollJacking = scrollJackingMatch ? scrollJackingMatch[1].toLowerCase() === 'yes' : false;

    const entropyMatch = userPrompt.match(/Text Entropy Score[:\s]+([0-9.]+)/);
    const entropy = entropyMatch ? parseFloat(entropyMatch[1]) : 50;

    const readabilityMatch = userPrompt.match(/Readability Score[:\s]+([0-9.]+)/);
    const readability = readabilityMatch ? parseFloat(readabilityMatch[1]) : 70;

    let category = 'REVIEW_REQUIRED';
    let riskLevel = 'MEDIUM';
    let confidence = 60;

    if (mfaProbability > 0.75) {
      category = 'SUSPECTED_MFA';
      riskLevel = 'CRITICAL';
      confidence = 85;
    } else if (mfaProbability > 0.55) {
      category = 'POTENTIAL_ISSUES';
      riskLevel = 'HIGH';
      confidence = 75;
    } else if (mfaProbability < 0.25) {
      category = 'COMPLIANT';
      riskLevel = 'LOW';
      confidence = 80;
    }

    const contentQuality = [];
    if (aiLikelihood > 70) {
      contentQuality.push('- Likelihood of AI-generated content is elevated');
    }
    if (entropy < 40) {
      contentQuality.push('- Content shows low variety, suggesting template reuse');
    }
    if (readability < 50) {
      contentQuality.push('- Readability scores indicate comprehension challenges');
    }
    if (contentQuality.length === 0) {
      contentQuality.push('- Content quality metrics are within acceptable ranges');
    }

    const adBehavior = [];
    if (adDensity > 35) {
      adBehavior.push('- Ad density exceeds typical publisher benchmarks');
    }
    if (scrollJacking) {
      adBehavior.push('- Scroll jacking behavior detected - indicates manipulative practices');
    }
    if (adDensity > 30 && entropy < 40) {
      adBehavior.push('- Ad density is inconsistent with content quantity');
    }
    if (adBehavior.length === 0) {
      adBehavior.push('- Ad behavior appears within normal parameters');
    }

    const recommendations = [];
    if (mfaProbability > 0.7) {
      recommendations.push('1. [CRITICAL] Initiate immediate investigation into publisher compliance');
      recommendations.push('2. [CRITICAL] Review account for policy violations');
    } else if (mfaProbability > 0.5) {
      recommendations.push('1. [HIGH] Enhanced monitoring of this property');
      recommendations.push('2. [HIGH] Request additional documentation from publisher');
    } else {
      recommendations.push('1. [MEDIUM] Continue routine monitoring');
      recommendations.push('2. [MEDIUM] Schedule periodic compliance review');
    }

    return {
      mfaProbability,
      adDensity,
      aiLikelihood,
      scrollJacking,
      entropy,
      readability,
      category,
      riskLevel,
      confidence,
      contentQuality,
      adBehavior,
      recommendations
    };
  }

  generateFallbackFindings(hints) {
    const findings = [];

    if (hints.mfaProbability > 0.75) {
      findings.push('- Strong MFA probability detected based on metric analysis');
    } else if (hints.mfaProbability > 0.5) {
      findings.push('- Moderate MFA indicators present requiring investigation');
    }

    if (hints.adDensity > 40) {
      findings.push('- Exceptional ad density far exceeds industry benchmarks');
    } else if (hints.adDensity > 30) {
      findings.push('- Ad density is elevated compared to compliant publishers');
    }

    if (hints.scrollJacking) {
      findings.push('- Scroll jacking behavior indicates intentional user manipulation');
    }

    if (hints.aiLikelihood > 80) {
      findings.push('- Very high likelihood of AI-generated or heavily templated content');
    }

    if (hints.entropy < 35) {
      findings.push('- Extremely low text entropy suggests significant content recycling');
    }

    if (hints.readability < 45) {
      findings.push('- Very poor readability suggests content may be auto-generated');
    }

    if (findings.length === 0) {
      findings.push('- Site appears to meet baseline compliance metrics');
      findings.push('- No critical red flags identified in initial assessment');
    }

    return findings;
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
