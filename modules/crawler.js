import { chromium } from 'playwright';

export class WebsiteCrawler {
  constructor() {
    this.browser = null;
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
          '--disable-gpu'
        ]
      };

      if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
      }

      this.browser = await chromium.launch(launchOptions);
    }
  }

  async crawlSite(domain) {
    try {
      await this.initBrowser();
      const context = await this.browser.newContext({
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

      const page = await context.newPage();

      const url = domain.startsWith('http') ? domain : `https://${domain}`;
      const startTime = Date.now();

      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      const loadTime = Date.now() - startTime;
      const htmlContent = await page.content();

      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a')).map(a => a.href);
      });

      const popupCount = await page.evaluate(() => {
        const popupSelectors = ['.popup', '.modal', '[id*="popup"]', '[class*="popup"]'];
        return popupSelectors.reduce((count, selector) => {
          return count + document.querySelectorAll(selector).length;
        }, 0);
      });

      const metrics = await page.evaluate(() => {
        const performanceData = performance.getEntriesByType('navigation')[0];
        return {
          JSHeapUsedSize: performance.memory ? performance.memory.usedJSHeapSize : 0,
          JSHeapTotalSize: performance.memory ? performance.memory.totalJSHeapSize : 0,
          Timestamp: Date.now() / 1000,
          Documents: document.querySelectorAll('*').length,
          Frames: window.frames.length,
          JSEventListeners: 0,
          Nodes: document.querySelectorAll('*').length,
          LayoutCount: 0,
          RecalcStyleCount: 0,
          LayoutDuration: performanceData ? performanceData.domComplete - performanceData.domLoading : 0,
          RecalcStyleDuration: 0,
          ScriptDuration: performanceData ? performanceData.domContentLoadedEventEnd - performanceData.domContentLoadedEventStart : 0,
          TaskDuration: performanceData ? performanceData.loadEventEnd - performanceData.loadEventStart : 0
        };
      });

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
      return {
        success: false,
        error: error.message
      };
    }
  }

  async checkMobileFriendly(domain) {
    try {
      await this.initBrowser();
      const context = await this.browser.newContext({
        viewport: { width: 375, height: 667 },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
      });

      await context.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'font', 'media'].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      const page = await context.newPage();

      const url = domain.startsWith('http') ? domain : `https://${domain}`;
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      const isMobileFriendly = await page.evaluate(() => {
        const viewport = document.querySelector('meta[name="viewport"]');
        return viewport !== null;
      });

      await page.close();
      await context.close();
      return isMobileFriendly;
    } catch (error) {
      return false;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
