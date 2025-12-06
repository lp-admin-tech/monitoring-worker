const logger = require('../logger');

class ShannonEntropyCalculator {
  constructor(config = {}) {
    this.minLength = config.minLength || 10;
    this.lowEntropyThreshold = config.lowEntropyThreshold || 0.35;
  }

  analyze(text) {
    try {
      if (!text || typeof text !== 'string' || text.length < this.minLength) {
        return {
          entropyScore: 0,
          isLowEntropy: false,
          textLength: text ? text.length : 0,
          uniqueCharacters: 0,
          characterFrequency: {},
          wordDiversity: this.getEmptyWordDiversity(),
        };
      }

      const cleanedText = text.toLowerCase().replace(/\s+/g, ' ').trim();
      const entropy = this.calculateShannon(cleanedText);
      const isLowEntropy = entropy < this.lowEntropyThreshold;

      // NEW: Word-level diversity analysis
      const wordDiversity = this.analyzeWordDiversity(cleanedText);

      return {
        entropyScore: Math.round(entropy * 1000) / 1000,
        isLowEntropy,
        textLength: cleanedText.length,
        uniqueCharacters: new Set(cleanedText).size,
        characterFrequency: this.getCharacterFrequency(cleanedText),
        riskIndicators: this.identifyRiskIndicators(entropy, cleanedText),
        // NEW: Word-level diversity metrics
        wordDiversity,
      };
    } catch (error) {
      logger.error('Entropy calculation failed', error);
      return {
        entropyScore: 0,
        isLowEntropy: false,
        textLength: text ? text.length : 0,
        uniqueCharacters: 0,
        characterFrequency: {},
        wordDiversity: this.getEmptyWordDiversity(),
        error: error.message,
      };
    }
  }

  calculateShannon(text) {
    const frequencies = {};
    let entropy = 0;

    for (const char of text) {
      frequencies[char] = (frequencies[char] || 0) + 1;
    }

    const textLength = text.length;

    for (const char in frequencies) {
      const probability = frequencies[char] / textLength;
      entropy -= probability * Math.log2(probability);
    }

    const maxEntropy = Math.log2(Math.min(text.length, 256));
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
  }

  getCharacterFrequency(text) {
    const frequency = {};

    for (const char of text) {
      frequency[char] = (frequency[char] || 0) + 1;
    }

    const sorted = Object.entries(frequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20);

    return Object.fromEntries(sorted);
  }

  identifyRiskIndicators(entropy, text) {
    const indicators = [];

    if (entropy < 0.3) {
      indicators.push('extremely_low_entropy');
    } else if (entropy < this.lowEntropyThreshold) {
      indicators.push('low_entropy_ai_generated');
    }

    if (text.match(/(.{1,5})\1{4,}/gi)) {
      indicators.push('excessive_repetition');
    }

    if (text.split(' ').length < text.length / 20) {
      indicators.push('very_short_content');
    }

    if (/[!?]{2,}/g.test(text)) {
      indicators.push('excessive_punctuation');
    }

    return indicators;
  }

  async batchAnalyze(texts) {
    return texts.map(text => this.analyze(text));
  }

  mergeResults(text, allMetrics) {
    return {
      entropyScore: allMetrics.entropyScore,
      isLowEntropy: allMetrics.isLowEntropy,
      contentLength: allMetrics.textLength,
      flagStatus: this.determineFlagStatus(allMetrics),
    };
  }

  determineFlagStatus(metrics) {
    if (metrics.isLowEntropy) {
      return 'low_entropy';
    }
    return 'clean';
  }

  // NEW: Word-level diversity analysis for ML training
  analyzeWordDiversity(text) {
    const words = text.split(/\s+/).filter(w => w.length > 0);

    if (words.length < 10) {
      return this.getEmptyWordDiversity();
    }

    const wordFrequency = {};
    for (const word of words) {
      wordFrequency[word] = (wordFrequency[word] || 0) + 1;
    }

    const uniqueWords = Object.keys(wordFrequency).length;
    const totalWords = words.length;

    // Type-Token Ratio (TTR) - higher = more diverse vocabulary
    const typeTokenRatio = uniqueWords / totalWords;

    // Hapax Legomena - words appearing only once (indicator of natural writing)
    const hapaxLegomena = Object.values(wordFrequency).filter(count => count === 1).length;
    const hapaxRatio = hapaxLegomena / totalWords;

    // Vocabulary Richness Score (0-1)
    // Combines TTR and hapax ratio with normalization
    const vocabularyRichness = Math.min(1, (typeTokenRatio * 0.6) + (hapaxRatio * 0.4));

    // Detect repetitive patterns (MFA indicator)
    const topWord = Object.entries(wordFrequency).sort((a, b) => b[1] - a[1])[0];
    const dominantWordRatio = topWord ? topWord[1] / totalWords : 0;

    return {
      uniqueWords,
      totalWords,
      typeTokenRatio: Math.round(typeTokenRatio * 1000) / 1000,
      hapaxLegomena,
      hapaxRatio: Math.round(hapaxRatio * 1000) / 1000,
      vocabularyRichness: Math.round(vocabularyRichness * 1000) / 1000,
      dominantWordRatio: Math.round(dominantWordRatio * 1000) / 1000,
      isLowDiversity: typeTokenRatio < 0.3 || vocabularyRichness < 0.25,
    };
  }

  getEmptyWordDiversity() {
    return {
      uniqueWords: 0,
      totalWords: 0,
      typeTokenRatio: 0,
      hapaxLegomena: 0,
      hapaxRatio: 0,
      vocabularyRichness: 0,
      dominantWordRatio: 0,
      isLowDiversity: false,
    };
  }
}

module.exports = ShannonEntropyCalculator;
