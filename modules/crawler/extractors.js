const logger = require('../logger');

async function extractAdElements(page) {
  try {
    const adElements = await page.evaluate(() => {
      const ads = [];

      // Helper to check if an element matches ad patterns
      const isAd = (el) => {
        // 1. ID/Class Patterns
        if (el.id && (el.id.includes('ad-') || el.id.includes('gpt-') || el.id.includes('dfp-'))) return 'id-pattern';
        if (el.className && typeof el.className === 'string' && (el.className.includes('ad-slot') || el.className.includes('adsbygoogle'))) return 'class-pattern';

        // 2. Attribute Patterns (Strong signals)
        if (el.hasAttribute('data-google-query-id')) return 'google-query-id';
        if (el.hasAttribute('data-ad-slot')) return 'data-ad-slot';
        if (el.hasAttribute('data-ad-unit')) return 'data-ad-unit';

        // 3. Tag Patterns
        if (el.tagName === 'INS' && el.classList.contains('adsbygoogle')) return 'google-ins';
        if (el.tagName === 'GPT-AD') return 'gpt-tag';

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
    logger.error('Failed to extract ad elements', error);
    return [];
  }
}

async function extractIframes(page) {
  try {
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
