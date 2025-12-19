/**
 * Proxy Rotation Strategy
 * Round-robin proxy rotation for avoiding IP blocks
 * Inspired by crawl4ai/proxy_strategy.py
 */

const logger = require('../logger');

/**
 * Proxy configuration class
 */
class ProxyConfig {
    constructor(options = {}) {
        this.server = options.server; // e.g., "http://127.0.0.1:8080"
        this.username = options.username || null;
        this.password = options.password || null;
        this.ip = options.ip || this._extractIP();
        this.type = options.type || 'http'; // http, https, socks5
        this.failureCount = 0;
        this.lastUsed = null;
        this.isActive = true;
    }

    _extractIP() {
        if (!this.server) return null;
        try {
            const match = this.server.match(/:\/\/([^:\/]+)/);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    }

    /**
     * Create from string format: ip:port or ip:port:username:password
     * @param {string} proxyStr 
     * @returns {ProxyConfig}
     */
    static fromString(proxyStr) {
        const parts = proxyStr.split(':');

        if (parts.length === 2) {
            // ip:port
            return new ProxyConfig({
                server: `http://${parts[0]}:${parts[1]}`,
                ip: parts[0]
            });
        } else if (parts.length === 4) {
            // ip:port:username:password
            return new ProxyConfig({
                server: `http://${parts[0]}:${parts[1]}`,
                username: parts[2],
                password: parts[3],
                ip: parts[0]
            });
        } else if (parts.length >= 3 && proxyStr.includes('://')) {
            // Full URL format: http://user:pass@host:port
            try {
                const url = new URL(proxyStr);
                return new ProxyConfig({
                    server: `${url.protocol}//${url.host}`,
                    username: url.username || null,
                    password: url.password || null,
                    ip: url.hostname
                });
            } catch {
                throw new Error(`Invalid proxy string format: ${proxyStr}`);
            }
        }

        throw new Error(`Invalid proxy string format: ${proxyStr}`);
    }

    /**
     * Create from environment variable
     * Format: comma-separated proxy strings
     * @param {string} envVar - Environment variable name
     * @returns {ProxyConfig[]}
     */
    static fromEnv(envVar = 'PROXIES') {
        const proxyList = process.env[envVar];
        if (!proxyList) return [];

        return proxyList
            .split(',')
            .map(p => p.trim())
            .filter(p => p.length > 0)
            .map(p => {
                try {
                    return ProxyConfig.fromString(p);
                } catch (e) {
                    logger.warn('[Proxy] Failed to parse proxy', { proxy: p, error: e.message });
                    return null;
                }
            })
            .filter(p => p !== null);
    }

    /**
     * Get Chrome launch argument
     * @returns {string}
     */
    toChromeArg() {
        return `--proxy-server=${this.server}`;
    }

    /**
     * Get authentication for CDP
     * @returns {Object|null}
     */
    getAuth() {
        if (this.username && this.password) {
            return {
                username: this.username,
                password: this.password
            };
        }
        return null;
    }

    /**
     * Mark proxy as failed
     */
    markFailed() {
        this.failureCount++;
        if (this.failureCount >= 3) {
            this.isActive = false;
            logger.warn('[Proxy] Proxy disabled after 3 failures', { ip: this.ip });
        }
    }

    /**
     * Mark proxy as successful
     */
    markSuccess() {
        this.failureCount = 0;
        this.lastUsed = new Date();
    }

    /**
     * Reset proxy status
     */
    reset() {
        this.failureCount = 0;
        this.isActive = true;
    }
}

/**
 * Round-robin proxy rotation strategy
 */
class RoundRobinProxyStrategy {
    constructor(proxies = []) {
        this.proxies = proxies;
        this.currentIndex = 0;
        this.totalRequests = 0;
    }

    /**
     * Add proxies to the pool
     * @param {ProxyConfig[]} proxies 
     */
    addProxies(proxies) {
        this.proxies.push(...proxies);
    }

    /**
     * Get next proxy in rotation
     * @returns {ProxyConfig|null}
     */
    getNextProxy() {
        const activeProxies = this.proxies.filter(p => p.isActive);

        if (activeProxies.length === 0) {
            return null;
        }

        const proxy = activeProxies[this.currentIndex % activeProxies.length];
        this.currentIndex = (this.currentIndex + 1) % activeProxies.length;
        this.totalRequests++;

        return proxy;
    }

