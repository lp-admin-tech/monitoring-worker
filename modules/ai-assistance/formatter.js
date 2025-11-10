const logger = require('../logger');

class ReportFormatter {
  constructor() {
    this.formatVersion = '1.0';
  }

  formatForDashboard(interpretation, auditData, scorerOutput) {
    try {
      logger.info('Formatting report for dashboard', {
        domain: auditData?.domain
      });

      return {
        version: this.formatVersion,
        type: 'dashboard',
        domain: auditData?.domain,
        auditId: scorerOutput?.auditId,
        timestamp: new Date().toISOString(),

        summary: {
          mfaProbability: `${(scorerOutput?.scores?.mfaProbability * 100).toFixed(1)}%`,
          riskLevel: interpretation.categorization.riskLevel,
          category: interpretation.categorization.primaryCategory,
          confidence: `${interpretation.confidence.overall}%`,
          assessment: interpretation.parsedFindings.summary
        },

        metrics: {
          adDensity: {
            value: auditData?.adDensity?.toFixed(1),
            unit: '%',
            status: this.getMetricStatus(auditData?.adDensity, 35)
          },
          contentQuality: {
            entropyScore: auditData?.entropyScore?.toFixed(1),
            aiLikelihood: `${auditData?.aiLikelihood?.toFixed(1)}%`,
            readability: auditData?.readabilityScore?.toFixed(1),
            freshness: auditData?.freshnessScore?.toFixed(1),
            status: this.getContentQualityStatus(auditData)
          },
          technical: {
            performance: auditData?.performanceScore?.toFixed(1),
            sslValid: auditData?.sslValid !== false,
            brokenLinkRatio: auditData?.brokenLinkRatio?.toFixed(2)
          }
        },

        keyFindings: interpretation.parsedFindings.primaryFindings.slice(0, 5),

        riskFactors: this.extractRiskFactors(interpretation, auditData),

        recommendations: interpretation.actionItems.map(item => ({
          action: item.action,
          priority: item.priority,
          type: item.type
        })).slice(0, 5),

        visualization: {
          riskGauge: this.createRiskGauge(scorerOutput?.scores?.mfaProbability),
          componentBreakdown: this.createComponentBreakdown(scorerOutput?.scores?.componentScores),
          trendIndicator: this.createTrendIndicator(scorerOutput?.trend)
        },

        metadata: {
          confidenceFactors: interpretation.confidence.factors,
          categoryDetails: interpretation.categorization
        }
      };
    } catch (error) {
      logger.error('Error formatting for dashboard', error);
      throw error;
    }
  }

  formatForEmail(interpretation, auditData, scorerOutput, recipientType = 'team') {
    try {
      logger.info('Formatting report for email', {
        domain: auditData?.domain,
        recipient: recipientType
      });

      const emailContent = {
        version: this.formatVersion,
        type: 'email',
        recipientType,
        timestamp: new Date().toISOString(),

        subject: this.generateEmailSubject(interpretation, auditData),

        header: this.generateEmailHeader(interpretation, auditData, scorerOutput),

        executive_summary: {
          headline: this.generateHeadline(interpretation),
          overview: this.generateOverview(interpretation, auditData),
          riskLevel: interpretation.categorization.riskLevel,
          mfaProbability: `${(scorerOutput?.scores?.mfaProbability * 100).toFixed(1)}%`
        },

        key_findings: {
          findings: interpretation.parsedFindings.primaryFindings,
          contentAssessment: interpretation.parsedFindings.contentQuality,
          adBehaviorConcerns: this.extractAdBehaviorConcerns(interpretation, auditData)
        },

        detailed_analysis: {
          content: interpretation.parsedFindings.contentQuality,
          adBehavior: interpretation.parsedFindings.adBehavior,
          metrics: this.formatMetricsForEmail(auditData, scorerOutput)
        },

        next_steps: {
          recommendations: this.formatRecommendationsForEmail(interpretation.actionItems),
          immediateActions: this.filterByPriority(interpretation.actionItems, 'CRITICAL'),
          timeline: this.suggestInvestigationTimeline(interpretation)
        },

        raw_analysis: interpretation.rawResponse,

        footer: this.generateEmailFooter(recipientType)
      };

      return emailContent;
    } catch (error) {
      logger.error('Error formatting for email', error);
      throw error;
    }
  }

