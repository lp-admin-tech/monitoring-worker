/**
 * URL Scorers for MFA Detection
 * Inspired by crawl4ai/deep_crawling/scorers.py
 */

const logger = require('../logger');

/**
 * Keyword Relevance Scorer
 * Scores URLs/content by MFA-related keyword presence
 */
class KeywordRelevanceScorer {
    constructor(options = {}) {
        this.weight = options.weight || 1.0;
        this.caseSensitive = options.caseSensitive || false;

        // MFA-related keywords
        this.mfaKeywords = options.keywords || [
            // Ad-related
            'ads', 'advertisement', 'sponsored', 'promoted', 'partner',
            'affiliate', 'click', 'banner', 'popup', 'interstitial',

            // Clickbait
            'shocking', 'unbelievable', 'you wont believe', 'amazing',
            'viral', 'trending', 'breaking', 'exclusive', 'secret',

            // Low-quality content
            'slideshow', 'gallery', 'next', 'continue', 'more',
            'listicle', 'top 10', 'best ever', 'worst ever',

            // Monetization
            'earn money', 'make money', 'free gift', 'winner',
            'congratulations', 'survey', 'quiz result'
        ];

        // Process keywords
        this.processedKeywords = this.mfaKeywords.map(k =>
            this.caseSensitive ? k : k.toLowerCase()
        );
    }

    /**
     * Score a URL for MFA keyword presence
     * @param {string} url - URL to score
     * @returns {number} - Score between 0 and 1 (higher = more MFA-like)
     */
    scoreUrl(url) {
        const processedUrl = this.caseSensitive ? url : url.toLowerCase();

        let matches = 0;
        for (const keyword of this.processedKeywords) {
            if (processedUrl.includes(keyword)) {
                matches++;
            }
        }

        if (matches === 0) return 0;

        // Normalize - more matches = higher risk
        const score = Math.min(1, matches / 5); // Cap at 5 matches for max score
        return score * this.weight;
    }

    /**
     * Score content for MFA keywords
     * @param {string} content - Page content to analyze
     * @returns {Object} - Score and matched keywords
     */
    scoreContent(content) {
        if (!content) return { score: 0, matches: [] };

        const processedContent = this.caseSensitive ? content : content.toLowerCase();
        const matches = [];

        for (const keyword of this.processedKeywords) {
            const regex = new RegExp(`\\b${this.escapeRegex(keyword)}\\b`, 'gi');
            const count = (processedContent.match(regex) || []).length;
            if (count > 0) {
                matches.push({ keyword, count });
            }
        }

        // Calculate density-based score
        const totalMatches = matches.reduce((sum, m) => sum + m.count, 0);
        const wordCount = content.split(/\s+/).length;
        const density = wordCount > 0 ? totalMatches / wordCount : 0;

        // Higher density = more MFA-like
        const score = Math.min(1, density * 100); // 1% density = max score

        return {
            score: score * this.weight,
            matches,
            density,
            wordCount
        };
    }

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

/**
 * URL Path Depth Scorer
 * Scores URLs by path depth - MFA sites often have shallow paths
 */
class PathDepthScorer {
    constructor(options = {}) {
        this.weight = options.weight || 1.0;
        this.optimalDepth = options.optimalDepth || 3;

        // Pre-computed scores for common distances
        this.scoreLookup = [1.0, 0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.13, 0.11, 0.1];
    }

    /**
     * Calculate path depth from URL
     * @param {string} url - URL to analyze
     * @returns {number} - Depth (0 = homepage)
     */
    getPathDepth(url) {
        try {
            const urlObj = new URL(url);
            const path = urlObj.pathname;

            if (!path || path === '/') return 0;

            // Count non-empty path segments
            const segments = path.split('/').filter(s => s.length > 0);
            return segments.length;
        } catch {
            return 0;
        }
    }

    /**
     * Score URL by path depth for MFA risk
     * Shallow paths (depth 0-1) = higher MFA risk
     * @param {string} url - URL to score
     * @returns {number} - Score between 0 and 1
     */
    score(url) {
        const depth = this.getPathDepth(url);

        // MFA sites often have very shallow paths (homepage, or /article/123)
        // Legitimate sites often have deeper hierarchies

        if (depth === 0) {
            return 0.3 * this.weight; // Homepage - neutral
        }

        if (depth === 1) {
            return 0.5 * this.weight; // Single level - slight MFA indicator
        }

        if (depth === 2) {
            return 0.3 * this.weight; // Normal depth
        }

        // Deeper paths are less likely to be MFA
        const distance = depth - this.optimalDepth;
        if (distance < 0) {
            // Shallower than optimal
            return (0.3 + Math.abs(distance) * 0.1) * this.weight;
        }

        // Deeper than optimal - low MFA risk
        return Math.max(0.1, 0.3 - distance * 0.05) * this.weight;
    }
}

/**
 * Domain Authority Scorer
 * Known domains get pre-defined scores
 */
class DomainAuthorityScorer {
    constructor(options = {}) {
        this.weight = options.weight || 1.0;
        this.defaultScore = options.defaultScore || 0.5;

        // Known MFA/low-quality domains (higher score = more risk)
        this.knownMFADomains = new Set([
            // Add known MFA domains here
        ]);

        // Known trusted domains (lower score = less risk)
        this.trustedDomains = new Set([
            'google.com', 'facebook.com', 'twitter.com', 'x.com',
            'linkedin.com', 'youtube.com', 'amazon.com', 'microsoft.com',
            'apple.com', 'github.com', 'wikipedia.org', 'reddit.com',
            'nytimes.com', 'bbc.com', 'cnn.com', 'reuters.com',
            'washingtonpost.com', 'theguardian.com', 'forbes.com'
        ]);
    }