    /**
     * Get all active proxies
     * @returns {ProxyConfig[]}
     */
    getActiveProxies() {
        return this.proxies.filter(p => p.isActive);
    }

    /**
     * Reset all proxies
     */
    resetAll() {
        this.proxies.forEach(p => p.reset());
        this.currentIndex = 0;
    }

    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        return {
            total: this.proxies.length,
            active: this.proxies.filter(p => p.isActive).length,
            disabled: this.proxies.filter(p => !p.isActive).length,
            totalRequests: this.totalRequests
        };
    }
}

/**
 * Smart proxy rotation - chooses based on recent performance
 */
class SmartProxyStrategy {
    constructor(proxies = []) {
        this.proxies = proxies;
        this.performanceHistory = new Map(); // proxy ip -> {success, fail, avgTime}
        this.cooldownMs = 5000; // 5 second cooldown after failure
    }

    addProxies(proxies) {
        proxies.forEach(proxy => {
            this.proxies.push(proxy);
            this.performanceHistory.set(proxy.ip, {
                success: 0,
                fail: 0,
                avgTime: 0,
                lastFail: null
            });
        });
    }

    /**
     * Get best available proxy based on performance
     * @returns {ProxyConfig|null}
     */
    getNextProxy() {
        const now = Date.now();

        // Filter active proxies not in cooldown
        const available = this.proxies.filter(p => {
            if (!p.isActive) return false;

            const history = this.performanceHistory.get(p.ip);
            if (history && history.lastFail) {
                if (now - history.lastFail < this.cooldownMs) {
                    return false;
                }
            }

            return true;
        });

        if (available.length === 0) {
            // All in cooldown, return least recently failed
            const sorted = this.proxies
                .filter(p => p.isActive)
                .sort((a, b) => {
                    const aHist = this.performanceHistory.get(a.ip) || { lastFail: 0 };
                    const bHist = this.performanceHistory.get(b.ip) || { lastFail: 0 };
                    return (aHist.lastFail || 0) - (bHist.lastFail || 0);
                });

            return sorted[0] || null;
        }

        // Sort by success rate, then by response time
        available.sort((a, b) => {
            const aHist = this.performanceHistory.get(a.ip) || { success: 0, fail: 0 };
            const bHist = this.performanceHistory.get(b.ip) || { success: 0, fail: 0 };

            const aRate = aHist.success / (aHist.success + aHist.fail + 1);
            const bRate = bHist.success / (bHist.success + bHist.fail + 1);

            if (Math.abs(aRate - bRate) > 0.1) {
                return bRate - aRate; // Higher success rate first
            }

            return (aHist.avgTime || 0) - (bHist.avgTime || 0); // Faster first
        });

        return available[0];
    }

    /**
     * Record proxy success
     * @param {ProxyConfig} proxy 
     * @param {number} responseTime - Response time in ms
     */
    recordSuccess(proxy, responseTime = 0) {
        const history = this.performanceHistory.get(proxy.ip) || {
            success: 0, fail: 0, avgTime: 0
        };

        history.success++;
        history.avgTime = (history.avgTime * (history.success - 1) + responseTime) / history.success;

        this.performanceHistory.set(proxy.ip, history);
        proxy.markSuccess();
    }

    /**
     * Record proxy failure
     * @param {ProxyConfig} proxy 
     */
    recordFailure(proxy) {
        const history = this.performanceHistory.get(proxy.ip) || {
            success: 0, fail: 0, avgTime: 0
        };

        history.fail++;
        history.lastFail = Date.now();

        this.performanceHistory.set(proxy.ip, history);
        proxy.markFailed();
    }

    getStats() {
        const stats = [];

        for (const proxy of this.proxies) {
            const history = this.performanceHistory.get(proxy.ip) || {};
            stats.push({
                ip: proxy.ip,
                active: proxy.isActive,
                success: history.success || 0,
                fail: history.fail || 0,
                avgTime: Math.round(history.avgTime || 0),
                successRate: history.success ?
                    ((history.success / (history.success + history.fail)) * 100).toFixed(1) + '%' :
                    'N/A'
            });
        }

        return stats;
    }
}

module.exports = {
    ProxyConfig,
    RoundRobinProxyStrategy,
    SmartProxyStrategy
};
