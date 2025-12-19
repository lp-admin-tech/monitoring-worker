/**
 * Chrome CDP Client
 * Raw Chrome DevTools Protocol connection without Playwright/Puppeteer overhead
 */

const chromeLauncher = require('chrome-launcher');
const CDP = require('chrome-remote-interface');
const logger = require('../logger');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Find Chrome/Chromium executable path
 * Checks: environment variable, Playwright cache, system paths
 */
function findChromePath() {
    // 1. Environment variable (highest priority)
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
        return process.env.CHROME_PATH;
    }

    // 2. Playwright's Chromium cache (common on servers)
    const homeDir = os.homedir();
    const playwrightPaths = [
        // Linux
        path.join(homeDir, '.cache/ms-playwright'),
        // macOS
        path.join(homeDir, 'Library/Caches/ms-playwright'),
        // Windows
        path.join(homeDir, 'AppData/Local/ms-playwright'),
    ];

    for (const playwrightCache of playwrightPaths) {
        if (fs.existsSync(playwrightCache)) {
            try {
                const chromiumDirs = fs.readdirSync(playwrightCache)
                    .filter(d => d.startsWith('chromium-'))
                    .sort()
                    .reverse(); // Get newest version

                for (const chromiumDir of chromiumDirs) {
                    const chromePaths = [
                        // Linux
                        path.join(playwrightCache, chromiumDir, 'chrome-linux/chrome'),
                        // macOS
                        path.join(playwrightCache, chromiumDir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
                        // Windows
                        path.join(playwrightCache, chromiumDir, 'chrome-win/chrome.exe'),
                    ];

                    for (const chromePath of chromePaths) {
                        if (fs.existsSync(chromePath)) {
                            logger.info('[CDP] Found Playwright Chromium:', chromePath);
                            return chromePath;
                        }
                    }
                }
            } catch (e) {
                // Continue to next path
            }
        }
    }

    // 3. System Chrome/Chromium paths
    const systemPaths = [
        // Linux
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        // Snap
        '/snap/bin/chromium',
        // macOS
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];

    for (const chromePath of systemPaths) {
        if (fs.existsSync(chromePath)) {
            logger.info('[CDP] Found system Chrome:', chromePath);
            return chromePath;
        }
    }

    // 4. Let chrome-launcher try to find it (may fail)
    logger.warn('[CDP] No Chrome found, letting chrome-launcher search...');
    return undefined;
}

class ChromeCDPClient {
    constructor(options = {}) {
        this.chrome = null;
        this.client = null;
        this.chromePath = findChromePath();
        this.options = {
            headless: true,
            proxy: null,
            userDataDir: null,
            userAgent: null,
            ...options
        };
    }

    async launch() {
        const chromeFlags = [
            // Security & Sandbox
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',

            // Performance
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',

            // Disable unnecessary features
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-client-side-phishing-detection',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-hang-monitor',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--safebrowsing-disable-auto-update',

            // Window settings
            '--window-size=1920,1080',
            '--start-maximized',
        ];

        if (this.options.headless) {
            chromeFlags.push('--headless=new');
        }

        if (this.options.proxy) {
            chromeFlags.push(`--proxy-server=${this.options.proxy}`);
        }

        if (this.options.userDataDir) {
            chromeFlags.push(`--user-data-dir=${this.options.userDataDir}`);
        }

        try {
            logger.info('[CDP] Launching Chrome process...', {
                chromePath: this.chromePath || 'auto-detect'
            });

            // Launch Chrome with explicit path
            this.chrome = await chromeLauncher.launch({
                chromePath: this.chromePath, // Use detected path
                chromeFlags,
                logLevel: 'silent',
                ignoreDefaultFlags: true,
                defaultFlags: chromeLauncher.Launcher.defaultFlags().filter(
                    flag => !flag.includes('disable-extensions')
                )
            });

            logger.info('[CDP] Chrome launched on port ' + this.chrome.port);

            // Connect via CDP
            this.client = await CDP({ port: this.chrome.port });

            // Destructure the domains we need
            const { Network, Page, Runtime, DOM, CSS, Emulation, Security } = this.client;

            // Enable required domains
            await Promise.all([
                Network.enable(),
                Page.enable(),
                Runtime.enable(),
                DOM.enable(),
                CSS.enable(),
                Security.enable()
            ]);

            // Set User-Agent if provided
            if (this.options.userAgent) {
                await Emulation.setUserAgentOverride({
                    userAgent: this.options.userAgent
                });
                logger.info('[CDP] User-Agent override applied');
            }

            // Ignore certificate errors (for testing)
            await Security.setIgnoreCertificateErrors({ ignore: true });

            // Handle disconnection
            this.client.on('disconnect', () => {
                logger.warn('[CDP] Chrome disconnected unexpectedly');
                this.client = null;
            });

            logger.info('[CDP] Chrome connected and domains enabled');

            return this.client;
        } catch (error) {
            logger.error('[CDP] Failed to launch Chrome', { error: error.message });
            await this.close();
            throw error;
        }
    }

