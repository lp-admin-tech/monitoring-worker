/**
 * Filter Chain Module
 * Inspired by crawl4ai/deep_crawling/filters.py
 * Composable URL filtering with pattern matching
 */

const logger = require('./logger');
const { URL } = require('url');

/**
 * Base URL Filter class
 */
class URLFilter {
    constructor(name = null) {
        this.name = name || this.constructor.name;
        this.stats = {
            total: 0,
            passed: 0,
            rejected: 0
        };
    }

    /**
     * Apply filter to URL
     * @param {string} url
     * @returns {boolean}
     */
    apply(url) {
        throw new Error('Subclass must implement apply()');
    }

    /**
     * Update stats and apply filter
     * @param {string} url
     * @returns {boolean}
     */
    filter(url) {
        this.stats.total++;
        const passed = this.apply(url);
        if (passed) {
            this.stats.passed++;
        } else {
            this.stats.rejected++;
        }
        return passed;
    }
}

/**
 * Pattern-based URL filter
 * Supports glob patterns, regex, and simple string matching
 */
class URLPatternFilter extends URLFilter {
    constructor(patterns, options = {}) {
        super(options.name);
        this.reverse = options.reverse || false; // If true, reject matches instead of accepting
        this.patterns = Array.isArray(patterns) ? patterns : [patterns];
        this._compiledPatterns = this._compilePatterns(this.patterns, options.useGlob !== false);
    }

    _compilePatterns(patterns, useGlob) {
        return patterns.map(pattern => {
            if (pattern instanceof RegExp) {
                return pattern;
            }

            // Check if it's already a regex string
            if (pattern.startsWith('^') || pattern.endsWith('$') || pattern.includes('\\d')) {
                return new RegExp(pattern);
            }

            if (useGlob) {
                // Convert glob to regex
                const regexStr = pattern
                    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars except * and ?
                    .replace(/\*/g, '.*')
                    .replace(/\?/g, '.');
                return new RegExp(`^${regexStr}$`, 'i');
            }

            // Simple string matching
            return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        });
    }

    apply(url) {
        const matches = this._compiledPatterns.some(pattern => pattern.test(url));
        return this.reverse ? !matches : matches;
    }
}

/**
 * Domain filter - filter by domain/subdomain
 */
class DomainFilter extends URLFilter {
    constructor(domains, options = {}) {
        super(options.name || 'DomainFilter');
        this.allowSubdomains = options.allowSubdomains !== false;
        this.domains = new Set(
            (Array.isArray(domains) ? domains : [domains]).map(d => d.toLowerCase())
        );
        this.reverse = options.reverse || false;
    }

    apply(url) {
        try {
            const { hostname } = new URL(url);
            const host = hostname.toLowerCase();

            let matches = false;
            for (const domain of this.domains) {
                if (host === domain) {
                    matches = true;
                    break;
                }
                if (this.allowSubdomains && host.endsWith('.' + domain)) {
                    matches = true;
                    break;
                }
            }

            return this.reverse ? !matches : matches;
        } catch {
            return false;
        }
    }
}

/**
 * Content type filter - filter by file extension
 */
class FileTypeFilter extends URLFilter {
    constructor(extensions, options = {}) {
        super(options.name || 'FileTypeFilter');
        this.extensions = new Set(
            (Array.isArray(extensions) ? extensions : [extensions])
                .map(e => e.toLowerCase().replace(/^\./, ''))
        );
        this.reverse = options.reverse || false;
    }

    apply(url) {
        try {
            const { pathname } = new URL(url);
            const ext = pathname.split('.').pop()?.toLowerCase() || '';
            const matches = this.extensions.has(ext);
            return this.reverse ? !matches : matches;
        } catch {
            return true; // Allow if can't parse
        }
    }
}

/**
 * Path depth filter
 */
class PathDepthFilter extends URLFilter {
    constructor(maxDepth, options = {}) {
        super(options.name || 'PathDepthFilter');
        this.maxDepth = maxDepth;
        this.minDepth = options.minDepth || 0;
    }

