const logger = require('../logger');

async function extractAdElements(page) {
  try {
    // Check if page is already closed
    if (page.isClosed()) {
      logger.warn('Cannot extract ad elements: page is already closed');
      return [];
    }

    logger.info('Waiting for ads to load...');

    // Wait for page to be more stable before looking for ads
    // Use waitForLoadState instead of waitForTimeout when possible
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {
      logger.debug('Network idle timeout, continuing with extraction');
    });

    // Check if page is still open
    if (page.isClosed()) {
      logger.warn('Page closed during initial load wait');
      return [];
    }

    // Wait for GPT to be ready if it exists
    try {
      await page.waitForFunction(
        () => {
          return !window.googletag || (window.googletag && window.googletag.apiReady);
        },
        { timeout: 8000 }
      );
      logger.info('Google Publisher Tag detected and ready');
    } catch (e) {
      if (e.message && e.message.includes('closed')) {
        logger.warn('Page closed while waiting for GPT');
        return [];
      }
      logger.warn('GPT not detected or timeout waiting for readiness');
    }

    // Check if page is still open
    if (page.isClosed()) {
      logger.warn('Page closed after GPT check');
      return [];
    }

    // Wait for Prebid if present
    try {
      await page.waitForFunction(
        () => !window.pbjs || (window.pbjs && window.pbjs.requestBids),
        { timeout: 3000 }
      );
    } catch (e) {
      if (e.message && e.message.includes('closed')) {
        logger.warn('Page closed while waiting for Prebid');
        return [];
      }
      // Prebid not present or not ready, continue
    }

    // Check if page is still open before final wait
    if (page.isClosed()) {
      logger.warn('Page closed before final ad load wait');
      return [];
    }

    // Additional wait for ad slots to render after auction completes
    await page.waitForLoadState('load', { timeout: 3000 }).catch(() => {
      logger.debug('Load state timeout, continuing with extraction');
    });

    // Final check before evaluation
    if (page.isClosed()) {
      logger.warn('Page closed before ad element evaluation');
      return [];
    }

    const adElements = await page.evaluate(() => {
      const ads = [];
      const processedElements = new Set();

      // Comprehensive ad detection patterns
      const isAd = (el) => {
        const id = (el.id || '').toLowerCase();
        const className = (typeof el.className === 'string' ? el.className.toLowerCase() : '');
        const tagName = el.tagName.toUpperCase();

        // 1. ID Patterns (comprehensive)
        const idPatterns = [
          /^ad[-_\s]?/i, /[-_\s]ad$/i, /[-_\s]ad[-_\s]/i,
          /^gpt[-_]/i, /^dfp[-_]/i, /^div[-_]gpt/i,
          /google[-_]?ad/i, /adsense/i, /advert/i,
          /^banner[-_]?ad/i, /^sidebar[-_]?ad/i,
          /^leaderboard/i, /^skyscraper/i, /^rectangle/i,
          /^sticky[-_]?ad/i, /^floating[-_]?ad/i
        ];
        for (const pattern of idPatterns) {
          if (pattern.test(id)) return 'id-pattern';
        }

        // 2. Class Patterns (comprehensive)
        const classPatterns = [
          /adsbygoogle/i, /ad[-_]?slot/i, /ad[-_]?unit/i,
          /ad[-_]?container/i, /ad[-_]?wrapper/i, /ad[-_]?block/i,
          /google[-_]?ad/i, /dfp[-_]?ad/i, /gpt[-_]?ad/i,
          /sponsored/i, /advertisement/i, /promo[-_]?banner/i,
          /native[-_]?ad/i, /in[-_]?feed[-_]?ad/i,
          /taboola/i, /outbrain/i, /mgid/i, /revcontent/i
        ];
        for (const pattern of classPatterns) {
          if (pattern.test(className)) return 'class-pattern';
        }

        // 3. Data Attribute Patterns (Strong signals)
        const dataAttrs = [
          'data-google-query-id', 'data-ad-slot', 'data-ad-unit',
          'data-ad-client', 'data-adsbygoogle-status', 'data-ad-format',
          'data-full-width-responsive', 'data-matched-content-ui-type',
          'data-taboola-widget-id', 'data-outbrain-widget-id'
        ];
        for (const attr of dataAttrs) {
          if (el.hasAttribute(attr)) return 'data-attribute';
        }

        // 4. Tag Patterns
        if (tagName === 'INS' && (el.classList.contains('adsbygoogle') || el.hasAttribute('data-ad-client'))) return 'google-ins';
        if (tagName === 'GPT-AD') return 'gpt-tag';
        if (tagName === 'AMP-AD' || tagName === 'AMP-EMBED') return 'amp-ad';

        // 5. Check for iframe with ad-related src
        if (tagName === 'IFRAME') {
          const src = (el.src || el.getAttribute('src') || '').toLowerCase();
          const adIframeDomains = [
            'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
            'adnxs.com', 'pubmatic.com', 'rubiconproject.com', 'openx.net',
            'criteo.com', 'amazon-adsystem.com', 'taboola.com', 'outbrain.com',
            'mgid.com', 'sharethrough.com', 'triplelift.com'
          ];
          if (adIframeDomains.some(domain => src.includes(domain))) {
            return 'ad-iframe';
          }
          // Check iframe ID/name patterns
          if (/google_ads|ad[-_]?frame/i.test(el.id || el.name || '')) {
            return 'ad-iframe-id';
          }
        }

        // 6. Check parent context (sometimes ads are wrapped)
        const parent = el.parentElement;
        if (parent) {
          const parentId = (parent.id || '').toLowerCase();
          const parentClass = (typeof parent.className === 'string' ? parent.className.toLowerCase() : '');
          if (/^ad[-_]|[-_]ad[-_]|[-_]ad$/i.test(parentId) || /ad[-_]?container|ad[-_]?wrapper/i.test(parentClass)) {
            return 'parent-context';
          }
        }

        return null;
      };

      // Helper to traverse Shadow DOM
      const findAllAds = (root) => {
        const elements = root.querySelectorAll('*');
        elements.forEach(el => {
          const type = isAd(el);
          if (type) {
            // Check visibility
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);

            if (rect.width > 1 || rect.height > 1) { // Filter out 1x1 tracking pixels from "ads" list if desired, or keep them
              ads.push({
                type,
                id: el.id,
                className: typeof el.className === 'string' ? el.className : '',
                tag: el.tagName,
                dataAttributes: Array.from(el.attributes)
                  .filter(attr => attr.name.startsWith('data-'))
                  .reduce((acc, attr) => {
                    acc[attr.name] = attr.value;
                    return acc;
                  }, {}),
                position: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                },
                viewportPosition: {
                  top: rect.top,
                  bottom: rect.bottom,
                  left: rect.left,
                  right: rect.right,
                },
                visibility: {
                  visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
                  display: style.display,
                  visibility: style.visibility,
                  opacity: style.opacity,
                  position: style.position,
                  zIndex: style.zIndex,
                  isSticky: style.position === 'fixed' || style.position === 'sticky',
                },
                html: el.outerHTML.substring(0, 500),
                isShadow: !!root.host
              });
            }
          }

          if (el.shadowRoot) {
            findAllAds(el.shadowRoot);
          }
        });
      };

      findAllAds(document);

      // Also check for iframes that look like ads but weren't caught by above patterns
      document.querySelectorAll('iframe').forEach(iframe => {
        try {
          const src = iframe.src || '';
          if (src.includes('doubleclick.net') || src.includes('googlesyndication.com') || src.includes('adnxs.com')) {
            const rect = iframe.getBoundingClientRect();
            ads.push({
              type: 'ad-iframe',
              id: iframe.id,
              src: src,
              position: { width: rect.width, height: rect.height },
              visibility: { visible: rect.width > 0 && rect.height > 0 }
            });
          }
        } catch (e) { }
      });

      return ads;
    });

    // Extract global ad signals (Behavioral)
    const globalSignals = await page.evaluate(() => {
      return {
        hasGPT: !!(window.googletag && window.googletag.apiReady),
        hasPrebid: !!(window.pbjs && window.pbjs.que),
        hasAmazonApstag: !!(window.apstag),
        googleQueryIdsFound: document.querySelectorAll('[data-google-query-id]').length
      };
    });

    logger.debug('Ad elements extracted', {
      count: adElements.length,
      signals: globalSignals
    });

    // Attach signals to the array for downstream use (hacky but effective)
    adElements.globalSignals = globalSignals;

    return adElements;
  } catch (error) {
    // Handle browser closure errors gracefully
    if (error.message && (error.message.includes('closed') || error.message.includes('Target page'))) {
      logger.warn('Failed to extract ad elements: page or browser was closed', { error: error.message });
      return [];
    }
    logger.error('Failed to extract ad elements', error);
    return [];
  }
}

