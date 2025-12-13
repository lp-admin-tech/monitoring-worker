/**
 * Ad Heatmap Generator
 * Detects ads per scroll level and calculates MFA indicators
 */

const logger = require('../logger');

class AdHeatmapGenerator {
  constructor(client) {
    this.client = client;
    this.Runtime = client.Runtime;
    this.DOM = client.DOM;
  }

  // Common ad selectors
  static AD_SELECTORS = [
    // Google Ads / AdX / Ad Manager / GPT (comprehensive)
    '[id*="google_ads"]', '[id*="gpt-"]', '[class*="adunit"]',
    '[data-google-query-id]', 'ins.adsbygoogle', '[id*="div-gpt-ad"]',
    '[id*="google_ads_iframe"]', 'iframe[id*="google_ads"]',
    'iframe[src*="googleads"]', 'iframe[src*="tpc.googlesyndication"]',
    'iframe[src*="pagead2.googlesyndication"]', 'iframe[src*="securepubads"]',
    '[data-ad-slot]', '[data-ad-client]', '[data-ad-format]',
    '[class*="adsbygoogle"]', '[id*="aswift"]',
    'iframe[name*="google_ads"]', 'iframe[title*="Advertisement"]',
    '[class*="google-ad"]', '[id*="google-ad"]',
    'div[data-google-container-id]', '[data-text-ad]',

    // Google AdX / Ad Exchange specific
    'iframe[id*="aswift_"]', 'iframe[name*="aswift_"]',
    '[id*="google_image_div"]', 'div[id*="ad_unit"]',
    'iframe[src*="safeframe"]', '[class*="safeframe"]',
    '[id*="sf_"]', 'iframe[name*="safeframe"]',
    '[data-load-complete]', '[data-google-av-cxn]',
    'div[id*="_ads_"]', '[class*="GoogleActiveViewElement"]',
    'iframe[src*="googleadservices"]', '[id*="google_image_"]',
    '[id*="ad-div"]', '[class*="ad-wrapper"]',

    // Generic ad containers
    '[class*="ad-slot"]', '[class*="advertisement"]', '[class*="ad-container"]',
    '[class*="ad-wrapper"]', '[class*="ad-banner"]', '[data-ad]',

    // Ad iframes
    'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]',
    'iframe[src*="amazon-adsystem"]', 'iframe[id*="google_ads"]',

    // Native ads
    '[class*="taboola"]', '[class*="outbrain"]', '[class*="mgid"]',
    '[class*="revcontent"]', '[id*="taboola"]', '[id*="outbrain"]',

    // Video ads
    '[class*="video-ad"]', '[class*="preroll"]', '[class*="midroll"]',

    // Generic ID/Class patterns (common in MFA)
    '[id^="ad-"]', '[id^="banner-"]', '[id^="div-gpt-"]',
    '[class^="ad-"]', '[class^="banner-"]', '[class*="sponsored"]',
    '[aria-label="Advertisement"]', '[aria-label="Sponsored"]',

    // Specific Bidders/Networks
    '[id*="criteo"]', '[class*="criteo"]',
    '[id*="pubmatic"]', '[class*="pubmatic"]',
    '[id*="rubicon"]', '[class*="rubicon"]',
    '[id*="openx"]', '[class*="openx"]',
    '[id*="amazon"]', '[class*="amzn"]',

    // === NEW: Deceptive Download Ads (MFA favorite) ===
    '[class*="download"]', '[id*="download"]',
    'a[href*="download"][class*="button"]', 'button[class*="download"]',
    '[class*="fake-download"]', '[class*="dl-button"]',

    // Fake system notifications / alerts
    '[class*="notification-ad"]', '[class*="alert-ad"]',
    '[class*="system-message"]', '[class*="update-notification"]',

    // Pop-under / overlay patterns
    '[class*="overlay-ad"]', '[class*="popup-ad"]', '[class*="modal-ad"]',
    '[class*="interstitial"]', '[class*="splash-ad"]',

    // AdSense alternatives commonly used by MFA
    '[class*="propeller"]', '[id*="propeller"]',
    '[class*="adsterra"]', '[id*="adsterra"]',
    '[class*="popcash"]', '[id*="popcash"]',
    '[class*="admaven"]', '[id*="admaven"]',
    '[class*="adcash"]', '[id*="adcash"]',
    '[class*="monetag"]', '[id*="monetag"]',
    '[class*="hilltopads"]', '[id*="hilltopads"]',

    // Widget / recommendation areas (often ads)
    '[class*="widget-ad"]', '[class*="sidebar-ad"]',
    '[class*="related-ad"]', '[class*="promoted"]',

    // Data attributes often used by ad networks
    '[data-ad-slot]', '[data-ad-client]', '[data-ad-format]',
    '[data-adblockkey]', '[data-cfasync]'
  ];

