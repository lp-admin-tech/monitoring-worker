const logger = require('../logger');
const ShannonEntropyCalculator = require('./entropy');
const SimHashSimilarityChecker = require('./similarity');
const ReadabilityScorer = require('./readability');
const AILikelihoodDetector = require('./ai-likelihood');
const ClickbaitPatternDetector = require('./clickbait-detector');
const FreshnessAnalyzer = require('./freshness');
const TextUtils = require('./utils');

class ContentAnalyzer {
  constructor(config = {}) {
    this.entropy = new ShannonEntropyCalculator(config.entropy);
    this.similarity = new SimHashSimilarityChecker(config.similarity);
    this.readability = new ReadabilityScorer(config.readability);
    this.aiDetector = new AILikelihoodDetector(config.aiDetector);
    this.clickbaitDetector = new ClickbaitPatternDetector(config.clickbait);
    this.freshness = new FreshnessAnalyzer(config.freshness);
    this.config = config;
  }

  async analyzeContent(text, options = {}) {
    try {
      if (!text || typeof text !== 'string' || text.length === 0) {
        logger.warn('Content analyzer received empty or invalid text input');
        return this.getEmptyAnalysis();
      }

      logger.info(`Starting content analysis for ${text.length} character text`);

      const entropyMetrics = this.entropy.analyze(text);
      logger.debug('Entropy analysis complete', entropyMetrics);

      const similarityMetrics = this.similarity.analyze(text);
      logger.debug('Similarity analysis complete', similarityMetrics);

      const readabilityMetrics = this.readability.analyze(text);
      logger.debug('Readability analysis complete', readabilityMetrics);

      const aiMetrics = this.aiDetector.analyze(text, entropyMetrics.entropyScore);
      logger.debug('AI likelihood analysis complete', aiMetrics);

      const clickbaitMetrics = this.clickbaitDetector.analyze(text, options.headline);
      logger.debug('Clickbait analysis complete', clickbaitMetrics);

      const freshnessMetrics = this.freshness.analyze(text, options.metadata);
      logger.debug('Freshness analysis complete', freshnessMetrics);

      if (this.validateMetrics({
        entropy: entropyMetrics,
        similarity: similarityMetrics,
        readability: readabilityMetrics,
        ai: aiMetrics,
        clickbait: clickbaitMetrics,
        freshness: freshnessMetrics,
      })) {
        logger.warn('All metrics returned zero or null values. Content extraction may have failed.');
      }

      const linguisticFingerprint = this.aggregateResults(text, {
        entropy: entropyMetrics,
        similarity: similarityMetrics,
        readability: readabilityMetrics,
        ai: aiMetrics,
        clickbait: clickbaitMetrics,
        freshness: freshnessMetrics,
      });

      logger.info('Content analysis complete', {
        textLength: text.length,
        aiLikelihood: aiMetrics.aiLikelihood,
        clickbaitScore: clickbaitMetrics.clickbaitScore,
        freshnessLevel: freshnessMetrics.freshness,
      });

      return linguisticFingerprint;
    } catch (error) {
      logger.error('Content analysis failed', error);
      return {
        error: error.message,
        status: 'analysis_failed',
      };
    }
  }

  validateMetrics(metrics) {
    const metricsAreEmpty = Object.values(metrics).every(metric => {
      if (!metric || typeof metric !== 'object') return true;

      return Object.values(metric).every(value =>
        value === 0 || value === false || value === null || value === undefined || value === ''
      );
    });

    return metricsAreEmpty;
  }

