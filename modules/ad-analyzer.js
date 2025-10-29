import { load } from 'cheerio';
import { chromium } from 'playwright';

export class AdAnalyzer {
  constructor() {
    this.browser = null;
  }

  analyzeAdDensity(htmlContent) {
    const $ = load(htmlContent);

    const adSelectors = [
      '[id*="ad"]', '[class*="ad"]',
      '[id*="banner"]', '[class*="banner"]',
      'iframe[src*="doubleclick"]',
      'iframe[src*="googlesyndication"]',
      'iframe[src*="googleadservices"]',
      'iframe[src*="adservice"]',
      '.adsbygoogle',
      '[data-ad-slot]',
      '[data-ad-client]',
      'iframe[src*="google.com/adsense"]',
      'script[src*="adsbygoogle.js"]',
      'iframe[src*="adnxs.com"]',
      'iframe[src*="pubmatic.com"]',
      'iframe[src*="rubiconproject.com"]',
      'iframe[src*="criteo.com"]',
      'iframe[src*="openx.net"]',
      'iframe[src*="amazon-adsystem.com"]',
      'iframe[src*="media.net"]',
      'iframe[src*="taboola.com"]',
      'iframe[src*="outbrain.com"]',
      'iframe[src*="smartadserver.com"]',
      'iframe[src*="indexww.com"]',
      'iframe[src*="smaato.net"]',
      '[data-google-query-id]',
      'ins.adsbygoogle'
    ];

    const sidebarSelectors = [
      'aside', '.sidebar', '[class*="sidebar"]',
      '.widget', '[class*="widget"]'
    ];

    const stickySelectors = [
      '[style*="position: fixed"]',
      '[style*="position:fixed"]',
      '.sticky', '.fixed',
      '[class*="sticky"]', '[class*="fixed"]'
    ];

    let totalAds = 0;
    let adsAboveFold = 0;
    let adsInContent = 0;
    let adsSidebar = 0;
    let stickyAds = 0;
    let autoRefreshAds = 0;

    const adElements = [];

    adSelectors.forEach(selector => {
      const elements = $(selector);
      elements.each((i, el) => {
        const $el = $(el);
        if (!adElements.includes(el)) {
          adElements.push(el);
          totalAds++;

          const allElements = $('body *');
          const elementIndex = allElements.index(el);
          const totalElements = allElements.length;

          if (totalElements > 0 && elementIndex >= 0 && elementIndex < totalElements * 0.2) {
            adsAboveFold++;
          }

          const inSidebar = $el.parents(sidebarSelectors.join(',')).length > 0;
          if (inSidebar) {
            adsSidebar++;
          }

          const inMainContent = $el.parents('article, main, [class*="content"], [class*="post"]').length > 0;
          if (inMainContent && !inSidebar) {
            adsInContent++;
          }

          const isSticky = stickySelectors.some(stickySelector => {
            return $el.is(stickySelector) || $el.parents(stickySelector).length > 0;
          });
          if (isSticky) {
            stickyAds++;
          }

          const hasRefresh = $el.attr('data-ad-refresh') ||
                           ($el.html() && $el.html().includes('setInterval'));
          if (hasRefresh) {
            autoRefreshAds++;
          }
        }
      });
    });

    const bodyText = $('body').text().length;
    const adDensity = bodyText > 0 ? (totalAds / bodyText) * 1000 : 0;

    let totalAdPixels = 0;
    adElements.forEach(el => {
      const $el = $(el);
      const width = parseInt($el.css('width')) || parseInt($el.attr('width')) || 0;
      const height = parseInt($el.css('height')) || parseInt($el.attr('height')) || 0;
      totalAdPixels += width * height;
    });

    const bodyElements = $('body *').length;
    const estimatedBodyHeight = Math.max(bodyElements * 50, 3000);
    const viewportWidth = 1920;
    const contentPixels = estimatedBodyHeight * viewportWidth;
    const adToContentRatio = contentPixels > 0 ? totalAdPixels / contentPixels : 0;

    return {
      adDensity,
      totalAds,
      adsAboveFold,
      adsInContent,
      adsSidebar,
      stickyAds,
      autoRefreshAds,
      adToContentRatio
    };
  }

  async captureAdSectionScreenshots(domain, browser = null) {
    let context = null;
    let page = null;
    const shouldCloseBrowser = !browser;

    try {
      if (!browser) {
        browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
      }

      context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
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
        waitUntil: 'networkidle',
        timeout: 30000
      }).catch(() => page.waitForLoadState('domcontentloaded'));

