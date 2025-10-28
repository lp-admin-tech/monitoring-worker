import { load } from 'cheerio';

export class AdAnalyzer {
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

          // Estimate above-the-fold placement based on DOM position
          // Check if element appears early in the body (rough heuristic)
          const allElements = $('body *');
          const elementIndex = allElements.index(el);
          const totalElements = allElements.length;

          // Consider first 20% of DOM elements as potentially above fold
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

    // Estimate body height from content elements (cheerio doesn't support .height())
    const bodyElements = $('body *').length;
    const estimatedBodyHeight = Math.max(bodyElements * 50, 3000); // Rough estimate based on elements
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
}
