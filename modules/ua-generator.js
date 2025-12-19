/**
 * User Agent Generator with Client Hints
 * Inspired by crawl4ai/user_agent_generator.py
 * Generates valid random user agents with matching Sec-CH-UA headers
 */

const logger = require('./logger');

// Chrome versions (recent)
const CHROME_VERSIONS = [
    '120', '121', '122', '123', '124', '125', '126', '127', '128', '129', '130'
];

// Firefox versions
const FIREFOX_VERSIONS = ['120', '121', '122', '123', '124', '125'];

// Edge versions
const EDGE_VERSIONS = ['120', '121', '122', '123', '124'];

// Safari versions
const SAFARI_VERSIONS = ['16', '17'];

// Desktop platforms
const DESKTOP_PLATFORMS = {
    windows: {
        '10_64': '(Windows NT 10.0; Win64; x64)',
        '11_64': '(Windows NT 10.0; Win64; x64)',
    },
    macos: {
        intel: '(Macintosh; Intel Mac OS X 10_15_7)',
        arm: '(Macintosh; Apple M1 Mac OS X 10_15_7)',
    },
    linux: {
        generic: '(X11; Linux x86_64)',
        ubuntu: '(X11; Ubuntu; Linux x86_64)',
    }
};

// Mobile platforms
const MOBILE_PLATFORMS = {
    android: {
        samsung: '(Linux; Android 14; SM-S918B)',
        pixel: '(Linux; Android 14; Pixel 8 Pro)',
        generic: '(Linux; Android 13; K)',
    },
    ios: {
        iphone: '(iPhone; CPU iPhone OS 17_4 like Mac OS X)',
        ipad: '(iPad; CPU OS 17_4 like Mac OS X)',
    }
};

// Browser rendering engines
const RENDERING_ENGINES = {
    chrome_webkit: 'AppleWebKit/537.36 (KHTML, like Gecko)',
    firefox_gecko: 'Gecko/20100101',
};

class UserAgentGenerator {
    constructor(options = {}) {
        this.defaultPlatform = options.platform || 'desktop';
        this.defaultBrowser = options.browser || 'chrome';
        this.cache = new Map();
    }

    /**
     * Generate a random user agent string
     * @param {Object} options
     * @param {string} options.platform - 'desktop' or 'mobile'
     * @param {string} options.browser - 'chrome', 'firefox', 'edge', 'safari'
     * @param {string} options.os - 'windows', 'macos', 'linux', 'android', 'ios'
     * @returns {{userAgent: string, clientHints: Object}}
     */
    generate(options = {}) {
        const platform = options.platform || this.defaultPlatform;
        const browser = options.browser || this.defaultBrowser;
        const os = options.os || this._getDefaultOS(platform);

        const platformString = this._getPlatformString(platform, os);
        const chromeVersion = this._randomChoice(CHROME_VERSIONS);
        const firefoxVersion = this._randomChoice(FIREFOX_VERSIONS);
        const edgeVersion = this._randomChoice(EDGE_VERSIONS);
        const safariVersion = this._randomChoice(SAFARI_VERSIONS);

        let userAgent;
        let clientHints;

        switch (browser.toLowerCase()) {
            case 'chrome':
                userAgent = this._buildChromeUA(platformString, chromeVersion, platform);
                clientHints = this._generateChromeClientHints(chromeVersion, platform, os);
                break;
            case 'firefox':
                userAgent = this._buildFirefoxUA(platformString, firefoxVersion);
                clientHints = {}; // Firefox doesn't send client hints
                break;
            case 'edge':
                userAgent = this._buildEdgeUA(platformString, chromeVersion, edgeVersion);
                clientHints = this._generateEdgeClientHints(chromeVersion, edgeVersion, platform, os);
                break;
            case 'safari':
                userAgent = this._buildSafariUA(platformString, safariVersion);
                clientHints = this._generateSafariClientHints(safariVersion);
                break;
            default:
                userAgent = this._buildChromeUA(platformString, chromeVersion, platform);
                clientHints = this._generateChromeClientHints(chromeVersion, platform, os);
        }

        return { userAgent, clientHints };
    }

    /**
     * Generate a random desktop Chrome user agent
     * @returns {{userAgent: string, clientHints: Object}}
     */
    generateDesktopChrome() {
        const os = this._randomChoice(['windows', 'macos', 'linux']);
        return this.generate({ platform: 'desktop', browser: 'chrome', os });
    }

    /**
     * Generate a random mobile Chrome user agent
     * @returns {{userAgent: string, clientHints: Object}}
     */
    generateMobileChrome() {
        const os = this._randomChoice(['android', 'ios']);
        return this.generate({ platform: 'mobile', browser: 'chrome', os });
    }

    /**
     * Generate client hints headers from user agent string
     * @param {string} userAgent
     * @returns {Object}
     */
    generateClientHintsFromUA(userAgent) {
        const result = this._parseUserAgent(userAgent);
        const hints = {};

        if (result.chrome) {
            hints['Sec-CH-UA'] = `"Chromium";v="${result.chrome}", "Not_A Brand";v="8", "Google Chrome";v="${result.chrome}"`;
            hints['Sec-CH-UA-Mobile'] = userAgent.includes('Mobile') ? '?1' : '?0';
            hints['Sec-CH-UA-Platform'] = this._detectPlatformFromUA(userAgent);
        } else if (result.edge) {
            hints['Sec-CH-UA'] = `"Chromium";v="${result.chrome}", "Not_A Brand";v="8", "Microsoft Edge";v="${result.edge}"`;
            hints['Sec-CH-UA-Mobile'] = '?0';
            hints['Sec-CH-UA-Platform'] = this._detectPlatformFromUA(userAgent);
        }

        return hints;
    }