      const adSectionScreenshots = await page.evaluate(async () => {
        const adSelectors = [
          'iframe[src*="doubleclick"]',
          'iframe[src*="googlesyndication"]',
          '.adsbygoogle',
          '[data-ad-slot]',
          '[id*="ad"]',
          '[class*="ad"]'
        ];

        const screenshots = [];
        const processedElements = new Set();

        for (const selector of adSelectors) {
          const elements = document.querySelectorAll(selector);

          for (let i = 0; i < Math.min(elements.length, 5); i++) {
            const el = elements[i];
            if (processedElements.has(el)) continue;
            processedElements.add(el);

            const rect = el.getBoundingClientRect();
            if (rect.width > 50 && rect.height > 50) {
              screenshots.push({
                selector: selector,
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              });
            }
          }

          if (screenshots.length >= 5) break;
        }

        return screenshots;
      });

      const capturedScreenshots = [];
      for (const adSection of adSectionScreenshots) {
        try {
          const screenshot = await page.screenshot({
            clip: {
              x: Math.max(0, adSection.x),
              y: Math.max(0, adSection.y),
              width: Math.min(adSection.width, 1920),
              height: Math.min(adSection.height, 1080)
            },
            type: 'jpeg',
            quality: 60
          });

          capturedScreenshots.push({
            selector: adSection.selector,
            screenshot: screenshot.toString('base64')
          });
        } catch (e) {
          console.error('[AD-ANALYZER] Screenshot error:', e.message);
        }
      }

      await page.close();
      await context.close();
      if (shouldCloseBrowser && browser) {
        await browser.close();
      }

      return capturedScreenshots;
    } catch (error) {
      console.error('[AD-ANALYZER] Ad section capture error:', error.message);

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

      if (shouldCloseBrowser && browser) {
        try {
          await browser.close();
        } catch (e) {}
      }

      return [];
    }
  }

  detectClickInterference(htmlContent) {
    const $ = load(htmlContent);

    const interstitialSelectors = [
      '[class*="interstitial"]',
      '[id*="interstitial"]',
      '[class*="overlay"]',
      '[id*="overlay"]'
    ];

    let hasInterference = false;

    interstitialSelectors.forEach(selector => {
      if ($(selector).length > 0) {
        hasInterference = true;
      }
    });

    return hasInterference;
  }

  detectAdNetworks(htmlContent) {
    const $ = load(htmlContent);
    const detectedNetworks = [];

    const networks = {
      'Google AdSense': [
        'googlesyndication.com',
        'adsbygoogle',
        'data-ad-client',
        'google_ad_client'
      ],
      'Google AdX': [
        'doubleclick.net',
        'googleadservices.com',
        'data-google-query-id'
      ],
      'Amazon': [
        'amazon-adsystem.com',
        'aax.amazon-adsystem.com'
      ],
      'Media.net': [
        'media.net',
        'contextual.media.net'
      ],
      'AppNexus': [
        'adnxs.com',
        'appnexus.com'
      ],
      'PubMatic': [
        'pubmatic.com',
        'ads.pubmatic.com'
      ],
      'Rubicon': [
        'rubiconproject.com',
        'rubicon'
      ],
      'Criteo': [
        'criteo.com',
        'criteo.net'
      ],
      'OpenX': [
        'openx.net',
        'openx.com'
      ],
      'Taboola': [
        'taboola.com',
        'trc.taboola.com'
      ],
      'Outbrain': [
        'outbrain.com',
        'widgets.outbrain.com'
      ],
      'Index Exchange': [
        'indexww.com',
        'casalemedia.com'
      ],
      'Smaato': [
        'smaato.net',
        'smaato.com'
      ],
      'Smart AdServer': [
        'smartadserver.com',
        'smart-adserver.com'
      ]
    };

    const pageHtml = $.html().toLowerCase();

    Object.entries(networks).forEach(([networkName, patterns]) => {
      const detected = patterns.some(pattern =>
        pageHtml.includes(pattern.toLowerCase())
      );

      if (detected) {
        detectedNetworks.push(networkName);
      }
    });

    return {
      networks: detectedNetworks,
      count: detectedNetworks.length,
      hasGoogleAds: detectedNetworks.includes('Google AdSense') ||
                    detectedNetworks.includes('Google AdX'),
      hasMultipleNetworks: detectedNetworks.length > 1
    };
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
