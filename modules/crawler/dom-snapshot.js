const logger = require('../logger');

async function createDOMSnapshot(page) {
  try {
    const snapshot = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe');
      const scripts = document.querySelectorAll('script');
      const adSlots = [];

      document.querySelectorAll('[id*="ad"], [class*="ad"], [id*="gpt"]').forEach((el) => {
        adSlots.push({
          id: el.id,
          classes: el.className,
          tag: el.tagName,
          visible: el.offsetParent !== null,
          position: {
            x: el.offsetLeft,
            y: el.offsetTop,
            width: el.offsetWidth,
            height: el.offsetHeight,
          },
        });
      });

      return {
        elementCount: document.querySelectorAll('*').length,
        iframeCount: iframes.length,
        scriptCount: scripts.length,
        adSlotIds: adSlots.map(slot => slot.id).filter(Boolean),
        adSlots,
        htmlSize: document.documentElement.innerHTML.length,
        bodySize: document.body.innerHTML.length,
      };
    });

    logger.debug('DOM snapshot created', {
      elementCount: snapshot.elementCount,
      iframeCount: snapshot.iframeCount,
      adSlots: snapshot.adSlots.length,
    });

    return snapshot;
  } catch (error) {
    logger.error('Failed to create DOM snapshot', error);
    throw error;
  }
}

module.exports = {
  createDOMSnapshot,
};
