/**
 * MFA Crawler - Powered by Crawlee
 * 
 * This module wraps the existing MFA detection logic with Crawlee's
 * enterprise-grade features: request queue, session pool, auto-scaling,
 * and smart retries.
 * 
 * All existing MFA detection logic is preserved from the original crawler.
 */

const { PlaywrightCrawler, Configuration, Dataset, KeyValueStore } = require('crawlee');
const { chromium } = require('playwright');
const axios = require('axios');
const logger = require('../logger');
const { extractMetrics } = require('./metrics');
const { captureHAR, setupNetworkLogging } = require('./har-capture');
const { createDOMSnapshot } = require('./dom-snapshot');
const { setupMutationObservers } = require('./observers');
const { extractAdElements, extractIframes } = require('./extractors');
const { uploadToStorage } = require('./storage');
const { generateUserAgent } = require('./user-agent-rotation');
const { validateUrl } = require('./url-validator');
const crawlerDB = require('./db');

// Configure Crawlee for Render.com deployment
Configuration.getGlobalConfig().set('persistStorage', false); // Use in-memory storage on Render

class CrawleeCrawler {
  constructor() {
    this.crawler = null;
    this.results = new Map();

    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ];

    this.viewports = [
      { width: 1920, height: 1080, name: 'desktop' },
      { width: 390, height: 844, name: 'mobile', isMobile: true },
    ];

    this.commonDirectories = [
      '/news', '/blog', '/category', '/articles', '/sports',
      '/entertainment', '/business', '/health', '/tech',
      '/lifestyle', '/politics', '/world',
    ];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  /**
   * Initialize the Crawlee crawler with all MFA detection features
   */
  async initialize() {
    logger.info('[Crawler] Initializing Crawlee PlaywrightCrawler with MFA detection features');

    // Don't block initialization - browser will be launched on first use
    // This prevents startup failures if Playwright isn't ready yet
    logger.info('[Crawler] Crawler initialized (browser will launch on first audit)');
  }

