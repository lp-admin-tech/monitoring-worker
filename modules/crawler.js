import { chromium } from 'playwright';

export class WebsiteCrawler {
  constructor() {
    this.browser = null;
    this.cdpSessions = new Map();
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
          '--disable-blink-features=AutomationControlled'
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
    let cdpSession = null;

    try {
      await this.initBrowser();
      context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        bypassCSP: true,
        javaScriptEnabled: true,
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = { runtime: {} };
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

      const client = await page.context().newCDPSession(page);
      cdpSession = client;

      await client.send('Performance.enable');
      await client.send('Network.enable');

      const url = domain.startsWith('http') ? domain : `https://${domain}`;
      const startTime = Date.now();

      const navigationPromise = page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      await Promise.race([
        navigationPromise,
        page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
      ]);

      await page.waitForLoadState('domcontentloaded');

      const loadTime = Date.now() - startTime;

      const performanceMetrics = await client.send('Performance.getMetrics');
      const metricsMap = {};
      performanceMetrics.metrics.forEach(metric => {
        metricsMap[metric.name] = metric.value;
      });

      const [htmlContent, pageData] = await Promise.all([
        page.content(),
        page.evaluate(() => {
          try {
            const links = Array.from(document.querySelectorAll('a')).map(a => a.href);

            const popupSelectors = ['.popup', '.modal', '[id*="popup"]', '[class*="popup"]', '[role="dialog"]'];
            const popupCount = popupSelectors.reduce((count, selector) => {
              return count + document.querySelectorAll(selector).length;
            }, 0);

            const performanceData = performance.getEntriesByType('navigation')[0];

            return {
              links,
              popupCount,
              metrics: {
                JSHeapUsedSize: performance.memory ? performance.memory.usedJSHeapSize : 0,
                JSHeapTotalSize: performance.memory ? performance.memory.totalJSHeapSize : 0,
                Timestamp: Date.now() / 1000,
                Documents: document.querySelectorAll('*').length,
                Frames: window.frames.length,
                JSEventListeners: 0,
                Nodes: document.querySelectorAll('*').length,
                LayoutDuration: performanceData ? performanceData.domComplete - performanceData.domLoading : 0,
                ScriptDuration: performanceData ? performanceData.domContentLoadedEventEnd - performanceData.domContentLoadedEventStart : 0,
                TaskDuration: performanceData ? performanceData.loadEventEnd - performanceData.loadEventStart : 0
              }
            };
          } catch (e) {
            return {
              links: [],
              popupCount: 0,
              metrics: {
                JSHeapUsedSize: 0,
                JSHeapTotalSize: 0,
                Timestamp: Date.now() / 1000,
                Documents: 0,
                Frames: 0,
                JSEventListeners: 0,
                Nodes: 0,
                LayoutDuration: 0,
                ScriptDuration: 0,
                TaskDuration: 0
              }
            };
          }
        })
      ]);

      const links = pageData.links;
      const popupCount = pageData.popupCount;
      const metrics = {
        ...pageData.metrics,
        LayoutCount: metricsMap.LayoutCount || 0,
        RecalcStyleCount: metricsMap.RecalcStyleCount || 0,
        RecalcStyleDuration: metricsMap.RecalcStyleDuration || 0
      };

      if (cdpSession) {
        await cdpSession.detach().catch(() => {});
      }
      await page.close();
      await context.close();

      return {
        success: true,
        htmlContent,
        links,
        loadTime,
        popupCount,
        metrics
      };
    } catch (error) {
      console.error('[CRAWLER] Error details:', error);

      if (cdpSession) {
        try {
          await cdpSession.detach();
        } catch (e) {
          console.error('[CRAWLER] Error detaching CDP session:', e.message);
        }
      }

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

      return {
        success: false,
        error: error.message
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
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
        hasTouch: true,
        isMobile: true
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
        waitUntil: 'networkidle',
        timeout: 30000
      }).catch(() => page.waitForLoadState('domcontentloaded'));

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
      return isMobileFriendly;
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

      return false;
    }
  }

  async interceptAndAnalyzeRequests(domain) {
    let context = null;
    let page = null;

    try {
      await this.initBrowser();
      context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });

      const requestStats = {
        total: 0,
        blocked: 0,
        scripts: 0,
        stylesheets: 0,
        xhr: 0,
        fetch: 0,
        thirdParty: 0,
        totalSize: 0
      };

      await context.route('**/*', (route) => {
        requestStats.total++;
        const request = route.request();
        const resourceType = request.resourceType();

        if (['image', 'font', 'media'].includes(resourceType)) {
          requestStats.blocked++;
          route.abort();
        } else {
          if (resourceType === 'script') requestStats.scripts++;
          if (resourceType === 'stylesheet') requestStats.stylesheets++;
          if (resourceType === 'xhr') requestStats.xhr++;
          if (resourceType === 'fetch') requestStats.fetch++;

          const url = new URL(request.url());
          const domainUrl = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
          if (url.hostname !== domainUrl.hostname) {
            requestStats.thirdParty++;
          }

          route.continue();
        }
      });

      page = await context.newPage();

      page.on('response', async (response) => {
        try {
          const headers = response.headers();
          const contentLength = headers['content-length'];
          if (contentLength) {
            requestStats.totalSize += parseInt(contentLength, 10);
          }
        } catch (e) {}
      });

      const url = domain.startsWith('http') ? domain : `https://${domain}`;
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000
      }).catch(() => page.waitForLoadState('domcontentloaded'));

      await page.close();
      await context.close();

      return requestStats;
    } catch (error) {
      console.error('[CRAWLER] Request analysis error:', error.message);

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

  async captureNetworkTimings(domain) {
    let context = null;
    let page = null;
    let cdpSession = null;

    try {
      await this.initBrowser();
      context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
      const client = await page.context().newCDPSession(page);
      cdpSession = client;

      await client.send('Network.enable');

      const networkEvents = [];

      client.on('Network.responseReceived', (params) => {
        networkEvents.push({
          url: params.response.url,
          status: params.response.status,
          mimeType: params.response.mimeType,
          timing: params.response.timing
        });
      });

      const url = domain.startsWith('http') ? domain : `https://${domain}`;
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000
      }).catch(() => page.waitForLoadState('domcontentloaded'));

      const timings = networkEvents.filter(e => e.timing).map(e => ({
        url: e.url,
        dns: e.timing.dnsEnd - e.timing.dnsStart,
        connect: e.timing.connectEnd - e.timing.connectStart,
        ssl: e.timing.sslEnd - e.timing.sslStart,
        send: e.timing.sendEnd - e.timing.sendStart,
        wait: e.timing.receiveHeadersEnd - e.timing.sendEnd,
        receive: e.timing.receiveHeadersEnd
      }));

      if (cdpSession) {
        await cdpSession.detach().catch(() => {});
      }
      await page.close();
      await context.close();

      return timings;
    } catch (error) {
      console.error('[CRAWLER] Network timing error:', error.message);

      if (cdpSession) {
        try {
          await cdpSession.detach();
        } catch (e) {}
      }

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

      return [];
    }
  }

  async checkAccessibility(domain) {
    let context = null;
    let page = null;

    try {
      await this.initBrowser();
      context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
        waitUntil: 'networkidle',
        timeout: 30000
      }).catch(() => page.waitForLoadState('domcontentloaded'));

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

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.cdpSessions.clear();
  }
}
