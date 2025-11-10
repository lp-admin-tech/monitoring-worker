const logger = require('../logger');

class RiskEngine {
  constructor(weights = {}) {
    this.weights = weights;
    this.bayesianPriors = weights.bayesianPriors || {};
    this.componentWeights = weights.componentWeights || {};
  }

  calculateComponentRisks(data) {
    const components = {
      behavioral: this.calculateBehavioralRisk(data),
      content: this.calculateContentRisk(data),
      technical: this.calculateTechnicalRisk(data),
      layout: this.calculateLayoutRisk(data),
      gamCorrelation: this.calculateGamCorrelationRisk(data),
      policy: this.calculatePolicyRisk(data)
    };

    logger.debug('Component risks calculated', components);
    return components;
  }

  calculateBehavioralRisk(data) {
    const weights = this.weights.behavioral || {};

    const adDensity = Math.min(data.adDensity || 0, 1) * (weights.ad_density || 0.15);
    const autoRefresh = Math.min(data.autoRefreshRate || 0, 1) * (weights.auto_refresh || 0.12);
    const viewportOcclusion = Math.min(data.viewportOcclusionPercent || 0, 1) * (weights.viewport_occlusion || 0.10);
    const userPatterns = Math.min(data.suspiciousInteractionRatio || 0, 1) * (weights.user_interaction_patterns || 0.08);
    const scrollJacking = Math.min(data.scrollJackingDetected ? 1 : 0, 1) * (weights.scroll_jacking || 0.05);

    const rawScore = adDensity + autoRefresh + viewportOcclusion + userPatterns + scrollJacking;
    const normalizedScore = Math.min(rawScore, 1);

    return {
      score: normalizedScore,
      adDensity: { value: data.adDensity || 0, weight: adDensity },
      autoRefresh: { value: data.autoRefreshRate || 0, weight: autoRefresh },
      viewportOcclusion: { value: data.viewportOcclusionPercent || 0, weight: viewportOcclusion },
      userPatterns: { value: data.suspiciousInteractionRatio || 0, weight: userPatterns },
      scrollJacking: { detected: data.scrollJackingDetected || false, weight: scrollJacking }
    };
  }

  calculateContentRisk(data) {
    const weights = this.weights.content || {};

    const entropy = Math.min(Math.max((data.entropyScore || 0) / 5, 0), 1) * (weights.entropy_score || 0.20);
    const aiLikelihood = Math.min(data.aiLikelihood || 0, 1) * (weights.ai_likelihood || 0.12);
    const clickbait = Math.min(data.clickbaitScore || 0, 1) * (weights.clickbait_score || 0.10);
    const readability = Math.min(data.readabilityScore || 0, 1) * (weights.readability || 0.08);
    const freshness = Math.min(data.freshnessScore || 0, 1) * (weights.freshness || 0.05);
    const similarity = Math.min(data.similarityScore || 0, 1) * (weights.semantic_similarity || 0.08);

    const rawScore = entropy + aiLikelihood + clickbait + readability + freshness + similarity;
    const normalizedScore = Math.min(rawScore, 1);

    return {
      score: normalizedScore,
      entropy: { value: data.entropyScore || 0, weight: entropy },
      aiLikelihood: { value: data.aiLikelihood || 0, weight: aiLikelihood },
      clickbait: { value: data.clickbaitScore || 0, weight: clickbait },
      readability: { value: data.readabilityScore || 0, weight: readability },
      freshness: { value: data.freshnessScore || 0, weight: freshness },
      similarity: { value: data.similarityScore || 0, weight: similarity }
    };
  }

