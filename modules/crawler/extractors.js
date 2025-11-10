const logger = require('../logger');

async function extractAdElements(page) {
  try {
    const adElements = await page.evaluate(() => {
      const ads = [];
      const adPatterns = [
        { selector: '[id*="ad"], [class*="ad"]', type: 'id-class-based' },
        { selector: '[id*="gpt"], [class*="gpt"]', type: 'gpt-based' },
        { selector: 'div[data-ad-slot], div[data-adsbygoogle]', type: 'data-attribute' },
        { selector: 'ins.adsbygoogle', type: 'google-ads-tag' },
      ];

      const seenElements = new Set();

      for (const pattern of adPatterns) {
        document.querySelectorAll(pattern.selector).forEach((el) => {
          if (seenElements.has(el)) return;
          seenElements.add(el);

          const rect = el.getBoundingClientRect();
          const computedStyle = window.getComputedStyle(el);

          ads.push({
            type: pattern.type,
            id: el.id,
            className: el.className,
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
              visible: rect.width > 0 && rect.height > 0,
              display: computedStyle.display,
              visibility: computedStyle.visibility,
              opacity: computedStyle.opacity,
            },
            html: el.outerHTML.substring(0, 500),
          });
        });
      }

      return ads;
    });

    logger.debug('Ad elements extracted', {
      count: adElements.length,
      types: [...new Set(adElements.map(ad => ad.type))],
    });

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
