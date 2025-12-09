/**
 * CDP Crawler - Main Entry Point
 * Combines all components into a unified MFA detection crawler
 */

const ChromeCDPClient = require('./chrome-client');
const AntiDetect = require('./anti-detect');
const HumanSimulator = require('./human-simulator');
const NetworkInterceptor = require('./network-interceptor');
const AdHeatmapGenerator = require('./ad-heatmap');
const { KeywordRelevanceScorer, PathDepthScorer, ContentTypeFilter } = require('./url-scorers');
const logger = require('../logger');

// Default fingerprint profiles
const FINGERPRINT_PROFILES = {
  desktop: {
    platform: 'Win32',
    languages: ['en-US', 'en'],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    cores: 8,
    memory: 8,
    isMobile: false,
    webglVendor: 'Google Inc. (Intel)',
    webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'
  },
  mobile: {
    platform: 'Linux armv8l',
    languages: ['en-US'],
    userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    cores: 8,
    memory: 4,
    isMobile: true,
    webglVendor: 'Qualcomm',
    webglRenderer: 'Adreno (TM) 650'
  }
};

class CDPCrawler {
  constructor(options = {}) {
    this.options = {
      fingerprint: options.fingerprint || 'desktop',
      timeout: options.timeout || 90000,
      scrollDuration: options.scrollDuration || 45000,
      ...options
    };

    this.chromeClient = null;
    this.client = null;
    this.antiDetect = null;
    this.humanSimulator = null;
    this.networkInterceptor = null;
    this.adHeatmap = null;

    // New analyzers from crawl4ai
    this.keywordScorer = new KeywordRelevanceScorer();
    this.pathDepthScorer = new PathDepthScorer();
    this.contentTypeFilter = new ContentTypeFilter();

    // Hooks system (inspired by crawl4ai)
    this.hooks = {
      on_browser_created: null,
      before_navigate: null,
      after_navigate: null,
      before_scroll: null,
      after_scroll: null,
      on_ad_detected: null,
      on_content_extracted: null,
      on_error: null,
      before_close: null
    };
  }

  /**
   * Register a hook callback
   * @param {string} hookType - Hook name from this.hooks
   * @param {Function} callback - Async function to call
   */
  setHook(hookType, callback) {
    if (hookType in this.hooks) {
      this.hooks[hookType] = callback;
      logger.debug(`[CDPCrawler] Hook registered: ${hookType}`);
    } else {
      throw new Error(`Invalid hook type: ${hookType}. Valid types: ${Object.keys(this.hooks).join(', ')}`);
    }
    return this;
  }

  /**
   * Execute a hook if registered
   * @param {string} hookType - Hook name
   * @param  {...any} args - Arguments to pass to hook
   */
  async executeHook(hookType, ...args) {
    const hook = this.hooks[hookType];
    if (hook) {
      try {
        return await hook(...args);
      } catch (error) {
        logger.warn(`[CDPCrawler] Hook ${hookType} error:`, error.message);
      }
    }
    return args[0]; // Return first arg if no hook
  }

  /**
   * Smart wait - auto-detect CSS selector or JS condition
   * Inspired by crawl4ai smart_wait
   * @param {string} condition - CSS selector, 'css:selector', or 'js:() => boolean'
   * @param {number} timeout - Max wait time in ms
   */
  async smartWait(condition, timeout = 30000) {
    const startTime = Date.now();
    condition = condition.trim();

    try {
      if (condition.startsWith('js:')) {
        // JavaScript condition
        const jsCode = condition.slice(3).trim();
        return await this._waitForJsCondition(jsCode, timeout);
      } else if (condition.startsWith('css:')) {
        // CSS selector
        const selector = condition.slice(4).trim();
        return await this._waitForSelector(selector, timeout);
      } else {
        // Auto-detect: try as CSS first, then JS
        try {
          return await this._waitForSelector(condition, timeout);
        } catch (e) {
          // Maybe it's a JS condition
          if (condition.includes('=>') || condition.includes('return') || condition.includes('document.')) {
            return await this._waitForJsCondition(condition, timeout);
          }
          throw e;
        }
      }
    } catch (error) {
      logger.debug(`[CDPCrawler] smartWait failed for "${condition}":`, error.message);
      return false;
    }
  }

