const { chromium } = require('playwright');
const logger = require('../logger');
const { extractMetrics } = require('./metrics');
const { captureHAR, setupNetworkLogging } = require('./har-capture');
const { createDOMSnapshot } = require('./dom-snapshot');
const { setupMutationObservers } = require('./observers');
const { extractAdElements, extractIframes } = require('./extractors');
const { uploadToStorage } = require('./storage');
const { generateUserAgent } = require('./user-agent-rotation');
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

      const context = await this.browser.newContext({
        userAgent: this.getRandomUserAgent(),
        viewportSize: viewport,
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      page = await context.newPage();

      const harRecorder = setupNetworkLogging(page);
      const mutationLog = [];
      const timingMarks = {};

      setupMutationObservers(page, mutationLog);

      timingMarks.startTime = Date.now();

      await this.navigateToPage(page, publisher.site_url);

      timingMarks.navigationComplete = Date.now();

      await new Promise(resolve => setTimeout(resolve, sessionDuration));

      timingMarks.endTime = Date.now();

      const metrics = await extractMetrics(page);
      const domSnapshot = await createDOMSnapshot(page);
      const adElements = await extractAdElements(page);
      const iframes = await extractIframes(page);
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
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded', // Faster than networkidle
        timeout: 60000,
      });

      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      } catch (e) {
        logger.warn(`Network idle timeout for ${url}, proceeding with available content`);
      }
    } catch (error) {
      logger.warn(`Navigation timeout for ${url}, continuing with partial load`, error);
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
      const discoveredDirs = await page.evaluate((baseUrl) => {
        try {
          // Validate baseUrl before using it
          if (!baseUrl || typeof baseUrl !== 'string') {
            return [];
          }

          // Try to construct URL, return empty array if invalid
          let baseUrlObj;
          try {
            baseUrlObj = new URL(baseUrl);
          } catch (e) {
            return [];
          }

          const discovered = new Set();
          const links = document.querySelectorAll('a[href]');

          for (const link of links) {
            try {
              const href = link.href;
              if (!href) continue;

              const absoluteUrl = new URL(href, baseUrl);

              if (absoluteUrl.hostname === baseUrlObj.hostname) {
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
      }, normalizedUrl);

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

  async extractPageContent(page) {
    try {
      // Wait for body to be available
      await page.waitForSelector('body', { timeout: 5000 }).catch(() => { });

      return await page.evaluate(() => {
        // Helper to clean text
        const cleanText = (text) => {
          return text
            .replace(/\\s+/g, ' ')
            .replace(/[\\n\\r]+/g, ' ')
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
              return text;
            }
          }
        }

        // 2. Fallback to body innerText
        const bodyText = cleanText(document.body.innerText);
        if (bodyText.length > 50) {
          return bodyText;
        }

        // 3. Fallback to textContent (includes hidden text, but better than nothing)
        const bodyContent = cleanText(document.body.textContent);
        if (bodyContent.length > 50) {
          return bodyContent;
        }

        // 4. Last resort: meta description
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc && metaDesc.content) {
          return metaDesc.content;
        }

        return "No content extracted";
      });
    } catch (error) {
      logger.warn('Error extracting page content', error);
      return "Error extracting content";
    }
  }
}

module.exports = new Crawler();
