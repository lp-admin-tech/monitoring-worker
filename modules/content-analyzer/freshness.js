const logger = require('../logger');

class FreshnessAnalyzer {
  constructor(config = {}) {
    this.datePatterns = {
      iso8601: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      mmddyyyy: /\d{1,2}\/\d{1,2}\/\d{4}/,
      monthyear: /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}/gi,
      relativeTime: /(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)/gi,
      publishedKeyword: /(?:published|posted|updated|created|written|last\s+updated)[\s:]*([^,\n\r]+)/gi,
    };
    this.staleholdDays = config.staleTholdDays || 90;
    this.veryStaleTholdDays = config.veryStaleTholdDays || 180;
  }

  analyze(text, metadata = {}) {
    try {
      if (!text || typeof text !== 'string') {
        return {
          freshness: 'unknown',
          staleness: 0,
          publishDate: null,
          updateDate: null,
          daysOld: null,
          lastUpdated: null,
          updateFrequency: 'unknown',
        };
      }

      const publishDate = this.extractPublishDate(text, metadata);
      const updateDate = this.extractUpdateDate(text, metadata);
      const lastUpdate = updateDate || publishDate;

      let daysOld = null;
      let freshness = 'unknown';

      if (lastUpdate) {
        daysOld = this.calculateDaysOld(lastUpdate);
        freshness = this.determineFreshness(daysOld);
      }

      const updateFrequency = this.analyzeUpdateFrequency(text);

      return {
        freshness,
        staleness: daysOld !== null ? daysOld : 0,
        publishDate: publishDate ? publishDate.toISOString() : null,
        updateDate: updateDate ? updateDate.toISOString() : null,
        daysOld,
        lastUpdated: lastUpdate ? lastUpdate.toISOString() : null,
        updateFrequency,
        stalenessScore: this.calculateStalenessScore(daysOld),
      };
    } catch (error) {
      logger.error('Freshness analysis failed', error);
      return {
        freshness: 'unknown',
        staleness: 0,
        publishDate: null,
        updateDate: null,
        daysOld: null,
        lastUpdated: null,
        updateFrequency: 'unknown',
        error: error.message,
      };
    }
  }

  extractPublishDate(text, metadata = {}) {
    if (metadata.publishDate) {
      return this.parseDate(metadata.publishDate);
    }

    const publishedMatch = text.match(this.datePatterns.publishedKeyword);
    if (publishedMatch) {
      return this.parseDate(publishedMatch[1]);
    }

    const iso8601Match = text.match(this.datePatterns.iso8601);
    if (iso8601Match) {
      return new Date(iso8601Match[0]);
    }

    const mmddyyyyMatch = text.match(this.datePatterns.mmddyyyy);
    if (mmddyyyyMatch) {
      return this.parseDate(mmddyyyyMatch[0]);
    }

    const monthYearMatch = text.match(this.datePatterns.monthyear);
    if (monthYearMatch) {
      return this.parseDate(monthYearMatch[0]);
    }

    return null;
  }

  extractUpdateDate(text, metadata = {}) {
    if (metadata.updateDate) {
      return this.parseDate(metadata.updateDate);
    }

    const updatedMatch = text.match(/updated[\s:]*([^,\n\r]+)/i);
    if (updatedMatch) {
      return this.parseDate(updatedMatch[1]);
    }

    return null;
  }

  parseDate(dateString) {
    if (!dateString) return null;

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

  calculateDaysOld(date) {
    if (!date) return null;

    const now = new Date();
    const diff = now.getTime() - date.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  determineFreshness(daysOld) {
    if (daysOld === null) {
      return 'unknown';
    }

    if (daysOld < 7) {
      return 'very_fresh';
    }

    if (daysOld < 30) {
      return 'fresh';
    }

    if (daysOld < this.staleholdDays) {
      return 'moderately_fresh';
    }

    if (daysOld < this.veryStaleTholdDays) {
      return 'stale';
    }

    return 'very_stale';
  }

  analyzeUpdateFrequency(text) {
    const dateMatches = text.match(this.datePatterns.iso8601) || [];
    const monthYearMatches = text.match(this.datePatterns.monthyear) || [];
    const relativeMatches = text.match(this.datePatterns.relativeTime) || [];

    const totalDateReferences = dateMatches.length + monthYearMatches.length + relativeMatches.length;

    if (totalDateReferences === 0) {
      return 'no_date_references';
    }

    if (totalDateReferences < 2) {
      return 'infrequent';
    }

    if (totalDateReferences < 5) {
      return 'occasional';
    }

    if (totalDateReferences < 10) {
      return 'frequent';
    }

    return 'very_frequent';
  }

  calculateStalenessScore(daysOld) {
    if (daysOld === null || daysOld === undefined) {
      return 0.5;
    }

    if (daysOld < 7) {
      return 0;
    }

    if (daysOld > 365) {
      return 1;
    }

    return Math.min(1, daysOld / 365);
  }

  async batchAnalyze(texts, metadataArray = []) {
    return texts.map((text, i) => this.analyze(text, metadataArray[i] || {}));
  }

  mergeResults(text, allMetrics) {
    return {
      contentFreshness: allMetrics.freshness,
      daysOld: allMetrics.daysOld,
      lastUpdatedDate: allMetrics.lastUpdated,
      stalenessIndicator: allMetrics.staleness > this.staleholdDays,
    };
  }

  compareVersions(oldDate, newDate) {
    if (!oldDate || !newDate) {
      return {
        isNewer: false,
        daysDifference: 0,
      };
    }

    const oldTime = new Date(oldDate).getTime();
    const newTime = new Date(newDate).getTime();

    const daysDiff = Math.floor((newTime - oldTime) / (1000 * 60 * 60 * 24));

    return {
      isNewer: newTime > oldTime,
      daysDifference: Math.abs(daysDiff),
    };
  }
}

module.exports = FreshnessAnalyzer;