  calculateTechnicalRisk(data) {
    const weights = this.weights.technical || {};

    const performance = Math.min(data.performanceScore || 0, 1) * (weights.performance_score || 0.10);
    const ssl = (data.sslValid === false ? 1 : 0) * (weights.ssl_validity || 0.05);
    const brokenLinks = Math.min(data.brokenLinkRatio || 0, 1) * (weights.broken_links || 0.08);
    const domainAge = this.calculateDomainAgeRisk(data.domainAgeMonths || 0) * (weights.domain_age || 0.06);
    const whoisPrivacy = (data.whoisPrivate === true ? 1 : 0) * (weights.whois_privacy || 0.04);

    const rawScore = performance + ssl + brokenLinks + domainAge + whoisPrivacy;
    const normalizedScore = Math.min(rawScore, 1);

    return {
      score: normalizedScore,
      performance: { value: data.performanceScore || 0, weight: performance },
      ssl: { valid: data.sslValid !== false, weight: ssl },
      brokenLinks: { value: data.brokenLinkRatio || 0, weight: brokenLinks },
      domainAge: { months: data.domainAgeMonths || 0, weight: domainAge },
      whoisPrivacy: { private: data.whoisPrivate || false, weight: whoisPrivacy }
    };
  }

  calculateLayoutRisk(data) {
    const weights = this.weights.layout || {};

    const viewportConsistency = Math.min(data.viewportInconsistencyRatio || 0, 1) * (weights.viewport_consistency || 0.08);
    const rendering = Math.min(data.renderingAnomalies || 0, 1) * (weights.rendering_anomalies || 0.06);
    const hidden = Math.min(data.hiddenElementRatio || 0, 1) * (weights.hidden_elements || 0.05);
    const aggressive = Math.min(data.aggressivePositioning || 0, 1) * (weights.aggressive_positioning || 0.07);

    const rawScore = viewportConsistency + rendering + hidden + aggressive;
    const normalizedScore = Math.min(rawScore, 1);

    return {
      score: normalizedScore,
      viewportConsistency: { value: data.viewportInconsistencyRatio || 0, weight: viewportConsistency },
      rendering: { value: data.renderingAnomalies || 0, weight: rendering },
      hidden: { value: data.hiddenElementRatio || 0, weight: hidden },
      aggressive: { value: data.aggressivePositioning || 0, weight: aggressive }
    };
  }

  calculateGamCorrelationRisk(data) {
    const weights = this.weights.gam_correlation || {};

    const ctrDeviation = Math.min(Math.abs(data.ctrDeviation || 0), 1) * (weights.ctr_deviation || 0.15);
    const ecpmDeviation = Math.min(Math.abs(data.ecpmDeviation || 0), 1) * (weights.ecpm_deviation || 0.12);
    const fillRate = Math.min(Math.abs(data.fillRateInconsistency || 0), 1) * (weights.fill_rate_inconsistency || 0.08);
    const impression = Math.min(data.impressionSpike || 0, 1) * (weights.impression_spike || 0.10);

    const rawScore = ctrDeviation + ecpmDeviation + fillRate + impression;
    const normalizedScore = Math.min(rawScore, 1);

    return {
      score: normalizedScore,
      ctrDeviation: { value: data.ctrDeviation || 0, weight: ctrDeviation },
      ecpmDeviation: { value: data.ecpmDeviation || 0, weight: ecpmDeviation },
      fillRate: { value: data.fillRateInconsistency || 0, weight: fillRate },
      impression: { value: data.impressionSpike || 0, weight: impression }
    };
  }

  calculatePolicyRisk(data) {
    const weights = this.weights.policy || {};

    const violations = Math.min(data.policyViolationCount || 0 / 5, 1) * (weights.policy_violations || 0.10);
    const keywords = Math.min(data.restrictedKeywordMatches || 0 / 10, 1) * (weights.restricted_keywords || 0.08);
    const jurisdiction = Math.min(data.jurisdictionViolations || 0, 1) * (weights.jurisdiction_compliance || 0.06);

    const rawScore = violations + keywords + jurisdiction;
    const normalizedScore = Math.min(rawScore, 1);

    return {
      score: normalizedScore,
      violations: { count: data.policyViolationCount || 0, weight: violations },
      keywords: { count: data.restrictedKeywordMatches || 0, weight: keywords },
      jurisdiction: { value: data.jurisdictionViolations || 0, weight: jurisdiction }
    };
  }

