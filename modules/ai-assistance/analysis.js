const logger = require('../logger');
const trainingData = require('./training-data.json');

class AnalysisInterpreter {
  constructor() {
    this.trainingData = trainingData;
    this.interpretationGuidance = trainingData.interpretationGuides;
  }

  interpretLLMResponse(llmResponse, auditData, scorerOutput) {
    try {
      logger.info('Interpreting LLM response', {
        domain: auditData?.domain,
        hasResponse: !!llmResponse
      });

      const interpretation = {
        rawResponse: llmResponse,
        parsedFindings: this.parseFindings(llmResponse),
        categorization: this.categorizeFinding(llmResponse, auditData, scorerOutput),
        confidence: this.assessConfidence(llmResponse, scorerOutput),
        actionItems: this.extractActionItems(llmResponse),
        metadata: {
          domain: auditData?.domain,
          timestamp: new Date().toISOString(),
          scoreId: scorerOutput?.auditId
        }
      };

      logger.info('LLM response interpreted', {
        category: interpretation.categorization.primaryCategory,
        confidence: interpretation.confidence.overall
      });

      return interpretation;
    } catch (error) {
      logger.error('Error interpreting LLM response', error);
      throw error;
    }
  }

  parseFindings(llmResponse) {
    const findings = {
      modules: this.parseTOONModules(llmResponse),
      summary: this.extractSectionOrNull(llmResponse, 'Executive Summary', 'Summary'),
      primaryFindings: this.extractBulletPoints(llmResponse, 'Primary Findings'),
      contentQuality: this.extractSectionOrNull(llmResponse, 'Content Quality'),
      adBehavior: this.extractSectionOrNull(llmResponse, 'Ad Behavior'),
      recommendations: this.extractBulletPoints(llmResponse, 'Recommended Actions')
    };

    return findings;
  }

  parseTOONModules(text) {
    const modules = {};
    const modulePattern = /module\(([^)]+)\)\s*\n([\s\S]*?)(?=module\(|$)/g;
    let match;

    while ((match = modulePattern.exec(text)) !== null) {
      const moduleName = match[1].trim();
      const moduleContent = match[2];

      modules[moduleName] = {
        name: moduleName,
        found: this.extractTOONArray(moduleContent, 'found'),
        cause: this.extractTOONArray(moduleContent, 'cause'),
        fix: this.extractTOONArray(moduleContent, 'fix'),
        good: this.extractTOONArray(moduleContent, 'good'),
        impact: this.extractTOONValue(moduleContent, 'impact'),
        review_summary: this.extractTOONValue(moduleContent, 'review_summary')
      };
    }

    return modules;
  }