    // Private methods

    _buildChromeUA(platform, version, type) {
        const mobile = type === 'mobile' ? ' Mobile' : '';
        return `Mozilla/5.0 ${platform} ${RENDERING_ENGINES.chrome_webkit} Chrome/${version}.0.0.0${mobile} Safari/537.36`;
    }

    _buildFirefoxUA(platform, version) {
        return `Mozilla/5.0 ${platform}; rv:${version}.0 ${RENDERING_ENGINES.firefox_gecko} Firefox/${version}.0`;
    }

    _buildEdgeUA(platform, chromeVersion, edgeVersion) {
        return `Mozilla/5.0 ${platform} ${RENDERING_ENGINES.chrome_webkit} Chrome/${chromeVersion}.0.0.0 Safari/537.36 Edg/${edgeVersion}.0.0.0`;
    }

    _buildSafariUA(platform, version) {
        return `Mozilla/5.0 ${platform} AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version}.0 Safari/605.1.15`;
    }

    _generateChromeClientHints(chromeVersion, platform, os) {
        return {
            'Sec-CH-UA': `"Chromium";v="${chromeVersion}", "Not_A Brand";v="8", "Google Chrome";v="${chromeVersion}"`,
            'Sec-CH-UA-Mobile': platform === 'mobile' ? '?1' : '?0',
            'Sec-CH-UA-Platform': this._getPlatformName(os),
            'Sec-CH-UA-Platform-Version': this._getPlatformVersion(os),
            'Sec-CH-UA-Full-Version-List': `"Chromium";v="${chromeVersion}.0.0.0", "Not_A Brand";v="8.0.0.0", "Google Chrome";v="${chromeVersion}.0.0.0"`,
        };
    }

    _generateEdgeClientHints(chromeVersion, edgeVersion, platform, os) {
        return {
            'Sec-CH-UA': `"Chromium";v="${chromeVersion}", "Not_A Brand";v="8", "Microsoft Edge";v="${edgeVersion}"`,
            'Sec-CH-UA-Mobile': platform === 'mobile' ? '?1' : '?0',
            'Sec-CH-UA-Platform': this._getPlatformName(os),
        };
    }

    _generateSafariClientHints(version) {
        // Safari has limited client hints support
        return {
            'Sec-CH-UA-Platform': '"macOS"',
        };
    }

    _getPlatformString(platform, os) {
        if (platform === 'mobile') {
            const osData = MOBILE_PLATFORMS[os];
            if (!osData) return MOBILE_PLATFORMS.android.generic;
            const variants = Object.values(osData);
            return variants[Math.floor(Math.random() * variants.length)];
        } else {
            const osData = DESKTOP_PLATFORMS[os];
            if (!osData) return DESKTOP_PLATFORMS.windows['10_64'];
            const variants = Object.values(osData);
            return variants[Math.floor(Math.random() * variants.length)];
        }
    }

    _getPlatformName(os) {
        const names = {
            windows: '"Windows"',
            macos: '"macOS"',
            linux: '"Linux"',
            android: '"Android"',
            ios: '"iOS"',
        };
        return names[os] || '"Windows"';
    }

    _getPlatformVersion(os) {
        const versions = {
            windows: '"10.0.0"',
            macos: '"10.15.7"',
            linux: '""',
            android: '"14.0.0"',
            ios: '"17.4.0"',
        };
        return versions[os] || '"10.0.0"';
    }

    _getDefaultOS(platform) {
        if (platform === 'mobile') {
            return Math.random() > 0.3 ? 'android' : 'ios';
        }
        const rand = Math.random();
        if (rand < 0.65) return 'windows';
        if (rand < 0.85) return 'macos';
        return 'linux';
    }

    _parseUserAgent(ua) {
        const result = {};

        const chromeMatch = ua.match(/Chrome\/(\d+)/);
        if (chromeMatch) result.chrome = chromeMatch[1];

        const edgeMatch = ua.match(/Edg\/(\d+)/);
        if (edgeMatch) result.edge = edgeMatch[1];

        const firefoxMatch = ua.match(/Firefox\/(\d+)/);
        if (firefoxMatch) result.firefox = firefoxMatch[1];

        const safariMatch = ua.match(/Version\/(\d+)/);
        if (safariMatch && !result.chrome) result.safari = safariMatch[1];

        return result;
    }

    _detectPlatformFromUA(ua) {
        if (ua.includes('Windows')) return '"Windows"';
        if (ua.includes('Macintosh') || ua.includes('Mac OS')) return '"macOS"';
        if (ua.includes('Linux') && !ua.includes('Android')) return '"Linux"';
        if (ua.includes('Android')) return '"Android"';
        if (ua.includes('iPhone') || ua.includes('iPad')) return '"iOS"';
        return '"Windows"';
    }

    _randomChoice(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }
}

/**
 * Create a user agent generator instance
 * @param {Object} options
 * @returns {UserAgentGenerator}
 */
function createUserAgentGenerator(options = {}) {
    return new UserAgentGenerator(options);
}

module.exports = UserAgentGenerator;
module.exports.createUserAgentGenerator = createUserAgentGenerator;