  async detectAdsInViewport() {
    const { result } = await this.Runtime.evaluate({
      expression: `
        (() => {
          const ads = [];
          const viewportHeight = window.innerHeight;
          const viewportWidth = window.innerWidth;
          const scrollY = window.scrollY;
          
          const selectors = ${JSON.stringify(AdHeatmapGenerator.AD_SELECTORS)};
          
          selectors.forEach(selector => {
            try {
              document.querySelectorAll(selector).forEach(el => {
                const rect = el.getBoundingClientRect();
                const computedStyle = window.getComputedStyle(el);
                
                // Only include visible elements
                if (rect.height > 10 && rect.width > 10 && 
                    computedStyle.display !== 'none' &&
                    computedStyle.visibility !== 'hidden') {
                  
                  const inViewport = rect.bottom > 0 && rect.top < viewportHeight;
                  const isAboveFold = rect.top < viewportHeight && scrollY === 0;
                  
                  // Check if it's likely an ad iframe
                  const isIframe = el.tagName === 'IFRAME';
                  const src = el.src || '';
                  const hasAdSrc = isIframe && (
                    src.includes('doubleclick') ||
                    src.includes('googlesyndication') ||
                    src.includes('googleads') ||
                    src.includes('amazon-adsystem') ||
                    src.includes('adsystem') ||
                    src.includes('ad.') ||
                    src.includes('/ads/') ||
                    src.includes('pagead') ||
                    src.includes('adservice') ||
                    src.includes('securepubads') ||
                    src.includes('tpc.google')
                  );
                  
                  ads.push({
                    selector: selector,
                    tagName: el.tagName,
                    id: el.id || null,
                    className: el.className || null,
                    x: Math.round(rect.x),
                    y: Math.round(rect.y + scrollY),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    area: Math.round(rect.width * rect.height),
                    inViewport,
                    isAboveFold,
                    isIframe,
                    hasAdSrc
                  });
                }
              });
            } catch (e) {
              // Selector failed, skip
            }
          });
          
          // === NEW: Text-based heuristic detection for deceptive elements ===
          const deceptivePatterns = [
            /download\\s*(now|free|here|button|right now)/i,
            /click\\s*(here|to|now)/i,
            /free\\s*(download|install|get)/i,
            /install\\s*(now|free)/i,
            /update\\s*(required|now|available)/i,
            /your\\s*(system|computer|device)/i,
            /virus\\s*(detected|found|alert)/i,
            /warning[:\\s]/i,
            /congratulations/i
          ];
          
          // Check buttons and prominent links for deceptive text
          document.querySelectorAll('button, a.button, a[class*="btn"], [class*="button"], [role="button"]').forEach(el => {
            const text = (el.innerText || '').trim().toLowerCase();
            const isDeceptive = deceptivePatterns.some(pattern => pattern.test(text));
            
            if (isDeceptive) {
              const rect = el.getBoundingClientRect();
              const computedStyle = window.getComputedStyle(el);
              
              if (rect.height > 10 && rect.width > 10 && 
                  computedStyle.display !== 'none' &&
                  computedStyle.visibility !== 'hidden') {
                
                ads.push({
                  selector: 'DECEPTIVE_TEXT: ' + text.substring(0, 30),
                  tagName: el.tagName,
                  id: el.id || null,
                  className: el.className || null,
                  x: Math.round(rect.x),
                  y: Math.round(rect.y + scrollY),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                  area: Math.round(rect.width * rect.height),
                  inViewport: rect.bottom > 0 && rect.top < viewportHeight,
                  isAboveFold: rect.top < viewportHeight && scrollY === 0,
                  isIframe: false,
                  hasAdSrc: false,
                  isDeceptive: true
                });
              }
            }
          });
          
          // Deduplicate by position (same ad matched by multiple selectors)
          const unique = [];
          const seen = new Set();
          ads.forEach(ad => {
            const key = ad.x + ',' + ad.y + ',' + ad.width + ',' + ad.height;
            if (!seen.has(key)) {
              seen.add(key);
              unique.push(ad);
            }
          });
          
          return unique;
        })()
      `,
      returnByValue: true
    });

    return result.value || [];
  }

