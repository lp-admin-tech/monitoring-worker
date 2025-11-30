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
      logger.info('Building comprehensive LLM prompt (TOON format)', {
        domain: auditData?.domain,
        scoreId: scorerOutput?.auditId
      });

      const sections = [];

      sections.push(this.buildContextSection(auditData));
      sections.push(this.buildMetricsSection(auditData, scorerOutput));
      sections.push(this.buildRiskProbabilitySection(scorerOutput));
      sections.push(this.buildGamTrendsSection(scorerOutput));
      sections.push(this.buildViolationsSection(auditData, policyViolations));
      sections.push(this.buildAnalysisRequestSection());

      const prompt = sections.join('\n\n');

      return {
        systemPrompt: this.systemRole,
        userPrompt: prompt,
        metadata: {
          domain: auditData?.domain,
          timestamp: new Date().toISOString(),
          format: 'TOON'
        }
      };
    } catch (error) {
      logger.error('Error building comprehensive prompt', error);
      throw error;
    }
  }

  buildContextSection(auditData) {
    return `audit_context(
  domain("${auditData?.domain || 'Unknown'}")
  audit_id("${auditData?.id || 'Unknown'}")
  timestamp("${auditData?.auditedAt || new Date().toISOString()}")
  content_category("${auditData?.contentCategory || 'General'}")
  language("${auditData?.language || 'English'}")
  monthly_traffic("${this.formatNumber(auditData?.estimatedMonthlyTraffic)}")
  publisher_group("${auditData?.publisherGroup || 'Unclassified'}")
  domain_age("${auditData?.domainAgeMonths || 'Unknown'} months")
)`;
  }

  buildMetricsSection(auditData, scorerOutput) {
    return `metrics(
  ad_behavior(
    density_standard("${auditData?.adDensity?.toFixed(1) || 0}%")
    density_weighted("${auditData?.weightedVisualDensity?.toFixed(1) || 0}%")
    clutter_atf("${auditData?.adsAboveFold || 0}")
    auto_refresh("${auditData?.autoRefreshRate?.toFixed(1) || 0}/min")
    viewport_occlusion("${auditData?.viewportOcclusionPercent?.toFixed(1) || 0}%")
    scroll_jacking("${auditData?.scrollJackingDetected ? 'YES' : 'NO'}")
    aggressive_positioning("${auditData?.aggressivePositioning?.toFixed(1) || 0}%")
  )
  content_quality(
    entropy("${auditData?.entropyScore?.toFixed(1) || 0}/100")
    ai_likelihood("${auditData?.aiLikelihood?.toFixed(1) || 0}%")
    clickbait("${auditData?.clickbaitScore?.toFixed(1) || 0}/100")
    readability("${auditData?.readabilityScore?.toFixed(1) || 0}/100")
    freshness("${auditData?.freshnessScore?.toFixed(1) || 0}/100")
    similarity("${auditData?.similarityScore?.toFixed(1) || 0}%")
  )
  technical(
    ads_txt_arbitrage("${auditData?.adsTxtArbitrageRisk ? 'YES' : 'NO'}")
    ads_txt_direct_ratio("${(auditData?.adsTxtDirectRatio * 100)?.toFixed(1) || 0}%")
    performance("${auditData?.performanceScore?.toFixed(1) || 0}/100")
    ssl_valid("${auditData?.sslValid !== false ? 'YES' : 'NO'}")
    broken_links("${auditData?.brokenLinkRatio?.toFixed(2) || 0}")
    reputation("${this.assessDomainReputation(auditData)}")
    whois_privacy("${auditData?.whoisPrivate ? 'YES' : 'NO'}")
  )
  ux_anomalies(
    viewport_inconsistency("${auditData?.viewportInconsistencyRatio?.toFixed(2) || 0}")
    rendering_anomalies("${auditData?.renderingAnomalies?.toFixed(1) || 0}")
    hidden_elements("${auditData?.hiddenElementRatio?.toFixed(2) || 0}")
  )
)`;
  }

  buildRiskProbabilitySection(scorerOutput) {
    return `risk_assessment(
  mfa_probability("${(scorerOutput?.scores?.mfaProbability * 100).toFixed(1)}%")
  overall_score("${scorerOutput?.scores?.overallRiskScore?.toFixed(2) || 0}/10")
  methodology("${scorerOutput?.methodology || 'Bayesian'}")
  confidence("${this.calculateConfidence(scorerOutput?.scores)}%")
  components(
${this.formatComponentRisksTOON(scorerOutput?.scores?.componentScores)}
  )
  trend(
    direction("${scorerOutput?.trend?.direction || 'Stable'}")
    velocity("${scorerOutput?.trend?.velocity || 'Normal'}")
    anomaly("${scorerOutput?.trend?.anomaly ? 'YES' : 'NO'}")
    benchmark("${this.formatBenchmarkComparison(scorerOutput?.benchmarks)}")
  )
)`;
  }

  buildGamTrendsSection(scorerOutput) {
    return `gam_signals(
  monetary_deviation(
    ctr("${this.formatDeviation(scorerOutput?.benchmarks?.ctr?.deviation)}")
    ecpm("${this.formatDeviation(scorerOutput?.benchmarks?.ecpm?.deviation)}")
    fill_rate("${this.formatDeviation(scorerOutput?.benchmarks?.fillRate?.deviation)}")
  )
  anomalies(
    impression_spike("${scorerOutput?.scores?.componentScores?.gamCorrelation > 0.7 ? 'YES' : 'NO'}")
    revenue_consistency("${this.assessRevenueConsistency(scorerOutput)}")
    group_alignment("${this.assessGroupAlignment(scorerOutput)}")
  )
)`;
  }

  formatComponentRisksTOON(componentScores) {
    if (!componentScores) return '    no_data()';

    const components = [
      { name: 'behavioral', score: componentScores.behavioral },
      { name: 'content', score: componentScores.content },
      { name: 'technical', score: componentScores.technical },
      { name: 'layout', score: componentScores.layout },
      { name: 'gam', score: componentScores.gamCorrelation },
      { name: 'policy', score: componentScores.policy }
    ];

    return components
      .filter(c => c.score !== undefined)
      .map(c => `    ${c.name}("${(c.score * 100).toFixed(0)}%")`)
      .join('\n');
  }

  buildViolationsSection(auditData, policyViolations) {
    const violationList = policyViolations && policyViolations.length > 0
      ? policyViolations.map(v => `    violation(category="${v.category}" type="${v.type}" severity="${v.severity}")`).join('\n')
      : '    status("clean")';

    return `compliance(
  violations(
${violationList}
  )
  brand_safety(
    risk("${auditData?.brandSafetyRisk ? 'YES' : 'NO'}")
  )
  jurisdiction(
    regulations("${this.listApplicableRegulations()}")
    status("${policyViolations?.length > 0 ? 'Issues Found' : 'Compliant'}")
  )
)`;
  }

  buildAnalysisRequestSection() {
    return `request(
  task("Analyze findings using TOON format")
  
  mfa_score_reasoning(
    instruction("Provide 1 sentence per score + 1 summary suggestion")
    format("<Score Name>: <Value> — <Reason>")
  )

  module_analysis(
    instruction("Analyze significant modules")
    format(
      module(name)
      found(issues:["issue1", "issue2"])
      cause:["cause1", "cause2"]
      fix:["fix1", "fix2"]
      impact(score_change="value")
      good:["signal1", "signal2"]
      review_summary("text")
    )
  )
)`;
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
