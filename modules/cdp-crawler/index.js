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
      timeout: options.timeout || 120000, // Increased to 120s
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
    const { fullHeatmap = true, simulateBrowsing = true, blockResources = false } = options;

    logger.info(`[CDPCrawler] Crawling: ${url}`);
    const startTime = Date.now();

    // Content collection for progressive extraction
    let baselineContent = '';
    let scrollContents = [];
    let finalContent = '';

    try {
      // Check browser health before starting
      if (!this.chromeClient.isHealthy()) {
        throw new Error('Browser is not healthy');
      }

      // Optionally block heavy resources for speed
      if (blockResources) {
        await this.chromeClient.blockResources(true);
      }

      // Execute before_navigate hook
      await this.executeHook('before_navigate', { url, options });

      // Navigate to page with timeout
      const navigated = await this.chromeClient.navigate(url, {
        timeout: this.options.timeout
      });

      if (!navigated) {
        throw new Error('Navigation failed');
      }

      // Execute after_navigate hook
      await this.executeHook('after_navigate', { url, success: true });

      // Wait for network to become idle (instead of fixed wait)
      logger.debug('[CDPCrawler] Waiting for network idle...');
      await this.chromeClient.waitForNetworkIdle(15000, 500);

      // Wait for DOM to stabilize
      await this.waitForDOMStable(5000, 300);

      // Handle cookie consent banners
      try {
        await this.handleCookieConsent();
      } catch (e) {
        logger.debug('[CDPCrawler] Cookie consent handling skipped:', e.message);
      }

      // Remove overlays/popups that may interfere with ad detection
      try {
        await this.antiDetect.removeOverlays();
        logger.debug('[CDPCrawler] Removed overlay elements');
      } catch (e) {
        logger.debug('[CDPCrawler] Overlay removal skipped:', e.message);
      }

      // === PHASE 1: BASELINE CONTENT EXTRACTION ===
      logger.debug('[CDPCrawler] Extracting baseline content...');
      baselineContent = await this.extractContentSafe();
      logger.debug(`[CDPCrawler] Baseline content: ${baselineContent?.length || 0} chars`);

      // === PHASE 2: SCROLL + HEATMAP + PROGRESSIVE EXTRACTION ===
      let heatmapData = null;
      if (fullHeatmap) {
        // Generate ad heatmap with scroll - capture content at each level
        heatmapData = await this.adHeatmap.generateFullHeatmap(this.humanSimulator, async (scrollY) => {
          // Progressive content extraction callback
          try {
            const chunk = await this.extractContentSafe();
            if (chunk && chunk.length > 100) {
              scrollContents.push(chunk);
            }
          } catch (e) {
            logger.debug('[CDPCrawler] Progressive extraction failed at scroll level');
          }
        });
      } else {
        heatmapData = await this.adHeatmap.quickScan();
      }

      // Additional browsing simulation
      if (simulateBrowsing) {
        await this.humanSimulator.randomMouseMovement(3000);
      }

      // Wait for network idle again after all interactions
      await this.chromeClient.waitForNetworkIdle(10000, 500);

      // === PHASE 3: FINAL CONTENT EXTRACTION WITH RETRIES ===
      finalContent = await this.extractContentWithRetry(3);

      // Choose best content from all extractions
      const content = this.chooseBestContent(baselineContent, scrollContents, finalContent);

      // Get network analysis
      const networkAnalysis = this.networkInterceptor.getAnalysis();

      // Calculate combined MFA indicators
      const mfaIndicators = this.calculateMFAIndicators(heatmapData, networkAnalysis);

      const duration = Date.now() - startTime;
      logger.info(`[CDPCrawler] Crawl complete in ${duration}ms`, {
        url,
        mfaScore: mfaIndicators.combinedScore,
        adCount: heatmapData?.totalAdsDetected || 0,
        adNetworks: networkAnalysis.adNetworkCount,
        contentLength: content?.length || 0
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
      // Save debug screenshot on failure
      try {
        await this.chromeClient.saveDebugScreenshot(`crawl_fail_${url.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}`);
      } catch (e) {
        // Ignore screenshot errors
      }

      logger.error(`[CDPCrawler] Crawl failed: ${url}`, {
        error: error.message,
        stack: error.stack
      });

      // Return best content we managed to get, even on failure
      const partialContent = this.chooseBestContent(baselineContent, scrollContents, finalContent);

      return {
        url,
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        content: partialContent,
        contentLength: partialContent?.length || 0,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Wait for DOM to stabilize (no mutations for idleTime ms)
   */
  async waitForDOMStable(timeout = 5000, idleTime = 300) {
    try {
      return await this.chromeClient.evaluate(`
        new Promise((resolve) => {
          let lastMutation = Date.now();
          let resolved = false;
          
          const observer = new MutationObserver(() => {
            lastMutation = Date.now();
          });
          
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true
          });
          
          const check = () => {
            if (resolved) return;
            if (Date.now() - lastMutation >= ${idleTime}) {
              resolved = true;
              observer.disconnect();
              resolve(true);
            } else {
              setTimeout(check, 100);
            }
          };
          
          setTimeout(check, ${idleTime});
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              observer.disconnect();
              resolve(false);
            }
          }, ${timeout});
        })
      `);
    } catch (e) {
      logger.debug('[CDPCrawler] DOM stability check failed:', e.message);
      return false;
    }
  }

  /**
   * Handle cookie consent banners
   */
  async handleCookieConsent() {
    const consentSelectors = [
      '[id*="cookie"] button[class*="accept"]',
      '[class*="cookie"] button[class*="accept"]',
      '[id*="consent"] button[class*="accept"]',
      'button[id*="accept-cookies"]',
      'button[class*="accept-cookies"]',
      '[data-testid*="cookie-accept"]',
      '#onetrust-accept-btn-handler',
      '.cookie-consent-accept'
    ];

    for (const selector of consentSelectors) {
      try {
        const clicked = await this.chromeClient.evaluate(`
          (() => {
            const btn = document.querySelector('${selector}');
            if (btn && btn.offsetParent !== null) {
              btn.click();
              return true;
            }
            return false;
          })()
        `);
        if (clicked) {
          logger.debug(`[CDPCrawler] Clicked cookie consent: ${selector}`);
          await this.humanSimulator.wait(500, 1000);
          return true;
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    return false;
  }

  /**
   * Safe content extraction (won't throw)
   */
  async extractContentSafe() {
    try {
      return await this.extractContent();
    } catch (e) {
      logger.debug('[CDPCrawler] Safe extraction failed:', e.message);
      return '';
    }
  }

  /**
   * Extract content with retry logic
   */
  async extractContentWithRetry(maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const content = await this.extractContent();
        if (content && content.length > 100) {
          return content;
        }
        logger.debug(`[CDPCrawler] Extraction attempt ${attempt} got ${content?.length || 0} chars`);
      } catch (error) {
        logger.warn(`[CDPCrawler] Extraction attempt ${attempt} failed:`, error.message);
      }

      if (attempt < maxRetries) {
        // Wait before retry with exponential backoff
        await this.humanSimulator.wait(500 * attempt, 1000 * attempt);
      }
    }

    // Final fallback - try raw innerText
    try {
      const fallback = await this.chromeClient.evaluate('document.body.innerText || ""');
      return fallback || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Choose best content from multiple extractions
   */
  chooseBestContent(baseline, scrollChunks, final) {
    const candidates = [
      { content: final, source: 'final' },
      { content: baseline, source: 'baseline' },
      ...(scrollChunks || []).map((c, i) => ({ content: c, source: `scroll_${i}` }))
    ].filter(c => c.content && c.content.length > 0);

    if (candidates.length === 0) {
      return '';
    }

    // Score each candidate
    const scored = candidates.map(c => ({
      ...c,
      score: this.scoreContent(c.content)
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    logger.debug(`[CDPCrawler] Best content: ${scored[0].source} (score: ${scored[0].score}, ${scored[0].content.length} chars)`);
    return scored[0].content;
  }

  /**
   * Score content quality
   */
  scoreContent(content) {
    if (!content) return 0;

    let score = 0;

    // Length score (prefer longer content, but with diminishing returns)
    score += Math.min(content.length / 100, 100);

    // Markdown structure (headings, lists)
    const headings = (content.match(/^#{1,6}\s/gm) || []).length;
    score += headings * 5;

    const listItems = (content.match(/^[-*]\s/gm) || []).length;
    score += listItems * 2;

    // Paragraphs (double newlines)
    const paragraphs = (content.match(/\n\n/g) || []).length;
    score += paragraphs * 3;

    // Penalize if looks like error/fallback
    if (content.includes('FALLBACK_TEXT')) {
      score -= 50;
    }

    return score;
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
          clone.querySelectorAll('script, style, noscript, iframe, svg, nav, footer, header, aside, [role="navigation"], [role="banner"], [role="complementary"], .sidebar, .advertisement, .ad, .ads, .social-share, .comments, .related-posts').forEach(el => el.remove());

          // Try to find main content area first (better content extraction)
          let contentRoot = clone.querySelector('article') || 
                           clone.querySelector('main') || 
                           clone.querySelector('[role="main"]') ||
                           clone.querySelector('.post-content') ||
                           clone.querySelector('.entry-content') ||
                           clone.querySelector('.article-content') ||
                           clone.querySelector('.content') ||
                           clone.querySelector('#content') ||
                           clone;

          let markdown = htmlToMarkdown(contentRoot)
            .replace(/\\n\\s+\\n/g, '\\n\\n') // Collapse multiple blank lines
            .replace(/\\n{3,}/g, '\\n\\n') // Max 2 newlines
            .trim()
            .substring(0, 50000); // Limit size

          // Fallback to full body if markdown from content area is too short
          if ((!markdown || markdown.length < 200) && contentRoot !== clone) {
             const fullBodyMarkdown = htmlToMarkdown(clone)
               .replace(/\\n\\s+\\n/g, '\\n\\n')
               .replace(/\\n{3,}/g, '\\n\\n')
               .trim()
               .substring(0, 50000);
             
             if (fullBodyMarkdown.length > markdown.length) {
               markdown = fullBodyMarkdown;
             }
          }

          // Fallback to innerText if markdown is still empty or too short
          if (!markdown || markdown.length < 100) {
             const rawText = document.body.innerText || '';
             // Basic cleanup of raw text
             const cleanText = rawText.replace(/\\n{3,}/g, '\\n\\n').trim();
             
             if (cleanText.length > (markdown ? markdown.length : 0)) {
                return 'FALLBACK_TEXT (Extraction Failed):\\n' + cleanText.substring(0, 50000);
             }
          }
          
          return markdown;
        })()
      `);

      // evaluate() returns the value directly, not wrapped in {value}
      if (result === null || result === undefined) {
        logger.warn('[CDPCrawler] Content extraction returned null/undefined, trying raw body text');
        const fallback = await this.chromeClient.evaluate('document.body.innerText || ""');
        return fallback || '';
      }

      if (result === '' || (typeof result === 'string' && result.trim() === '')) {
        logger.warn('[CDPCrawler] Content extraction returned empty string, trying raw body text');
        const fallback = await this.chromeClient.evaluate('document.body.innerText || ""');
        return fallback || '';
      }

      return result;
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
