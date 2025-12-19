/**
 * Freshness Scorer Module
 * Inspired by crawl4ai/deep_crawling/scorers.py
 * Scores URLs by extracting date patterns from paths
 */

const logger = require('./logger');

// Pre-computed freshness scores by years ago
const FRESHNESS_SCORES = [
    1.0,  // Current year
    0.9,  // Last year
    0.8,  // 2 years ago
    0.7,  // 3 years ago
    0.6,  // 4 years ago
    0.5,  // 5 years ago
];

// Common date patterns in URLs
const DATE_PATTERNS = [
    // YYYY/MM/DD or YYYY-MM-DD
    /\/(\d{4})\/(\d{1,2})\/(\d{1,2})/,
    /\/(\d{4})-(\d{1,2})-(\d{1,2})/,

    // YYYY/MM
    /\/(\d{4})\/(\d{1,2})(?:[\/\-]|$)/,
    /\/(\d{4})-(\d{1,2})(?:[\/\-]|$)/,

    // Just year
    /\/(\d{4})(?:[\/\-]|$)/,

    // Archive patterns
    /\/archives?\/(\d{4})/i,
    /\/blog\/(\d{4})/i,
    /\/news\/(\d{4})/i,
];

/**
 * URL Scorer base class
 */
class URLScorer {
    constructor(weight = 1.0) {
        this.weight = weight;
        this.stats = {
            urlsScored: 0,
            totalScore: 0,
            minScore: null,
            maxScore: null,
        };
    }

    /**
     * Calculate raw score for URL
     * @param {string} url
     * @returns {number}
     */
    _calculateScore(url) {
        throw new Error('Subclass must implement _calculateScore()');
    }

    /**
     * Calculate weighted score with stats tracking
     * @param {string} url
     * @returns {number}
     */
    score(url) {
        const rawScore = this._calculateScore(url);
        const weightedScore = rawScore * this.weight;

        this.stats.urlsScored++;
        this.stats.totalScore += weightedScore;

        if (this.stats.minScore === null || weightedScore < this.stats.minScore) {
            this.stats.minScore = weightedScore;
        }
        if (this.stats.maxScore === null || weightedScore > this.stats.maxScore) {
            this.stats.maxScore = weightedScore;
        }

        return weightedScore;
    }

    getAverageScore() {
        return this.stats.urlsScored > 0
            ? this.stats.totalScore / this.stats.urlsScored
            : 0;
    }
}

/**
 * Freshness Scorer
 * Scores URLs based on date patterns in the path
 */
class FreshnessScorer extends URLScorer {
    constructor(options = {}) {
        super(options.weight || 1.0);
        this.currentYear = new Date().getFullYear();
        this.defaultScore = options.defaultScore || 0.5; // For URLs without dates
        this.patterns = options.patterns || DATE_PATTERNS;
    }

    _calculateScore(url) {
        // Try each pattern
        for (const pattern of this.patterns) {
            const match = url.match(pattern);
            if (match) {
                const year = parseInt(match[1], 10);

                // Validate year
                if (year >= 2000 && year <= this.currentYear + 1) {
                    const yearsAgo = this.currentYear - year;

                    // Use pre-computed score or calculate diminishing returns
                    if (yearsAgo < FRESHNESS_SCORES.length) {
                        return FRESHNESS_SCORES[yearsAgo];
                    }
                    // For older content: 0.5 / (years - 4)
                    return Math.max(0.1, 0.5 / (yearsAgo - 4));
                }
            }
        }

        // No date found
        return this.defaultScore;
    }

    /**
     * Extract date from URL if present
     * @param {string} url
     * @returns {{year: number, month?: number, day?: number}|null}
     */
    extractDate(url) {
        for (const pattern of this.patterns) {
            const match = url.match(pattern);
            if (match) {
                const result = { year: parseInt(match[1], 10) };
                if (match[2]) result.month = parseInt(match[2], 10);
                if (match[3]) result.day = parseInt(match[3], 10);
                return result;
            }
        }
        return null;
    }
}

/**
 * Composite Scorer
 * Combines multiple scorers with optional normalization
 */
class CompositeScorer extends URLScorer {
    constructor(scorers = [], options = {}) {
        super(1.0);
        this.scorers = scorers;
        this.normalize = options.normalize !== false;
        this._cache = new Map();
        this.cacheSize = options.cacheSize || 10000;
    }

    _calculateScore(url) {
        // Check cache
        if (this._cache.has(url)) {
            return this._cache.get(url);
        }

        let totalScore = 0;
        for (const scorer of this.scorers) {
            totalScore += scorer.score(url);
        }

        const finalScore = this.normalize && this.scorers.length > 0
            ? totalScore / this.scorers.length
            : totalScore;

        // Cache result
        if (this._cache.size >= this.cacheSize) {
            // Remove oldest entry (simple FIFO)
            const firstKey = this._cache.keys().next().value;
            this._cache.delete(firstKey);
        }
        this._cache.set(url, finalScore);

        return finalScore;
    }

    addScorer(scorer) {
        this.scorers.push(scorer);
        this._cache.clear(); // Clear cache when scorers change
        return this;
    }
}

/**
 * Keyword Relevance Scorer
 * Scores based on presence of keywords in URL
 */
class KeywordScorer extends URLScorer {
    constructor(keywords, options = {}) {
        super(options.weight || 1.0);
        this.caseSensitive = options.caseSensitive || false;
        this.keywords = (Array.isArray(keywords) ? keywords : [keywords])
            .map(k => this.caseSensitive ? k : k.toLowerCase());
    }

    _calculateScore(url) {
        const checkUrl = this.caseSensitive ? url : url.toLowerCase();
        let matches = 0;

        for (const keyword of this.keywords) {
            if (checkUrl.includes(keyword)) {
                matches++;
            }
        }

        if (matches === 0) return 0;
        if (matches === this.keywords.length) return 1;
        return matches / this.keywords.length;
    }
}

/**
 * Path Depth Scorer
 * Scores inversely by path depth (shallower = higher score)
 */
class PathDepthScorer extends URLScorer {
    constructor(options = {}) {
        super(options.weight || 1.0);
        this.optimalDepth = options.optimalDepth || 3;
    }

    _calculateScore(url) {
        try {
            const { pathname } = new URL(url);
            const depth = pathname.split('/').filter(Boolean).length;

            // Score decreases as depth differs from optimal
            const diff = Math.abs(depth - this.optimalDepth);
            return Math.max(0, 1 - (diff * 0.2));
        } catch {
            return 0.5;
        }
    }
}

module.exports = {
    URLScorer,
    FreshnessScorer,
    CompositeScorer,
    KeywordScorer,
    PathDepthScorer,
    FRESHNESS_SCORES,
    DATE_PATTERNS
};
