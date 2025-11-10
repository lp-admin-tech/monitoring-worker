const logger = require('../logger');

class SimHashSimilarityChecker {
  constructor(config = {}) {
    this.hashBits = config.hashBits || 64;
    this.minSimilarity = config.minSimilarity || 0.85;
    this.minTokens = config.minTokens || 5;
  }

  analyze(text) {
    try {
      if (!text || typeof text !== 'string') {
        return {
          simhash: '0'.repeat(this.hashBits),
          tokens: [],
          tokenCount: 0,
        };
      }

      const tokens = this.extractTokens(text);
      const simhash = this.computeSimHash(tokens);

      return {
        simhash,
        tokens: tokens.slice(0, 100),
        tokenCount: tokens.length,
        contentHash: this.simpleHash(text),
      };
    } catch (error) {
      logger.error('SimHash calculation failed', error);
      return {
        simhash: '0'.repeat(this.hashBits),
        tokens: [],
        tokenCount: 0,
        error: error.message,
      };
    }
  }

  extractTokens(text) {
    const cleaned = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2);

    const shingles = [];

    for (let i = 0; i < cleaned.length - 1; i++) {
      shingles.push(`${cleaned[i]} ${cleaned[i + 1]}`);
    }

    return [...new Set(cleaned.concat(shingles))];
  }

  computeSimHash(tokens) {
    if (tokens.length === 0) {
      return '0'.repeat(this.hashBits);
    }

    const vector = new Array(this.hashBits).fill(0);

    for (const token of tokens) {
      const hash = this.hashToken(token);

      for (let i = 0; i < this.hashBits; i++) {
        if ((hash >> i) & 1) {
          vector[i]++;
        } else {
          vector[i]--;
        }
      }
    }

    let simhash = '';

    for (let i = 0; i < this.hashBits; i++) {
      simhash += vector[i] > 0 ? '1' : '0';
    }

    return simhash;
  }

  hashToken(token) {
    let hash = 5381;

    for (let i = 0; i < token.length; i++) {
      hash = ((hash << 5) + hash) ^ token.charCodeAt(i);
    }

    return hash >>> 0;
  }

  simpleHash(text) {
    let hash = 0;

    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }

    return Math.abs(hash).toString(16);
  }

  compareSimHashes(hash1, hash2) {
    if (hash1.length !== hash2.length) {
      return {
        similarity: 0,
        isDuplicate: false,
      };
    }

    let differences = 0;

    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) {
        differences++;
      }
    }

    const similarity = 1 - differences / hash1.length;

    return {
      similarity: Math.round(similarity * 1000) / 1000,
      isDuplicate: similarity >= this.minSimilarity,
      hammingDistance: differences,
    };
  }

  async batchAnalyze(texts) {
    return texts.map(text => this.analyze(text));
  }

  mergeResults(text, allMetrics) {
    return {
      simhashFingerprint: allMetrics.simhash,
      contentHash: allMetrics.contentHash,
      tokenCount: allMetrics.tokenCount,
    };
  }

  findDuplicates(simhash, existingHashes) {
    const duplicates = [];

    for (const [id, existingHash] of Object.entries(existingHashes)) {
      const comparison = this.compareSimHashes(simhash, existingHash);

      if (comparison.isDuplicate) {
        duplicates.push({
          id,
          ...comparison,
        });
      }
    }

    return duplicates;
  }

  hammingDistance(hash1, hash2) {
    if (hash1.length !== hash2.length) {
      return Math.max(hash1.length, hash2.length);
    }

    let distance = 0;

    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) {
        distance++;
      }
    }

    return distance;
  }
}

module.exports = SimHashSimilarityChecker;