  calculateDomainAgeRisk(ageMonths) {
    if (ageMonths > 36) return 0;
    if (ageMonths > 24) return 0.2;
    if (ageMonths > 12) return 0.4;
    if (ageMonths > 6) return 0.6;
    return 1;
  }

  bayesianScoring(componentRisks, priors = {}) {
    const p = { ...this.bayesianPriors, ...priors };

    const posteriors = {};
    let weightedSum = 0;
    let weightsSum = 0;

    for (const [component, risk] of Object.entries(componentRisks)) {
      const prior = p[`${component}Prior`] || p.baselineRate;
      const likelihood = risk.score;

      const numerator = likelihood * prior;
      const denominator = (likelihood * prior) + ((1 - likelihood) * (1 - prior));

      const posterior = denominator === 0 ? prior : numerator / denominator;
      posteriors[component] = posterior;

      const weight = this.componentWeights[component] || 0.2;
      weightedSum += posterior * weight;
      weightsSum += weight;
    }

    const bayesianScore = weightsSum === 0 ? p.baselineRate : weightedSum / weightsSum;

    logger.debug('Bayesian scoring complete', {
      posteriors,
      bayesianScore,
      baselineRate: p.baselineRate
    });

    return {
      score: Math.min(bayesianScore, 1),
      posteriors,
      methodology: 'Bayesian'
    };
  }

  logisticRegressionScoring(componentRisks) {
    const features = [];

    for (const [component, risk] of Object.entries(componentRisks)) {
      features.push(risk.score);
    }

    const coefficients = [
      0.8,
      0.7,
      0.5,
      0.45,
      0.75,
      0.3
    ];

    const intercept = -2.0;

    let linearCombination = intercept;
    for (let i = 0; i < Math.min(features.length, coefficients.length); i++) {
      linearCombination += coefficients[i] * features[i];
    }

    const logisticScore = 1 / (1 + Math.exp(-linearCombination));

    logger.debug('Logistic regression scoring complete', {
      linearCombination,
      logisticScore
    });

    return {
      score: Math.min(logisticScore, 1),
      methodology: 'Logistic Regression'
    };
  }

  calculateMfaProbability(componentRisks, method = 'bayesian') {
    if (method === 'logistic') {
      return this.logisticRegressionScoring(componentRisks);
    }

    return this.bayesianScoring(componentRisks);
  }

  calculateWeightedScore(componentRisks) {
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const [component, risk] of Object.entries(componentRisks)) {
      const weight = this.componentWeights[component] || 0.2;
      totalWeightedScore += risk.score * weight;
      totalWeight += weight;
    }

    return totalWeight === 0 ? 0 : totalWeightedScore / totalWeight;
  }

  aggregateRiskScores(data, options = {}) {
    try {
      const method = options.method || 'bayesian';

      const componentRisks = this.calculateComponentRisks(data);

      const mfaResult = this.calculateMfaProbability(componentRisks, method);

      const weightedScore = this.calculateWeightedScore(componentRisks);

      const overallRisk = Math.max(mfaResult.score, weightedScore);

      const result = {
        mfaProbability: mfaResult.score,
        overallRiskScore: overallRisk,
        weightedScore,
        componentRisks,
        methodology: mfaResult.methodology,
        timestamp: new Date().toISOString(),
        scores: {
          behavioral: componentRisks.behavioral.score,
          content: componentRisks.content.score,
          technical: componentRisks.technical.score,
          layout: componentRisks.layout.score,
          gamCorrelation: componentRisks.gamCorrelation.score,
          policy: componentRisks.policy.score
        }
      };

      logger.info('Risk aggregation complete', {
        mfaProbability: result.mfaProbability,
        overallRiskScore: result.overallRiskScore
      });

      return result;
    } catch (error) {
      logger.error('Error aggregating risk scores', error);
      throw error;
    }
  }

  mapScoreToRiskLevel(score) {
    if (score >= 0.8) return 'critical';
    if (score >= 0.6) return 'high';
    if (score >= 0.4) return 'medium';
    if (score >= 0.2) return 'low';
    return 'minimal';
  }
}

module.exports = RiskEngine;
