const logger = require('../logger');

class AILikelihoodDetector {
  constructor(config = {}) {
    this.entropyThreshold = config.entropyThreshold || 0.35;
    this.patterns = {
      perfectGrammar: /^[^!?]*[.!?]$/gm,
      templatedPhrases: /(?:in conclusion|furthermore|to summarize|it is important to note|as mentioned above|the fact that|the reason is that)/gi,
      formalTransitions: /(?:therefore|moreover|however|nevertheless|thus|hence|consequently)/gi,
      repetitiveStructure: /(.+?)\s+\1{2,}/gi,
      suspiciousPunctuation: /[.!?]{2,}|[^.!?]{30,}[.!?]/gi,
    };
    this.aiIndicators = {
      perfectGrammarWeight: 0.15,
      entropyWeight: 0.3,
      repetitionWeight: 0.2,
      transitionWeight: 0.15,
      structureWeight: 0.2,
    };
  }

  analyze(text, entropyScore = null) {
    try {
      if (!text || typeof text !== 'string' || text.length < 50) {
        return {
          aiLikelihood: 0,
          aiScore: 0,
          indicators: [],
          confidence: 0,
        };
      }

      const indicators = [];
      let totalScore = 0;

      const entropyLikelihood = this.scoreEntropy(entropyScore);
      totalScore += entropyLikelihood * this.aiIndicators.entropyWeight;

      if (entropyLikelihood > 0.7) {
        indicators.push('low_entropy_detected');
      }

      const grammarScore = this.scorePerfectGrammar(text);
      totalScore += grammarScore * this.aiIndicators.perfectGrammarWeight;

      if (grammarScore > 0.6) {
        indicators.push('unnaturally_perfect_grammar');
      }

      const repetitionScore = this.scoreRepetitivePatterns(text);
      totalScore += repetitionScore * this.aiIndicators.repetitionWeight;

      if (repetitionScore > 0.5) {
        indicators.push('excessive_repetition_pattern');
      }

      const transitionScore = this.scoreFormaltransitions(text);
      totalScore += transitionScore * this.aiIndicators.transitionWeight;

      if (transitionScore > 0.6) {
        indicators.push('templated_transitions');
      }

      const structureScore = this.scoreSentenceStructure(text);
      totalScore += structureScore * this.aiIndicators.structureWeight;

      if (structureScore > 0.5) {
        indicators.push('repetitive_sentence_structure');
      }

      const normalizedScore = Math.min(1, totalScore);
      const confidence = this.calculateConfidence(indicators, text.length);

      return {
        aiLikelihood: normalizedScore > 0.6,
        aiScore: Math.round(normalizedScore * 1000) / 1000,
        indicators,
        confidence: Math.round(confidence * 100),
        detailedScores: {
          entropy: Math.round(entropyLikelihood * 100),
          grammar: Math.round(grammarScore * 100),
          repetition: Math.round(repetitionScore * 100),
          transitions: Math.round(transitionScore * 100),
          structure: Math.round(structureScore * 100),
        },
      };
    } catch (error) {
      logger.error('AI likelihood detection failed', error);
      return {
        aiLikelihood: false,
        aiScore: 0,
        indicators: [],
        confidence: 0,
        error: error.message,
      };
    }
  }

  scoreEntropy(entropyScore) {
    if (entropyScore === null || entropyScore === undefined) {
      return 0;
    }

    if (entropyScore < 0.2) return 1;
    if (entropyScore < this.entropyThreshold) return 0.8;
    if (entropyScore < 0.5) return 0.4;
    return 0;
  }

  scorePerfectGrammar(text) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];

    if (sentences.length === 0) return 0;

    let perfectCount = 0;

    for (const sentence of sentences) {
      const trimmed = sentence.trim();

      if (
        trimmed.charAt(0) === trimmed.charAt(0).toUpperCase() &&
        trimmed.match(/^[A-Z][a-z].+[.!?]$/)
      ) {
        perfectCount++;
      }
    }

    return Math.min(1, perfectCount / Math.max(sentences.length, 1));
  }

  scoreRepetitivePatterns(text) {
    const words = text.toLowerCase().split(/\s+/);

    if (words.length < 10) return 0;

    const wordFreq = {};

    for (const word of words) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }

    const frequencies = Object.values(wordFreq).sort((a, b) => b - a);
    const topFreq = frequencies[0] || 0;

    return Math.min(1, topFreq / (words.length * 0.15));
  }

  scoreFormaltransitions(text) {
    const transitionMatches = text.match(this.patterns.formalTransitions) || [];
    const totalWords = text.split(/\s+/).length;

    const transitionDensity = transitionMatches.length / Math.max(totalWords / 50, 1);

    return Math.min(1, transitionDensity * 0.3);
  }

  scoreSentenceStructure(text) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];

    if (sentences.length < 3) return 0;

    const lengths = sentences.map(s => s.split(/\s+/).length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;

    const variance = lengths.reduce((acc, len) => acc + Math.pow(len - avgLength, 2), 0) / lengths.length;

    if (variance < 5) {
      return 0.7;
    }

    if (variance < 15) {
      return 0.4;
    }

    return 0.1;
  }

  calculateConfidence(indicators, textLength) {
    const baseConfidence = Math.min(indicators.length * 0.2, 0.8);

    if (textLength < 200) {
      return baseConfidence * 0.7;
    }

    if (textLength > 1000) {
      return Math.min(baseConfidence + 0.1, 1);
    }

    return baseConfidence;
  }

  async batchAnalyze(texts, entropyScores = []) {
    return texts.map((text, i) => this.analyze(text, entropyScores[i]));
  }

  mergeResults(text, allMetrics) {
    return {
      aiLikelihood: allMetrics.aiLikelihood,
      aiScore: allMetrics.aiScore,
      aiIndicators: allMetrics.indicators,
      aiConfidence: allMetrics.confidence,
    };
  }
}

module.exports = AILikelihoodDetector;
