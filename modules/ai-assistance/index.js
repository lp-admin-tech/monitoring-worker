const logger = require('../logger');
const PromptBuilder = require('./prompt-builder');
const AnalysisInterpreter = require('./analysis');
const ReportFormatter = require('./formatter');
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

    // Groq - Primary LLM provider (fast inference)
    this.groq = {
      apiKey: envConfig?.groq?.apiKey || process.env.GROQ_API_KEY || '',
      model: envConfig?.groq?.model || process.env.GROQ_MODEL || 'llama-3.1-70b-versatile',
      baseUrl: 'https://api.groq.com/openai/v1'
    };

    // Provider selection
    if (this.groq.apiKey) {
      this.apiKey = this.groq.apiKey;
      this.model = this.groq.model;
      this.provider = 'groq';
      logger.info('[AIAssistance] Using Groq as LLM provider');
    } else {
      this.apiKey = null;
      this.model = null;
      this.provider = 'fallback';
      logger.warn('[AIAssistance] No GROQ_API_KEY configured - using rule-based fallback only');
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
        policyViolations,
        contextData
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
    let lastError = null;

    // 1. Try Groq
    if (this.groq.apiKey) {
      try {
        logger.info('Calling Groq LLM', { model: this.groq.model });
        const response = await this.callGroqLLM(systemPrompt, userPrompt);

        if (response && response.trim().length > 0) {
          return response;
        }
        logger.warn('Groq LLM returned empty response');
      } catch (error) {
        lastError = error;
        logger.warn('Groq LLM failed', { error: error.message });
      }
    }

    // 2. Fallback to Rule-Based Analysis
    logger.warn('Groq LLM failed or not configured, using rule-based fallback', { lastError: lastError?.message });
    return this.generateFallbackAnalysis(userPrompt, contextData);
  }


  /**
   * Call Groq LLM using OpenAI-compatible API
   */
  async callGroqLLM(systemPrompt, userPrompt) {
    try {
      const fetch = require('node-fetch');

      const response = await fetch(`${this.groq.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.groq.apiKey}`
        },
        body: JSON.stringify({
          model: this.groq.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 4096,
          temperature: 0.3
        }),
        timeout: 60000
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content || content.trim().length === 0) {
        throw new Error('Groq returned empty response');
      }

      logger.info('Groq LLM response received', {
        model: this.groq.model,
        responseLength: content.length
      });

      return content;
    } catch (error) {
      logger.error('Groq API error:', error.message);
      throw error;

    }
  }


  async callHuggingFaceLLM(systemPrompt, userPrompt) {
    try {
      // Check if HuggingFace package is available
      if (!InferenceClient) {
        throw new Error('@huggingface/inference package not installed - run npm install');
      }

      const client = new InferenceClient(this.huggingFace.apiKey);
      let out = '';

      logger.info('Calling HuggingFace Inference API', { model: this.huggingFace.model });


      const stream = client.chatCompletionStream({
        model: this.huggingFace.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 8192,
        temperature: 0.3,
      });

      for await (const chunk of stream) {
        if (chunk.choices && chunk.choices.length > 0) {
          const newContent = chunk.choices[0].delta.content;
          if (newContent) {
            out += newContent;
          }
        }
      }

      if (!out || out.trim().length === 0) {
        throw new Error('HuggingFace returned empty response');
      }

      return out;
    } catch (error) {
      logger.error('HuggingFace API error:', error);
      throw error;
    }
  }

  // OpenRouter and Alibaba functions removed - using HuggingFace only

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
