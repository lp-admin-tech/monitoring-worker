const logger = require('../logger');

class PromptBuilder {
  constructor() {
    this.systemRole = `You are an expert content compliance analyst specializing in detecting Made-For-Advertising (MFA) sites and publisher fraud patterns. Your role is to translate technical metrics and audit data into clear, actionable insights using Token-Oriented Object Notation (TOON).

TOON Format Guidelines:
- Use function-like syntax: keyword(parameter)
- Arrays use brackets: field:[item1, item2]
- Values use parentheses: field(value) or key(key=value)
- No JSON - maintain human-readable structure
- Be concise and specific in all descriptions
- No repetition between sections

For each module analysis:
1. interpret() - What the metrics mean
2. detect() - Specific issues identified
3. explain() - Root cause analysis
4. suggest() - Actionable fixes
5. highlight() - Positive signals
6. calculate() - Score impact
7. combine() - Summary combining all elements

Output in clean, structured TOON format. Be balanced, evidence-based, and explain findings in plain language.`;
  }

  buildComprehensivePrompt(auditData, scorerOutput, policyViolations = []) {
    try {
      logger.info('Building comprehensive LLM prompt', {
        domain: auditData?.domain,
        scoreId: scorerOutput?.auditId
      });

      const sections = [];

      sections.push(this.buildContextSection(auditData));
      sections.push(this.buildMetricsSection(auditData, scorerOutput));
      sections.push(this.buildRiskProbabilitySection(scorerOutput));
      sections.push(this.buildGamTrendsSection(scorerOutput));
      sections.push(this.buildViolationsSection(policyViolations));
      sections.push(this.buildAnalysisRequestSection());

      const prompt = sections.join('\n\n');

      logger.debug('Prompt constructed successfully', {
        sections: sections.length,
        totalLength: prompt.length
      });

      return {
        systemPrompt: this.systemRole,
        userPrompt: prompt,
        metadata: {
          domain: auditData?.domain,
          timestamp: new Date().toISOString(),
          sections: sections.length
        }
      };
    } catch (error) {
      logger.error('Error building comprehensive prompt', error);
      throw error;
    }
  }

  buildContextSection(auditData) {
    const context = `## AUDIT CONTEXT

**Domain Under Review:** ${auditData?.domain || 'Unknown'}
**Audit ID:** ${auditData?.id || 'Unknown'}
**Audit Timestamp:** ${auditData?.auditedAt || new Date().toISOString()}
**Content Category:** ${auditData?.contentCategory || 'General'}
**Primary Language:** ${auditData?.language || 'English'}

**Site Summary:**
- Approximate Monthly Traffic: ${this.formatNumber(auditData?.estimatedMonthlyTraffic)} sessions
- Publisher Group: ${auditData?.publisherGroup || 'Unclassified'}
- Domain Age: ${auditData?.domainAgeMonths || 'Unknown'} months
- Previous Risk Assessments: ${auditData?.historicalScores?.length || 0} on record`;

    return context;
  }