  async measureCLS() {
    const { result } = await this.Runtime.evaluate({
      expression: `
        new Promise(resolve => {
          let cls = 0;
          try {
            const observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                if (!entry.hadRecentInput) {
                  cls += entry.value;
                }
              }
            });
            observer.observe({ type: 'layout-shift', buffered: true });
            setTimeout(() => {
              observer.disconnect();
              resolve(cls);
            }, 1000);
          } catch (e) {
            resolve(0);
          }
        })
      `,
      awaitPromise: true,
      returnByValue: true
    });

    return result.value || 0;
  }

  async getPageDimensions() {
    const { result } = await this.Runtime.evaluate({
      expression: `({
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        totalHeight: document.body.scrollHeight,
        scrollY: window.scrollY
      })`,
      returnByValue: true
    });
    return result.value;
  }

  async captureLevel(scrollY, viewportHeight, levelIndex) {
    const ads = await this.detectAdsInViewport();
    const cls = await this.measureCLS();

    // Calculate viewport area
    const viewportArea = viewportHeight * 1920; // Assume 1920 width

    // Calculate total ad area in viewport
    const inViewportAds = ads.filter(a => a.inViewport);
    const totalAdArea = inViewportAds.reduce((sum, ad) => sum + ad.area, 0);

    // Ad density = ratio of ad pixels to viewport pixels
    const adDensity = totalAdArea / viewportArea;

    return {
      scrollY,
      levelIndex,
      viewportHeight,
      ads: inViewportAds,
      adCount: inViewportAds.length,
      totalAdArea,
      adDensity,
      cls,
      adsAboveFold: levelIndex === 0 ? ads.filter(a => a.isAboveFold).length : 0
    };
  }

  /**
   * Generate full page heatmap with scroll
   * @param {HumanSimulator} humanSimulator - Human simulator instance
   * @param {Function} onScrollLevel - Optional callback for each scroll level (e.g., for progressive content extraction)
   */
  async generateFullHeatmap(humanSimulator, onScrollLevel = null) {
    logger.info('[AdHeatmap] Starting full page heatmap generation...');

    const levels = [];

    await humanSimulator.scrollAndCapture(async (scrollY, viewportHeight, levelIndex) => {
      const levelData = await this.captureLevel(scrollY, viewportHeight, levelIndex);
      levels.push(levelData);

      logger.debug(`[AdHeatmap] Level ${levelIndex}: ${levelData.adCount} ads, density: ${(levelData.adDensity * 100).toFixed(1)}%`);

      // Call optional callback for progressive content extraction
      if (onScrollLevel && typeof onScrollLevel === 'function') {
        try {
          await onScrollLevel(scrollY, viewportHeight, levelIndex);
        } catch (e) {
          logger.debug(`[AdHeatmap] onScrollLevel callback error at level ${levelIndex}:`, e.message);
        }
      }

      return levelData;
    });

    return this.analyzeHeatmap(levels);
  }