  generateEmailSubject(interpretation, auditData) {
    const domain = auditData?.domain || 'Unknown Site';
    const riskLevel = interpretation.categorization.riskLevel;

    const subjectMap = {
      'CRITICAL': `ACTION REQUIRED: ${domain} - Critical Risk Detected`,
      'HIGH': `PRIORITY REVIEW: ${domain} - High Risk Assessment`,
      'MEDIUM': `REVIEW NEEDED: ${domain} - Moderate Risk Indicators`,
      'LOW': `MONITORING: ${domain} - Low Risk Profile`
    };

    return subjectMap[riskLevel] || `AUDIT REPORT: ${domain}`;
  }

  generateEmailHeader(interpretation, auditData, scorerOutput) {
    return `
# Compliance Alert & Risk Assessment

**Domain:** ${auditData?.domain}
**Audit ID:** ${scorerOutput?.auditId}
**Report Date:** ${new Date().toLocaleDateString()}
**Risk Level:** ${interpretation.categorization.riskLevel}
**MFA Probability:** ${(scorerOutput?.scores?.mfaProbability * 100).toFixed(1)}%
**Assessment Confidence:** ${interpretation.confidence.overall}%
    `;
  }

  generateHeadline(interpretation) {
    const category = interpretation.categorization.primaryCategory;

    const headlines = {
      'SUSPECTED_MFA': 'This site shows strong indicators of Made-For-Advertising activity',
      'POTENTIAL_ISSUES': 'This site has multiple concerning patterns that warrant investigation',
      'COMPLIANT': 'This site appears to meet compliance standards',
      'REQUIRES_FURTHER_REVIEW': 'This site requires additional analysis for definitive classification',
      'REVIEW_REQUIRED': 'Initial assessment suggests this site needs closer examination'
    };

    return headlines[category] || 'Compliance assessment completed';
  }

  generateOverview(interpretation, auditData) {
    const findings = interpretation.parsedFindings.primaryFindings.slice(0, 3);
    const summary = `Based on comprehensive analysis of ${auditData?.domain}, the following key findings were identified:

${findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}`;

    return summary;
  }

  extractAdBehaviorConcerns(interpretation, auditData) {
    const concerns = [];

    if ((auditData?.adDensity || 0) > 35) {
      concerns.push('Exceptionally high ad density detected');
    }

    if (auditData?.scrollJackingDetected) {
      concerns.push('Scroll jacking behavior observed');
    }

    if ((auditData?.viewportOcclusionPercent || 0) > 50) {
      concerns.push('Significant viewport occlusion detected');
    }

    if ((auditData?.autoRefreshRate || 0) > 5) {
      concerns.push('Aggressive auto-refresh patterns detected');
    }

    return concerns;
  }

  formatMetricsForEmail(auditData, scorerOutput) {
    return `
**Performance Metrics:**
- Ad Density: ${auditData?.adDensity?.toFixed(1)}% of viewport
- Content Freshness: ${auditData?.freshnessScore?.toFixed(1)}/100
- Readability: ${auditData?.readabilityScore?.toFixed(1)}/100
- AI-Generated Likelihood: ${auditData?.aiLikelihood?.toFixed(1)}%
- Page Performance: ${auditData?.performanceScore?.toFixed(1)}/100
- SSL/TLS Valid: ${auditData?.sslValid !== false ? 'Yes' : 'No'}

**Risk Scores:**
- Overall Risk: ${scorerOutput?.scores?.overallRiskScore?.toFixed(2)}/10
- MFA Probability: ${(scorerOutput?.scores?.mfaProbability * 100).toFixed(1)}%
    `;
  }

  formatRecommendationsForEmail(actionItems) {
    return actionItems
      .slice(0, 5)
      .map((item, i) => `${i + 1}. [${item.priority}] ${item.action}`)
      .join('\n');
  }

  filterByPriority(actionItems, priority) {
    return actionItems.filter(item => item.priority === priority);
  }

