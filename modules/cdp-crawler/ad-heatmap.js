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
    // Google Ads
    '[id*="google_ads"]', '[id*="gpt-"]', '[class*="adunit"]',
    '[data-google-query-id]', 'ins.adsbygoogle', '[id*="div-gpt-ad"]',

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
    '[id*="amazon"]', '[class*="amzn"]'
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
                  const hasAdSrc = isIframe && (
                    el.src?.includes('doubleclick') ||
                    el.src?.includes('googlesyndication') ||
                    el.src?.includes('amazon-adsystem')
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

  async generateFullHeatmap(humanSimulator) {
    logger.info('[AdHeatmap] Starting full page heatmap generation...');

    const levels = [];

    await humanSimulator.scrollAndCapture(async (scrollY, viewportHeight, levelIndex) => {
      const levelData = await this.captureLevel(scrollY, viewportHeight, levelIndex);
      levels.push(levelData);

      logger.debug(`[AdHeatmap] Level ${levelIndex}: ${levelData.adCount} ads, density: ${(levelData.adDensity * 100).toFixed(1)}%`);

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