    apply(url) {
        try {
            const { pathname } = new URL(url);
            const depth = pathname.split('/').filter(Boolean).length;
            return depth >= this.minDepth && depth <= this.maxDepth;
        } catch {
            return true;
        }
    }
}

/**
 * Query parameter filter
 */
class QueryParamFilter extends URLFilter {
    constructor(requiredParams, options = {}) {
        super(options.name || 'QueryParamFilter');
        this.requiredParams = new Set(
            Array.isArray(requiredParams) ? requiredParams : [requiredParams]
        );
        this.reverse = options.reverse || false;
    }

    apply(url) {
        try {
            const { searchParams } = new URL(url);
            const hasAll = Array.from(this.requiredParams).every(param => searchParams.has(param));
            return this.reverse ? !hasAll : hasAll;
        } catch {
            return false;
        }
    }
}

/**
 * Filter Chain - combine multiple filters
 */
class FilterChain {
    constructor(filters = [], options = {}) {
        this.filters = filters;
        this.mode = options.mode || 'AND'; // AND = all must pass, OR = any must pass
        this.stats = {
            total: 0,
            passed: 0,
            rejected: 0
        };
    }

    /**
     * Add a filter to the chain
     * @param {URLFilter} filter
     * @returns {FilterChain}
     */
    addFilter(filter) {
        this.filters.push(filter);
        return this;
    }

    /**
     * Apply all filters to a URL
     * @param {string} url
     * @returns {Promise<boolean>}
     */
    async apply(url) {
        this.stats.total++;

        if (this.filters.length === 0) {
            this.stats.passed++;
            return true;
        }

        const results = await Promise.all(
            this.filters.map(async filter => {
                // Support both sync and async filters
                const result = filter.filter ? filter.filter(url) : filter.apply(url);
                return result instanceof Promise ? await result : result;
            })
        );

        let passed;
        if (this.mode === 'OR') {
            passed = results.some(r => r);
        } else {
            passed = results.every(r => r);
        }

        if (passed) {
            this.stats.passed++;
        } else {
            this.stats.rejected++;
        }

        return passed;
    }

    /**
     * Filter an array of URLs
     * @param {string[]} urls
     * @returns {Promise<string[]>}
     */
    async filterUrls(urls) {
        const results = await Promise.all(
            urls.map(async url => ({ url, passed: await this.apply(url) }))
        );
        return results.filter(r => r.passed).map(r => r.url);
    }

    /**
     * Get stats from all filters
     * @returns {Object}
     */
    getStats() {
        return {
            chain: this.stats,
            filters: this.filters.map(f => ({
                name: f.name,
                stats: f.stats
            }))
        };
    }
}

/**
 * Common filter presets
 */
const FilterPresets = {
    /**
     * Skip common non-HTML resources
     */
    skipResources: () => new FileTypeFilter(
        ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot'],
        { reverse: true, name: 'SkipResourcesFilter' }
    ),

    /**
     * Skip common document types
     */
    skipDocuments: () => new FileTypeFilter(
        ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar'],
        { reverse: true, name: 'SkipDocumentsFilter' }
    ),

    /**
     * Stay within same domain
     * @param {string} domain
     */
    sameDomain: (domain) => new DomainFilter(domain, { name: 'SameDomainFilter' }),

    /**
     * Skip deep paths
     * @param {number} maxDepth
     */
    maxDepth: (maxDepth) => new PathDepthFilter(maxDepth, { name: `MaxDepth${maxDepth}Filter` }),

    /**
     * Skip common ad/tracking patterns
     */
    skipAds: () => new URLPatternFilter(
        ['*/ads/*', '*/tracking/*', '*/analytics/*', '*/pixel/*', '*.doubleclick.*', '*.googlesyndication.*'],
        { reverse: true, name: 'SkipAdsFilter' }
    ),
};

module.exports = {
    URLFilter,
    URLPatternFilter,
    DomainFilter,
    FileTypeFilter,
    PathDepthFilter,
    QueryParamFilter,
    FilterChain,
    FilterPresets
};
