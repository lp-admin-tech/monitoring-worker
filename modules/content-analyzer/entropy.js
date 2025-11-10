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
        };
      }

      const cleanedText = text.toLowerCase().replace(/\s+/g, ' ').trim();
      const entropy = this.calculateShannon(cleanedText);
      const isLowEntropy = entropy < this.lowEntropyThreshold;

      return {
        entropyScore: Math.round(entropy * 1000) / 1000,
        isLowEntropy,
        textLength: cleanedText.length,
        uniqueCharacters: new Set(cleanedText).size,
        characterFrequency: this.getCharacterFrequency(cleanedText),
        riskIndicators: this.identifyRiskIndicators(entropy, cleanedText),
      };
    } catch (error) {
      logger.error('Entropy calculation failed', error);
      return {
        entropyScore: 0,
        isLowEntropy: false,
        textLength: text ? text.length : 0,
        uniqueCharacters: 0,
        characterFrequency: {},
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
}

module.exports = ShannonEntropyCalculator;