  async analyzeMultiplePages(pages) {
    try {
      const results = [];

      for (const page of pages) {
        const result = await this.analyzeContent(page.content, {
          headline: page.headline,
          metadata: page.metadata,
        });

        results.push({
          pageUrl: page.url,
          pageTitle: page.title,
          analysis: result,
        });
      }

      return {
        status: 'success',
        pageCount: results.length,
        pages: results,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Multi-page analysis failed', error);
      return {
        error: error.message,
        status: 'analysis_failed',
      };
    }
  }

  aggregateResults(text, metrics) {
    // NEW: Thin content detection
    const thinContent = this.detectThinContent(text, metrics);

    // NEW: Content quality score
    const contentQualityScore = this.calculateContentQualityScore(metrics, thinContent);

    const fingerprint = {
      textLength: text.length,
      analysisTimestamp: new Date().toISOString(),
      entropy: this.entropy.mergeResults(text, metrics.entropy),
      similarity: this.similarity.mergeResults(text, metrics.similarity),
      readability: this.readability.mergeResults(text, metrics.readability),
      ai: this.aiDetector.mergeResults(text, metrics.ai),
      clickbait: this.clickbaitDetector.mergeResults(text, metrics.clickbait),
      freshness: this.freshness.mergeResults(text, metrics.freshness),
      riskAssessment: this.calculateRiskAssessment(metrics),
      flagStatus: this.determineFlagStatus(metrics),
      // NEW: ML-ready metrics
      thinContent,
      wordDiversity: metrics.entropy.wordDiversity || {},
      contentQualityScore,
    };

    return fingerprint;
  }

  calculateRiskAssessment(metrics) {
    const risks = [];
    let riskScore = 0;

    if (metrics.ai.aiLikelihood) {
      risks.push('ai_generated_content');
      riskScore += 0.3;
    }

    if (metrics.entropy.isLowEntropy) {
      risks.push('low_entropy_detected');
      riskScore += 0.2;
    }

    if (metrics.clickbait.isClickbait) {
      risks.push('clickbait_detected');
      riskScore += 0.2;
    }

    if (metrics.similarity.tokenCount < 20) {
      risks.push('insufficient_content_tokens');
      riskScore += 0.1;
    }

    if (metrics.freshness.staleness > 180) {
      risks.push('stale_content');
      riskScore += 0.15;
    }

    const readabilityLevel = metrics.readability.readabilityLevel;
    if (readabilityLevel === 'very_easy') {
      risks.push('suspiciously_simple_text');
      riskScore += 0.1;
    }

    return {
      detectedRisks: risks,
      totalRiskScore: Math.round(riskScore * 1000) / 1000,
      riskLevel: this.getRiskLevel(riskScore),
      recommendedAction: this.getRecommendedAction(riskScore, risks),
    };
  }

  getRiskLevel(score) {
    if (score < 0.2) return 'low';
    if (score < 0.4) return 'medium';
    if (score < 0.6) return 'high';
    return 'critical';
  }

  getRecommendedAction(score, risks) {
    if (score < 0.2) {
      return 'auto_approve';
    }

    if (score < 0.4) {
      return 'review_recommended';
    }

    if (score < 0.6) {
      return 'manual_review_required';
    }

    return 'flag_for_escalation';
  }

  determineFlagStatus(metrics) {
    if (metrics.ai.aiLikelihood) {
      return 'ai_generated';
    }

    if (metrics.similarity.tokenCount > 50 && metrics.entropy.isLowEntropy) {
      return 'potential_duplicate';
    }

    if (metrics.clickbait.isClickbait) {
      return 'clickbait_detected';
    }

    if (metrics.freshness.staleness > 180) {
      return 'stale_content';
    }

    return 'clean';
  }

  compareWithPrevious(currentFingerprint, previousFingerprint) {
    if (!previousFingerprint) {
      return {
        isNew: true,
        changes: [],
      };
    }

    const changes = [];

    if (currentFingerprint.entropy.entropyScore !== previousFingerprint.entropy?.entropyScore) {
      changes.push('entropy_changed');
    }

    if (currentFingerprint.similarity.simhashFingerprint !== previousFingerprint.similarity?.simhashFingerprint) {
      changes.push('content_changed');
    }

    if (currentFingerprint.readability.readabilityScore !== previousFingerprint.readability?.readabilityScore) {
      changes.push('readability_changed');
    }

    if (currentFingerprint.freshness.daysOld !== previousFingerprint.freshness?.daysOld) {
      changes.push('staleness_changed');
    }

    return {
      isNew: false,
      changes,
      contentModified: changes.includes('content_changed'),
      riskIncreased: currentFingerprint.riskAssessment.totalRiskScore > (previousFingerprint.riskAssessment?.totalRiskScore || 0),
    };
  }

  getEmptyAnalysis() {
    return {
      textLength: 0,
      analysisTimestamp: new Date().toISOString(),
      entropy: { entropyScore: 0, isLowEntropy: false, contentLength: 0, flagStatus: 'clean' },
      similarity: { simhashFingerprint: '', contentHash: '', tokenCount: 0 },
      readability: {
        readabilityScore: 100,
        gradeLevel: 0,
        readabilityLevel: 'unknown',
        humanAuthorshipLikelihood: true,
      },
      ai: {
        aiLikelihood: false,
        aiScore: 0,
        aiIndicators: [],
        aiConfidence: 0,
      },
      clickbait: {
        clickbaitScore: 0,
        isClickbait: false,
        clickbaitPatterns: [],
        clickbaitRiskLevel: 'none',
      },
      freshness: {
        contentFreshness: 'unknown',
        daysOld: null,
        lastUpdatedDate: null,
        stalenessIndicator: false,
      },
      riskAssessment: {
        detectedRisks: [],
        totalRiskScore: 0,
        riskLevel: 'low',
        recommendedAction: 'auto_approve',
      },
      flagStatus: 'clean',
      // NEW: ML-ready metrics
      thinContent: {
        wordCount: 0,
        uniqueWords: 0,
        uniqueWordRatio: 0,
        isThin: true,
        isVeryThin: true,
        isMfaThinContent: true,
        severity: 'critical',
      },
      wordDiversity: {
        uniqueWords: 0,
        totalWords: 0,
        typeTokenRatio: 0,
        vocabularyRichness: 0,
        isLowDiversity: true,
      },
      contentQualityScore: {
        overall: 0,
        qualityLevel: 'low',
        isMfaRisk: true,
      },
    };
  }

  // NEW: Detect thin/low-value content (major MFA indicator)
  detectThinContent(text, metrics) {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    const uniqueWords = new Set(words.map(w => w.toLowerCase())).size;
    const uniqueWordRatio = wordCount > 0 ? uniqueWords / wordCount : 0;

    // Thresholds based on industry standards
    const THIN_WORD_COUNT = 300;
    const VERY_THIN_WORD_COUNT = 100;
    const LOW_UNIQUE_RATIO = 0.3;

    const isThin = wordCount < THIN_WORD_COUNT;
    const isVeryThin = wordCount < VERY_THIN_WORD_COUNT;
    const hasLowDiversity = uniqueWordRatio < LOW_UNIQUE_RATIO;

    return {
      wordCount,
      uniqueWords,
      uniqueWordRatio: Math.round(uniqueWordRatio * 1000) / 1000,
      isThin,
      isVeryThin,
      hasLowDiversity,
      // Combined thin content flag
      isMfaThinContent: isVeryThin || (isThin && hasLowDiversity),
      severity: isVeryThin ? 'critical' : (isThin ? 'warning' : 'normal'),
    };
  }

  // NEW: Aggregate content quality score (0-1, higher = better)
  calculateContentQualityScore(metrics, thinContent) {
    const weights = {
      depth: 0.25,         // Word count & complexity
      originality: 0.30,   // Entropy & AI likelihood
      readability: 0.20,   // Readability level
      engagement: 0.15,    // Not clickbait
      freshness: 0.10,     // Content freshness
    };

    // Depth score (based on word count)
    const wordCount = thinContent?.wordCount || 0;
    const depthScore = Math.min(1, wordCount / 800); // 800+ words = max score

    // Originality score (high entropy, low AI likelihood)
    const entropyScore = metrics.entropy?.entropyScore || 0;
    const aiScore = metrics.ai?.aiScore || 0;
    const originalityScore = Math.max(0, (entropyScore - aiScore) * 0.5 + 0.5);

    // Readability score (moderate is best)
    const readabilityLevel = metrics.readability?.readabilityLevel || 'unknown';
    const readabilityScoreMap = {
      'very_easy': 0.4,    // Too simple = suspicious
      'easy': 0.7,
      'moderate': 1.0,     // Ideal
      'difficult': 0.8,
      'very_difficult': 0.5,
      'unknown': 0.5,
    };
    const readabilityScore = readabilityScoreMap[readabilityLevel] || 0.5;

    // Engagement score (not clickbait)
    const clickbaitScore = metrics.clickbait?.clickbaitScore || 0;
    const engagementScore = Math.max(0, 1 - clickbaitScore);

    // Freshness score
    const staleness = metrics.freshness?.staleness || 0;
    const freshnessScore = Math.max(0, 1 - (staleness / 365));

    // Weighted average
    const overall = (
      (depthScore * weights.depth) +
      (originalityScore * weights.originality) +
      (readabilityScore * weights.readability) +
      (engagementScore * weights.engagement) +
      (freshnessScore * weights.freshness)
    );

    return {
      overall: Math.round(overall * 1000) / 1000,
      components: {
        depth: Math.round(depthScore * 100),
        originality: Math.round(originalityScore * 100),
        readability: Math.round(readabilityScore * 100),
        engagement: Math.round(engagementScore * 100),
        freshness: Math.round(freshnessScore * 100),
      },
      qualityLevel: overall >= 0.7 ? 'high' : (overall >= 0.4 ? 'medium' : 'low'),
      isMfaRisk: overall < 0.35,
    };
  }
}

module.exports = ContentAnalyzer;

module.exports.ShannonEntropyCalculator = ShannonEntropyCalculator;
module.exports.SimHashSimilarityChecker = SimHashSimilarityChecker;
module.exports.ReadabilityScorer = ReadabilityScorer;
module.exports.AILikelihoodDetector = AILikelihoodDetector;
module.exports.ClickbaitPatternDetector = ClickbaitPatternDetector;
module.exports.FreshnessAnalyzer = FreshnessAnalyzer;
module.exports.TextUtils = TextUtils;

module.exports.createContentAnalyzer = (config = {}) => {
  return new ContentAnalyzer(config);
};

module.exports.createEntropyCalculator = (config = {}) => {
  return new ShannonEntropyCalculator(config);
};

module.exports.createSimilarityChecker = (config = {}) => {
  return new SimHashSimilarityChecker(config);
};

module.exports.createReadabilityScorer = (config = {}) => {
  return new ReadabilityScorer(config);
};

module.exports.createAIDetector = (config = {}) => {
  return new AILikelihoodDetector(config);
};

module.exports.createClickbaitDetector = (config = {}) => {
  return new ClickbaitPatternDetector(config);
};

module.exports.createFreshnessAnalyzer = (config = {}) => {
  return new FreshnessAnalyzer(config);
};