  async _waitForSelector(selector, timeout) {
    const startTime = Date.now();
    const pollInterval = 100;

    while (Date.now() - startTime < timeout) {
      const result = await this.chromeClient.evaluate(`
        !!document.querySelector(${JSON.stringify(selector)})
      `);
      if (result) return true;
      await new Promise(r => setTimeout(r, pollInterval));
    }
    return false;
  }

  async _waitForJsCondition(jsCode, timeout) {
    const startTime = Date.now();
    const pollInterval = 100;

    // Wrap in async IIFE if needed
    const wrappedCode = jsCode.startsWith('(') || jsCode.startsWith('async')
      ? `(${jsCode})()`
      : `(async () => { ${jsCode} })()`;

    while (Date.now() - startTime < timeout) {
      try {
        const result = await this.chromeClient.evaluate(wrappedCode);
        if (result) return true;
      } catch (e) {
        // Condition threw error, keep waiting
      }
      await new Promise(r => setTimeout(r, pollInterval));
    }
    return false;
  }

  async launch(proxyUrl = null) {
    logger.info('[CDPCrawler] Launching crawler...');

    // Get fingerprint profile
    const profile = typeof this.options.fingerprint === 'string'
      ? FINGERPRINT_PROFILES[this.options.fingerprint] || FINGERPRINT_PROFILES.desktop
      : this.options.fingerprint;

    // Create Chrome client
    this.chromeClient = new ChromeCDPClient({
      headless: true,
      proxy: proxyUrl,
      userAgent: profile.userAgent
    });

    // Launch Chrome and connect
    this.client = await this.chromeClient.launch();

    // Initialize components
    this.antiDetect = new AntiDetect(this.client);
    this.humanSimulator = new HumanSimulator(this.client);
    this.networkInterceptor = new NetworkInterceptor(this.client);
    this.adHeatmap = new AdHeatmapGenerator(this.client);

    // Apply anti-detect patches
    await this.antiDetect.applyAll(profile);

    // Start network interception
    await this.networkInterceptor.start();

    // Execute on_browser_created hook
    await this.executeHook('on_browser_created', { client: this.client, profile });

    logger.info('[CDPCrawler] Crawler ready');
    return this;
  }

