const { chromium } = require('playwright');
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

class Crawler {
  constructor() {
    this.browser = null;
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
      '/news',
      '/blog',
      '/category',
      '/articles',
      '/sports',
      '/entertainment',
      '/business',
      '/health',
      '/tech',
      '/lifestyle',
      '/politics',
      '/world',
    ];
  }

  async initialize() {
    try {
      logger.info('Initializing Playwright browser');
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
        ],
      });
      logger.info('Browser initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize browser', error);
      throw error;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      logger.info('Browser closed');
    }
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  async crawlPublisher(publisher, options = {}) {
    const {
      sessionDuration = 70000,
      viewport = this.viewports[0],
      captureScreenshots = true,
      uploadResults = true,
      persistToDatabase = true,
      siteAuditId = null,
    } = options;

    let page = null;
    try {
      logger.info(`Starting crawl for publisher: ${publisher.site_name}`, {
        publisherId: publisher.id,
        url: publisher.site_url,
      });

      const contextOptions = {
        userAgent: this.getRandomUserAgent(),
        viewportSize: {
          width: viewport.width + Math.floor(Math.random() * 10),
          height: viewport.height + Math.floor(Math.random() * 10),
        },
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
          'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'sec-ch-ua-mobile': viewport.isMobile ? '?1' : '?0',
          'sec-ch-ua-platform': '"Windows"',
        },
      };

      // Add proxy if provided (Infrastructure for future use)
      if (options.proxyUrl) {
        contextOptions.proxy = {
          server: options.proxyUrl,
        };
        logger.info(`Using proxy: ${options.proxyUrl}`);
      }

      const context = await this.browser.newContext(contextOptions);

      page = await context.newPage();

      // 1. Stealth: Mask Bot Signals
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        // Mock Chrome
        window.chrome = { runtime: {} };
        // Mock Plugins
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      });

      // 2. Performance: Smart Resource Blocking
      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        const url = route.request().url();

        // Block heavy media and fonts
        if (['media', 'font', 'other'].includes(type)) {
          return route.abort();
        }

        // Smart Block Images: Block download but allow request to register in DOM
        // (We need the <img> tags for feature image detection, but don't need the bytes)
        if (type === 'image') {
          return route.abort();
        }

        // Block Analytics & Trackers (Optional list)
        if (url.includes('google-analytics') || url.includes('facebook.com/tr')) {
          return route.abort();
        }

        route.continue();
      });

      const harRecorder = setupNetworkLogging(page);
      const mutationLog = [];
      const timingMarks = {};

      setupMutationObservers(page, mutationLog);

      timingMarks.startTime = Date.now();

      // SECURITY: Validate URL to prevent SSRF attacks
      const urlValidation = validateUrl(publisher.site_url);
      if (!urlValidation.isValid) {
        throw new Error(`SSRF Protection: ${urlValidation.error}`);
      }
      logger.info(`URL validated: ${urlValidation.hostname}`);

      await this.navigateToPage(page, publisher.site_url);

      timingMarks.navigationComplete = Date.now();

      // Phase 2: Interaction & Access
      await this.handleConsentBanners(page);
      await this.simulateHumanBehavior(page);

      // Wait remaining session duration if needed, or just a fixed buffer since we simulated behavior
      // The sessionDuration was originally a big sleep. Now we've spent some time scrolling.
      // Let's keep a small buffer to ensure everything settles.
      await new Promise(resolve => setTimeout(resolve, 5000));

      timingMarks.endTime = Date.now();

      // Metrics extraction moved to end of flow to ensure page is settled

      const domSnapshot = await createDOMSnapshot(page);
      logger.info('DOM snapshot created:', {
        elementCount: domSnapshot.elementCount || 0,
        iframeCount: domSnapshot.iframeCount || 0,
        scriptCount: domSnapshot.scriptCount || 0
      });

      const adElements = await extractAdElements(page);
      logger.info('Ad elements extracted:', { count: adElements.length });

      const iframes = await extractIframes(page);
      logger.info('Iframes extracted:', { count: iframes.length });

      // Extract page content (Missing in previous version)
      const content = await this.extractPageContent(page);
      logger.info('Page content extracted:', { length: content.length });

      // Extract metrics LAST to ensure all resources/ads have loaded and LCP/CLS are captured
      const metrics = await extractMetrics(page);
      logger.info('Metrics extracted (final):', {
        ttfb: metrics.coreLWP?.ttfb || 0,
        fcp: metrics.coreLWP?.fcp || 0,
        lcp: metrics.coreLWP?.lcp || 0,
        cls: metrics.coreLWP?.cls || 0,
        dcp: metrics.coreLWP?.dcp || 0,
        jsWeight: metrics.jsWeight || 0,
        resourceCount: metrics.resourceCount || 0
      });

      const har = harRecorder.getHAR();

      const crawlData = {
        publisherId: publisher.id,
        publisherName: publisher.site_name,
        url: publisher.site_url,
        subdirectories: publisher.subdirectories || [],
        viewport: viewport.name,
        timestamp: new Date().toISOString(),
        sessionDuration,
        metrics: {
          ...metrics,
          timingMarks,
        },
        adElements,
        iframes,
        content, // Add content to crawlData
        mutationLog,
        domSnapshot: {
          elementCount: domSnapshot.elementCount,
          iframeCount: domSnapshot.iframeCount,
          scriptCount: domSnapshot.scriptCount,
          adSlotIds: domSnapshot.adSlotIds,
        },
      };

      if (captureScreenshots) {
        crawlData.screenshotPath = await this.captureScreenshot(page, publisher.id);
      }

      if (uploadResults) {
        const uploadedPaths = await uploadToStorage(
          publisher.id,
          {
            har,
            mutationLog,
            domSnapshot,
            crawlData,
          }
        );
        crawlData.uploadedPaths = uploadedPaths;
      }

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
          } else {
            logger.warn('Failed to persist crawl data to database', { error: dbResult.error });
          }
        } catch (dbError) {
          logger.warn('Error persisting crawl data to database', dbError);
        }
      }

      await context.close();

      logger.info(`Crawl completed for publisher: ${publisher.site_name}`, {
        adCount: adElements.length,
        iframeCount: iframes.length,
        mutations: mutationLog.length,
        sessionId: crawlData.sessionId,
      });

      return crawlData;
    } catch (error) {
      logger.error(`Error crawling publisher: ${publisher.site_name}`, error);
      throw error;
    } finally {
      if (page) {
        await page.close().catch(() => { });
      }
    }
  }

  async crawlPublisherSubdirectories(publisher, options = {}) {
    const results = [];
    let directoriesToCrawl = [];

    // First, crawl the main page
    const mainCrawlResult = await this.crawlPublisher(publisher, options);
    results.push(mainCrawlResult);

    // ALWAYS auto-discover directories from the homepage
    const page = await this.browser.newPage();
    try {
      await this.navigateToPage(page, publisher.site_url);
      const discoveredDirs = await this.discoverDirectories(page, publisher.site_url);

      // Merge discovered directories with any specified ones
      const specifiedDirs = publisher.subdirectories || [];
      const allDirs = new Set([...specifiedDirs, ...discoveredDirs]);
      directoriesToCrawl = Array.from(allDirs);

      logger.info(`Found ${directoriesToCrawl.length} total directories for ${publisher.site_name}`, {
        discovered: discoveredDirs.length,
        specified: specifiedDirs.length,
        directories: directoriesToCrawl
      });
    } catch (error) {
      logger.warn(`Failed to auto-discover directories: ${error.message}`);
      // Fallback to specified directories if discovery fails
      directoriesToCrawl = publisher.subdirectories || [];
    } finally {
      await page.close().catch(() => { });
    }

    // Crawl all discovered and specified directories
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

  async navigateToPage(page, url) {
    const navigate = async (waitUntil, timeout) => {
      try {
        await page.goto(url, { waitUntil, timeout });
        return true;
      } catch (e) {
        return false;
      }
    };

    try {
      // Attempt 1: Standard load (90s timeout)
      logger.info(`Navigating to ${url} (Attempt 1: domcontentloaded)`);
      let success = await navigate('domcontentloaded', 90000);

      // Attempt 2: Relaxed load if first failed
      if (!success) {
        logger.warn(`Initial navigation timed out for ${url}, retrying with 'commit' event`);
        success = await navigate('commit', 60000);
      }

      if (!success) {
        throw new Error('Navigation failed after retries');
      }

      // Wait for network idle if possible, but don't fail the crawl
      try {
        await page.waitForLoadState('networkidle', { timeout: 15000 });
      } catch (e) {
        logger.warn(`Network idle timeout for ${url}, proceeding with available content`);
      }
    } catch (error) {
      logger.warn(`Navigation failed for ${url}, continuing with partial load`, error);
    }
  }

  async captureScreenshot(page, publisherId) {
    try {
      const timestamp = new Date().getTime();
      const filename = `screenshot-${publisherId}-${timestamp}.png`;
      const path = `/tmp/${filename}`;
      await page.screenshot({ path, fullPage: true, timeout: 5000 }).catch(() => {
        return page.screenshot({ path, fullPage: false }); // Fallback to viewport
      });
      return filename;
    } catch (error) {
      logger.error('Failed to capture screenshot', error);
      return null;
    }
  }

  async discoverDirectories(page, baseUrl) {
    try {
      // Normalize URL to ensure it has a protocol
      let normalizedUrl = baseUrl;
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = `https://${normalizedUrl}`;
      }

      try {
        new URL(normalizedUrl); // Validate URL before passing to evaluate
      } catch (e) {
        logger.warn(`Invalid base URL for directory discovery: ${baseUrl}`);
        return [];
      }

      // Use evaluate for performance - extracting thousands of links via Locators is slow
      const discoveredDirs = await page.evaluate(() => {
        try {
          const baseUrl = window.location.href;
          const rootHostname = window.location.hostname;

          if (!baseUrl || !rootHostname) return [];

          const discovered = new Set();
          const links = document.querySelectorAll('a[href]');

          for (const link of links) {
            try {
              const href = link.href;
              if (!href) continue;

              const absoluteUrl = new URL(href, baseUrl);

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

      logger.info(`Discovered ${discoveredDirs.length} directories on ${normalizedUrl}`);
      return discoveredDirs;
    } catch (error) {
      logger.warn(`Error discovering directories: ${error.message}`);
      return [];
    }
  }

  async crawlMultipleSites(sites, options = {}) {
    const results = [];

    if (!Array.isArray(sites) || sites.length === 0) {
      return { content: [], ads: [] };
    }

    for (const site of sites) {
      try {
        const siteName = typeof site === 'string' ? site : site.site_name;
        const siteUrl = typeof site === 'string' ? site : site.site_url;

        const publisherData = {
          id: `site-${Date.now()}`,
          site_name: siteName,
          site_url: siteUrl,
          subdirectories: site.subdirectories || [],
        };

        const crawlResults = await this.crawlPublisherSubdirectories(publisherData, options);
        results.push(...crawlResults);
      } catch (error) {
        logger.error(`Error crawling site: ${site}`, error);
        results.push({
          site: site,
          error: error.message,
        });
      }
    }

    return {
      content: results.filter(r => !r.error),
      ads: results.filter(r => r.adElements).flatMap(r => r.adElements || []),
    };
  }

  async extractPageMetrics(page) {
    return extractMetrics(page);
  }

  async extractPageAdElements(page) {
    return extractAdElements(page);
  }

  async extractPageIframes(page) {
    return extractIframes(page);
  }

  async simulateHumanBehavior(page) {
    try {
      logger.info('Simulating human behavior (scrolling & mouse movements)');

      // 1. Mouse movements (Bezier curves)
      // Move mouse to random positions to simulate "reading"
      for (let i = 0; i < 3; i++) {
        const x = Math.floor(Math.random() * 500);
        const y = Math.floor(Math.random() * 500);
        await page.mouse.move(x, y, { steps: 10 });
        await page.waitForTimeout(Math.random() * 500 + 200);
      }

      // 2. Smooth Scrolling (Trigger lazy loading)
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          const distance = 100;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            // Stop if we've scrolled past the bottom or for too long
            if (totalHeight >= scrollHeight || totalHeight > 5000) {
              clearInterval(timer);
              resolve();
            }
          }, 100); // Scroll every 100ms
        });
      });

      // Wait a bit after scrolling for lazy items to load
      await page.waitForTimeout(2000);

    } catch (error) {
      logger.warn('Error simulating human behavior', error);
    }
  }

  async handleConsentBanners(page) {
    try {
      logger.info('Checking for consent banners (CMP)');

      // Common selectors for "Accept/Agree" buttons
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
            await page.waitForTimeout(1000); // Wait for dismissal animation
            return; // Found and clicked one, usually enough
          }
        } catch (e) {
          // Ignore errors for individual selectors
        }
      }
    } catch (error) {
      logger.warn('Error handling consent banners', error);
    }
  }


  async extractPageContent(page) {
    try {
      // Wait for body to be available
      try {
        await page.waitForSelector('body', { timeout: 10000 });
        // Wait for some content to render (simple heuristic)
        await page.waitForFunction(() => document.body.innerText.length > 100, { timeout: 5000 }).catch(() => { });
      } catch (e) {
        logger.warn('Body selector timeout or content wait failed', e);
      }

      const content = await page.evaluate(() => {
        // Helper to clean text
        const cleanText = (text) => {
          return text
            .replace(/\s+/g, ' ')
            .replace(/[\n\r]+/g, ' ')
            .trim();
        };

        // 1. Try common content selectors first (usually higher quality)
        const contentSelectors = [
          'article',
          'main',
          '[role="main"]',
          '.post-content',
          '.article-content',
          '.entry-content',
          '#content',
          '.content'
        ];

        for (const selector of contentSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            const text = cleanText(element.innerText);
            if (text.length > 100) { // Threshold for meaningful content
              return { source: selector, text };
            }
          }
        }

        // 2. Fallback to body innerText
        const bodyText = cleanText(document.body.innerText);
        if (bodyText.length > 50) {
          return { source: 'body.innerText', text: bodyText };
        }

        // 3. Fallback to textContent (includes hidden text, but better than nothing)
        const bodyContent = cleanText(document.body.textContent);
        if (bodyContent.length > 50) {
          return { source: 'body.textContent', text: bodyContent };
        }

        // 4. Last resort: meta description
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc && metaDesc.content) {
          return { source: 'meta[name="description"]', text: metaDesc.content };
        }

        return { source: 'none', text: "No content extracted" };
      });

      logger.info(`Extracted content from ${content.source}, length: ${content.text.length}`);
      return content.text;

    } catch (error) {
      logger.warn('Error extracting page content', error);
      return "Error extracting content";
    }
  }
}

module.exports = new Crawler();
