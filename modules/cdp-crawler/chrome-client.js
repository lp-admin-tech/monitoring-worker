/**
 * Chrome CDP Client
 * Raw Chrome DevTools Protocol connection without Playwright/Puppeteer overhead
 */

const chromeLauncher = require('chrome-launcher');
const CDP = require('chrome-remote-interface');
const logger = require('../logger');

class ChromeCDPClient {
    constructor(options = {}) {
        this.chrome = null;
        this.client = null;
        this.options = {
            headless: true,
            proxy: null,
            userDataDir: null,
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
            logger.info('[CDP] Launching Chrome process...');

            // Launch Chrome
            this.chrome = await chromeLauncher.launch({
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
