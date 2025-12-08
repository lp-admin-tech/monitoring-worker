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
            const { Network, Page, Runtime, DOM, CSS, Input, Emulation, Security } = this.client;

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
        const timeout = options.timeout || 60000;

        try {
            logger.info(`[CDP] Navigating to ${url}`);

            const loadPromise = new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Navigation timeout')), timeout);
                Page.loadEventFired(() => {
                    clearTimeout(timer);
                    resolve();
                });
            });

            await Page.navigate({ url });
            await loadPromise;

            logger.info(`[CDP] Navigation complete: ${url}`);
            return true;
        } catch (error) {
            logger.warn(`[CDP] Navigation error: ${error.message}`);
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

    async close() {
        try {
            if (this.client) {
                await this.client.close();
                this.client = null;
            }
            if (this.chrome) {
                await this.chrome.kill();
                this.chrome = null;
            }
            logger.info('[CDP] Chrome closed');
        } catch (error) {
            logger.warn('[CDP] Error closing Chrome', { error: error.message });
        }
    }

    getClient() {
        return this.client;
    }

    isConnected() {
        return this.client !== null && this.chrome !== null;
    }
}

module.exports = ChromeCDPClient;
