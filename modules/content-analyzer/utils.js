const logger = require('../logger');

class TextUtils {
  static normalizeText(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  static extractTokens(text, minLength = 2) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    const cleaned = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > minLength);

    return cleaned;
  }

  static extractSentences(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    const cleaned = text.replace(/\s+/g, ' ').trim();
    const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [];
    return sentences.filter(s => s.trim().length > 0);
  }

  static extractWords(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    const cleaned = text.toLowerCase().replace(/[^\w\s]/g, ' ');
    return cleaned.split(/\s+/).filter(word => word.length > 0);
  }

  static getCharacterFrequency(text, limit = 20) {
    if (!text || typeof text !== 'string') {
      return {};
    }

    const frequency = {};

    for (const char of text) {
      frequency[char] = (frequency[char] || 0) + 1;
    }

    const sorted = Object.entries(frequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit);

    return Object.fromEntries(sorted);
  }

  static calculateMean(values) {
    if (!Array.isArray(values) || values.length === 0) {
      return 0;
    }

    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  static calculateVariance(values, mean = null) {
    if (!Array.isArray(values) || values.length === 0) {
      return 0;
    }

    const avgValue = mean !== null ? mean : this.calculateMean(values);
    return values.reduce((acc, val) => acc + Math.pow(val - avgValue, 2), 0) / values.length;
  }

  static calculateStandardDeviation(values) {
    return Math.sqrt(this.calculateVariance(values));
  }

  static parseDate(dateString) {
    if (!dateString) {
      return null;
    }

    if (dateString instanceof Date) {
      return dateString;
    }

    const relativeMatch = dateString.match(/(\d+)\s+(\w+)\s+ago/i);
    if (relativeMatch) {
      const amount = parseInt(relativeMatch[1]);
      const unit = relativeMatch[2].toLowerCase();

      const now = new Date();
      const date = new Date(now);

      if (unit.startsWith('second')) {
        date.setSeconds(date.getSeconds() - amount);
      } else if (unit.startsWith('minute')) {
        date.setMinutes(date.getMinutes() - amount);
      } else if (unit.startsWith('hour')) {
        date.setHours(date.getHours() - amount);
      } else if (unit.startsWith('day')) {
        date.setDate(date.getDate() - amount);
      } else if (unit.startsWith('week')) {
        date.setDate(date.getDate() - amount * 7);
      } else if (unit.startsWith('month')) {
        date.setMonth(date.getMonth() - amount);
      } else if (unit.startsWith('year')) {
        date.setFullYear(date.getFullYear() - amount);
      }

      return date;
    }

    const parsed = new Date(dateString);
    return !isNaN(parsed.getTime()) ? parsed : null;
  }

  static calculateDaysOld(date) {
    if (!date) {
      return null;
    }

    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  static validateText(text, minLength = 10) {
    if (!text || typeof text !== 'string') {
      return false;
    }

    return text.trim().length >= minLength;
  }

  static truncateText(text, maxLength = 1000) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    if (text.length <= maxLength) {
      return text;
    }

    return text.substring(0, maxLength) + '...';
  }

  static simpleHash(text) {
    if (!text || typeof text !== 'string') {
      return '0';
    }

    let hash = 0;

    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }

    return Math.abs(hash).toString(16);
  }

  static hammingDistance(string1, string2) {
    if (string1.length !== string2.length) {
      return Math.max(string1.length, string2.length);
    }

    let distance = 0;

    for (let i = 0; i < string1.length; i++) {
      if (string1[i] !== string2[i]) {
        distance++;
      }
    }

    return distance;
  }

  static calculateSimilarity(string1, string2) {
    const distance = this.hammingDistance(string1, string2);
    const maxLength = Math.max(string1.length, string2.length);

    if (maxLength === 0) {
      return 1.0;
    }

    return 1 - distance / maxLength;
  }

  static wordFrequency(text) {
    if (!text || typeof text !== 'string') {
      return {};
    }

    const words = this.extractWords(text);
    const frequency = {};

    for (const word of words) {
      frequency[word] = (frequency[word] || 0) + 1;
    }

    return frequency;
  }

  static getTopWords(text, limit = 10) {
    const frequency = this.wordFrequency(text);
    const sorted = Object.entries(frequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit);

    return Object.fromEntries(sorted);
  }

  static countSyllables(word) {
    if (!word || typeof word !== 'string') {
      return 1;
    }

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

  static calculateAverageWordLength(text) {
    const words = this.extractWords(text);
    if (words.length === 0) {
      return 0;
    }

    const totalLength = words.reduce((acc, word) => acc + word.length, 0);
    return totalLength / words.length;
  }

  static containsPattern(text, patterns) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    const found = [];

    for (const pattern of patterns) {
      if (typeof pattern === 'string') {
        if (text.includes(pattern)) {
          found.push(pattern);
        }
      } else if (pattern instanceof RegExp) {
        if (pattern.test(text)) {
          found.push(pattern.source);
        }
      }
    }

    return found;
  }

  static countPatternMatches(text, pattern) {
    if (!text || typeof text !== 'string') {
      return 0;
    }

    if (typeof pattern === 'string') {
      return (text.match(new RegExp(pattern, 'g')) || []).length;
    }

    if (pattern instanceof RegExp) {
      return (text.match(pattern) || []).length;
    }

    return 0;
  }

  static removeCommonWords(text, commonWords = null) {
    const words = this.extractWords(text);

    const defaults = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were'];
    const stopWords = commonWords || defaults;

    return words.filter(word => !stopWords.includes(word));
  }

  static levenshteinDistance(str1, str2) {
    const track = Array(str2.length + 1).fill(null).map(() =>
      Array(str1.length + 1).fill(null)
    );

    for (let i = 0; i <= str1.length; i += 1) {
      track[0][i] = i;
    }

    for (let j = 0; j <= str2.length; j += 1) {
      track[j][0] = j;
    }

    for (let j = 1; j <= str2.length; j += 1) {
      for (let i = 1; i <= str1.length; i += 1) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        track[j][i] = Math.min(
          track[j][i - 1] + 1,
          track[j - 1][i] + 1,
          track[j - 1][i - 1] + indicator
        );
      }
    }

    return track[str2.length][str1.length];
  }
}

module.exports = TextUtils;
