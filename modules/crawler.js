import puppeteer from 'puppeteer';

export class WebsiteCrawler {
  constructor() {
    this.browser = null;
  }

  async initBrowser() {
    if (!this.browser) {
      const launchOptions = {
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu'
        ]
      };

      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      }

      this.browser = await puppeteer.launch(launchOptions);
    }
  }

  async crawlSite(domain) {
    try {
      await this.initBrowser();
      const page = await this.browser.newPage();

      const url = domain.startsWith('http') ? domain : `https://${domain}`;
      const startTime = Date.now();

      await page.goto(url, {
        waitUntil: 'networkidle2',
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

      const metrics = await page.metrics();

      await page.close();

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
      const page = await this.browser.newPage();

      await page.setViewport({ width: 375, height: 667 });

      const url = domain.startsWith('http') ? domain : `https://${domain}`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      const isMobileFriendly = await page.evaluate(() => {
        const viewport = document.querySelector('meta[name="viewport"]');
        return viewport !== null;
      });

      await page.close();
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