  async crawl(url, options = {}) {
    const { fullHeatmap = true, simulateBrowsing = true } = options;

    logger.info(`[CDPCrawler] Crawling: ${url}`);
    const startTime = Date.now();

    try {
      // Execute before_navigate hook
      await this.executeHook('before_navigate', { url, options });

      // Navigate to page
      const navigated = await this.chromeClient.navigate(url, {
        timeout: this.options.timeout
      });

      if (!navigated) {
        throw new Error('Navigation failed');
      }

      // Execute after_navigate hook
      await this.executeHook('after_navigate', { url, success: true });

      // Wait for dynamic content (longer wait for ads)
      await this.humanSimulator.wait(5000, 8000);

      // Remove overlays/popups that may interfere with ad detection
      try {
        await this.antiDetect.removeOverlays();
        logger.debug('[CDPCrawler] Removed overlay elements');
      } catch (e) {
        logger.debug('[CDPCrawler] Overlay removal skipped:', e.message);
      }

      // Generate ad heatmap (with scroll)
      let heatmapData = null;
      if (fullHeatmap) {
        heatmapData = await this.adHeatmap.generateFullHeatmap(this.humanSimulator);
      } else {
        heatmapData = await this.adHeatmap.quickScan();
      }

      // Additional browsing simulation
      if (simulateBrowsing) {
        await this.humanSimulator.randomMouseMovement(3000);
      }

      // Extract content
      const content = await this.extractContent();

      // Get network analysis
      const networkAnalysis = this.networkInterceptor.getAnalysis();

      // Calculate combined MFA indicators
      const mfaIndicators = this.calculateMFAIndicators(heatmapData, networkAnalysis);

      const duration = Date.now() - startTime;
      logger.info(`[CDPCrawler] Crawl complete in ${duration}ms`, {
        url,
        mfaScore: mfaIndicators.combinedScore,
        adCount: heatmapData.totalAdsDetected,
        adNetworks: networkAnalysis.adNetworkCount
      });

      return {
        url,
        success: true,
        duration,
        content,
        contentLength: content?.length || 0,
        networkAnalysis,
        adHeatmap: heatmapData,
        mfaIndicators,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`[CDPCrawler] Crawl failed: ${url}`, { error: error.message });
      return {
        url,
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
    }
  }

  async extractContent() {
    try {
      if (!this.chromeClient) {
        logger.warn('[CDPCrawler] Content extraction skipped: No Chrome client');
        return '';
      }

      const result = await this.chromeClient.evaluate(`
        (() => {
          function htmlToMarkdown(node) {
            let output = '';
            
            // Helper to process children
            const processChildren = (n) => {
              let childOutput = '';
              n.childNodes.forEach(child => {
                childOutput += htmlToMarkdown(child);
              });
              return childOutput;
            };

            // Skip non-element/text nodes
            if (node.nodeType === Node.TEXT_NODE) {
              return node.textContent.replace(/\\s+/g, ' ');
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return '';

            const tagName = node.tagName.toLowerCase();
            
            // Skip unwanted tags
            if (['script', 'style', 'noscript', 'iframe', 'svg', 'nav', 'footer', 'header', 'aside', 'form', 'button'].includes(tagName)) {
              return '';
            }
            
            // Skip hidden elements
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              return '';
            }

            // Process headings
            if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
              const level = parseInt(tagName.substring(1));
              return '\\n' + '#'.repeat(level) + ' ' + processChildren(node).trim() + '\\n\\n';
            }

            // Process paragraphs
            if (tagName === 'p') {
              return '\\n' + processChildren(node).trim() + '\\n\\n';
            }

            // Process lists
            if (tagName === 'ul') {
              let listOut = '\\n';
              node.childNodes.forEach(child => {
                if (child.tagName && child.tagName.toLowerCase() === 'li') {
                  listOut += '- ' + processChildren(child).trim() + '\\n';
                }
              });
              return listOut + '\\n';
            }
            if (tagName === 'ol') {
              let listOut = '\\n';
              let index = 1;
              node.childNodes.forEach(child => {
                if (child.tagName && child.tagName.toLowerCase() === 'li') {
                  listOut += index + '. ' + processChildren(child).trim() + '\\n';
                  index++;
                }
              });
              return listOut + '\\n';
            }

            // Process formatting
            if (tagName === 'strong' || tagName === 'b') {
              return '**' + processChildren(node).trim() + '**';
            }
            if (tagName === 'em' || tagName === 'i') {
              return '*' + processChildren(node).trim() + '*';
            }
            if (tagName === 'a') {
              const href = node.getAttribute('href');
              const text = processChildren(node).trim();
              if (!href || !text) return text;
              return '[' + text + '](' + href + ')';
            }
            if (tagName === 'img') {
              const alt = node.getAttribute('alt') || '';
              const src = node.getAttribute('src');
              if (!src) return '';
              return '![' + alt + '](' + src + ')';
            }
            if (tagName === 'blockquote') {
              return '\\n> ' + processChildren(node).trim().replace(/\\n/g, '\\n> ') + '\\n\\n';
            }
            if (tagName === 'code') {
              return '\`' + processChildren(node).trim() + '\`';
            }
            if (tagName === 'pre') {
              return '\\n\`\`\`\\n' + processChildren(node).trim() + '\\n\`\`\`\\n\\n';
            }
            if (tagName === 'br') {
              return '\\n';
            }
            if (tagName === 'hr') {
              return '\\n---\\n';
            }

            // Default: process children
            return processChildren(node);
          }

          // Clone body to avoid modifying page
          const clone = document.body.cloneNode(true);
          
          // Initial cleanup of obviously bad elements before traversal
          clone.querySelectorAll('script, style, noscript, iframe, svg').forEach(el => el.remove());

          let markdown = htmlToMarkdown(clone)
            .replace(/\\n\\s+\\n/g, '\\n\\n') // Collapse multiple blank lines
            .replace(/\\n{3,}/g, '\\n\\n') // Max 2 newlines
            .trim()
            .substring(0, 50000); // Limit size

          // Fallback to innerText if markdown is empty
          if (!markdown || markdown.length < 50) {
             const rawText = document.body.innerText || '';
             if (rawText.length > markdown.length) {
                return 'FALLBACK_TEXT:\\n' + rawText.substring(0, 50000);
             }
          }
          
          return markdown;
        })()
      `);

      if (!result || !result.value) {
        logger.warn('[CDPCrawler] Content extraction returned empty or invalid result');
        return '';
      }

      return result.value;
    } catch (error) {
      logger.warn('[CDPCrawler] Content extraction failed:', error.message || error);
      return '';
    }
  }

  calculateMFAIndicators(heatmapData, networkAnalysis) {
    // Calculate scores
    const heatmapScore = Math.min(100, (heatmapData.avgAdDensity || 0) * 2);
    const networkScore = networkAnalysis.networkRiskScore || 0;
    const combinedScore = Math.round((heatmapScore * 0.6) + (networkScore * 0.4));

    const suspiciousPatterns = [];
    if (heatmapData.infiniteAdsPattern) {
      suspiciousPatterns.push('INFINITE_SCROLL_MFA');
    }
    if (heatmapData.scrollTrapDetected) {
      suspiciousPatterns.push('HIGH_AD_DENSITY');
    }
    if (heatmapData.avgCLS > 0.1) {
      suspiciousPatterns.push('HIGH_LAYOUT_SHIFT');
    }

    return {
      // Scores
      heatmapScore,
      networkScore,
      combinedScore,

      // Key metrics
      adDensity: heatmapData.avgAdDensity,
      layoutShift: heatmapData.avgCLS,
      adsAboveFold: heatmapData.adsAboveFold,
      totalAds: heatmapData.totalAdsDetected,
      adNetworkCount: networkAnalysis.adNetworkCount,

      // Patterns detected
      hasAutoRefresh: networkAnalysis.hasAutoRefresh,
      infiniteScrollMFA: heatmapData.infiniteAdsPattern,
      scrollTrap: heatmapData.scrollTrapDetected,
      suspiciousPatterns,

      // Risk level
      riskLevel: combinedScore >= 70 ? 'HIGH' :
        combinedScore >= 40 ? 'MEDIUM' : 'LOW'
    };
  }

  async screenshot(options = {}) {
    return this.chromeClient.screenshot(options);
  }

  /**
   * Extract content from iframes (ads often hide in iframes)
   * Inspired by crawl4ai process_iframes
   * @returns {Promise<Array<{id: string, src: string, content: string}>>}
   */
  async extractIframeContent() {
    try {
      const iframeData = await this.chromeClient.evaluate(`
        (async () => {
          const iframes = document.querySelectorAll('iframe');
          const results = [];
          
          for (let i = 0; i < iframes.length; i++) {
            const iframe = iframes[i];
            const src = iframe.src || iframe.getAttribute('data-src') || '';
            
            try {
              // Only process same-origin iframes
              if (iframe.contentDocument) {
                const content = iframe.contentDocument.body?.innerText || '';
                results.push({
                  id: iframe.id || 'iframe-' + i,
                  src: src,
                  content: content.substring(0, 5000),
                  isAd: src.includes('ad') || src.includes('banner') || 
                        src.includes('doubleclick') || src.includes('googlesyndication')
                });
              } else {
                // Cross-origin - we can only get src
                results.push({
                  id: iframe.id || 'iframe-' + i,
                  src: src,
                  content: null,
                  isAd: src.includes('ad') || src.includes('banner') || 
                        src.includes('doubleclick') || src.includes('googlesyndication')
                });
              }
            } catch (e) {
              results.push({
                id: iframe.id || 'iframe-' + i,
                src: src,
                content: null,
                error: e.message,
                isAd: src.includes('ad') || src.includes('banner')
              });
            }
          }
          
          return results;
        })()
      `);

      return iframeData || [];
    } catch (error) {
      logger.debug('[CDPCrawler] Iframe extraction failed:', error.message);
      return [];
    }
  }

  async close() {
    // Execute before_close hook
    await this.executeHook('before_close', { crawler: this });

    logger.info('[CDPCrawler] Closing crawler...');
    await this.chromeClient?.close();
    this.client = null;
    this.chromeClient = null;
  }

  isConnected() {
    return this.chromeClient?.isConnected() || false;
  }
}

// Export both class and factory function
module.exports = CDPCrawler;
module.exports.CDPCrawler = CDPCrawler;
module.exports.FINGERPRINT_PROFILES = FINGERPRINT_PROFILES;