  suggestInvestigationTimeline(interpretation) {
    const riskLevel = interpretation.categorization.riskLevel;

    const timelines = {
      'CRITICAL': 'Investigation should begin immediately (within 24 hours)',
      'HIGH': 'Investigation should begin within 48-72 hours',
      'MEDIUM': 'Schedule investigation within 1-2 weeks',
      'LOW': 'Routine monitoring appropriate; investigation not urgent'
    };

    return timelines[riskLevel] || 'Schedule investigation at compliance team discretion';
  }

  generateEmailFooter(recipientType) {
    return `
---

**Report Generated By:** AI Compliance Assistant
**Confidence Level:** This assessment should be reviewed by compliance personnel
**Next Review:** Recommended within 7 days

*This is an automated report. All findings should be verified by qualified compliance personnel before taking action.*
    `;
  }

  createRiskGauge(mfaProbability = 0) {
    const percent = Math.round(mfaProbability * 100);
    const filled = Math.round(percent / 10);
    const empty = 10 - filled;

    return {
      percentage: percent,
      visualization: `[${'�'.repeat(filled)}${'�'.repeat(empty)}] ${percent}%`,
      level: percent < 25 ? 'LOW' : percent < 50 ? 'MEDIUM' : percent < 75 ? 'HIGH' : 'CRITICAL'
    };
  }

  createComponentBreakdown(componentScores) {
    if (!componentScores) return null;

    return {
      behavioral: Math.round((componentScores.behavioral || 0) * 100),
      content: Math.round((componentScores.content || 0) * 100),
      technical: Math.round((componentScores.technical || 0) * 100),
      layout: Math.round((componentScores.layout || 0) * 100),
      gamCorrelation: Math.round((componentScores.gamCorrelation || 0) * 100),
      policy: Math.round((componentScores.policy || 0) * 100)
    };
  }

  createTrendIndicator(trend) {
    if (!trend) return null;

    return {
      direction: trend.direction || 'stable',
      velocity: trend.velocity || 'normal',
      isAnomalous: trend.anomaly ? true : false,
      indicator: trend.direction === 'increasing' ? '=�' : trend.direction === 'decreasing' ? '=�' : '�'
    };
  }

  getMetricStatus(value, threshold) {
    if (!value) return 'unknown';
    return value > threshold ? 'concerning' : value > threshold * 0.7 ? 'caution' : 'normal';
  }

  getContentQualityStatus(auditData) {
    const issues = [];

    if ((auditData?.entropyScore || 0) < 35) issues.push('Low variety');
    if ((auditData?.aiLikelihood || 0) > 70) issues.push('AI content');
    if ((auditData?.clickbaitScore || 0) > 70) issues.push('Clickbait');
    if ((auditData?.readabilityScore || 0) < 50) issues.push('Poor readability');
    if ((auditData?.freshnessScore || 0) < 30) issues.push('Stale content');

    if (issues.length === 0) return 'good';
    if (issues.length <= 2) return 'fair';
    return 'poor';
  }

  extractRiskFactors(interpretation, auditData) {
    const factors = [];

    interpretation.categorization.keyIndicators.forEach(indicator => {
      factors.push({
        factor: indicator,
        severity: this.assessFactorSeverity(indicator, auditData)
      });
    });

    return factors.sort((a, b) => {
      const severityMap = { 'CRITICAL': 3, 'HIGH': 2, 'MEDIUM': 1, 'LOW': 0 };
      return severityMap[b.severity] - severityMap[a.severity];
    });
  }

  assessFactorSeverity(factor, auditData) {
    const text = factor.toLowerCase();

    if (text.includes('scroll') || text.includes('viewport manipulation')) return 'CRITICAL';
    if (text.includes('ad density') && (auditData?.adDensity || 0) > 40) return 'CRITICAL';
    if (text.includes('ai-generated') && (auditData?.aiLikelihood || 0) > 80) return 'HIGH';
    if (text.includes('readability')) return 'MEDIUM';
    if (text.includes('detected')) return 'HIGH';

    return 'MEDIUM';
  }
}

module.exports = ReportFormatter;
