const logger = require('../logger');

class ReadabilityScorer {
  constructor(config = {}) {
    this.gradeThresholds = config.gradeThresholds || {
      elementary: 6,
      middle: 9,
      high: 13,
      college: 16,
    };
  }

  analyze(text) {
    try {
      if (!text || typeof text !== 'string' || text.length < 100) {
        return {
          fleschKincaidGrade: 0,
          fleschReadingEase: 100,
          averageSentenceLength: 0,
          averageWordLength: 0,
          syllableCount: 0,
          wordCount: 0,
          sentenceCount: 0,
          readabilityLevel: 'unknown',
          humanAuthorship: {
            likelyHuman: true,
            confidence: 100,
            indicators: {}
          }
        };
      }

      const sentences = this.extractSentences(text);
      const words = this.extractWords(text);

      if (words.length === 0 || sentences.length === 0) {
        return {
          fleschKincaidGrade: 0,
          fleschReadingEase: 100,
          averageSentenceLength: 0,
          averageWordLength: 0,
          syllableCount: 0,
          wordCount: 0,
          sentenceCount: 0,
          readabilityLevel: 'unknown',
          humanAuthorship: {
            likelyHuman: true,
            confidence: 100,
            indicators: {}
          }
        };
      }

      const syllableCount = words.reduce((acc, word) => acc + this.countSyllables(word), 0);
      const fleschKincaidGrade = this.calculateFleschKincaidGrade(words.length, sentences.length, syllableCount);
      const fleschReadingEase = this.calculateFleschReadingEase(words.length, sentences.length, syllableCount);

      return {
        fleschKincaidGrade: Math.max(0, Math.round(fleschKincaidGrade * 10) / 10),
        fleschReadingEase: Math.round(fleschReadingEase * 10) / 10,
        averageSentenceLength: Math.round((words.length / sentences.length) * 10) / 10,
        averageWordLength: Math.round((text.length / words.length) * 10) / 10,
        syllableCount,
        wordCount: words.length,
        sentenceCount: sentences.length,
        readabilityLevel: this.getReadabilityLevel(fleschKincaidGrade),
        humanAuthorship: this.assessHumanAuthorship(fleschKincaidGrade, fleschReadingEase, words),
      };
    } catch (error) {
      logger.error('Readability calculation failed', error);
      return {
        fleschKincaidGrade: 0,
        fleschReadingEase: 100,
        averageSentenceLength: 0,
        averageWordLength: 0,
        syllableCount: 0,
        wordCount: 0,
        sentenceCount: 0,
        readabilityLevel: 'unknown',
        humanAuthorship: {
          likelyHuman: true,
          confidence: 100,
          indicators: {}
        },
        error: error.message,
      };
    }
  }

  extractSentences(text) {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [];
    return sentences.filter(s => s.trim().length > 0);
  }

  extractWords(text) {
    const cleaned = text.toLowerCase().replace(/[^\w\s]/g, ' ');
    return cleaned.split(/\s+/).filter(word => word.length > 0);
  }

  countSyllables(word) {
    const cleaned = word.toLowerCase();
    let syllableCount = 0;
    let previousWasVowel = false;

    const vowels = 'aeiouy';

    for (let i = 0; i < cleaned.length; i++) {
      const isVowel = vowels.includes(cleaned[i]);

      if (isVowel && !previousWasVowel) {
        syllableCount++;
      }

      previousWasVowel = isVowel;
    }

    if (cleaned.endsWith('e')) {
      syllableCount--;
    }

    if (cleaned.endsWith('le') && cleaned.length > 2 && !vowels.includes(cleaned[cleaned.length - 3])) {
      syllableCount++;
    }

    return Math.max(1, syllableCount);
  }

  calculateFleschKincaidGrade(wordCount, sentenceCount, syllableCount) {
    const grade = (0.39 * (wordCount / sentenceCount)) + (11.8 * (syllableCount / wordCount)) - 15.59;
    return Math.max(0, grade);
  }

  calculateFleschReadingEase(wordCount, sentenceCount, syllableCount) {
    const ease = 206.835 - (1.015 * (wordCount / sentenceCount)) - (84.6 * (syllableCount / wordCount));
    return Math.min(100, Math.max(0, ease));
  }

  getReadabilityLevel(grade) {
    if (grade < this.gradeThresholds.elementary) {
      return 'very_easy';
    }

    if (grade < this.gradeThresholds.middle) {
      return 'easy';
    }

    if (grade < this.gradeThresholds.high) {
      return 'moderate';
    }

    if (grade < this.gradeThresholds.college) {
      return 'difficult';
    }

    return 'very_difficult';
  }

  assessHumanAuthorship(grade, ease, words) {
    const indicators = {
      hasNaturalVariation: this.checkNaturalVariation(words),
      hasComplexSentences: grade > 10,
      hasVariableSyllables: this.checkVariableSyllables(words),
    };

    const humanTraits = Object.values(indicators).filter(v => v).length;
    const confidence = Math.round((humanTraits / 3) * 100);

    return {
      likelyHuman: confidence > 60,
      confidence,
      indicators,
    };
  }

  checkNaturalVariation(words) {
    if (words.length < 20) return false;

    const wordLengths = words.map(w => w.length);
    const avgLength = wordLengths.reduce((a, b) => a + b, 0) / wordLengths.length;
    const variance = wordLengths.reduce((acc, len) => acc + Math.pow(len - avgLength, 2), 0) / wordLengths.length;

    return variance > 2;
  }

  checkVariableSyllables(words) {
    if (words.length < 20) return false;

    const syllables = words.map(w => this.countSyllables(w));
    const avgSyllables = syllables.reduce((a, b) => a + b, 0) / syllables.length;
    const variance = syllables.reduce((acc, syl) => acc + Math.pow(syl - avgSyllables, 2), 0) / syllables.length;

    return variance > 0.5;
  }

  async batchAnalyze(texts) {
    return texts.map(text => this.analyze(text));
  }

  mergeResults(text, allMetrics) {
    return {
      readabilityScore: allMetrics.fleschReadingEase,
      gradeLevel: allMetrics.fleschKincaidGrade,
      readabilityLevel: allMetrics.readabilityLevel,
      humanAuthorshipLikelihood: allMetrics.humanAuthorship?.likelyHuman ?? false,
    };
  }
}

module.exports = ReadabilityScorer;