    async navigate(url, options = {}) {
        const { Page } = this.client;
        const timeout = options.timeout || 120000; // 120s default timeout

        try {
            logger.info(`[CDP] Navigating to ${url} (timeout: ${timeout}ms)`);

            // Use multiple load event strategies
            const loadPromise = new Promise((resolve) => {
                let isResolved = false;

                const timer = setTimeout(() => {
                    if (!isResolved) {
                        logger.warn(`[CDP] Navigation timeout after ${timeout}ms for ${url}`);
                        // Don't reject, just resolve with what we have to avoid crashing the audit
                        resolve(false);
                    }
                }, timeout);

                const onSuccess = (event) => {
                    if (!isResolved) {
                        isResolved = true;
                        clearTimeout(timer);
                        logger.debug(`[CDP] Navigation success: ${event}`);
                        resolve(true);
                    }
                };

                // 1. Load Event (most reliable for full page)
                Page.loadEventFired(() => onSuccess('loadEventFired'));

                // 2. DOM Content Loaded (faster)
                Page.domContentEventFired(() => onSuccess('domContentEventFired'));

                // 3. Frame Stopped Loading (fallback)
                Page.frameStoppedLoading(() => onSuccess('frameStoppedLoading'));
            });

            const { frameId, errorText } = await Page.navigate({ url });

            if (errorText) {
                logger.warn(`[CDP] Navigation error from Chrome: ${errorText}`);
                if (errorText.includes('net::ERR_NAME_NOT_RESOLVED') || errorText.includes('net::ERR_CONNECTION_REFUSED')) {
                    return false;
                }
            }

            const success = await loadPromise;

            // Small additional wait for dynamic content
            await new Promise(resolve => setTimeout(resolve, 3000));

            logger.info(`[CDP] Navigation complete: ${url} (Success: ${success})`);
            return true; // Always return true to allow partial crawls unless network error
        } catch (error) {
            logger.warn(`[CDP] Navigation error: ${error.message}`, { url });
            return false;
        }
    }

    async evaluate(expression, returnByValue = true) {
        const { Runtime } = this.client;
        const { result, exceptionDetails } = await Runtime.evaluate({
            expression,
            returnByValue,
            awaitPromise: true
        });

        if (exceptionDetails) {
            throw new Error(exceptionDetails.exception?.description || 'Evaluation failed');
        }

        return result.value;
    }

    async screenshot(options = {}) {
        const { Page } = this.client;
        const { data } = await Page.captureScreenshot({
            format: options.format || 'png',
            quality: options.quality || 80,
            captureBeyondViewport: options.fullPage || false
        });
        return Buffer.from(data, 'base64');
    }

