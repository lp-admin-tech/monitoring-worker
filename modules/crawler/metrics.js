const logger = require('../logger');

async function extractMetrics(page) {
  try {
    const metrics = await page.evaluate(() => {
      const navigationTiming = window.performance.getEntriesByType('navigation')[0];
      const paintEntries = window.performance.getEntriesByType('paint');
      const largestContentfulPaint = window.performance.getEntriesByType('largest-contentful-paint').slice(-1)[0];
      const layoutShifts = window.performance.getEntriesByType('layout-shift');

      const calculateCLS = () => {
        let clsValue = 0;
        let sessionValue = 0;
        let sessionTimeout;

        for (const entry of layoutShifts) {
          if (!entry.hadRecentInput) {
            sessionValue += entry.value;
            clsValue += entry.value;
          }
        }

        return {
          value: clsValue,
          entries: layoutShifts.length,
        };
      };

      const calculateJSWeight = () => {
        let totalSize = 0;
        const scripts = document.querySelectorAll('script');

        scripts.forEach((script) => {
          if (script.src) {
            totalSize += script.textContent.length;
          }
        });

        return totalSize;
      };

      const cls = calculateCLS();
      const jsWeight = calculateJSWeight();

      let ttfb = 0;
      let lcp = 0;
      let fcp = 0;
      let dcp = 0;

      if (navigationTiming) {
        ttfb = navigationTiming.responseStart - navigationTiming.requestStart;
        dcp = navigationTiming.domContentLoadedEventEnd - navigationTiming.navigationStart;
      }

      if (largestContentfulPaint) {
        lcp = largestContentfulPaint.renderTime || largestContentfulPaint.loadTime;
      }

      const fcpEntry = paintEntries.find(entry => entry.name === 'first-contentful-paint');
      if (fcpEntry) {
        fcp = fcpEntry.startTime;
      }

      return {
        navigationTiming: navigationTiming ? {
          navigationStart: navigationTiming.navigationStart,
          fetchStart: navigationTiming.fetchStart,
          requestStart: navigationTiming.requestStart,
          responseStart: navigationTiming.responseStart,
          responseEnd: navigationTiming.responseEnd,
          domInteractive: navigationTiming.domInteractive,
          domComplete: navigationTiming.domComplete,
          domContentLoadedEventEnd: navigationTiming.domContentLoadedEventEnd,
          loadEventEnd: navigationTiming.loadEventEnd,
          unloadEventDuration: navigationTiming.unloadEventDuration,
        } : null,
        coreLWP: {
          ttfb,
          fcp,
          lcp,
          cls: cls.value,
          dcp,
        },
        jsWeight,
        resourceCount: window.performance.getEntriesByType('resource').length,
        resourceTiming: {
          images: window.performance.getEntriesByType('resource')
            .filter(r => r.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)).length,
          stylesheets: window.performance.getEntriesByType('resource')
            .filter(r => r.name.match(/\.css$/i)).length,
          scripts: window.performance.getEntriesByType('resource')
            .filter(r => r.name.match(/\.js$/i)).length,
          fonts: window.performance.getEntriesByType('resource')
            .filter(r => r.name.match(/\.(woff|woff2|ttf|otf)$/i)).length,
        },
        documentReady: document.readyState,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
      };
    });

    logger.debug('Metrics extracted', {
      ttfb: metrics.coreLWP.ttfb,
      lcp: metrics.coreLWP.lcp,
      cls: metrics.coreLWP.cls,
      jsWeight: metrics.jsWeight,
    });

    return metrics;
  } catch (error) {
    logger.error('Failed to extract metrics', error);
    return {
      coreLWP: {},
      resourceTiming: {},
    };
  }
}

module.exports = {
  extractMetrics,
};