async function extractIframes(page) {
  try {
    // Check if page is closed before extraction
    if (page.isClosed()) {
      logger.warn('Cannot extract iframes: page is already closed');
      return [];
    }

    const iframes = await page.evaluate(() => {
      const frames = [];

      document.querySelectorAll('iframe').forEach((iframe, index) => {
        const rect = iframe.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(iframe);

        frames.push({
          index,
          id: iframe.id,
          name: iframe.name,
          src: iframe.src,
          className: iframe.className,
          position: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          viewportPosition: {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
          },
          attributes: {
            allow: iframe.getAttribute('allow'),
            sandbox: iframe.getAttribute('sandbox'),
            loading: iframe.getAttribute('loading'),
            title: iframe.title,
          },
          visibility: {
            visible: rect.width > 0 && rect.height > 0,
            display: computedStyle.display,
            visibility: computedStyle.visibility,
            opacity: computedStyle.opacity,
          },
          isHidden: rect.width === 0 || rect.height === 0,
          dataAttributes: Array.from(iframe.attributes)
            .filter(attr => attr.name.startsWith('data-'))
            .reduce((acc, attr) => {
              acc[attr.name] = attr.value;
              return acc;
            }, {}),
        });
      });

      return frames;
    });

    const hiddenIframes = iframes.filter(f => f.isHidden);

    logger.debug('Iframes extracted', {
      total: iframes.length,
      hidden: hiddenIframes.length,
    });

    return iframes;
  } catch (error) {
    // Handle browser closure errors gracefully
    if (error.message && (error.message.includes('closed') || error.message.includes('Target page'))) {
      logger.warn('Failed to extract iframes: page or browser was closed', { error: error.message });
      return [];
    }
    logger.error('Failed to extract iframes', error);
    return [];
  }
}

async function extractScripts(page) {
  try {
    const scripts = await page.evaluate(() => {
      const scriptsList = [];

      document.querySelectorAll('script').forEach((script, index) => {
        const isExternal = !!script.src;

        scriptsList.push({
          index,
          src: script.src,
          type: script.type || 'text/javascript',
          async: script.async,
          defer: script.defer,
          isExternal,
          size: script.textContent.length,
          domain: isExternal ? new URL(script.src).hostname : null,
          content: isExternal ? null : script.textContent.substring(0, 200),
          dataAttributes: Array.from(script.attributes)
            .filter(attr => attr.name.startsWith('data-'))
            .reduce((acc, attr) => {
              acc[attr.name] = attr.value;
              return acc;
            }, {}),
        });
      });

      return scriptsList;
    });

    logger.debug('Scripts extracted', {
      total: scripts.length,
      external: scripts.filter(s => s.isExternal).length,
      totalSize: scripts.reduce((sum, s) => sum + s.size, 0),
    });

    return scripts;
  } catch (error) {
    logger.error('Failed to extract scripts', error);
    return [];
  }
}

module.exports = {
  extractAdElements,
  extractIframes,
  extractScripts,
};