    /**
     * Wait for network to become idle (no pending requests for idleTime ms)
     * Inspired by Playwright's waitForLoadState('networkidle')
     * @param {number} timeout - Max wait time in ms
     * @param {number} idleTime - How long network must be idle
     * @returns {Promise<boolean>} - True if network became idle, false if timeout
     */
    async waitForNetworkIdle(timeout = 30000, idleTime = 500) {
        if (!this.client) return false;

        const { Network } = this.client;
        let pendingRequests = 0;
        let lastActivityTime = Date.now();
        let isResolved = false;

        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    logger.debug(`[CDP] Network idle timeout after ${timeout}ms (${pendingRequests} pending)`);
                    resolve(false);
                }
            }, timeout);

            const checkIdle = () => {
                if (isResolved) return;
                if (pendingRequests === 0 && Date.now() - lastActivityTime >= idleTime) {
                    isResolved = true;
                    clearTimeout(timeoutId);
                    logger.debug('[CDP] Network is idle');
                    resolve(true);
                }
            };

            // Track request start
            Network.requestWillBeSent(() => {
                pendingRequests++;
                lastActivityTime = Date.now();
            });

            // Track request end
            Network.loadingFinished(() => {
                pendingRequests = Math.max(0, pendingRequests - 1);
                lastActivityTime = Date.now();
                setTimeout(checkIdle, idleTime);
            });

            // Track failed requests
            Network.loadingFailed(() => {
                pendingRequests = Math.max(0, pendingRequests - 1);
                lastActivityTime = Date.now();
                setTimeout(checkIdle, idleTime);
            });

            // Initial check in case network is already idle
            setTimeout(checkIdle, idleTime);
        });
    }

    /**
     * Check if the CDP client is connected
     * @returns {boolean}
     */
    isConnected() {
        return this.client !== null && this.chrome !== null;
    }

    /**
     * Check if browser is healthy and ready for use
     * @returns {boolean}
     */
    isHealthy() {
        return this.isConnected();
    }

    /**
     * Block heavy resources to speed up crawling
     * @param {boolean} enable - Whether to enable blocking
     */
    async blockResources(enable = true) {
        if (!this.client) return;

        const { Network } = this.client;

        if (enable) {
            await Network.setBlockedURLs({
                urls: [
                    '*.woff', '*.woff2', '*.ttf', '*.otf', // Fonts
                    '*.mp4', '*.webm', '*.avi', '*.mov',   // Videos
                    '*.mp3', '*.wav', '*.ogg',             // Audio
                ]
            });
            logger.debug('[CDP] Resource blocking enabled');
        } else {
            await Network.setBlockedURLs({ urls: [] });
            logger.debug('[CDP] Resource blocking disabled');
        }
    }

    /**
     * Save a debug screenshot
     * @param {string} name - Screenshot name
     */
    async saveDebugScreenshot(name) {
        try {
            const screenshotBuffer = await this.screenshot();
            const debugDir = path.join(os.tmpdir(), 'cdp-debug');
            if (!fs.existsSync(debugDir)) {
                fs.mkdirSync(debugDir, { recursive: true });
            }
            const filepath = path.join(debugDir, `${name}_${Date.now()}.png`);
            fs.writeFileSync(filepath, screenshotBuffer);
            logger.debug(`[CDP] Debug screenshot saved: ${filepath}`);
        } catch (e) {
            logger.debug('[CDP] Failed to save debug screenshot:', e.message);
        }
    }

    /**
     * Attempt to reconnect to an existing Chrome process
     * Used for recovery when connection is lost during extraction
     */
    async reconnect() {
        if (!this.chrome || !this.chrome.port) {
            throw new Error('No Chrome process to reconnect to');
        }

        logger.info('[CDP] Attempting to reconnect to Chrome...');

        try {
            // Close existing client if any
            if (this.client) {
                try {
                    await this.client.close();
                } catch (e) { /* ignore */ }
                this.client = null;
            }

            // Re-establish CDP connection
            const CDP = require('chrome-remote-interface');
            this.client = await CDP({ port: this.chrome.port });

            // Re-enable required domains
            const { Network, Page, Runtime, Performance } = this.client;
            await Promise.all([
                Network.enable(),
                Page.enable(),
                Runtime.enable(),
                Performance.enable().catch(() => { })
            ]);

            logger.info('[CDP] Successfully reconnected to Chrome');
            return true;
        } catch (error) {
            logger.error('[CDP] Reconnection failed:', error.message);
            throw error;
        }
    }

    /**
     * Close the Chrome process and cleanup
     */
    async close() {
        try {
            if (this.client) {
                await this.client.close();
                this.client = null;
            }
        } catch (e) {
            logger.debug('[CDP] Error closing client:', e.message);
        }

        try {
            if (this.chrome) {
                await this.chrome.kill();
                this.chrome = null;
            }
        } catch (e) {
            logger.debug('[CDP] Error killing Chrome:', e.message);
        }

        logger.info('[CDP] Chrome closed');
    }

}

module.exports = ChromeCDPClient;