  /**
   * Ensure browser is available for direct context creation
   * Required by directory-audit-orchestrator.js
   */
  async ensureBrowser() {
    if (this.browser && this.browser.isConnected()) {
      logger.debug('[Crawler] Browser already connected');
      return;
    }

    logger.info('[Crawler] Launching Playwright browser...');

    try {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--disable-web-security',
          '--window-size=1280,720',  // Smaller viewport
          '--disable-infobars',
          '--disable-notifications',
          '--disable-popup-blocking',
          // Aggressive memory optimizations for 1GB RAM (e2-micro)
          '--single-process',
          '--no-zygote',
          '--disable-software-rasterizer',
          '--js-flags=--max-old-space-size=128',  // Reduced from 256
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-sync',
          '--disable-translate',
          '--mute-audio',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-component-update',
          '--disable-default-apps',
          '--disable-domain-reliability',
          '--disable-hang-monitor',
          '--memory-pressure-off',
          '--renderer-process-limit=1',
        ],
      });

      logger.info('[Crawler] Browser launched successfully', {
        isConnected: this.browser.isConnected(),
      });
    } catch (error) {
      logger.error('[Crawler] Failed to launch browser', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Close the crawler and browser
   */
  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
        logger.info('[Crawler] Browser closed');
      } catch (error) {
        logger.warn('[Crawler] Error closing browser', { error: error.message });
      }
      this.browser = null;
    }

    if (this.crawler) {
      logger.info('[Crawler] Crawler session ended');
    }
  }

  /**
   * Main crawl method - processes a single publisher
   * Preserves ALL original MFA detection logic
   */
  async crawlPublisher(publisher, options = {}) {
    const {
      sessionDuration = 60000,
      viewport = this.viewports[0],
      captureScreenshots = true,
      uploadResults = true,
      persistToDatabase = true,
      siteAuditId = null,
    } = options;

    // SECURITY: Validate URL to prevent SSRF attacks
    const urlValidation = validateUrl(publisher.site_url);
    if (!urlValidation.isValid) {
      throw new Error(`SSRF Protection: ${urlValidation.error}`);
    }
    logger.info(`URL validated: ${urlValidation.hostname}`);

    return new Promise((resolve, reject) => {
      const crawlData = {
        publisherId: publisher.id,
        publisherName: publisher.site_name,
        url: publisher.site_url,
        subdirectories: publisher.subdirectories || [],
        viewport: viewport.name,
        timestamp: new Date().toISOString(),
        sessionDuration,
      };

      // Create a one-time crawler for this publisher
      const crawler = new PlaywrightCrawler({
        // Crawlee configuration
        maxRequestsPerCrawl: 1,
        maxConcurrency: 1,
        requestHandlerTimeoutSecs: 180,
        maxRequestRetries: 3,

        // Session pool for anti-bot protection
        useSessionPool: true,
        sessionPoolOptions: {
          maxPoolSize: 10,
          sessionOptions: {
            maxUsageCount: 50,
          },
        },

        // Browser launch options (Render-compatible with aggressive memory limits)
        launchContext: {
          launchOptions: {
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-blink-features=AutomationControlled',
              '--disable-features=IsolateOrigins,site-per-process',
              '--disable-accelerated-2d-canvas',
              '--disable-gpu',
              '--disable-web-security',
              '--window-size=1280,720',  // Smaller viewport
              '--disable-infobars',
              '--disable-notifications',
              '--disable-popup-blocking',
              // Aggressive memory optimizations for 512MB RAM (Render free tier)
              '--single-process',
              '--no-zygote',
              '--disable-software-rasterizer',
              '--js-flags=--max-old-space-size=128',  // Limit JS heap
              '--disable-extensions',
              '--disable-background-networking',
              '--disable-sync',
              '--disable-translate',
              '--mute-audio',
              '--disable-background-timer-throttling',
              '--disable-backgrounding-occluded-windows',
              '--disable-renderer-backgrounding',
              '--disable-component-update',
              '--disable-default-apps',
              '--disable-domain-reliability',
              '--disable-hang-monitor',
              '--memory-pressure-off',
              '--renderer-process-limit=1',
            ],
          },
        },

        // Pre-navigation hook
        preNavigationHooks: [
          async ({ page, request }) => {
            // Set user agent and viewport
            const userAgent = this.getRandomUserAgent();
            await page.setExtraHTTPHeaders({
              'Accept-Language': 'en-US,en;q=0.9',
              'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
              'sec-ch-ua-mobile': viewport.isMobile ? '?1' : '?0',
              'sec-ch-ua-platform': '"Windows"',
            });

            // Stealth: Mask Bot Signals
            await page.addInitScript(() => {
              Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
              window.chrome = { runtime: {} };
              Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
              Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            });

            // Smart Resource Blocking (preserve ad-related resources)
            await page.route('**/*', (route) => {
              const type = route.request().resourceType();
              const url = route.request().url().toLowerCase();

              // Always allow scripts (including ad scripts)
              if (type === 'script') return route.continue();

              // Allow ad-related network requests
              const adDomains = [
                'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
                'googletag', 'gpt.js', 'adnxs.com', 'adsystem', 'pubmatic.com',
                'rubiconproject.com', 'openx.net', 'criteo', 'amazon-adsystem',
                'prebid', 'moatads.com', 'adsafeprotected.com', 'iasds01.com',
                'taboola.com', 'outbrain.com', 'mgid.com', 'revcontent.com',
                'teads.tv', 'sharethrough.com', 'triplelift.com', 'indexexchange.com'
              ];

              if (adDomains.some(domain => url.includes(domain))) {
                return route.continue();
              }

              // Allow XHR/fetch requests
              if (type === 'xhr' || type === 'fetch') return route.continue();

              // Block heavy media and fonts
              if (type === 'media' || type === 'font') return route.abort();

              // Block non-ad images
              if (type === 'image' && !adDomains.some(domain => url.includes(domain))) {
                return route.abort();
              }

              // Block analytics trackers
              if (url.includes('google-analytics.com/') || url.includes('facebook.com/tr')) {
                return route.abort();
              }

              route.continue();
            });
          },
        ],

        // Main request handler - contains all MFA detection logic
        requestHandler: async ({ page, request }) => {
          try {
            logger.info(`Crawling publisher: ${publisher.site_name}`, {
              publisherId: publisher.id,
              url: request.url,
            });

            const timingMarks = { startTime: Date.now() };
            const mutationLog = [];
            const resources = { js: [], css: [], images: [], xhr: [], fonts: [], total: 0 };

            // Set up HAR recorder
            const harRecorder = setupNetworkLogging(page);

            // Set up mutation observers
            setupMutationObservers(page, mutationLog);

            // Track resources
            page.on('response', async (response) => {
              try {
                const url = response.url();
                const type = response.request().resourceType();
                resources.total++;

                if (type === 'script') resources.js.push(url);
                else if (type === 'stylesheet') resources.css.push(url);
                else if (type === 'image') resources.images.push(url);
                else if (type === 'xhr' || type === 'fetch') resources.xhr.push(url);
                else if (type === 'font') resources.fonts.push(url);
              } catch (err) { /* Ignore */ }
            });

            // Wait for page to load
            await page.waitForLoadState('domcontentloaded', { timeout: 90000 });
            timingMarks.navigationComplete = Date.now();

            // Try to reach network idle
            try {
              await page.waitForLoadState('networkidle', { timeout: 15000 });
            } catch (e) {
              logger.warn('Network idle timeout, continuing with available content');
            }

            // Handle consent banners
            await this.handleConsentBanners(page);

            // Simulate human behavior (scrolling, mouse movements)
            await this.simulateHumanBehavior(page, sessionDuration);

            // Wait for ads to settle
            await new Promise(resolve => setTimeout(resolve, 5000));

            timingMarks.endTime = Date.now();

            // === MFA DETECTION PHASE ===

            // 1. Create DOM Snapshot
            const domSnapshot = await createDOMSnapshot(page);
            logger.info('DOM snapshot created:', {
              elementCount: domSnapshot.elementCount || 0,
              iframeCount: domSnapshot.iframeCount || 0,
              scriptCount: domSnapshot.scriptCount || 0
            });

            // 2. Extract Ad Elements
            const adElements = await extractAdElements(page);
            logger.info('Ad elements extracted:', { count: adElements.length });

            // 3. Extract Iframes
            const iframes = await extractIframes(page);
            logger.info('Iframes extracted:', { count: iframes.length });

            // 4. Extract Page Content
            const content = await this.extractPageContent(page);
            logger.info('Page content extracted:', { length: content.length });

            // 5. Extract Performance Metrics (LAST for accurate LCP/CLS)
            const metrics = await extractMetrics(page);
            logger.info('Metrics extracted:', {
              ttfb: metrics.coreLWP?.ttfb || 0,
              fcp: metrics.coreLWP?.fcp || 0,
              lcp: metrics.coreLWP?.lcp || 0,
              cls: metrics.coreLWP?.cls || 0,
            });

            // 6. Get HAR data
            const har = harRecorder.getHAR();

            // Log resource tracking
            logger.info('Resources loaded:', {
              total: resources.total,
              js: resources.js.length,
              css: resources.css.length,
              images: resources.images.length,
              xhr: resources.xhr.length,
            });

            // Validation checks
            const validationIssues = [];
            if (!content || content.length < 100) {
              validationIssues.push('Content extraction failed or returned minimal text');
            }
            if (!adElements || adElements.length === 0) {
              validationIssues.push('No ad elements detected');
            }
            if (!har.log.entries || har.log.entries.length < 5) {
              validationIssues.push('Very few network requests captured');
            }

            if (validationIssues.length > 0) {
              logger.warn('Crawl data validation issues:', {
                issues: validationIssues,
                url: request.url,
              });
            }

            // Build complete crawl data
            Object.assign(crawlData, {
              metrics: { ...metrics, timingMarks },
              resources: {
                total: resources.total,
                js: resources.js.length,
                css: resources.css.length,
                images: resources.images.length,
                xhr: resources.xhr.length,
                fonts: resources.fonts.length,
              },
              adElements,
              iframes,
              content,
              mutationLog,
              har,
              domSnapshot: {
                elementCount: domSnapshot.elementCount,
                iframeCount: domSnapshot.iframeCount,
                scriptCount: domSnapshot.scriptCount,
                adSlotIds: domSnapshot.adSlotIds,
              },
              validationIssues,
              dataQuality: {
                hasContent: content && content.length >= 100,
                hasAds: adElements && adElements.length > 0,
                hasNetworkData: har.log.entries && har.log.entries.length >= 5,
                adNetworksDetected: har.log.adAnalysis?.detectedNetworks || []
              }
            });

            // Capture screenshot
            if (captureScreenshots) {
              crawlData.screenshotPath = await this.captureScreenshot(page, publisher.id);
            }

            // Upload to storage
            if (uploadResults) {
              const uploadedPaths = await uploadToStorage(
                publisher.id,
                { har, mutationLog, domSnapshot, crawlData }
              );
              crawlData.uploadedPaths = uploadedPaths;
            }

            // Persist to database
            if (persistToDatabase) {
              try {
                const dbResult = await crawlerDB.saveCrawlData(
                  publisher.id,
                  siteAuditId,
                  {
                    url: publisher.site_url,
                    viewport: viewport.name,
                    viewportWidth: viewport.width,
                    viewportHeight: viewport.height,
                    userAgent: this.getRandomUserAgent(),
                    sessionDuration,
                    har,
                    domSnapshot,
                    metrics,
                    adElements,
                    screenshotPath: crawlData.screenshotPath,
                  }
                );

                if (dbResult.success) {
                  crawlData.sessionId = dbResult.sessionId;
                  logger.info('Crawl data persisted to database', { sessionId: dbResult.sessionId });
                }
              } catch (dbError) {
                logger.warn('Error persisting crawl data to database', dbError);
              }
            }

            logger.info(`Crawl completed for publisher: ${publisher.site_name}`, {
              adCount: adElements.length,
              iframeCount: iframes.length,
              mutations: mutationLog.length,
            });

          } catch (error) {
            logger.error(`Error in request handler: ${error.message}`);
            throw error;
          }
        },

        // Error handler with smart retry
        failedRequestHandler: async ({ request, error }) => {
          logger.error(`Request failed after retries: ${request.url}`, {
            error: error.message,
            retryCount: request.retryCount,
          });

          // Try Axios fallback
          try {
            const fallbackData = await this.crawlWithAxios(request.url, publisher);
            Object.assign(crawlData, fallbackData);
          } catch (fallbackError) {
            crawlData.error = error.message;
            crawlData.fallbackError = fallbackError.message;
          }
        },
      });

      // Run the crawler
      crawler.run([{ url: publisher.site_url, userData: publisher }])
        .then(() => {
          resolve(crawlData);
        })
        .catch((error) => {
          logger.error(`Crawler run failed: ${error.message}`);
          reject(error);
        });
    });
  }

  /**
   * Crawl publisher and all subdirectories
   */
  async crawlPublisherSubdirectories(publisher, options = {}) {
    const results = [];
    let directoriesToCrawl = [];

    // First, crawl the main page
    const mainCrawlResult = await this.crawlPublisher(publisher, options);
    results.push(mainCrawlResult);

    // Discover directories from the homepage
    try {
      const page = await chromium.launch({ headless: true }).then(b => b.newPage());
      try {
        await page.goto(publisher.site_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const discoveredDirs = await this.discoverDirectories(page, publisher.site_url);

        const specifiedDirs = publisher.subdirectories || [];
        const allDirs = new Set([...specifiedDirs, ...discoveredDirs]);
        directoriesToCrawl = Array.from(allDirs);

        logger.info(`Found ${directoriesToCrawl.length} total directories for ${publisher.site_name}`);
      } finally {
        await page.close().catch(() => { });
      }
    } catch (error) {
      logger.warn(`Failed to discover directories: ${error.message}`);
      directoriesToCrawl = publisher.subdirectories || [];
    }

    // Crawl all directories
    for (const subdirectory of directoriesToCrawl) {
      try {
        const subdirPublisher = {
          ...publisher,
          site_url: `${publisher.site_url}${subdirectory}`.replace(/\/+/g, '/'),
        };
        const crawlResult = await this.crawlPublisher(subdirPublisher, options);
        results.push(crawlResult);
      } catch (error) {
        logger.error(`Error crawling subdirectory: ${subdirectory}`, error);
        results.push({
          publisherId: publisher.id,
          subdirectory,
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Handle consent/cookie banners (preserved from original)
   */
  async handleConsentBanners(page) {
    try {
      logger.info('Checking for consent banners (CMP)');

      const consentSelectors = [
        '#onetrust-accept-btn-handler',
        '.fc-cta-consent',
        '.cc-btn.cc-accept',
        '[aria-label="Accept cookies"]',
        'button:has-text("Accept All")',
        'button:has-text("I Agree")',
        'button:has-text("Accept Cookies")',
        '.cmp-button',
        '#accept-cookies',
      ];

      for (const selector of consentSelectors) {
        try {
          const button = await page.$(selector);
          if (button && await button.isVisible()) {
            logger.info(`Found consent banner with selector: ${selector}, clicking...`);
            await button.click();
            await page.waitForTimeout(1000);
            return;
          }
        } catch (e) { /* Ignore */ }
      }
    } catch (error) {
      logger.warn('Error handling consent banners', error);
    }
  }

  /**
   * Simulate human behavior (preserved from original)
   */
  async simulateHumanBehavior(page, minDuration = 5000) {
    try {
      if (page.isClosed()) {
        logger.warn('Cannot simulate human behavior: page is already closed');
        return;
      }

      logger.info(`Simulating human behavior for ${minDuration / 1000}s`);

      // Mouse movements
      for (let i = 0; i < 5; i++) {
        if (page.isClosed()) return;
        const x = Math.floor(Math.random() * 500);
        const y = Math.floor(Math.random() * 500);
        await page.mouse.move(x, y, { steps: 10 }).catch(() => { });
        await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 100));
      }

      if (page.isClosed()) return;

      // Scrolling simulation
      await Promise.race([
        page.evaluate(async (duration) => {
          await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const startTime = Date.now();

            const timer = setInterval(() => {
              const scrollHeight = document.body.scrollHeight;
              const currentScroll = window.scrollY + window.innerHeight;

              window.scrollBy(0, distance);
              totalHeight += distance;

              if (currentScroll >= scrollHeight) {
                if (Date.now() - startTime < duration) {
                  window.scrollBy(0, -300);
                } else {
                  clearInterval(timer);
                  resolve();
                }
              }

              if (Date.now() - startTime >= duration) {
                clearInterval(timer);
                resolve();
              }
            }, 200);
          });
        }, minDuration),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Scroll timeout')), minDuration + 5000))
      ]).catch(err => {
        if (!err.message.includes('closed')) {
          logger.warn('Scrolling simulation timed out or failed');
        }
      });

      logger.info('Human behavior simulation completed');
    } catch (error) {
      if (!error.message?.includes('closed')) {
        logger.warn('Error simulating human behavior', error);
      }
    }
  }

  /**
   * Extract page content (preserved from original)
   */
  async extractPageContent(page) {
    const maxAttempts = 2;
    let lastContent = { source: 'none', text: '' };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        try {
          await page.waitForSelector('body', { timeout: 5000 });
          await page.waitForFunction(() => document.body && document.body.innerText.length > 100, { timeout: 5000 }).catch(() => { });
        } catch (e) {
          logger.warn('Body selector timeout', { attempt });
        }

        const content = await page.evaluate(() => {
          if (!document.body) return { source: 'none', text: "No body element found" };

          const cleanText = (text) => {
            if (!text) return '';
            return text.replace(/\s+/g, ' ').replace(/[\n\r]+/g, ' ').trim();
          };

          const contentSelectors = [
            'article', 'main', '[role="main"]', '.post-content',
            '.article-content', '.entry-content', '#content', '.content'
          ];

          for (const selector of contentSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              const text = cleanText(element.innerText);
              if (text.length > 100) {
                return { source: selector, text };
              }
            }
          }

          const bodyText = cleanText(document.body.innerText);
          if (bodyText.length > 50) {
            return { source: 'body.innerText', text: bodyText };
          }

          const bodyContent = cleanText(document.body.textContent);
          if (bodyContent.length > 50) {
            return { source: 'body.textContent', text: bodyContent };
          }

          const metaDesc = document.querySelector('meta[name="description"]');
          if (metaDesc && metaDesc.content) {
            return { source: 'meta[name="description"]', text: metaDesc.content };
          }

          return { source: 'none', text: "No content extracted" };
        });

        lastContent = content;

        if (content.text.length >= 100) {
          logger.info(`Extracted content from ${content.source}, length: ${content.text.length}`);
          return content.text;
        }

        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      } catch (error) {
        logger.warn('Error extracting page content', { error: error.message, attempt });
        if (attempt === maxAttempts) return "Error extracting content";
      }
    }

    return lastContent.text;
  }

  /**
   * Capture screenshot (preserved from original)
   */
  async captureScreenshot(page, publisherId) {
    try {
      const timestamp = new Date().getTime();
      const filename = `screenshot-${publisherId}-${timestamp}.png`;
      const path = `/tmp/${filename}`;
      await page.screenshot({ path, fullPage: true, timeout: 5000 }).catch(() => {
        return page.screenshot({ path, fullPage: false });
      });
      return filename;
    } catch (error) {
      logger.error('Failed to capture screenshot', error);
      return null;
    }
  }

  /**
   * Discover directories (preserved from original)
   */
  async discoverDirectories(page, baseUrl) {
    try {
      const discoveredDirs = await page.evaluate(() => {
        try {
          const rootHostname = window.location.hostname;
          if (!rootHostname) return [];

          const discovered = new Set();
          const links = document.querySelectorAll('a[href]');

          for (const link of links) {
            try {
              const href = link.href;
              if (!href) continue;

              const absoluteUrl = new URL(href, window.location.href);

              if (absoluteUrl.hostname === rootHostname) {
                const pathname = absoluteUrl.pathname;
                const segments = pathname.split('/').filter(s => s.length > 0);

                if (segments.length > 0) {
                  const firstSegment = '/' + segments[0];
                  if (firstSegment !== '/' && !firstSegment.includes('.')) {
                    discovered.add(firstSegment);
                  }
                }
              }
            } catch (e) { continue; }
          }
          return Array.from(discovered);
        } catch (err) {
          return [];
        }
      });

      logger.info(`Discovered ${discoveredDirs.length} directories on ${baseUrl}`);
      return discoveredDirs;
    } catch (error) {
      logger.warn(`Error discovering directories: ${error.message}`);
      return [];
    }
  }

  /**
   * Crawl multiple sites with parallel processing (NEW - Crawlee feature)
   */
  async crawlMultipleSites(sites, options = {}) {
    const results = [];

    if (!Array.isArray(sites) || sites.length === 0) {
      return { content: [], ads: [] };
    }

    // Crawlee enables parallel processing
    const crawlPromises = sites.map(async (site) => {
      try {
        const siteName = typeof site === 'string' ? site : site.site_name;
        const siteUrl = typeof site === 'string' ? site : site.site_url;

        const publisherData = {
          id: `site-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          site_name: siteName,
          site_url: siteUrl,
          subdirectories: site.subdirectories || [],
        };

        return await this.crawlPublisher(publisherData, options);
      } catch (error) {
        logger.error(`Error crawling site: ${site}`, error);
        return { site, error: error.message };
      }
    });

    // Process in batches for controlled parallelism
    const batchSize = options.maxConcurrency || 3;
    for (let i = 0; i < crawlPromises.length; i += batchSize) {
      const batch = crawlPromises.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
    }

    return {
      content: results.filter(r => !r.error),
      ads: results.filter(r => r.adElements).flatMap(r => r.adElements || []),
    };
  }

  /**
   * Axios fallback for when Playwright fails (preserved from original)
   */
  async crawlWithAxios(url, publisher) {
    try {
      logger.info(`Attempting fallback crawl with Axios for ${url}`);

      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 30000,
        maxRedirects: 5,
      });

      const html = response.data;
      const headers = response.headers;

      const extractBasicContent = (htmlString) => {
        let text = htmlString.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        text = text.replace(/<[^>]+>/g, ' ');
        text = text.replace(/\s+/g, ' ').trim();
        return text.substring(0, 5000);
      };

      const content = extractBasicContent(html);

      return {
        publisherId: publisher.id,
        publisherName: publisher.site_name,
        url,
        timestamp: new Date().toISOString(),
        fallbackMode: true,
        html,
        headers: {
          contentType: headers['content-type'],
          server: headers['server'],
          statusCode: response.status,
        },
        content,
        metrics: {
          htmlLength: html.length,
          contentLength: content.length,
        },
        dataQuality: {
          hasContent: content.length >= 100,
          hasHTML: html.length > 0,
          jsExecuted: false,
          screenshotCaptured: false,
        },
        validationIssues: [
          'Fallback mode: No JS execution',
          'Fallback mode: No ad detection',
          'Fallback mode: No screenshots',
        ],
      };
    } catch (error) {
      logger.error(`Axios fallback failed for ${url}`, { error: error.message });
      throw new Error(`All crawl methods failed: ${error.message}`);
    }
  }

  // === Compatibility methods for existing code ===

  async extractPageMetrics(page) {
    return extractMetrics(page);
  }

  async extractPageAdElements(page) {
    return extractAdElements(page);
  }

  async extractPageIframes(page) {
    return extractIframes(page);
  }
}

module.exports = new CrawleeCrawler();
