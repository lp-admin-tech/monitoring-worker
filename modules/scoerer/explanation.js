const logger = require('../logger');

class ExplanationGenerator {
  constructor() {
    this.riskDescriptions = {
      behavioral: {
        high: 'Unusual user interaction patterns detected with high ad density and viewport manipulation',
        medium: 'Some suspicious behavioral indicators suggest potential user engagement manipulation',
        low: 'Behavioral metrics appear within normal ranges'
      },
      content: {
        high: 'Content quality concerns including low readability and high AI-generated likelihood',
        medium: 'Some content quality issues identified in entropy and freshness analysis',
        low: 'Content quality metrics appear acceptable'
      },
      technical: {
        high: 'Multiple technical red flags including poor performance, SSL issues, and broken links',
        medium: 'Some technical concerns identified in domain reputation and security checks',
        low: 'Technical infrastructure appears sound'
      },
      layout: {
        high: 'Aggressive ad placement and viewport inconsistencies detected',
        medium: 'Some layout optimization issues identified',
        low: 'Page layout and ad positioning appear appropriate'
      },
      gam_correlation: {
        high: 'GAM metrics show significant deviation from publisher benchmarks',
        medium: 'Some variance detected in GAM performance metrics',
        low: 'GAM performance metrics align with benchmarks'
      },
      policy: {
        high: 'Policy violations and restricted content detected',
        medium: 'Some potential policy compliance issues identified',
        low: 'Policy compliance appears satisfactory'
      }
    };
  }

  generateExplanation(riskScores, componentRisks = {}, options = {}) {
    try {
      const mfaProbability = riskScores.mfaProbability || 0;
      const overallRisk = riskScores.overallRiskScore || 0;

      const riskLevel = this.mapScoreToLevel(overallRisk);
      const mfaLevel = this.mapScoreToLevel(mfaProbability);

      const primaryReasons = this.extractPrimaryReasons(componentRisks, riskLevel);
      const contributingFactors = this.identifyContributingFactors(componentRisks);
      const recommendations = this.generateRecommendations(riskLevel, componentRisks);

      const explanation = {
        summary: this.generateSummary(mfaLevel, riskLevel, primaryReasons),
        details: this.generateDetails(componentRisks, riskLevel),
        primaryReasons,
        contributingFactors,
        recommendations,
        riskLevel,
        mfaLevel,
        confidenceScore: this.calculateConfidence(riskScores),
        timestamp: new Date().toISOString()
      };

      logger.info('Risk explanation generated', { riskLevel, mfaLevel });
      return explanation;
    } catch (error) {
      logger.error('Error generating explanation', error);
      return this.getDefaultExplanation();
    }
  }

  generateSummary(mfaLevel, riskLevel, reasons) {
    const mfaText = mfaLevel.toLowerCase();
    const riskText = riskLevel.toLowerCase();

    let summary = `This publisher shows ${riskText} overall risk with ${mfaText} MFA probability. `;

    if (reasons.length > 0) {
      summary += `Key concerns: ${reasons.slice(0, 3).join(', ')}. `;
    }

    if (riskLevel === 'CRITICAL') {
      summary += 'Immediate investigation and potential policy action recommended.';
    } else if (riskLevel === 'HIGH') {
      summary += 'Enhanced monitoring and review recommended.';
    } else if (riskLevel === 'MEDIUM') {
      summary += 'Continue regular monitoring with focus on flagged areas.';
    } else {
      summary += 'Standard monitoring protocols sufficient.';
    }

    return summary;
  }

  generateDetails(componentRisks, riskLevel) {
    const details = {};

    for (const [component, risks] of Object.entries(componentRisks)) {
      if (!risks || !risks.score) continue;

      const componentLevel = this.mapScoreToLevel(risks.score);
      const description = this.riskDescriptions[component]
        ? this.riskDescriptions[component][componentLevel.toLowerCase()]
        : `${component} risk assessment`;

      details[component] = {
        level: componentLevel,
        score: risks.score,
        description,
        breakdown: this.createDetailedBreakdown(component, risks)
      };
    }

    return details;
  }

  createDetailedBreakdown(component, risks) {
    const breakdown = {};

    for (const [key, value] of Object.entries(risks)) {
      if (key === 'score') continue;
      if (typeof value === 'object' && value.value !== undefined) {
        breakdown[key] = {
          value: value.value,
          weight: value.weight,
          contribution: `${(value.weight * 100).toFixed(1)}%`
        };
      } else if (typeof value === 'object' && value.detected !== undefined) {
        breakdown[key] = {
          detected: value.detected,
          weight: value.weight,
          contribution: `${(value.weight * 100).toFixed(1)}%`
        };
      }
    }

    return breakdown;
  }

