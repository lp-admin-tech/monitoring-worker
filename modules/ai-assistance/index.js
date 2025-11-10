const logger = require('../logger');
const PromptBuilder = require('./prompt-builder');
const AnalysisInterpreter = require('./analysis');
const ReportFormatter = require('./formatter');

class AIAssistanceModule {
  constructor(envConfig = {}) {
    this.config = envConfig;
    this.promptBuilder = new PromptBuilder();
    this.analysisInterpreter = new AnalysisInterpreter();
    this.reportFormatter = new ReportFormatter();

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

  async generateComprehensiveReport(auditData, scorerOutput, policyViolations = []) {
    try {
      logger.info('Starting comprehensive AI report generation', {
        domain: auditData?.domain,
        auditId: scorerOutput?.auditId
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

      return {
        llmResponse,
        interpretation,
        timestamp: new Date().toISOString(),
        metadata: {
          model: this.model,
          promptVersion: promptData.metadata
        }
      };
    } catch (error) {
      logger.error('Error generating comprehensive report', error);
      throw error;
    }
  }

  async callLLM(systemPrompt, userPrompt) {
    try {
      if (!this.apiKey) {
        logger.warn('No AI API key configured, using fallback analysis');
        return this.generateFallbackAnalysis(userPrompt);
      }

      logger.debug('Calling LLM', {
        model: this.model,
        provider: this.provider,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length
      });

      if (this.provider === 'alibaba') {
        return await this.callAlibabaLLM(systemPrompt, userPrompt);
      } else {
        return await this.callOpenRouterLLM(systemPrompt, userPrompt);
      }
    } catch (error) {
      logger.error('Error calling LLM', error);
      logger.warn('Using fallback analysis due to LLM error');
      return this.generateFallbackAnalysis(userPrompt);
    }
  }

  async callAlibabaLLM(systemPrompt, userPrompt) {
    try {
      logger.debug('Calling Alibaba LLM', { model: this.model });

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
            max_tokens: 2048
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        logger.error('Alibaba LLM API error', {
          status: response.status,
          error: errorData
        });

        if (response.status === 401) {
          logger.error('Invalid Alibaba API key');
          return this.generateFallbackAnalysis(userPrompt);
        }

        throw new Error(`Alibaba LLM API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.code && data.code !== 'Success') {
        logger.error('Alibaba LLM returned error', data.message);
        return this.generateFallbackAnalysis(userPrompt);
      }

      const response_text = data.output?.text || '';

      logger.info('Alibaba LLM response successful', {
        responseLength: response_text.length,
        usage: data.usage
      });

      return response_text;
    } catch (error) {
      logger.error('Error calling Alibaba LLM', error);
      return this.generateFallbackAnalysis(userPrompt);
    }
  }

  async callOpenRouterLLM(systemPrompt, userPrompt) {
    try {
      logger.debug('Calling OpenRouter LLM', {
        model: this.model,
        isDeepResearch: this.model.includes('deepseek')
      });

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://compliance-monitor.local',
          'X-Title': 'Compliance AI Assistant'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          top_p: 0.9,
          max_tokens: 2048
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        logger.error('OpenRouter API error', {
          status: response.status,
          model: this.model,
          error: errorData
        });

        if (response.status === 401) {
          logger.error('Invalid OpenRouter API key - check OPENROUTER_API_KEY');
          return this.generateFallbackAnalysis(userPrompt);
        }

        if (response.status === 429) {
          logger.warn('OpenRouter rate limit exceeded, using fallback');
          return this.generateFallbackAnalysis(userPrompt);
        }

        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.error) {
        logger.error('OpenRouter returned error', {
          error: data.error,
          model: this.model
        });
        return this.generateFallbackAnalysis(userPrompt);
      }

      const response_text = data.choices?.[0]?.message?.content || '';

      logger.info('OpenRouter response successful', {
        responseLength: response_text.length,
        tokensUsed: data.usage?.total_tokens,
        model: this.model
      });

      return response_text;
    } catch (error) {
      logger.error('Error calling OpenRouter LLM', {
        error: error.message,
        model: this.model
      });
      return this.generateFallbackAnalysis(userPrompt);
    }
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

  getConfiguration() {
    return {
      model: this.model,
      hasApiKey: !!this.apiKey,
      promptBuilder: 'active',
      analysisInterpreter: 'active',
      reportFormatter: 'active'
    };
  }
}

module.exports = AIAssistanceModule;
