/**
 * Robots.txt Parser with SQLite Caching
 * Inspired by crawl4ai/utils.py RobotsParser
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

// Simple file-based cache (no SQLite dependency)
const CACHE_DIR = path.join(process.cwd(), '.cache', 'robots');
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

class RobotsParser {
    constructor(options = {}) {
        this.cacheTTL = options.cacheTTL || CACHE_TTL;
        this.userAgent = options.userAgent || '*';
        this.timeout = options.timeout || 5000;

        // Ensure cache directory exists
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
        }
    }

    /**
     * Get cache file path for a domain
     * @param {string} domain 
     * @returns {string}
     */
    getCachePath(domain) {
        const hash = crypto.createHash('md5').update(domain).digest('hex');
        return path.join(CACHE_DIR, `${hash}.json`);
    }

    /**
     * Get cached robots.txt rules
     * @param {string} domain 
     * @returns {{rules: string, isFresh: boolean} | null}
     */
    getCached(domain) {
        const cachePath = this.getCachePath(domain);

        if (!fs.existsSync(cachePath)) {
            return null;
        }

        try {
            const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            const isFresh = Date.now() - data.fetchTime < this.cacheTTL;
            return { rules: data.rules, isFresh };
        } catch (e) {
            return null;
        }
    }

    /**
     * Cache robots.txt rules
     * @param {string} domain 
     * @param {string} rules 
     */
    cacheRules(domain, rules) {
        const cachePath = this.getCachePath(domain);
        const data = {
            domain,
            rules,
            fetchTime: Date.now(),
            hash: crypto.createHash('md5').update(rules).digest('hex')
        };

        try {
            fs.writeFileSync(cachePath, JSON.stringify(data), 'utf8');
        } catch (e) {
            logger.warn('[RobotsParser] Failed to cache rules:', e.message);
        }
    }

    /**
     * Fetch robots.txt from a domain
     * @param {string} domain 
     * @param {string} protocol 
     * @returns {Promise<string|null>}
     */
    async fetchRobotsTxt(domain, protocol = 'https') {
        return new Promise((resolve) => {
            const robotsUrl = `${protocol}://${domain}/robots.txt`;
            const httpModule = protocol === 'https' ? https : http;

            const req = httpModule.get(robotsUrl, { timeout: this.timeout }, (res) => {
                if (res.statusCode !== 200) {
                    resolve(null);
                    return;
                }

                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            });

            req.on('error', () => resolve(null));
            req.on('timeout', () => {
                req.destroy();
                resolve(null);
            });
        });
    }

    /**
     * Parse robots.txt rules for a specific user agent
     * @param {string} robotsTxt 
     * @param {string} userAgent 
     * @returns {{disallowed: string[], allowed: string[], crawlDelay: number|null}}
     */
    parseRules(robotsTxt, userAgent = '*') {
        const lines = robotsTxt.split('\n').map(l => l.trim());
        const rules = { disallowed: [], allowed: [], crawlDelay: null };

        let currentAgent = null;
        let foundAgent = false;

        for (const line of lines) {
            // Skip comments and empty lines
            if (line.startsWith('#') || line === '') continue;

            const [directive, ...valueParts] = line.split(':');
            const value = valueParts.join(':').trim();

            if (directive.toLowerCase() === 'user-agent') {
                currentAgent = value.toLowerCase();
                if (currentAgent === '*' || currentAgent === userAgent.toLowerCase()) {
                    foundAgent = true;
                } else {
                    foundAgent = false;
                }
            } else if (foundAgent) {
                switch (directive.toLowerCase()) {
                    case 'disallow':
                        if (value) rules.disallowed.push(value);
                        break;
                    case 'allow':
                        if (value) rules.allowed.push(value);
                        break;
                    case 'crawl-delay':
                        rules.crawlDelay = parseFloat(value) || null;
                        break;
                }
            }
        }

        return rules;
    }

    /**
     * Check if a URL path is allowed
     * @param {string} path 
     * @param {{disallowed: string[], allowed: string[]}} rules 
     * @returns {boolean}
     */
    isPathAllowed(path, rules) {
        // Check allowed first (more specific)
        for (const pattern of rules.allowed) {
            if (this.matchesPattern(path, pattern)) {
                return true;
            }
        }

        // Check disallowed
        for (const pattern of rules.disallowed) {
            if (this.matchesPattern(path, pattern)) {
                return false;
            }
        }

        // Default: allowed
        return true;
    }

    /**
     * Match path against robots.txt pattern
     * @param {string} path 
     * @param {string} pattern 
     * @returns {boolean}
     */
    matchesPattern(path, pattern) {
        // Handle wildcards
        if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\$/g, '$'));
            return regex.test(path);
        }

        // Handle $ end anchor
        if (pattern.endsWith('$')) {
            return path === pattern.slice(0, -1);
        }

        // Simple prefix match
        return path.startsWith(pattern);
    }

    /**
     * Check if a URL can be fetched according to robots.txt
     * @param {string} url - Full URL to check
     * @param {string} userAgent - User agent to check against
     * @returns {Promise<{allowed: boolean, crawlDelay: number|null}>}
     */
    async canFetch(url, userAgent = null) {
        try {
            const parsedUrl = new URL(url);
            const domain = parsedUrl.hostname;
            const path = parsedUrl.pathname + parsedUrl.search;
            const agent = userAgent || this.userAgent;

            // Check cache first
            let cached = this.getCached(domain);
            let robotsTxt = cached?.rules;

            // Fetch if not cached or stale
            if (!cached || !cached.isFresh) {
                const protocol = parsedUrl.protocol.replace(':', '');
                robotsTxt = await this.fetchRobotsTxt(domain, protocol);

                if (robotsTxt) {
                    this.cacheRules(domain, robotsTxt);
                } else if (!cached) {
                    // No robots.txt and no cache - allow everything
                    return { allowed: true, crawlDelay: null };
                }
            }

            if (!robotsTxt) {
                return { allowed: true, crawlDelay: null };
            }

            const rules = this.parseRules(robotsTxt, agent);
            const allowed = this.isPathAllowed(path, rules);

            return { allowed, crawlDelay: rules.crawlDelay };
        } catch (error) {
            logger.debug('[RobotsParser] Error checking URL:', error.message);
            return { allowed: true, crawlDelay: null }; // Allow on error
        }
    }

    /**
     * Clear all cached robots.txt files
     */
    clearCache() {
        if (fs.existsSync(CACHE_DIR)) {
            const files = fs.readdirSync(CACHE_DIR);
            files.forEach(file => {
                fs.unlinkSync(path.join(CACHE_DIR, file));
            });
        }
    }

    /**
     * Clear expired cache entries
     */
    clearExpired() {
        if (!fs.existsSync(CACHE_DIR)) return;

        const files = fs.readdirSync(CACHE_DIR);
        const now = Date.now();

        files.forEach(file => {
            const filePath = path.join(CACHE_DIR, file);
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (now - data.fetchTime > this.cacheTTL) {
                    fs.unlinkSync(filePath);
                }
            } catch (e) {
                // Invalid cache file, remove it
                fs.unlinkSync(filePath);
            }
        });
    }
}

module.exports = RobotsParser;
