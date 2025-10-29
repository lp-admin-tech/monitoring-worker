import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

export class AdvancedWebsiteCrawler {
  constructor(options = {}) {
    this.browser = null;
    this.supabase = null;
    this.cache = new Map();
    this.cacheTimeout = options.cacheTimeout || 3600000;
    this.maxRetries = options.maxRetries || 3;
    this.concurrency = options.concurrency || 3;
    this.deepCrawl = options.deepCrawl || false;
    this.maxDepth = options.maxDepth || 2;

    console.log('[CRAWLER-INIT] Initializing AdvancedWebsiteCrawler');
    console.log('[CRAWLER-INIT] Configuration:', {
      cacheTimeout: this.cacheTimeout,
      maxRetries: this.maxRetries,
      concurrency: this.concurrency,
      deepCrawl: this.deepCrawl,
      maxDepth: this.maxDepth
    });

    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      this.supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
      );
      console.log('[CRAWLER-INIT] ✓ Supabase client initialized');
    } else {
      console.warn('[CRAWLER-INIT] ⚠ Supabase credentials not found');
    }
  }

  getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  getCacheKey(domain, type = 'default') {
    return crypto.createHash('md5').update(`${domain}-${type}`).digest('hex');
  }

  getCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      console.log('[CACHE-HIT] Returning cached data for key:', key.substring(0, 8));
      return cached.data;
    }
    if (cached) {
      console.log('[CACHE-MISS] Cache expired for key:', key.substring(0, 8));
    }
    this.cache.delete(key);
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
    console.log('[CACHE-SET] Cached data for key:', key.substring(0, 8));
  }

  async initBrowser() {
    if (!this.browser) {
      console.log('[BROWSER-INIT] Launching Chromium browser...');
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
          '--disable-features=IsolateOrigins,site-per-process',
          '--window-size=1920,1080'
        ]
      };

      if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
      }

      this.browser = await chromium.launch(launchOptions);
      console.log('[BROWSER-INIT] ✓ Browser launched successfully');
    } else {
      console.log('[BROWSER-INIT] Browser already running');
    }
  }

  async retryOperation(operation, maxRetries = this.maxRetries) {
    let lastError;
    console.log(`[RETRY] Starting operation with ${maxRetries} max retries`);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        if (attempt > 1) {
          console.log(`[RETRY] ✓ Operation succeeded on attempt ${attempt}`);
        }
        return result;
      } catch (error) {
        lastError = error;
        console.log(`[RETRY] ✗ Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        if (attempt < maxRetries) {
          const waitTime = 1000 * attempt;
          console.log(`[RETRY] Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    console.error(`[RETRY] ✗ All ${maxRetries} attempts failed`);
    throw lastError;
  }

  async analyzeSEO(page, htmlContent, domain) {
    console.log(`[SEO-ANALYZER] Starting SEO analysis for ${domain}`);
    try {
      const seoData = await page.evaluate(() => {
        const getMetaContent = (name) => {
          const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
          return meta ? meta.content : null;
        };

        const title = document.title || '';
        const description = getMetaContent('description') || '';
        const keywords = getMetaContent('keywords') || '';
        const ogTitle = getMetaContent('og:title') || '';
        const ogDescription = getMetaContent('og:description') || '';
        const ogImage = getMetaContent('og:image') || '';
        const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
        
        const h1Tags = Array.from(document.querySelectorAll('h1')).map(h => h.textContent.trim());
        const h2Tags = Array.from(document.querySelectorAll('h2')).map(h => h.textContent.trim());
        
        const images = document.querySelectorAll('img');
        const imagesWithoutAlt = Array.from(images).filter(img => !img.alt).length;
        
        const structuredData = [];
        document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
          try {
            structuredData.push(JSON.parse(script.textContent));
          } catch (e) {}
        });

        const wordCount = document.body.textContent.split(/\s+/).filter(w => w.length > 0).length;
        
        return {
          title,
          titleLength: title.length,
          description,
          descriptionLength: description.length,
          keywords,
          ogTitle,
          ogDescription,
          ogImage,
          canonical,
          h1Tags,
          h1Count: h1Tags.length,
          h2Count: h2Tags.length,
          imagesTotal: images.length,
          imagesWithoutAlt,
          structuredData,
          wordCount,
          hasRobotsMeta: getMetaContent('robots') !== null,
          robotsContent: getMetaContent('robots'),
          hasViewport: document.querySelector('meta[name="viewport"]') !== null,
          lang: document.documentElement.lang || null
        };
      });

      // Fetch robots.txt and sitemap
      const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
      const robotsTxt = await this.fetchRobotsTxt(baseUrl);
      const sitemap = await this.fetchSitemap(baseUrl);

      // Calculate SEO score
      let score = 100;
      const issues = [];
      const recommendations = [];

      if (!seoData.title || seoData.titleLength === 0) {
        score -= 15;
        issues.push('Missing title tag');
        recommendations.push('Add a descriptive title tag (50-60 characters)');
      } else if (seoData.titleLength < 30 || seoData.titleLength > 60) {
        score -= 5;
        issues.push('Title length not optimal');
        recommendations.push('Title should be between 30-60 characters');
      }

      if (!seoData.description || seoData.descriptionLength === 0) {
        score -= 15;
        issues.push('Missing meta description');
        recommendations.push('Add a meta description (150-160 characters)');
      } else if (seoData.descriptionLength < 120 || seoData.descriptionLength > 160) {
        score -= 5;
        issues.push('Meta description length not optimal');
      }

      if (seoData.h1Count === 0) {
        score -= 10;
        issues.push('Missing H1 tag');
        recommendations.push('Add exactly one H1 tag per page');
      } else if (seoData.h1Count > 1) {
        score -= 5;
        issues.push('Multiple H1 tags found');
        recommendations.push('Use only one H1 tag per page');
      }

      if (seoData.imagesWithoutAlt > 0) {
        score -= Math.min(10, seoData.imagesWithoutAlt * 2);
        issues.push(`${seoData.imagesWithoutAlt} images missing alt text`);
        recommendations.push('Add descriptive alt text to all images');
      }

      if (!seoData.canonical) {
        score -= 5;
        issues.push('Missing canonical URL');
        recommendations.push('Add canonical link tag to prevent duplicate content');
      }

      if (!seoData.ogTitle || !seoData.ogDescription) {
        score -= 8;
        issues.push('Incomplete Open Graph tags');
        recommendations.push('Add Open Graph tags for better social media sharing');
      }

      if (seoData.structuredData.length === 0) {
        score -= 7;
        issues.push('No structured data found');
        recommendations.push('Add Schema.org structured data for rich snippets');
      }

      if (!seoData.hasViewport) {
        score -= 5;
        issues.push('Missing viewport meta tag');
      }

      if (seoData.wordCount < 300) {
        score -= 5;
        issues.push('Low content word count');
        recommendations.push('Aim for at least 300 words of quality content');
      }

      const result = {
        ...seoData,
        robotsTxt,
        sitemap,
        score: Math.max(0, score),
        issues,
        recommendations
      };
      console.log(`[SEO-ANALYZER] ✓ Analysis complete - Score: ${result.score}/100, Issues: ${issues.length}`);
      return result;
    } catch (error) {
      console.error('[SEO-ANALYZER] ✗ Analysis error:', error.message);
      return null;
    }
  }

  async fetchRobotsTxt(baseUrl) {
    try {
      const url = new URL('/robots.txt', baseUrl).href;
      const response = await fetch(url, { timeout: 5000 });
      if (response.ok) {
        return await response.text();
      }
    } catch (e) {}
    return null;
  }

  async fetchSitemap(baseUrl) {
    try {
      const url = new URL('/sitemap.xml', baseUrl).href;
      const response = await fetch(url, { timeout: 5000 });
      if (response.ok) {
        const text = await response.text();
        const urlMatches = text.match(/<loc>(.*?)<\/loc>/g);
        if (urlMatches) {
          return urlMatches.map(match => match.replace(/<\/?loc>/g, ''));
        }
      }
    } catch (e) {}
    return null;
  }

  async analyzeSecurityHeaders(page, domain) {
    console.log(`[SECURITY-ANALYZER] Starting security header analysis for ${domain}`);
    try{
      const securityData = await page.evaluate(() => {
        return {
          headers: {},
          forms: document.querySelectorAll('form').length,
          httpsLinks: Array.from(document.querySelectorAll('a[href^="https://"]')).length,
          httpLinks: Array.from(document.querySelectorAll('a[href^="http://"]')).length,
          mixedContent: false
        };
      });

      // Capture response headers
      let headers = {};
      const response = await page.goto(
        domain.startsWith('http') ? domain : `https://${domain}`,
        { waitUntil: 'domcontentloaded', timeout: 10000 }
      ).catch(() => null);

      if (response) {
        headers = response.headers();
      }

      let score = 100;
      const issues = [];
      const recommendations = [];

      const securityHeaders = {
        'strict-transport-security': headers['strict-transport-security'] || null,
        'content-security-policy': headers['content-security-policy'] || null,
        'x-content-type-options': headers['x-content-type-options'] || null,
        'x-frame-options': headers['x-frame-options'] || null,
        'x-xss-protection': headers['x-xss-protection'] || null,
        'referrer-policy': headers['referrer-policy'] || null,
        'permissions-policy': headers['permissions-policy'] || null
      };

      if (!securityHeaders['strict-transport-security']) {
        score -= 15;
        issues.push('Missing HSTS header');
        recommendations.push('Add Strict-Transport-Security header');
      }

      if (!securityHeaders['content-security-policy']) {
        score -= 15;
        issues.push('Missing CSP header');
        recommendations.push('Implement Content-Security-Policy');
      }

      if (!securityHeaders['x-content-type-options']) {
        score -= 10;
        issues.push('Missing X-Content-Type-Options header');
        recommendations.push('Add X-Content-Type-Options: nosniff');
      }

      if (!securityHeaders['x-frame-options']) {
        score -= 10;
        issues.push('Missing X-Frame-Options header');
        recommendations.push('Add X-Frame-Options to prevent clickjacking');
      }

      if (securityData.httpLinks > 0) {
        score -= 10;
        issues.push(`Found ${securityData.httpLinks} insecure HTTP links`);
        recommendations.push('Update all links to use HTTPS');
      }

      const result = {
        headers: securityHeaders,
        score: Math.max(0, score),
        issues,
        recommendations,
        ...securityData
      };
      console.log(`[SECURITY-ANALYZER] ✓ Analysis complete - Score: ${result.score}/100, Issues: ${issues.length}`);
      return result;
    } catch (error) {
      console.error('[SECURITY-ANALYZER] ✗ Analysis error:', error.message);
      return null;
    }
  }

  async detectTechnologies(page, htmlContent) {
    console.log('[TECH-DETECTOR] Detecting technologies...');
    try {
      const technologies = await page.evaluate(() => {
        const detected = {
          cms: [],
          frameworks: [],
          analytics: [],
          libraries: [],
          server: [],
          cdn: []
        };

        // CMS Detection
        if (document.querySelector('meta[name="generator"]')) {
          const generator = document.querySelector('meta[name="generator"]').content;
          if (generator.includes('WordPress')) detected.cms.push('WordPress');
          if (generator.includes('Drupal')) detected.cms.push('Drupal');
          if (generator.includes('Joomla')) detected.cms.push('Joomla');
        }

        // Framework Detection
        if (window.React || document.querySelector('[data-reactroot]')) detected.frameworks.push('React');
        if (window.Vue) detected.frameworks.push('Vue.js');
        if (window.angular) detected.frameworks.push('Angular');
        if (document.querySelector('[ng-app]')) detected.frameworks.push('AngularJS');
        if (window.next) detected.frameworks.push('Next.js');
        if (window.Shopify) detected.cms.push('Shopify');

        // Analytics Detection
        if (window.ga || window.gtag) detected.analytics.push('Google Analytics');
        if (window.fbq) detected.analytics.push('Facebook Pixel');
        if (window._hsq) detected.analytics.push('HubSpot');
        if (window.mixpanel) detected.analytics.push('Mixpanel');

        // Libraries
        if (window.jQuery) detected.libraries.push(`jQuery ${window.jQuery.fn.jquery}`);
        if (window.bootstrap) detected.libraries.push('Bootstrap');
        if (window.Modernizr) detected.libraries.push('Modernizr');

        // CDN Detection
        const scripts = Array.from(document.querySelectorAll('script[src]'));
        scripts.forEach(script => {
          const src = script.src;
          if (src.includes('cloudflare')) detected.cdn.push('Cloudflare');
          if (src.includes('amazonaws')) detected.cdn.push('AWS CloudFront');
          if (src.includes('fastly')) detected.cdn.push('Fastly');
          if (src.includes('akamai')) detected.cdn.push('Akamai');
        });

        // Remove duplicates
        Object.keys(detected).forEach(key => {
          detected[key] = [...new Set(detected[key])];
        });

        return detected;
      });

      // Additional detection from HTML
      if (htmlContent.includes('wp-content') || htmlContent.includes('wp-includes')) {
        technologies.cms.push('WordPress');
      }

      const totalDetected = Object.values(technologies).reduce((sum, arr) => sum + arr.length, 0);
      console.log(`[TECH-DETECTOR] ✓ Detected ${totalDetected} technologies`);
      return technologies;
    } catch (error) {
      console.error('[TECH-DETECTOR] ✗ Detection error:', error.message);
      return null;
    }
  }

  async analyzePerformance(page, domain) {
    console.log(`[PERFORMANCE-ANALYZER] Starting performance analysis for ${domain}`);
    try {
      const performanceData = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const paint = performance.getEntriesByType('paint');
        const resources = performance.getEntriesByType('resource');

        const fcp = paint.find(e => e.name === 'first-contentful-paint')?.startTime || 0;
        const lcp = paint.find(e => e.name === 'largest-contentful-paint')?.startTime || 0;

        const layoutShifts = performance.getEntriesByType('layout-shift');
        let cls = 0;
        layoutShifts.forEach(entry => {
          if (!entry.hadRecentInput) cls += entry.value;
        });

        // Calculate Total Blocking Time (TBT)
        const longTasks = performance.getEntriesByType('longtask') || [];
        let tbt = 0;
        longTasks.forEach(task => {
          if (task.duration > 50) {
            tbt += task.duration - 50;
          }
        });

        // Resource breakdown
        const resourceBreakdown = {
          scripts: 0,
          stylesheets: 0,
          images: 0,
          fonts: 0,
          total: 0
        };

        resources.forEach(resource => {
          const size = resource.transferSize || 0;
          resourceBreakdown.total += size;
          
          if (resource.initiatorType === 'script') resourceBreakdown.scripts += size;
          if (resource.initiatorType === 'css') resourceBreakdown.stylesheets += size;
          if (resource.initiatorType === 'img') resourceBreakdown.images += size;
          if (resource.initiatorType === 'font') resourceBreakdown.fonts += size;
        });

        return {
          fcp,
          lcp,
          cls,
          tbt,
          ttfb: nav?.responseStart || 0,
          domInteractive: nav?.domInteractive || 0,
          domComplete: nav?.domComplete || 0,
          loadTime: nav?.loadEventEnd || 0,
          resourceBreakdown,
          resourceCount: resources.length
        };
      });

      // Calculate performance score (similar to Lighthouse)
      let score = 100;
      const issues = [];

      if (performanceData.fcp > 1800) {
        score -= 20;
        issues.push('Slow First Contentful Paint');
      } else if (performanceData.fcp > 1000) {
        score -= 10;
      }

      if (performanceData.lcp > 2500) {
        score -= 20;
        issues.push('Slow Largest Contentful Paint');
      } else if (performanceData.lcp > 1200) {
        score -= 10;
      }

      if (performanceData.cls > 0.25) {
        score -= 15;
        issues.push('High Cumulative Layout Shift');
      } else if (performanceData.cls > 0.1) {
        score -= 8;
      }

      if (performanceData.tbt > 600) {
        score -= 15;
        issues.push('High Total Blocking Time');
      } else if (performanceData.tbt > 300) {
        score -= 8;
      }

      const result = {
        ...performanceData,
        score: Math.max(0, score),
        issues
      };
      console.log(`[PERFORMANCE-ANALYZER] ✓ Analysis complete - Score: ${result.score}/100, FCP: ${result.fcp.toFixed(0)}ms, LCP: ${result.lcp.toFixed(0)}ms`);
      return result;
    } catch (error) {
      console.error('[PERFORMANCE-ANALYZER] ✗ Analysis error:', error.message);
      return null;
    }
  }

  async analyzeLinkQuality(page, domain) {
    console.log(`[LINK-ANALYZER] Analyzing link quality for ${domain}`);
    try {
      const linkData = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href]'));
        
        const internal = [];
        const external = [];
        const broken = [];
        
        const currentHost = window.location.hostname;
        
        links.forEach(link => {
          const href = link.href;
          if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;
          
          try {
            const url = new URL(href);
            if (url.hostname === currentHost) {
              internal.push(href);
            } else {
              external.push(href);
            }
          } catch (e) {}
        });

        return {
          internal: [...new Set(internal)],
          external: [...new Set(external)],
          totalLinks: links.length
        };
      });

      console.log(`[LINK-ANALYZER] ✓ Found ${linkData.totalLinks} links (${linkData.internal.length} internal, ${linkData.external.length} external)`);
      return linkData;
    } catch (error) {
      console.error('[LINK-ANALYZER] ✗ Analysis error:', error.message);
      return null;
    }
  }

  async generateLighthouseScore(seoScore, securityScore, performanceScore, accessibilityScore) {
    const overallScore = Math.round(
      (seoScore * 0.25 + securityScore * 0.25 + performanceScore * 0.3 + accessibilityScore * 0.2)
    );

    return {
      overall: overallScore,
      seo: seoScore,
      security: securityScore,
      performance: performanceScore,
      accessibility: accessibilityScore,
      rating: overallScore >= 90 ? 'Excellent' :
              overallScore >= 75 ? 'Good' :
              overallScore >= 50 ? 'Fair' : 'Poor'
    };
  }

  async crawlSite(domain) {
    console.log(`\n[CRAWL-START] ====== Starting crawl for ${domain} ======`);
    const cacheKey = this.getCacheKey(domain);
    const cached = this.getCache(cacheKey);
    if (cached) {
      console.log('[CRAWL-END] ====== Returning cached results ======\n');
      return cached;
    }

    return await this.retryOperation(async () => {
      let context = null;
      let page = null;

      try {
        await this.initBrowser();

        console.log(`[CONTEXT-CREATE] Creating browser context for ${domain}`);
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
            if (resourceType === 'image') requestStats.images++;
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

        console.log(`[PAGE-NAVIGATE] Navigating to ${url}`);
        const startTime = Date.now();

        try {
          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 45000
          });
          await page.waitForTimeout(3000);
        } catch (error) {
          if (error.message.includes('SSL') || error.message.includes('ERR_CERT')) {
            sslError = true;
          }
          throw error;
        }

        const loadTime = Date.now() - startTime;
        console.log(`[PAGE-LOADED] ✓ Page loaded in ${loadTime}ms`);

        console.log('[DATA-EXTRACT] Extracting page data...');
        const [htmlContent, screenshot, pageData] = await Promise.all([
          page.content(),
          page.screenshot({ fullPage: false, type: 'jpeg', quality: 75 }).catch(() => null),
          page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a')).map(a => a.href);
            const popupSelectors = ['.popup', '.modal', '[id*="popup"]', '[class*="popup"]', '[role="dialog"]'];
            const popupCount = popupSelectors.reduce((count, selector) => {
              return count + document.querySelectorAll(selector).length;
            }, 0);

            return { links, popupCount };
          })
        ]);

        console.log('[ANALYSIS-START] Running comprehensive analysis suite...');
        const [seoAnalysis, securityAnalysis, technologies, performanceAnalysis, linkAnalysis, accessibilityData] =
          await Promise.all([
            this.analyzeSEO(page, htmlContent, domain),
            this.analyzeSecurityHeaders(page, domain),
            this.detectTechnologies(page, htmlContent),
            this.analyzePerformance(page, domain),
            this.analyzeLinkQuality(page, domain),
            this.checkAccessibility(domain)
          ]);

        console.log('[ANALYSIS-COMPLETE] All analyses finished');

        const lighthouseScore = await this.generateLighthouseScore(
          seoAnalysis?.score || 0,
          securityAnalysis?.score || 0,
          performanceAnalysis?.score || 0,
          accessibilityData?.score || 0
        );

        console.log(`[LIGHTHOUSE-SCORE] Overall: ${lighthouseScore.overall}/100 (${lighthouseScore.rating})`);

        console.log('[CLEANUP] Closing page and context');
        await page.close();
        await context.close();

        const result = {
          success: true,
          timestamp: new Date().toISOString(),
          domain,
          htmlContent,
          links: pageData.links,
          loadTime,
          popupCount: pageData.popupCount,
          requestStats,
          harData: harData.slice(0, 50),
          screenshot: screenshot ? screenshot.toString('base64') : null,
          sslError,
          seoAnalysis,
          securityAnalysis,
          technologies,
          performanceAnalysis,
          linkAnalysis,
          accessibilityData,
          lighthouseScore
        };

        this.setCache(cacheKey, result);
        console.log(`[CRAWL-END] ====== Successfully crawled ${domain} ======\n`);
        return result;

      } catch (error) {
        console.error('[CRAWL-ERROR] ✗ Crawl failed:', error.message);

        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});

        let errorMessage = error.message;
        if (error.message.includes('Timeout')) {
          errorMessage = 'Website timed out (45s limit exceeded)';
        } else if (error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
          errorMessage = 'Domain name could not be resolved (DNS failure)';
        } else if (error.message.includes('net::ERR_CONNECTION_REFUSED')) {
          errorMessage = 'Connection refused by server';
        } else if (error.message.includes('SSL') || error.message.includes('ERR_CERT')) {
          errorMessage = 'SSL certificate issues detected';
        }

        const errorResult = {
          success: false,
          error: errorMessage,
          isOffline: true,
          timestamp: new Date().toISOString()
        };
        console.log(`[CRAWL-END] ====== Failed to crawl ${domain}: ${errorMessage} ======\n`);
        return errorResult;
      }
    });
  }

  async checkAccessibility(domain) {
    console.log(`[ACCESSIBILITY] Starting accessibility check for ${domain}`);
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
      });
      await page.waitForTimeout(2000);

      const issues = await page.evaluate(() => {
        const problems = [];

        // Image alt text
        const images = document.querySelectorAll('img');
        images.forEach(img => {
          if (!img.alt) problems.push({ type: 'missing-alt', element: 'img', severity: 'high' });
        });

        // Form labels
        const inputs = document.querySelectorAll('input:not([type="hidden"])');
        inputs.forEach(input => {
          if (!input.labels || input.labels.length === 0) {
            problems.push({ type: 'missing-label', element: 'input', severity: 'high' });
          }
        });

        // Button text
        const buttons = document.querySelectorAll('button');
        buttons.forEach(btn => {
          if (!btn.textContent.trim() && !btn.ariaLabel) {
            problems.push({ type: 'missing-button-text', element: 'button', severity: 'medium' });
          }
        });

        // Heading hierarchy
        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        let previousLevel = 0;
        headings.forEach(heading => {
          const level = parseInt(heading.tagName.substring(1));
          if (level - previousLevel > 1) {
            problems.push({ type: 'heading-skip', element: heading.tagName, severity: 'medium' });
          }
          previousLevel = level;
        });

        // Color contrast (basic check)
        const elements = document.querySelectorAll('p, span, div, a, button');
        let contrastIssues = 0;
        for (let i = 0; i < Math.min(elements.length, 100); i++) {
          const el = elements[i];
          const style = window.getComputedStyle(el);
          const bgColor = style.backgroundColor;
          const color = style.color;
          
          if (bgColor && color && bgColor !== 'rgba(0, 0, 0, 0)') {
            // Simple check - would need full contrast calculation
            contrastIssues++;
          }
        }

        // ARIA labels
        const interactiveElements = document.querySelectorAll('button, a, input, select, textarea');
        interactiveElements.forEach(el => {
          if (!el.textContent.trim() && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) {
            problems.push({ type: 'missing-aria-label', element: el.tagName.toLowerCase(), severity: 'medium' });
          }
        });

        return problems;
      });

      await page.close();
      await context.close();

      // Calculate accessibility score
      let score = 100;
      const highSeverity = issues.filter(i => i.severity === 'high').length;
      const mediumSeverity = issues.filter(i => i.severity === 'medium').length;
      
      score -= highSeverity * 5;
      score -= mediumSeverity * 2;

      const result = {
        score: Math.max(0, score),
        issues,
        issueCount: issues.length,
        highSeverityCount: highSeverity,
        mediumSeverityCount: mediumSeverity
      };
      console.log(`[ACCESSIBILITY] ✓ Check complete - Score: ${result.score}/100, Issues: ${issues.length}`);
      return result;
    } catch (error) {
      console.error('[ACCESSIBILITY] ✗ Check error:', error.message);
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      return { score: 0, issues: [], issueCount: 0 };
    }
  }

  async checkMobileFriendly(domain) {
    console.log(`[MOBILE-CHECK] Starting mobile-friendly check for ${domain}`);
    let context = null;
    let page = null;

    try {
      await this.initBrowser();
      context = await this.browser.newContext({
        viewport: { width: 375, height: 667 },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        hasTouch: true,
        isMobile: true,
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

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2000);

      const screenshot = await page.screenshot({
        fullPage: false,
        type: 'jpeg',
        quality: 60
      }).catch(() => null);

      const mobileData = await page.evaluate(() => {
        const viewport = document.querySelector('meta[name="viewport"]');
        const tapTargets = document.querySelectorAll('button, a, input');
        
        let smallTapTargets = 0;
        tapTargets.forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.width < 44 || rect.height < 44) {
            smallTapTargets++;
          }
        });

        return {
          hasViewport: viewport !== null,
          viewportContent: viewport?.content || null,
          smallTapTargets,
          totalTapTargets: tapTargets.length
        };
      });

      await page.close();
      await context.close();

      let score = 100;
      const issues = [];

      if (!mobileData.hasViewport) {
        score -= 40;
        issues.push('Missing viewport meta tag');
      }

      if (mobileData.smallTapTargets > 0) {
        score -= Math.min(30, mobileData.smallTapTargets * 5);
        issues.push(`${mobileData.smallTapTargets} tap targets too small (< 44x44px)`);
      }

      const result = {
        isMobileFriendly: score >= 70,
        score: Math.max(0, score),
        screenshot: screenshot ? screenshot.toString('base64') : null,
        issues,
        ...mobileData
      };
      console.log(`[MOBILE-CHECK] ✓ Check complete - Score: ${result.score}/100, Mobile Friendly: ${result.isMobileFriendly}`);
      return result;
    } catch (error) {
      console.error('[MOBILE-CHECK] ✗ Check error:', error.message);
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      return { isMobileFriendly: false, score: 0, screenshot: null, issues: [] };
    }
  }

  async crawlMultipleSites(domains) {
    console.log(`\n[MULTI-CRAWL] Starting crawl for ${domains.length} domains with concurrency ${this.concurrency}`);
    const results = [];
    const chunks = [];
    
    for (let i = 0; i < domains.length; i += this.concurrency) {
      chunks.push(domains.slice(i, i + this.concurrency));
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[MULTI-CRAWL] Processing chunk ${i + 1}/${chunks.length} (${chunk.length} domains)`);
      const chunkResults = await Promise.allSettled(
        chunk.map(domain => this.crawlSite(domain))
      );
      
      chunkResults.forEach((result, index) => {
        results.push({
          domain: chunk[index],
          result: result.status === 'fulfilled' ? result.value : { success: false, error: result.reason.message }
        });
      });
      console.log(`[MULTI-CRAWL] Chunk ${i + 1}/${chunks.length} complete`);
    }

    console.log(`[MULTI-CRAWL] ✓ All ${domains.length} domains processed\n`);
    return results;
  }

  clearCache() {
    this.cache.clear();
    console.log('[CACHE] Cleared all cached results');
  }

  async close() {
    console.log('[CRAWLER-CLOSE] Shutting down crawler...');
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('[CRAWLER-CLOSE] ✓ Browser closed');
    }
    this.clearCache();
    console.log('[CRAWLER-CLOSE] ✓ Crawler shutdown complete');
  }
}

export default AdvancedWebsiteCrawler;