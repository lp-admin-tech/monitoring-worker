const logger = require('../logger');

function setupMutationObservers(page, mutationLog) {
  page.evaluateHandle(() => {
    const mutations = window.__mutations = [];

    const detailedObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        const record = {
          type: mutation.type,
          timestamp: Date.now(),
          nodeName: mutation.target.nodeName,
        };

        if (mutation.type === 'childList') {
          record.addedNodes = mutation.addedNodes.length;
          record.removedNodes = mutation.removedNodes.length;

          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              record.addedElement = node.nodeName;

              if (node.tagName === 'IFRAME') {
                record.newIframe = {
                  src: node.src,
                  id: node.id,
                  hidden: node.offsetWidth === 0 || node.offsetHeight === 0,
                };
              }

              if (node.tagName === 'SCRIPT') {
                record.newScript = {
                  src: node.src,
                  type: node.type,
                  async: node.async,
                  defer: node.defer,
                };
              }
            }
          });
        } else if (mutation.type === 'attributes') {
          record.attributeName = mutation.attributeName;
          record.oldValue = mutation.oldValue;
          record.newValue = mutation.target.getAttribute(mutation.attributeName);
        } else if (mutation.type === 'characterData') {
          record.textLength = mutation.target.textContent.length;
        }

        window.__mutations.push(record);
      });
    });

    detailedObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: false,
      attributeOldValue: true,
      attributeFilter: ['class', 'id', 'style', 'data-ad-slot', 'src'],
    });

    window.__mutationObserver = detailedObserver;
    window.__getMutations = () => window.__mutations;
  });

  page.on('framenavigated', async () => {
    try {
      const mutations = await page.evaluate(() => window.__getMutations?.());
      if (mutations && mutations.length > 0) {
        mutationLog.push(...mutations);

        const adRefreshCount = mutations.filter(m => m.newIframe || m.addedElement === 'IFRAME').length;
        const hiddenIframeCount = mutations.filter(m => m.newIframe?.hidden).length;

        if (adRefreshCount > 0) {
          logger.debug('Ad refresh detected', {
            iframeAdditions: adRefreshCount,
            hiddenIframes: hiddenIframeCount,
          });
        }
      }
    } catch (error) {
      logger.debug('Failed to retrieve mutations', error);
    }
  });

  return mutationLog;
}

function extractMutationSummary(mutationLog) {
  const summary = {
    totalMutations: mutationLog.length,
    iframeAdditions: 0,
    hiddenIframeCreations: 0,
    scriptAdditions: 0,
    classChanges: 0,
    attributeChanges: 0,
    adRefreshIndicators: [],
  };

  mutationLog.forEach((mutation) => {
    if (mutation.newIframe) {
      summary.iframeAdditions++;
      if (mutation.newIframe.hidden) {
        summary.hiddenIframeCreations++;
        summary.adRefreshIndicators.push({
          type: 'hidden_iframe',
          timestamp: mutation.timestamp,
          iframe: mutation.newIframe,
        });
      }
    }

    if (mutation.newScript) {
      summary.scriptAdditions++;
    }

    if (mutation.attributeName === 'class') {
      summary.classChanges++;
    }

    if (mutation.type === 'attributes') {
      summary.attributeChanges++;
    }
  });

  return summary;
}

module.exports = {
  setupMutationObservers,
  extractMutationSummary,
};