  extractPrimaryReasons(componentRisks, riskLevel) {
    const reasons = [];
    const thresholds = {
      CRITICAL: 0.7,
      HIGH: 0.5,
      MEDIUM: 0.3,
      LOW: 0.1
    };

    const threshold = thresholds[riskLevel] || 0.5;

    for (const [component, risks] of Object.entries(componentRisks)) {
      if (!risks || !risks.score) continue;

      if (risks.score >= threshold) {
        const reason = this.generateReason(component, risks);
        reasons.push(reason);
      }
    }

    return reasons.sort(() => Math.random() - 0.5).slice(0, 5);
  }

  generateReason(component, risks) {
    const score = risks.score;
    const severity = score > 0.7 ? 'severe' : score > 0.5 ? 'significant' : 'notable';

    const reasonTemplates = {
      behavioral: `${severity} behavioral risk (score: ${(score * 100).toFixed(0)}%)`,
      content: `${severity} content quality concerns (score: ${(score * 100).toFixed(0)}%)`,
      technical: `${severity} technical infrastructure issues (score: ${(score * 100).toFixed(0)}%)`,
      layout: `${severity} layout and positioning anomalies (score: ${(score * 100).toFixed(0)}%)`,
      gamCorrelation: `${severity} deviation from GAM benchmarks (score: ${(score * 100).toFixed(0)}%)`,
      policy: `${severity} policy compliance concerns (score: ${(score * 100).toFixed(0)}%)`
    };

    return reasonTemplates[component] || `${component} risk detected`;
  }

  identifyContributingFactors(componentRisks) {
    const factors = [];

    const factorMap = {
      adDensity: 'High ad density ratio',
      autoRefresh: 'Auto-refresh behavior detected',
      viewportOcclusion: 'Viewport manipulation detected',
      userPatterns: 'Suspicious user interaction patterns',
      scrollJacking: 'Scroll jacking detected',
      entropy: 'Low content entropy',
      aiLikelihood: 'AI-generated content indicators',
      clickbait: 'Clickbait-style headlines detected',
      readability: 'Poor readability scores',
      freshness: 'Stale content detected',
      similarity: 'High content similarity clusters',
      performance: 'Poor page performance',
      ssl: 'SSL certificate issues',
      brokenLinks: 'Multiple broken links found',
      domainAge: 'Recently registered domain',
      whoisPrivacy: 'Private WHOIS registration',
      viewportConsistency: 'Inconsistent viewport rendering',
      rendering: 'Rendering anomalies detected',
      hidden: 'Hidden elements detected',
      aggressive: 'Aggressive ad positioning',
      ctrDeviation: 'CTR deviation from benchmark',
      ecpmDeviation: 'eCPM deviation from benchmark',
      fillRate: 'Fill rate inconsistencies',
      impression: 'Unusual impression volume',
      violations: 'Policy violations detected',
      keywords: 'Restricted keywords found',
      jurisdiction: 'Jurisdiction compliance issues'
    };

    for (const [component, risks] of Object.entries(componentRisks)) {
      if (!risks) continue;

      for (const [key, value] of Object.entries(risks)) {
        if (key === 'score' || !value) continue;

        if (typeof value === 'object') {
          const isTriggered = value.value > 0.5 || value.detected === true || value.weight > 0.1;
          if (isTriggered) {
            const factor = factorMap[key] || key;
            factors.push({
              name: factor,
              component,
              severity: this.calculateFactorSeverity(value)
            });
          }
        }
      }
    }

    return factors;
  }

  calculateFactorSeverity(value) {
    if (typeof value.value === 'number') {
      if (value.value > 0.7) return 'critical';
      if (value.value > 0.5) return 'high';
      if (value.value > 0.3) return 'medium';
      return 'low';
    }
    return value.detected ? 'high' : 'low';
  }

