const logger = require('../logger');

/**
 * ClickbaitPatternDetector - Industry-standard MFA clickbait detection
 * Based on patterns flagged by Google, IAS, DoubleVerify, and TAG guidelines
 */
class ClickbaitPatternDetector {
  constructor(config = {}) {
    // Industry-standard clickbait patterns (MFA indicators)
    this.patterns = {
      // Typography abuse
      allCaps: /\b[A-Z]{4,}\b/g,
      excessivePunctuation: /[!?]{2,}/g,
      ellipsis: /\.{2,}/g,
      questionMarks: /\?{2,}/g,

      // Sensationalism patterns (high MFA correlation)
      sensationalPhrases: /\b(you|I|we|they)\s+(won't|will|never|always|must)\s+(?:believe|see|want|miss|imagine)/gi,
      curiosityGap: /(?:what|how|why|when|where)\s+(?:happened|happens|this|these|nobody|everyone)\s+(?:next|after|will)/gi,
      listicleFormat: /^\s*(?:\d+|top\s+\d+|best\s+\d+|\d+\s+ways|\d+\s+things|\d+\s+reasons)/im,

      // Urgency/scarcity (affiliate/MFA tactics)
      urgencyKeywords: /(?:shocking|explosive|breaking|exclusive|urgent|limited\s+time|act\s+now|don't\s+miss|click\s+here|before\s+it's\s+gone|only\s+today|last\s+chance|hurry|ends\s+soon)/gi,

      // Classic clickbait structures
      clickbaitStructure: /^(?:This|That|This\s+one|Watch\s+this|You\s+won't|Can\s+you|Will\s+you|Should\s+you|What\s+happens|Here's\s+what|Here's\s+why).+[!?]$/im,

      // Fake authority (common in MFA)
      fakeAuthority: /\b(?:doctors|hospitals|scientists|experts|studies|research)\s+(?:hate|don't|won't|reveal|exposed|secret)/gi,

      // Emotional manipulation
      emotionalTriggers: /(?:makes\s+me|angry|disgusted|furious|devastated|ashamed|heartbroken|terrified|outraged|unbelievable)/gi,

      // Identity/Celebrity bait
      celebrityBait: /(?:celebrity|star|famous|millionaire|billionaire)\s+(?:secret|reveals|exposed|shocking)/gi,

      // Vague pronouns (withholding info)
      vaguePronouns: /^(?:This|It|They|He|She|Someone|Something)\s+(?:will|is|was|has|did)\b/im,

      // Superlatives abuse
      superlativeAbuse: /\b(?:most\s+amazing|absolutely\s+incredible|mind-blowing|life-changing|game-changing|world's\s+best|greatest\s+ever)\b/gi,

      // Fear-based (common in health/finance MFA)
      fearBased: /(?:warning|danger|toxic|deadly|risk|mistake|wrong|never\s+do|stop\s+doing|avoid\s+at\s+all\s+costs)/gi,
    };

    // Weights calibrated based on MFA detection research
    this.weights = {
      allCaps: 0.08,
      excessivePunctuation: 0.12,
      ellipsis: 0.08,
      questionMarks: 0.10,
      sensationalPhrases: 0.18,
      curiosityGap: 0.22,
      listicleFormat: 0.15,
      urgencyKeywords: 0.25,
      clickbaitStructure: 0.28,
      fakeAuthority: 0.30,
      emotionalTriggers: 0.20,
      celebrityBait: 0.18,
      vaguePronouns: 0.12,
      superlativeAbuse: 0.15,
      fearBased: 0.22,
    };
  }

  analyze(text, headline = null) {
    try {
      if (!text || typeof text !== 'string') {
        return {
          clickbaitScore: 0,
          isClickbait: false,
          detectedPatterns: [],
          riskLevel: 'none',
          confidence: 0,
        };
      }

      const targetText = headline || text;
      const detectedPatterns = [];
      let totalScore = 0;

      // Helper to check pattern and add to results
      const checkPattern = (name, pattern, weight, displayName) => {
        const matches = targetText.match(pattern) || [];
        if (matches.length > 0) {
          const score = Math.min(1, matches.length / 3) * weight;
          totalScore += score;
          detectedPatterns.push({
            pattern: displayName,
            count: matches.length,
            matches: matches.slice(0, 3),
            score: Math.round(score * 100),
          });
        }
      };

      const checkBoolPattern = (name, pattern, weight, displayName) => {
        if (pattern.test(targetText)) {
          totalScore += weight;
          detectedPatterns.push({
            pattern: displayName,
            count: 1,
            score: Math.round(weight * 100),
          });
        }
      };

      // Typography abuse
      checkPattern('allCaps', this.patterns.allCaps, this.weights.allCaps, 'excessive_capitals');
      checkPattern('excessivePunctuation', this.patterns.excessivePunctuation, this.weights.excessivePunctuation, 'excessive_punctuation');
      checkPattern('ellipsis', this.patterns.ellipsis, this.weights.ellipsis, 'suspicious_ellipsis');
      checkPattern('questionMarks', this.patterns.questionMarks, this.weights.questionMarks, 'excessive_question_marks');

      // Sensationalism
      checkPattern('sensationalPhrases', this.patterns.sensationalPhrases, this.weights.sensationalPhrases, 'sensational_phrases');
      checkPattern('curiosityGap', this.patterns.curiosityGap, this.weights.curiosityGap, 'curiosity_gap');
      checkBoolPattern('listicleFormat', this.patterns.listicleFormat, this.weights.listicleFormat, 'listicle_format');

      // Urgency/clickbait
      checkPattern('urgencyKeywords', this.patterns.urgencyKeywords, this.weights.urgencyKeywords, 'urgency_keywords');
      checkBoolPattern('clickbaitStructure', this.patterns.clickbaitStructure, this.weights.clickbaitStructure, 'clickbait_structure');

      // Authority/credibility abuse
      checkPattern('fakeAuthority', this.patterns.fakeAuthority, this.weights.fakeAuthority, 'fake_authority');

      // Emotional manipulation
      checkPattern('emotionalTriggers', this.patterns.emotionalTriggers, this.weights.emotionalTriggers, 'emotional_triggers');
      checkPattern('celebrityBait', this.patterns.celebrityBait, this.weights.celebrityBait, 'celebrity_bait');

      // Information withholding
      checkBoolPattern('vaguePronouns', this.patterns.vaguePronouns, this.weights.vaguePronouns, 'vague_pronouns');

      // Hyperbole
      checkPattern('superlativeAbuse', this.patterns.superlativeAbuse, this.weights.superlativeAbuse, 'superlative_abuse');

      // Fear tactics
      checkPattern('fearBased', this.patterns.fearBased, this.weights.fearBased, 'fear_based');

      const normalizedScore = Math.min(1, totalScore);
      const riskLevel = this.getRiskLevel(normalizedScore);
      const confidence = this.calculateConfidence(detectedPatterns, targetText.length);

      return {
        clickbaitScore: Math.round(normalizedScore * 1000) / 1000,
        isClickbait: normalizedScore > 0.4, // Lowered threshold for better MFA detection
        detectedPatterns,
        riskLevel,
        confidence: Math.round(confidence * 100),
        mfaIndicator: normalizedScore > 0.35, // Separate MFA flag
      };
    } catch (error) {
      logger.error('Clickbait detection failed', error);
      return {
        clickbaitScore: 0,
        isClickbait: false,
        detectedPatterns: [],
        riskLevel: 'none',
        confidence: 0,
        error: error.message,
      };
    }
  }

  getRiskLevel(score) {
    if (score < 0.3) return 'none';
    if (score < 0.5) return 'low';
    if (score < 0.7) return 'medium';
    if (score < 0.85) return 'high';
    return 'critical';
  }

  calculateConfidence(patterns, textLength) {
    const patternCount = patterns.length;
    const baseConfidence = Math.min(patternCount * 0.15, 0.9);

    if (textLength < 50) {
      return baseConfidence * 0.6;
    }

    if (textLength > 500) {
      return Math.min(baseConfidence + 0.1, 1);
    }

    return baseConfidence;
  }

  async batchAnalyze(texts, headlines = []) {
    return texts.map((text, i) => this.analyze(text, headlines[i] || null));
  }

  mergeResults(text, allMetrics) {
    return {
      clickbaitScore: allMetrics.clickbaitScore,
      isClickbait: allMetrics.isClickbait,
      clickbaitPatterns: allMetrics.detectedPatterns,
      clickbaitRiskLevel: allMetrics.riskLevel,
      mfaIndicator: allMetrics.mfaIndicator,
    };
  }
}

module.exports = ClickbaitPatternDetector;