  buildMetricsSection(auditData, scorerOutput) {
    const metrics = `## BEHAVIORAL & TECHNICAL METRICS

### Ad Behavior Analysis
- **Ad Density:** ${auditData?.adDensity?.toFixed(1) || 0}% of viewport
- **Auto-Refresh Rate:** ${auditData?.autoRefreshRate?.toFixed(1) || 0} per minute
- **Viewport Occlusion:** ${auditData?.viewportOcclusionPercent?.toFixed(1) || 0}%
- **Scroll Jacking Detected:** ${auditData?.scrollJackingDetected ? 'Yes - HIGH CONCERN' : 'No'}
- **Aggressive Positioning:** ${auditData?.aggressivePositioning?.toFixed(1) || 0}% of ads

### Content Quality Indicators
- **Text Entropy Score:** ${auditData?.entropyScore?.toFixed(1) || 0}/100 (Higher = More Varied Content)
- **AI-Generated Likelihood:** ${auditData?.aiLikelihood?.toFixed(1) || 0}%
- **Clickbait Score:** ${auditData?.clickbaitScore?.toFixed(1) || 0}/100
- **Readability Score:** ${auditData?.readabilityScore?.toFixed(1) || 0}/100 (Flesch Reading Ease)
- **Content Freshness:** ${auditData?.freshnessScore?.toFixed(1) || 0}/100
- **Content Similarity:** ${auditData?.similarityScore?.toFixed(1) || 0}% (Higher = More Recycled)

### Technical Infrastructure
- **Page Load Performance:** ${auditData?.performanceScore?.toFixed(1) || 0}/100
- **SSL Certificate Valid:** ${auditData?.sslValid !== false ? 'Yes' : 'No - SECURITY ISSUE'}
- **Broken Links Ratio:** ${auditData?.brokenLinkRatio?.toFixed(2) || 0}
- **Domain Reputation:** ${this.assessDomainReputation(auditData)}
- **WHOIS Privacy:** ${auditData?.whoisPrivate ? 'Enabled - Suspicious' : 'Transparent - Normal'}

### Layout & UX Anomalies
- **Viewport Inconsistency:** ${auditData?.viewportInconsistencyRatio?.toFixed(2) || 0} (Mobile/Desktop variance)
- **Rendering Anomalies:** ${auditData?.renderingAnomalies?.toFixed(1) || 0}
- **Hidden Element Ratio:** ${auditData?.hiddenElementRatio?.toFixed(2) || 0}`;

    return metrics;
  }

  buildRiskProbabilitySection(scorerOutput) {
    const riskProb = `## RISK PROBABILITY ASSESSMENT

**Overall MFA Probability:** ${(scorerOutput?.scores?.mfaProbability * 100).toFixed(1)}%
**Overall Risk Score:** ${scorerOutput?.scores?.overallRiskScore?.toFixed(2) || 0}/10
**Methodology:** ${scorerOutput?.methodology || 'Bayesian Risk Engine'}
**Confidence Level:** ${this.calculateConfidence(scorerOutput?.scores)}%

### Component Risk Breakdown
${this.formatComponentRisks(scorerOutput?.scores?.componentScores)}

### Trend Analysis
- **Risk Direction:** ${scorerOutput?.trend?.direction || 'Stable'}
- **Velocity (Rate of Change):** ${scorerOutput?.trend?.velocity || 'Normal'}
- **Anomaly Detected:** ${scorerOutput?.trend?.anomaly ? 'Yes - Investigation Priority' : 'No'}
- **Benchmark Comparison:** ${this.formatBenchmarkComparison(scorerOutput?.benchmarks)}`;

    return riskProb;
  }

  buildGamTrendsSection(scorerOutput) {
    const gamData = `## GAM PERFORMANCE & CORRELATION SIGNALS

### Monetary Metrics Deviation
- **CTR vs Benchmark:** ${this.formatDeviation(scorerOutput?.benchmarks?.ctr?.deviation)}
- **eCPM vs Benchmark:** ${this.formatDeviation(scorerOutput?.benchmarks?.ecpm?.deviation)}
- **Fill Rate vs Publisher Group:** ${this.formatDeviation(scorerOutput?.benchmarks?.fillRate?.deviation)}

### Anomaly Indicators
- **Impression Spike Detected:** ${scorerOutput?.scores?.componentScores?.gamCorrelation > 0.7 ? 'Yes - Suspicious Pattern' : 'No'}
- **Revenue Consistency:** ${this.assessRevenueConsistency(scorerOutput)}
- **Publisher Group Alignment:** ${this.assessGroupAlignment(scorerOutput)}`;

    return gamData;
  }

  buildViolationsSection(policyViolations) {
    const violations = `## POLICY & COMPLIANCE VIOLATIONS

${policyViolations && policyViolations.length > 0
  ? policyViolations.map((v, i) => `**Violation ${i + 1}:** ${v.category}\n- Type: ${v.type}\n- Severity: ${v.severity}\n- Evidence: ${v.evidence}`).join('\n\n')
  : 'No explicit policy violations detected.'}

### Jurisdiction Checks
- **Applicable Regulations:** ${this.listApplicableRegulations()}
- **Compliance Status:** ${policyViolations?.length > 0 ? 'Multiple Issues Identified' : 'Compliant'}`;

    return violations;
  }