  generateRecommendations(riskLevel, componentRisks) {
    const recommendations = [];

    if (riskLevel === 'CRITICAL') {
      recommendations.push(
        'Immediately flag publisher for policy review',
        'Suspend new ad serving pending investigation',
        'Request full documentation of traffic sources',
        'Conduct manual content audit'
      );
    } else if (riskLevel === 'HIGH') {
      recommendations.push(
        'Enhanced monitoring and increased review frequency',
        'Request publisher clarification on flagged metrics',
        'Schedule compliance check within 7 days',
        'Monitor CTR and eCPM trends closely'
      );
    } else if (riskLevel === 'MEDIUM') {
      recommendations.push(
        'Continue regular monitoring',
        'Add to review queue for next cycle',
        'Monitor specific flagged components',
        'Request optimization of identified areas'
      );
    } else {
      recommendations.push(
        'Continue standard monitoring',
        'Routine compliance checks sufficient',
        'Consider for tier promotion if trend continues'
      );
    }

    const componentRecommendations = this.generateComponentRecommendations(componentRisks);
    recommendations.push(...componentRecommendations);

    return recommendations;
  }

  generateComponentRecommendations(componentRisks) {
    const recommendations = [];

    if (componentRisks.behavioral?.score > 0.6) {
      recommendations.push('Review user interaction patterns and consider traffic source verification');
    }

    if (componentRisks.content?.score > 0.6) {
      recommendations.push('Audit content quality and freshness; review editorial guidelines compliance');
    }

    if (componentRisks.technical?.score > 0.6) {
      recommendations.push('Address technical infrastructure issues including SSL and broken links');
    }

    if (componentRisks.layout?.score > 0.6) {
      recommendations.push('Review ad placement strategy and viewport consistency');
    }

    if (componentRisks.gamCorrelation?.score > 0.6) {
      recommendations.push('Investigate performance metric deviations and verify traffic quality');
    }

    if (componentRisks.policy?.score > 0.6) {
      recommendations.push('Review content for policy compliance and restrict prohibited categories');
    }

    return recommendations;
  }

  mapScoreToLevel(score) {
    if (score >= 0.8) return 'CRITICAL';
    if (score >= 0.6) return 'HIGH';
    if (score >= 0.4) return 'MEDIUM';
    if (score >= 0.2) return 'LOW';
    return 'MINIMAL';
  }

  calculateConfidence(riskScores) {
    const hasComponentScores = Object.keys(riskScores.componentRisks || {}).length > 3;
    const mfaScore = riskScores.mfaProbability || 0;
    const weightedScore = riskScores.weightedScore || 0;

    let confidence = 0.5;

    if (Math.abs(mfaScore - weightedScore) < 0.2) confidence += 0.3;
    if (hasComponentScores) confidence += 0.2;
    if (riskScores.timestamp) confidence += 0.05;

    return Math.min(confidence, 1);
  }

  generateHumanReadableRiskJustification(explanation) {
    try {
      let justification = `Risk Assessment: ${explanation.riskLevel}\n\n`;

      justification += `Summary:\n${explanation.summary}\n\n`;

      if (explanation.primaryReasons && explanation.primaryReasons.length > 0) {
        justification += `Primary Concerns:\n`;
        explanation.primaryReasons.forEach((reason, index) => {
          justification += `${index + 1}. ${reason}\n`;
        });
        justification += '\n';
      }

      if (explanation.contributingFactors && explanation.contributingFactors.length > 0) {
        justification += `Contributing Factors:\n`;
        const criticalFactors = explanation.contributingFactors.filter(f => f.severity === 'critical');
        const highFactors = explanation.contributingFactors.filter(f => f.severity === 'high');

        if (criticalFactors.length > 0) {
          justification += `Critical: ${criticalFactors.map(f => f.name).join(', ')}\n`;
        }
        if (highFactors.length > 0) {
          justification += `High: ${highFactors.map(f => f.name).join(', ')}\n`;
        }
        justification += '\n';
      }

      if (explanation.recommendations && explanation.recommendations.length > 0) {
        justification += `Recommendations:\n`;
        explanation.recommendations.slice(0, 5).forEach((rec, index) => {
          justification += `${index + 1}. ${rec}\n`;
        });
      }

      justification += `\nConfidence Level: ${(explanation.confidenceScore * 100).toFixed(0)}%`;

      return justification;
    } catch (error) {
      logger.error('Error generating human readable justification', error);
      return 'Risk assessment details unavailable';
    }
  }

  getDefaultExplanation() {
    return {
      summary: 'Risk assessment could not be completed. Using default evaluation.',
      details: {},
      primaryReasons: [],
      contributingFactors: [],
      recommendations: ['Continue standard monitoring'],
      riskLevel: 'UNKNOWN',
      mfaLevel: 'UNKNOWN',
      confidenceScore: 0,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ExplanationGenerator;