    /**
     * Extract base domain from URL
     * @param {string} url 
     * @returns {string}
     */
    extractDomain(url) {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();

            // Get base domain (remove www and subdomains for common TLDs)
            const parts = hostname.split('.');
            if (parts.length >= 2) {
                return parts.slice(-2).join('.');
            }
            return hostname;
        } catch {
            return '';
        }
    }

    /**
     * Score domain for MFA risk
     * @param {string} url - URL to score
     * @returns {number} - Score between 0 and 1
     */
    score(url) {
        const domain = this.extractDomain(url);

        if (!domain) return this.defaultScore * this.weight;

        if (this.knownMFADomains.has(domain)) {
            return 0.9 * this.weight; // High risk
        }

        if (this.trustedDomains.has(domain)) {
            return 0.1 * this.weight; // Low risk
        }

        return this.defaultScore * this.weight;
    }

    /**
     * Add known MFA domains
     * @param {string[]} domains 
     */
    addMFADomains(domains) {
        domains.forEach(d => this.knownMFADomains.add(d.toLowerCase()));
    }

    /**
     * Add trusted domains
     * @param {string[]} domains 
     */
    addTrustedDomains(domains) {
        domains.forEach(d => this.trustedDomains.add(d.toLowerCase()));
    }
}

/**
 * Content Type Filter
 * Filter URLs by content type/extension
 */
class ContentTypeFilter {
    constructor() {
        // Extensions to skip (not useful for MFA analysis)
        this.skipExtensions = new Set([
            // Images
            'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff',
            // Media
            'mp3', 'mp4', 'wav', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ogg',
            // Documents
            'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt',
            // Archives
            'zip', 'rar', '7z', 'tar', 'gz',
            // Code/Data
            'js', 'css', 'json', 'xml', 'csv',
            // Fonts
            'woff', 'woff2', 'ttf', 'eot', 'otf',
            // Other
            'exe', 'dmg', 'apk', 'ipa'
        ]);

        // HTML extensions (should be crawled)
        this.htmlExtensions = new Set([
            'html', 'htm', 'xhtml', 'php', 'asp', 'aspx', 'jsp'
        ]);
    }

    /**
     * Check if URL should be crawled
     * @param {string} url - URL to check
     * @returns {boolean} - true if should crawl
     */
    shouldCrawl(url) {
        const ext = this.extractExtension(url);

        // No extension or HTML extension - should crawl
        if (!ext || this.htmlExtensions.has(ext)) {
            return true;
        }

        // Skip if it's a known non-HTML type
        return !this.skipExtensions.has(ext);
    }

    /**
     * Extract file extension from URL
     * @param {string} url 
     * @returns {string|null}
     */
    extractExtension(url) {
        try {
            const urlObj = new URL(url);
            const path = urlObj.pathname;

            // Remove query string artifacts
            const cleanPath = path.split('?')[0];

            // Get last part of path
            const lastSegment = cleanPath.split('/').pop();

            // Extract extension
            if (lastSegment && lastSegment.includes('.')) {
                const ext = lastSegment.split('.').pop().toLowerCase();
                // Validate it looks like an extension (1-10 chars, alphanumeric)
                if (ext && ext.length <= 10 && /^[a-z0-9]+$/.test(ext)) {
                    return ext;
                }
            }

            return null;
        } catch {
            return null;
        }
    }
}

/**
 * Composite Scorer - combines multiple scorers
 */
class CompositeScorer {
    constructor(scorers = []) {
        this.scorers = scorers;
    }

    addScorer(scorer) {
        this.scorers.push(scorer);
        return this;
    }

    /**
     * Calculate combined score
     * @param {string} url - URL to score
     * @param {Object} options - Additional data for scoring
     * @returns {number} - Combined normalized score
     */
    score(url, options = {}) {
        if (this.scorers.length === 0) return 0;

        let totalScore = 0;
        let totalWeight = 0;

        for (const scorer of this.scorers) {
            const weight = scorer.weight || 1;
            totalWeight += weight;

            if (typeof scorer.score === 'function') {
                totalScore += scorer.score(url) * weight;
            } else if (typeof scorer.scoreUrl === 'function') {
                totalScore += scorer.scoreUrl(url) * weight;
            }
        }

        return totalWeight > 0 ? totalScore / totalWeight : 0;
    }
}

module.exports = {
    KeywordRelevanceScorer,
    PathDepthScorer,
    DomainAuthorityScorer,
    ContentTypeFilter,
    CompositeScorer
};