  buildAnalysisRequestSection() {
    return `## ANALYSIS REQUEST

Analyze findings using TOON format. For each significant module/finding:

For each module analysis:
- interpret() - What does this metric mean for site quality?
- detect() - Identify specific issues that arise from this
- explain() - Root cause for the issue
- suggest() - Actionable fix to improve the score
- highlight() - Positive signals to maintain quality
- calculate() - Impact on overall quality/risk score
- combine() - Brief summary connecting all findings

Output format for each module:
module(name)
found(issues:["problem1", "problem2"])
cause:["root cause for problem1", "root cause for problem2"]
fix:["actionable fix for problem1", "actionable fix for problem2"]
impact(score_change="numerical or qualitative value")
good:["positive signal1", "positive signal2"]
review_summary("Brief evaluation combining causes, fixes, and improvements")

Guidelines:
- Be concise and specific
- Avoid repetition
- Give realistic fixes that match site context
- Infer missing details logically from signals
- Maintain human-readable TOON format (no JSON)`;
  }

  formatComponentRisks(componentScores) {
    if (!componentScores) return 'No component data available.';

    const components = [
      { name: 'Behavioral', score: componentScores.behavioral },
      { name: 'Content Quality', score: componentScores.content },
      { name: 'Technical', score: componentScores.technical },
      { name: 'Layout & UX', score: componentScores.layout },
      { name: 'GAM Correlation', score: componentScores.gamCorrelation },
      { name: 'Policy Compliance', score: componentScores.policy }
    ];

    return components
      .filter(c => c.score !== undefined)
      .map(c => `- **${c.name}:** ${(c.score * 100).toFixed(0)}% risk`)
      .join('\n');
  }

  formatBenchmarkComparison(benchmarks) {
    if (!benchmarks) return 'No benchmark data available.';

    const items = [];
    if (benchmarks?.ctr) {
      items.push(`CTR ${benchmarks.ctr.percentile || 'average'}`);
    }
    if (benchmarks?.ecpm) {
      items.push(`eCPM ${benchmarks.ecpm.percentile || 'average'}`);
    }
    if (benchmarks?.fillRate) {
      items.push(`Fill Rate ${benchmarks.fillRate.percentile || 'average'}`);
    }

    return items.length > 0 ? items.join(', ') : 'Within benchmarks';
  }

  formatDeviation(deviation) {
    if (!deviation) return 'No data';
    const sign = deviation > 0 ? '+' : '';
    return `${sign}${(deviation * 100).toFixed(1)}%`;
  }

  assessDomainReputation(auditData) {
    if (auditData?.domainAgeMonths && auditData.domainAgeMonths < 3) {
      return 'Very New - High Risk';
    }
    if (auditData?.whoisPrivate) {
      return 'Private Registration - Suspicious';
    }
    return 'Established';
  }

  assessRevenueConsistency(scorerOutput) {
    const ctrDev = scorerOutput?.benchmarks?.ctr?.deviation || 0;
    const ecpmDev = scorerOutput?.benchmarks?.ecpm?.deviation || 0;

    if (Math.abs(ctrDev) > 0.5 || Math.abs(ecpmDev) > 0.5) {
      return 'Highly Inconsistent - Major Concern';
    }
    if (Math.abs(ctrDev) > 0.3 || Math.abs(ecpmDev) > 0.3) {
      return 'Somewhat Inconsistent - Review Needed';
    }
    return 'Consistent - Normal';
  }

  assessGroupAlignment(scorerOutput) {
    if (!scorerOutput?.patternDrift) return 'Aligned';
    if (scorerOutput.patternDrift.score > 0.7) {
      return 'Significant Divergence from Group';
    }
    return 'Aligned with Publisher Group';
  }

  listApplicableRegulations() {
    return 'AdChoices Guidelines, Google Publisher Policies, IAB Standards';
  }

  calculateConfidence(scores) {
    if (!scores) return 0;
    const factors = [
      scores.mfaProbability !== undefined ? 0.3 : 0,
      scores.overallRiskScore !== undefined ? 0.3 : 0,
      scores.componentScores ? 0.4 : 0
    ];
    return Math.round(Math.min(100, factors.reduce((a, b) => a + b, 0) * 100));
  }

  formatNumber(num) {
    if (!num) return 'N/A';
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  }
}

module.exports = PromptBuilder;
