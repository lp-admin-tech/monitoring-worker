const { chromium } = require('playwright');
const logger = require('../logger');
const { extractMetrics } = require('./metrics');
const { captureHAR, setupNetworkLogging } = require('./har-capture');
const { createDOMSnapshot } = require('./dom-snapshot');
const { setupMutationObservers } = require('./observers');
const { extractAdElements, extractIframes } = require('./extractors');
const { uploadToStorage } = require('./storage');
const { generateUserAgent } = require('./user-agent-rotation');

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

      await context.close();

      logger.info(`Crawl completed for publisher: ${publisher.site_name}`, {
        adCount: adElements.length,
        iframeCount: iframes.length,
        mutations: mutationLog.length,
      });

      return crawlData;
    } catch (error) {
      logger.error(`Error crawling publisher: ${publisher.site_name}`, error);
      throw error;
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  async crawlPublisherSubdirectories(publisher, options = {}) {
    const results = [];
    let directoriesToCrawl = publisher.subdirectories || [];

    const mainCrawlResult = await this.crawlPublisher(publisher, options);
    results.push(mainCrawlResult);

    if (directoriesToCrawl.length === 0) {
      const page = await this.browser.newPage();
      try {
        await this.navigateToPage(page, publisher.site_url);
        const discoveredDirs = await this.discoverDirectories(page, publisher.site_url);
        directoriesToCrawl = discoveredDirs;
        logger.info(`Auto-discovered ${discoveredDirs.length} directories for ${publisher.site_name}`);
      } catch (error) {
        logger.warn(`Failed to auto-discover directories: ${error.message}`);
      } finally {
        await page.close().catch(() => {});
      }
    }

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
        waitUntil: 'networkidle',
        timeout: 30000,
      });
    } catch (error) {
      logger.warn(`Navigation timeout for ${url}, continuing with partial load`, error);
      await page.waitForTimeout(2000);
    }
  }

  async captureScreenshot(page, publisherId) {
    try {
      const timestamp = new Date().getTime();
      const filename = `screenshot-${publisherId}-${timestamp}.png`;
      const path = `/tmp/${filename}`;
      await page.screenshot({ path, fullPage: true });
      return filename;
    } catch (error) {
      logger.error('Failed to capture screenshot', error);
      return null;
    }
  }

  async discoverDirectories(page, baseUrl) {
    const discoveredDirs = new Set();
    try {
      const baseUrlObj = new URL(baseUrl);
      const baseDomain = `${baseUrlObj.protocol}//${baseUrlObj.host}`;

      const links = await page.locator('a[href]').all();

      for (const link of links) {
        try {
          const href = await link.getAttribute('href');
          if (!href) continue;

          const absoluteUrl = new URL(href, baseUrl).href;
          const absoluteUrlObj = new URL(absoluteUrl);

          if (absoluteUrlObj.hostname === baseUrlObj.hostname) {
            const pathname = absoluteUrlObj.pathname;
            const segments = pathname.split('/').filter(s => s.length > 0);

            if (segments.length > 0) {
              const firstSegment = '/' + segments[0];

              if (firstSegment !== '/' && !firstSegment.includes('.')) {
                discoveredDirs.add(firstSegment);
              }
            }
          }
        } catch (error) {
          continue;
        }
      }

      const dirsArray = Array.from(discoveredDirs);
      logger.info(`Discovered ${dirsArray.length} directories on ${baseUrl}: ${dirsArray.join(', ')}`);

      return dirsArray;
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
}

module.exports = new Crawler();