  extractTOONArray(text, fieldName) {
    const regex = new RegExp(`${fieldName}\\s*:\\s*\\[([^\\]]+)\\]`, 'i');
    const match = text.match(regex);
    if (!match) return [];

    return match[1]
      .split(',')
      .map(item => item.trim().replace(/^["']|["']$/g, ''))
      .filter(item => item);
  }

  extractTOONValue(text, fieldName) {
    const regex = new RegExp(`${fieldName}\\s*\\(\\s*([^)]*)\\s*\\)`, 'i');
    const match = text.match(regex);
    if (!match) return null;

    const content = match[1].trim();
    if (content.startsWith('"') || content.startsWith("'")) {
      return content.replace(/^["']|["']$/g, '');
    }

    const keyValueMatch = content.match(/([^=]+)=(.+)/);
    if (keyValueMatch) {
      return {
        [keyValueMatch[1].trim()]: keyValueMatch[2].trim()
      };
    }

    return content;
  }

  extractSectionOrNull(text, ...sectionNames) {
    const section = this.extractSection(text, ...sectionNames);
    return section || null;
  }

  categorizeFinding(llmResponse, auditData, scorerOutput) {
    const responseText = llmResponse.toLowerCase();
    const mfaProbability = scorerOutput?.scores?.mfaProbability || 0;

    const mfaKeywords = [
      'mfa', 'made-for-advertising', 'ad farm', 'manipulation',
      'fraudulent', 'suspicious', 'deceptive', 'aggressive'
    ];
    const complianceKeywords = [
      'compliant', 'appropriate', 'acceptable', 'normal', 'healthy'
    ];

    const mfaMatches = mfaKeywords.filter(kw => responseText.includes(kw)).length;
    const complianceMatches = complianceKeywords.filter(kw => responseText.includes(kw)).length;

    let primaryCategory = 'REVIEW_REQUIRED';
    let riskLevel = 'MEDIUM';
    let confidence = 0.5;

    if (mfaProbability > 0.75 || mfaMatches > 3) {
      primaryCategory = 'SUSPECTED_MFA';
      riskLevel = 'CRITICAL';
      confidence = Math.min(0.95, mfaProbability);
    } else if (mfaProbability > 0.55 || mfaMatches > 1) {
      primaryCategory = 'POTENTIAL_ISSUES';
      riskLevel = 'HIGH';
      confidence = Math.min(0.85, mfaProbability);
    } else if (mfaProbability < 0.25 && complianceMatches > 2) {
      primaryCategory = 'COMPLIANT';
      riskLevel = 'LOW';
      confidence = Math.min(0.9, 1 - mfaProbability);
    } else {
      primaryCategory = 'REQUIRES_FURTHER_REVIEW';
      riskLevel = this.mapScoreToLevel(mfaProbability);
      confidence = 0.6;
    }

    return {
      primaryCategory,
      riskLevel,
      confidence,
      aiAssessment: this.extractAssessmentSentence(llmResponse),
      keyIndicators: this.identifyKeyIndicators(auditData, mfaProbability),
      supportingEvidence: mfaMatches > 0 ? 'LLM identified MFA patterns' : 'Requires investigation'
    };
  }

  assessConfidence(llmResponse, scorerOutput) {
    const factors = {
      llmResponsiveness: this.scoreLLMQuality(llmResponse),
      metricsAlignment: this.scoreMetricsAlignment(llmResponse, scorerOutput),
      dataCompleteness: this.scoreDataCompleteness(scorerOutput),
      patternClarity: this.scorePatternClarity(llmResponse)
    };

    const overallConfidence = (
      (factors.llmResponsiveness * 0.3) +
      (factors.metricsAlignment * 0.3) +
      (factors.dataCompleteness * 0.2) +
      (factors.patternClarity * 0.2)
    );

    return {
      overall: Math.round(overallConfidence * 100),
      factors,
      recommendation: overallConfidence > 0.8 ? 'HIGH_CONFIDENCE' : 'REQUIRES_REVIEW'
    };
  }

  extractActionItems(llmResponse) {
    const actionItems = [];

    const recommendationsSection = this.extractSection(llmResponse, 'Recommended Actions');
    if (recommendationsSection) {
      const bullets = recommendationsSection.split(/[-"]\s+/).filter(item => item.trim());
      bullets.forEach(bullet => {
        actionItems.push({
          action: bullet.trim(),
          priority: this.assessActionPriority(bullet),
          type: this.categorizeActionType(bullet),
          timestamp: new Date().toISOString()
        });
      });
    }

    return actionItems;
  }

  detectAdBehaviorPattern(llmResponse, auditData) {
    const patterns = {
      inconsistentWithContentDensity: false,
      scrollJackingConcern: false,
      aggressiveRefreshing: false,
      viewportManipulation: false
    };

    const responseText = llmResponse.toLowerCase();

    if (responseText.includes('ad density') && responseText.includes('inconsistent')) {
      patterns.inconsistentWithContentDensity = true;
    }

    if (auditData?.scrollJackingDetected && responseText.includes('scroll')) {
      patterns.scrollJackingConcern = true;
    }

    if ((auditData?.autoRefreshRate || 0) > 5) {
      patterns.aggressiveRefreshing = true;
    }

    if ((auditData?.viewportOcclusionPercent || 0) > 40) {
      patterns.viewportManipulation = true;
    }

    return patterns;
  }

  detectContentConcern(llmResponse) {
    const responseText = llmResponse.toLowerCase();

    const concerns = {
      lowTextEntropy: responseText.includes('template'),
      aiGenerated: responseText.includes('ai-generated') || responseText.includes('machine'),
      clickbait: responseText.includes('clickbait') || responseText.includes('sensational'),
      lowReadability: responseText.includes('readability') || responseText.includes('comprehension'),
      recycledContent: responseText.includes('recycled') || responseText.includes('duplicate') || responseText.includes('similar')
    };

    return concerns;
  }

  extractSection(text, ...sectionNames) {
    for (const name of sectionNames) {
      const regex = new RegExp(`${name}[:\\s]*([\\s\\S]*?)(?=\\n##|\\n###|$)`, 'i');
      const match = text.match(regex);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return null;
  }

  extractBulletPoints(text, sectionName) {
    const section = this.extractSection(text, sectionName);
    if (!section) return [];

    return section
      .split(/[-"]\s+/)
      .filter(item => item.trim())
      .map(item => item.trim().split('\n')[0]);
  }

  extractAssessmentSentence(llmResponse) {
    const lines = llmResponse.split('\n');
    const importantLines = lines.filter(l => l.length > 20 && !l.startsWith('#'));
    return importantLines[0] || 'Assessment pending detailed analysis';
  }

  identifyKeyIndicators(auditData, mfaProbability) {
    const indicators = [];

    if ((auditData?.adDensity || 0) > 35) {
      indicators.push('High ad density detected');
    }

    if (auditData?.scrollJackingDetected) {
      indicators.push('Scroll jacking behavior identified');
    }

    if ((auditData?.aiLikelihood || 0) > 70) {
      indicators.push('Likely AI-generated content');
    }

    if ((auditData?.entropyScore || 0) < 40) {
      indicators.push('Low content variety detected');
    }

    if ((auditData?.readabilityScore || 0) < 50) {
      indicators.push('Poor readability metrics');
    }

    if (mfaProbability > 0.7) {
      indicators.push('Model indicates high MFA probability');
    }

    return indicators;
  }

  scoreLLMQuality(llmResponse) {
    if (!llmResponse || llmResponse.length < 100) return 0.3;
    if (llmResponse.length < 500) return 0.6;
    if (llmResponse.includes('##') || llmResponse.includes('-')) return 0.9;
    return 0.8;
  }

  scoreMetricsAlignment(llmResponse, scorerOutput) {
    const responseText = llmResponse.toLowerCase();
    const hasMetricReferences = /\d+%/.test(llmResponse);
    const referencesComponents = responseText.includes('content') || responseText.includes('behavior') || responseText.includes('technical');

    if (hasMetricReferences && referencesComponents) return 0.9;
    if (referencesComponents) return 0.7;
    return 0.5;
  }

  scoreDataCompleteness(scorerOutput) {
    const hasScores = !!scorerOutput?.scores;
    const hasTrend = !!scorerOutput?.trend;
    const hasBenchmarks = !!scorerOutput?.benchmarks;
    const hasComponents = !!scorerOutput?.scores?.componentScores;

    const completeness = [hasScores, hasTrend, hasBenchmarks, hasComponents].filter(Boolean).length / 4;
    return completeness;
  }

  scorePatternClarity(llmResponse) {
    const responseText = llmResponse.toLowerCase();
    const patternKeywords = [
      'pattern', 'behavior', 'suspicious', 'compliant',
      'concerning', 'normal', 'trend', 'finding'
    ];

    const matches = patternKeywords.filter(kw => responseText.includes(kw)).length;
    return Math.min(1, matches / 4);
  }

  mapScoreToLevel(score) {
    if (score < 0.25) return 'LOW';
    if (score < 0.5) return 'MEDIUM';
    if (score < 0.75) return 'HIGH';
    return 'CRITICAL';
  }

  assessActionPriority(actionText) {
    const text = actionText.toLowerCase();
    if (text.includes('immediate') || text.includes('urgent') || text.includes('critical')) return 'CRITICAL';
    if (text.includes('soon') || text.includes('priority') || text.includes('important')) return 'HIGH';
    if (text.includes('monitor') || text.includes('continue')) return 'MEDIUM';
    return 'LOW';
  }

  categorizeActionType(actionText) {
    const text = actionText.toLowerCase();
    if (text.includes('investigate') || text.includes('review')) return 'INVESTIGATION';
    if (text.includes('monitor') || text.includes('track') || text.includes('observe')) return 'MONITORING';
    if (text.includes('suspend') || text.includes('disable') || text.includes('block')) return 'ENFORCEMENT';
    if (text.includes('communication') || text.includes('contact') || text.includes('notify')) return 'OUTREACH';
    return 'OTHER';
  }
}

module.exports = AnalysisInterpreter;
