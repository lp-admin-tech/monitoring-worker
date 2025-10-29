import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

export class WebsiteCrawler {
  constructor() {
    this.browser = null;
    this.supabase = null;
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      this.supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
      );
    }
  }

  getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  async initBrowser() {
    if (!this.browser) {
      const launchOptions = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process'
        ]
      };

      if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
      }

      this.browser = await chromium.launch(launchOptions);
    }
  }

  async crawlSite(domain) {
    let context = null;
    let page = null;
    let tracePath = null;

    try {
      await this.initBrowser();

      context = await this.browser.newContext({
        userAgent: this.getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        bypassCSP: true,
        javaScriptEnabled: true,
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        }
      });

      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
      });

      const harData = [];
      const requestStats = {
        total: 0,
        scripts: 0,
        stylesheets: 0,
        images: 0,
        xhr: 0,
        fetch: 0,
        thirdParty: 0,
        totalSize: 0,
        blocked: 0
      };

      await context.route('**/*', (route) => {
        const request = route.request();
        const resourceType = request.resourceType();
        requestStats.total++;

        if (['image', 'font', 'media'].includes(resourceType)) {
          requestStats.blocked++;
          requestStats.images++;
          route.abort();
        } else {
          if (resourceType === 'script') requestStats.scripts++;
          if (resourceType === 'stylesheet') requestStats.stylesheets++;
          if (resourceType === 'xhr') requestStats.xhr++;
          if (resourceType === 'fetch') requestStats.fetch++;
          route.continue();
        }
      });

      page = await context.newPage();

      page.on('response', async (response) => {
        try {
          const request = response.request();
          const url = request.url();
          const headers = response.headers();
          const contentLength = parseInt(headers['content-length'] || '0');
          requestStats.totalSize += contentLength;

          const domainUrl = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
          const requestUrl = new URL(url);
          if (requestUrl.hostname !== domainUrl.hostname) {
            requestStats.thirdParty++;
          }

          harData.push({
            url,
            method: request.method(),
            status: response.status(),
            size: contentLength,
            timing: response.timing(),
            resourceType: request.resourceType()
          });
        } catch (e) {}
      });

      const url = domain.startsWith('http') ? domain : `https://${domain}`;

      let sslError = false;
      page.on('response', response => {
        if (response.status() === 0) {
          sslError = true;
        }
      });

      const startTime = Date.now();

      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 45000
        });
        await page.waitForTimeout(2000);
      } catch (error) {
        if (error.message.includes('SSL') || error.message.includes('ERR_CERT') || error.message.includes('net::')) {
          console.log(`[SSL-ERROR] SSL handshake failed for ${domain}: ${error.message}`);
          sslError = true;
        } else if (error.message.includes('Timeout')) {
          console.log(`[TIMEOUT] Page load timeout for ${domain}, continuing with partial data`);
        } else {
          throw error;
        }
      }

      await page.waitForLoadState('domcontentloaded').catch(() => {});
      const loadTime = Date.now() - startTime;

      const screenshot = await page.screenshot({
        fullPage: false,
        type: 'jpeg',
        quality: 75
      }).catch(() => null);

      const screenshotBase64 = screenshot ? screenshot.toString('base64') : null;

      const [htmlContent, pageData, performanceMetrics, layoutShiftData] = await Promise.all([
        page.content(),
        page.evaluate(() => {
          try {
            const links = Array.from(document.querySelectorAll('a')).map(a => a.href);

            const popupSelectors = ['.popup', '.modal', '[id*="popup"]', '[class*="popup"]', '[role="dialog"]'];
            const popupCount = popupSelectors.reduce((count, selector) => {
              return count + document.querySelectorAll(selector).length;
            }, 0);

            const performanceData = performance.getEntriesByType('navigation')[0];
            const paintData = performance.getEntriesByType('paint');

            const fcp = paintData.find(entry => entry.name === 'first-contentful-paint')?.startTime || 0;
            const lcp = paintData.find(entry => entry.name === 'largest-contentful-paint')?.startTime || 0;

            return {
              links,
              popupCount,
              fcp,
              lcp,
              metrics: {
                JSHeapUsedSize: performance.memory ? performance.memory.usedJSHeapSize : 0,
                JSHeapTotalSize: performance.memory ? performance.memory.totalJSHeapSize : 0,
                Timestamp: Date.now() / 1000,
                Documents: document.querySelectorAll('*').length,
                Frames: window.frames.length,
                Nodes: document.querySelectorAll('*').length,
                LayoutDuration: performanceData ? performanceData.domComplete - performanceData.domLoading : 0,
                ScriptDuration: performanceData ? performanceData.domContentLoadedEventEnd - performanceData.domContentLoadedEventStart : 0,
                TaskDuration: performanceData ? performanceData.loadEventEnd - performanceData.loadEventStart : 0,
                DomContentLoaded: performanceData ? performanceData.domContentLoadedEventEnd : 0,
                LoadComplete: performanceData ? performanceData.loadEventEnd : 0
              }
            };
          } catch (e) {
            return {
              links: [],
              popupCount: 0,
              fcp: 0,
              lcp: 0,
              metrics: {
                JSHeapUsedSize: 0,
                JSHeapTotalSize: 0,
                Timestamp: Date.now() / 1000,
                Documents: 0,
                Frames: 0,
                Nodes: 0,
                LayoutDuration: 0,
                ScriptDuration: 0,
                TaskDuration: 0,
                DomContentLoaded: 0,
                LoadComplete: 0
              }
            };
          }
        }),
        page.evaluate(() => {
          const metrics = performance.getEntriesByType('navigation')[0];
          return {
            domInteractive: metrics?.domInteractive || 0,
            domComplete: metrics?.domComplete || 0,
            loadEventEnd: metrics?.loadEventEnd || 0,
            transferSize: metrics?.transferSize || 0,
            encodedBodySize: metrics?.encodedBodySize || 0
          };
        }),
        page.evaluate(() => {
          const layoutShifts = performance.getEntriesByType('layout-shift');
          let cls = 0;
          layoutShifts.forEach(entry => {
            if (!entry.hadRecentInput) {
              cls += entry.value;
            }
          });
          return { cls, shiftCount: layoutShifts.length };
        })
      ]);

      await page.close();
      await context.close();

      return {
        success: true,
        htmlContent,
        links: pageData.links,
        loadTime,
        popupCount: pageData.popupCount,
        metrics: pageData.metrics,
        performanceMetrics: {
          ...performanceMetrics,
          fcp: pageData.fcp,
          lcp: pageData.lcp,
          cls: layoutShiftData.cls,
          layoutShiftCount: layoutShiftData.shiftCount
        },
        requestStats,
        harData: harData.slice(0, 50),
        screenshot: screenshotBase64,
        sslError: sslError || false
      };
    } catch (error) {
      console.error('[CRAWLER] Error details:', error);

      if (page) {
        try {
          await page.close();
        } catch (e) {
          console.error('[CRAWLER] Error closing page:', e.message);
        }
      }

      if (context) {
        try {
          await context.close();
        } catch (e) {
          console.error('[CRAWLER] Error closing context:', e.message);
        }
      }

      let errorMessage = error.message;

      if (error.message.includes('Timeout')) {
        errorMessage = `Website is down or not responding. The page failed to load within 45 seconds.`;
      } else if (error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
        errorMessage = `Website is offline. Domain name could not be resolved (DNS failure).`;
      } else if (error.message.includes('net::ERR_CONNECTION_REFUSED')) {
        errorMessage = `Website is offline. Connection was refused by the server.`;
      } else if (error.message.includes('net::ERR_CONNECTION_TIMED_OUT')) {
        errorMessage = `Website is down. Connection timed out.`;
      } else if (error.message.includes('SSL') || error.message.includes('ERR_CERT')) {
        errorMessage = `Website has SSL certificate issues and cannot be accessed securely.`;
      }

      return {
        success: false,
        error: errorMessage,
        isOffline: true
      };
    }
  }

  async checkMobileFriendly(domain) {
    let context = null;
    let page = null;

    try {
      await this.initBrowser();
      context = await this.browser.newContext({
        viewport: { width: 375, height: 667 },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        hasTouch: true,
        isMobile: true,
        ignoreHTTPSErrors: true
      });

      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      await context.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'font', 'media'].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      page = await context.newPage();

      const url = domain.startsWith('http') ? domain : `https://${domain}`;

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      }).catch(() => page.waitForLoadState('domcontentloaded'));
      await page.waitForTimeout(2000).catch(() => {});

      const screenshot = await page.screenshot({
        fullPage: false,
        type: 'jpeg',
        quality: 60
      }).catch(() => null);

      const isMobileFriendly = await page.evaluate(() => {
        try {
          const viewport = document.querySelector('meta[name="viewport"]');
          return viewport !== null;
        } catch (e) {
          return false;
        }
      }).catch(() => false);

      await page.close();
      await context.close();

      return {
        isMobileFriendly,
        screenshot: screenshot ? screenshot.toString('base64') : null
      };
    } catch (error) {
      console.error('[CRAWLER] Mobile check error:', error.message);

      if (page) {
        try {
          await page.close();
        } catch (e) {}
      }

      if (context) {
        try {
          await context.close();
        } catch (e) {}
      }

      return { isMobileFriendly: false, screenshot: null };
    }
  }

  async checkAccessibility(domain) {
    let context = null;
    let page = null;

    try {
      await this.initBrowser();
      context = await this.browser.newContext({
        userAgent: this.getRandomUserAgent(),
        ignoreHTTPSErrors: true
      });

      await context.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'font', 'media'].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      page = await context.newPage();

      const url = domain.startsWith('http') ? domain : `https://${domain}`;
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      }).catch(() => page.waitForLoadState('domcontentloaded'));
      await page.waitForTimeout(2000).catch(() => {});

      const accessibilitySnapshot = await page.accessibility.snapshot();

      const issues = await page.evaluate(() => {
        const problems = [];

        const images = document.querySelectorAll('img');
        images.forEach(img => {
          if (!img.alt) {
            problems.push({ type: 'missing-alt', element: 'img' });
          }
        });

        const inputs = document.querySelectorAll('input');
        inputs.forEach(input => {
          if (!input.labels || input.labels.length === 0) {
            problems.push({ type: 'missing-label', element: 'input' });
          }
        });

        const buttons = document.querySelectorAll('button');
        buttons.forEach(btn => {
          if (!btn.textContent.trim() && !btn.ariaLabel) {
            problems.push({ type: 'missing-button-text', element: 'button' });
          }
        });

        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        let previousLevel = 0;
        headings.forEach(heading => {
          const level = parseInt(heading.tagName.substring(1));
          if (level - previousLevel > 1) {
            problems.push({ type: 'heading-skip', element: heading.tagName });
          }
          previousLevel = level;
        });

        return problems;
      });

      await page.close();
      await context.close();

      return {
        snapshot: accessibilitySnapshot,
        issues
      };
    } catch (error) {
      console.error('[CRAWLER] Accessibility check error:', error.message);

      if (page) {
        try {
          await page.close();
        } catch (e) {}
      }

      if (context) {
        try {
          await context.close();
        } catch (e) {}
      }

      return null;
    }
  }

  async captureFullPageMetrics(domain) {
    let context = null;
    let page = null;

    try {
      await this.initBrowser();
      context = await this.browser.newContext({
        userAgent: this.getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        ignoreHTTPSErrors: true
      });

      await context.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (['font', 'media'].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      page = await context.newPage();

      const url = domain.startsWith('http') ? domain : `https://${domain}`;
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      }).catch(() => page.waitForLoadState('domcontentloaded'));
      await page.waitForTimeout(2000).catch(() => {});

      const fullPageScreenshot = await page.screenshot({
        fullPage: true,
        type: 'jpeg',
        quality: 50
      }).catch(() => null);

      await page.close();
      await context.close();

      return {
        fullPageScreenshot: fullPageScreenshot ? fullPageScreenshot.toString('base64') : null
      };
    } catch (error) {
      console.error('[CRAWLER] Full page metrics error:', error.message);

      if (page) {
        try {
          await page.close();
        } catch (e) {}
      }

      if (context) {
        try {
          await context.close();
        } catch (e) {}
      }

      return null;
    }
  }

  async crawlCategoryPages(domain) {
    const categoryUrls = this.generateCategoryUrls(domain);
    const results = [];

    for (const categoryUrl of categoryUrls) {
      try {
        const result = await this.crawlCategoryPage(categoryUrl);
        results.push(result);
      } catch (error) {
        results.push({
          categoryUrl,
          success: false,
          is_404: false,
          error: error.message
        });
      }
    }

    return results;
  }

  generateCategoryUrls(domain) {
    const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;

    const commonPaths = [
      '/blog',
      '/category',
      '/categories',
      '/news',
      '/articles',
      '/posts',
      '/blog/category',
      '/category/news',
      '/category/technology',
      '/category/business',
      '/category/sports',
      '/category/entertainment',
      '/category/health',
      '/category/lifestyle'
    ];

    return commonPaths.map(path => `${baseUrl}${path}`);
  }

  async crawlCategoryPage(categoryUrl) {
    let context = null;
    let page = null;

    try {
      await this.initBrowser();

      context = await this.browser.newContext({
        userAgent: this.getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        ignoreHTTPSErrors: true
      });

      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      await context.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'font', 'media'].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      page = await context.newPage();

      const response = await page.goto(categoryUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const statusCode = response.status();
      const is_404 = statusCode === 404;

      if (is_404) {
        await page.close();
        await context.close();
        return {
          categoryUrl,
          success: true,
          is_404: true,
          htmlContent: '',
          statusCode
        };
      }

      await page.waitForTimeout(2000);

      const htmlContent = await page.content();

      await page.close();
      await context.close();

      return {
        categoryUrl,
        success: true,
        is_404: false,
        htmlContent,
        statusCode
      };
    } catch (error) {
      console.error(`[CRAWLER] Category crawl error for ${categoryUrl}:`, error.message);

      if (page) {
        try {
          await page.close();
        } catch (e) {}
      }

      if (context) {
        try {
          await context.close();
        } catch (e) {}
      }

      const is_404 = error.message.includes('404') || error.message.includes('Not Found');

      return {
        categoryUrl,
        success: false,
        is_404,
        error: error.message
      };
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