  analyzeHeatmap(levels) {
    if (levels.length === 0) {
      return {
        levels: [],
        totalScrollLevels: 0,
        totalAdsDetected: 0,
        avgAdDensity: 0,
        avgCLS: 0,
        adsAboveFold: 0,
        infiniteAdsPattern: false,
        scrollTrapDetected: false,
        mfaScore: 0
      };
    }

    const totalAds = levels.reduce((sum, l) => sum + l.adCount, 0);
    const avgDensity = levels.reduce((sum, l) => sum + l.adDensity, 0) / levels.length;
    const avgCLS = levels.reduce((sum, l) => sum + l.cls, 0) / levels.length;
    const adsAboveFold = levels[0]?.adsAboveFold || 0;

    // Detect infinite scroll MFA pattern (ads increase as you scroll)
    const adCounts = levels.map(l => l.adCount);
    const isInfiniteAdsPattern = levels.length > 3 &&
      adCounts.slice(-3).every((c, i, arr) => i === 0 || c >= arr[i - 1] * 0.8);

    // Detect scroll trap (very high ad density)
    const scrollTrapDetected = avgDensity > 0.25;

    // Ad distribution analysis
    const adDistribution = {
      top: levels.slice(0, Math.ceil(levels.length / 3))
        .reduce((sum, l) => sum + l.adCount, 0),
      middle: levels.slice(Math.ceil(levels.length / 3), Math.ceil(2 * levels.length / 3))
        .reduce((sum, l) => sum + l.adCount, 0),
      bottom: levels.slice(Math.ceil(2 * levels.length / 3))
        .reduce((sum, l) => sum + l.adCount, 0)
    };

    const analysis = {
      levels,
      totalScrollLevels: levels.length,
      totalAdsDetected: totalAds,
      avgAdDensity: avgDensity,  // Use the local variable avgDensity
      avgCLS,
      adsAboveFold,
      adDistribution,
      infiniteAdsPattern: isInfiniteAdsPattern,
      scrollTrapDetected,
      mfaScore: this.calculateMFAScore(levels, avgDensity, avgCLS, adsAboveFold)
    };

    logger.info('[AdHeatmap] Analysis complete', {
      totalAds,
      avgDensity: (avgDensity * 100).toFixed(1) + '%',
      avgCLS: avgCLS.toFixed(3),
      mfaScore: analysis.mfaScore
    });

    return analysis;
  }

  calculateMFAScore(levels, avgDensity, avgCLS, adsAboveFold) {
    let score = 0;

    // Ad density scoring (0-30 points)
    if (avgDensity > 0.4) score += 30;
    else if (avgDensity > 0.25) score += 20;
    else if (avgDensity > 0.15) score += 10;
    else if (avgDensity > 0.08) score += 5;

    // CLS scoring (0-25 points) - layout instability is MFA indicator
    if (avgCLS > 0.25) score += 25;
    else if (avgCLS > 0.1) score += 15;
    else if (avgCLS > 0.05) score += 8;

    // Ads above fold (0-20 points)
    if (adsAboveFold > 4) score += 20;
    else if (adsAboveFold > 2) score += 12;
    else if (adsAboveFold > 1) score += 5;

    // Infinite scroll pattern (0-25 points)
    const adCounts = levels.map(l => l.adCount);
    if (levels.length > 3) {
      const firstHalf = adCounts.slice(0, Math.floor(levels.length / 2));
      const secondHalf = adCounts.slice(Math.floor(levels.length / 2));
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

      if (secondAvg > firstAvg * 1.5) score += 25;
      else if (secondAvg > firstAvg * 1.2) score += 15;
    }

    return Math.min(100, score);
  }

  // Quick scan without full scroll
  async quickScan() {
    const ads = await this.detectAdsInViewport();
    const cls = await this.measureCLS();
    const dimensions = await this.getPageDimensions();

    return {
      adsVisible: ads.length,
      adsAboveFold: ads.filter(a => a.isAboveFold).length,
      cls,
      estimatedTotalLevels: Math.ceil(dimensions.totalHeight / dimensions.viewportHeight)
    };
  }
}

module.exports = AdHeatmapGenerator;
