const logger = require('../logger');

class ClickbaitPatternDetector {
  constructor(config = {}) {
    this.patterns = {
      allCaps: /\b[A-Z]{4,}\b/g,
      excessivePunctuation: /[!?]{2,}/g,
      sensationalNumbers: /\b(you|I|we|they)\s+(won't|will|never|always|must)\s+(?:believe|see|want|miss|imagine)/gi,
      urgencyKeywords: /(?:shocking|explosive|breaking|exclusive|urgent|limited\s+time|act\s+now|don't\s+miss|click\s+here|before\s+it's\s+gone|only\s+today)/gi,
      clickbaitStructure: /^(?:This|That|This\s+one|Watch\s+this|You\s+won't|Can\s+you|Will\s+you|Should\s+you).+[!?]$/i,
      ellipsis: /\.{2,}/g,
      questionMarks: /\?{2,}/g,
      fakeNumbers: /\b(?:doctors|hospitals|scientists)\s+(?:hate|don't|don't\s+want|won't)/gi,
      emotionalTriggers: /(?:makes\s+me|angry|disgusted|furious|devastated|ashamed|heartbroken)/gi,
    };
    this.weights = {
      allCaps: 0.1,
      excessivePunctuation: 0.15,
      sensationalNumbers: 0.2,
      urgencyKeywords: 0.25,
      clickbaitStructure: 0.3,
      ellipsis: 0.1,
      questionMarks: 0.15,
      fakeNumbers: 0.3,
      emotionalTriggers: 0.25,
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

      const allCapsCount = (targetText.match(this.patterns.allCaps) || []).length;
      if (allCapsCount > 0) {
        const score = Math.min(1, allCapsCount / 5) * this.weights.allCaps;
        totalScore += score;
        detectedPatterns.push({
          pattern: 'excessive_capitals',
          count: allCapsCount,
          score: Math.round(score * 100),
        });
      }

      const excessivePunctuation = (targetText.match(this.patterns.excessivePunctuation) || []).length;
      if (excessivePunctuation > 0) {
        const score = Math.min(1, excessivePunctuation * 0.3) * this.weights.excessivePunctuation;
        totalScore += score;
        detectedPatterns.push({
          pattern: 'excessive_punctuation',
          count: excessivePunctuation,
          score: Math.round(score * 100),
        });
      }

      const sensationalMatches = targetText.match(this.patterns.sensationalNumbers) || [];
      if (sensationalMatches.length > 0) {
        const score = Math.min(1, sensationalMatches.length / 3) * this.weights.sensationalNumbers;
        totalScore += score;
        detectedPatterns.push({
          pattern: 'sensational_numbers',
          count: sensationalMatches.length,
          score: Math.round(score * 100),
        });
      }

      const urgencyMatches = targetText.match(this.patterns.urgencyKeywords) || [];
      if (urgencyMatches.length > 0) {
        const score = Math.min(1, urgencyMatches.length / 2) * this.weights.urgencyKeywords;
        totalScore += score;
        detectedPatterns.push({
          pattern: 'urgency_keywords',
          count: urgencyMatches.length,
          matches: urgencyMatches.slice(0, 3),
          score: Math.round(score * 100),
        });
      }

      if (this.patterns.clickbaitStructure.test(headline || text)) {
        const score = this.weights.clickbaitStructure;
        totalScore += score;
        detectedPatterns.push({
          pattern: 'clickbait_structure',
          count: 1,
          score: Math.round(score * 100),
        });
      }

      const ellipsisCount = (targetText.match(this.patterns.ellipsis) || []).length;
      if (ellipsisCount > 0) {
        const score = Math.min(1, ellipsisCount * 0.1) * this.weights.ellipsis;
        totalScore += score;
        detectedPatterns.push({
          pattern: 'suspicious_ellipsis',
          count: ellipsisCount,
          score: Math.round(score * 100),
        });
      }

      const questionMarksCount = (targetText.match(this.patterns.questionMarks) || []).length;
      if (questionMarksCount > 0) {
        const score = Math.min(1, questionMarksCount * 0.2) * this.weights.questionMarks;
        totalScore += score;
        detectedPatterns.push({
          pattern: 'excessive_question_marks',
          count: questionMarksCount,
          score: Math.round(score * 100),
        });
      }

      const fakeNumberMatches = targetText.match(this.patterns.fakeNumbers) || [];
      if (fakeNumberMatches.length > 0) {
        const score = Math.min(1, fakeNumberMatches.length) * this.weights.fakeNumbers;
        totalScore += score;
        detectedPatterns.push({
          pattern: 'fake_numbers',
          count: fakeNumberMatches.length,
          score: Math.round(score * 100),
        });
      }

      const emotionalMatches = targetText.match(this.patterns.emotionalTriggers) || [];
      if (emotionalMatches.length > 0) {
        const score = Math.min(1, emotionalMatches.length / 2) * this.weights.emotionalTriggers;
        totalScore += score;
        detectedPatterns.push({
          pattern: 'emotional_triggers',
          count: emotionalMatches.length,
          matches: emotionalMatches.slice(0, 2),
          score: Math.round(score * 100),
        });
      }

      const normalizedScore = Math.min(1, totalScore);
      const riskLevel = this.getRiskLevel(normalizedScore);
      const confidence = this.calculateConfidence(detectedPatterns, targetText.length);

      return {
        clickbaitScore: Math.round(normalizedScore * 1000) / 1000,
        isClickbait: normalizedScore > 0.5,
        detectedPatterns,
        riskLevel,
        confidence: Math.round(confidence * 100),
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
    };
  }
}

module.exports = ClickbaitPatternDetector;
