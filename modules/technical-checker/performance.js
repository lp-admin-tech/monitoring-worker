const logger = require('../logger');

const THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 },
  cls: { good: 0.1, poor: 0.25 },
  fid: { good: 100, poor: 300 },
  tbt: { good: 200, poor: 600 },
};

// Lighthouse threshold for triggering detailed analysis
const LIGHTHOUSE_THRESHOLD = 60; // Run Lighthouse if custom score < 60

function getMetricStatus(value, type) {
  const threshold = THRESHOLDS[type];
  if (!threshold) return 'unknown';

  if (value <= threshold.good) return 'good';
  if (value <= threshold.poor) return 'needs-improvement';
  return 'poor';
}

function calculateMetricScore(value, status) {
  const scores = {
    good: 100,
    'needs-improvement': 50,
    poor: 20,
    unknown: 0,
  };
  return scores[status] || 0;
}

function extractWebVitals(metrics) {
  if (!metrics) return null;

  const vitals = {};

  if (metrics.LargestContentfulPaint) {
    vitals.lcp = {
      value: Math.round(metrics.LargestContentfulPaint),
      status: getMetricStatus(metrics.LargestContentfulPaint, 'lcp'),
    };
  }

  if (typeof metrics.CumulativeLayoutShift === 'number') {
    vitals.cls = {
      value: parseFloat(metrics.CumulativeLayoutShift.toFixed(3)),
      status: getMetricStatus(metrics.CumulativeLayoutShift, 'cls'),
    };
  }

  if (metrics.FirstInputDelay) {
    vitals.fid = {
      value: Math.round(metrics.FirstInputDelay),
      status: getMetricStatus(metrics.FirstInputDelay, 'fid'),
    };
  }

  return vitals;
}

function calculateTotalBlockingTime(metrics) {
  if (!metrics || !metrics.eventTimings) {
    return null;
  }

  let tbt = 0;

  if (Array.isArray(metrics.eventTimings)) {
    metrics.eventTimings.forEach(event => {
      if (event.duration > 50) {
        tbt += event.duration - 50;
      }
    });
  }

  return {
    value: Math.round(tbt),
    status: getMetricStatus(tbt, 'tbt'),
  };
}

/**
 * Fast custom performance analysis using browser Performance API
 */
function analyzePerformanceFast(crawlData) {
  try {
    if (!crawlData) {
      logger.warn('No crawl data provided for performance analysis');
      // Return neutral estimate instead of zero when data unavailable
      return {
        lcp: null,
        cls: null,
        fid: null,
        tbt: null,
        performanceScore: 50, // Neutral estimate
        estimated: true,
        recommendations: ['Unable to analyze - no metrics available, using neutral estimate'],
        method: 'estimated',
      };
    }

    const vitals = extractWebVitals(crawlData.metrics);
    const tbt = calculateTotalBlockingTime(crawlData.metrics);

    // Check if we have any real vitals data
    const hasRealVitals = vitals?.lcp || vitals?.cls || vitals?.fid || tbt;

    // If no real vitals, estimate from resource patterns
    if (!hasRealVitals && crawlData.metrics) {
      const resourceCount = crawlData.metrics.resourceCount || 0;
      const jsWeight = crawlData.metrics.jsWeight || 0;

      // Heuristic: fewer resources and less JS = better performance
      let estimatedScore = 70; // Start with decent baseline

      // Penalize for excessive resources
      if (resourceCount > 100) estimatedScore -= 20;
      else if (resourceCount > 50) estimatedScore -= 10;

      // Penalize for heavy JS
      if (jsWeight > 500000) estimatedScore -= 15;
      else if (jsWeight > 200000) estimatedScore -= 8;

      estimatedScore = Math.max(25, Math.min(85, estimatedScore));

      logger.info('Estimating performance from resource patterns', {
        resourceCount,
        jsWeight,
        estimatedScore
      });

      return {
        lcp: null,
        cls: null,
        fid: null,
        tbt: null,
        performanceScore: Math.round(estimatedScore),
        estimated: true,
        resourceMetrics: { resourceCount, jsWeight },
        recommendations: ['Performance estimated from resource patterns - core web vitals unavailable'],
        method: 'estimated',
      };
    }

    const scores = {
      lcp: vitals?.lcp ? calculateMetricScore(vitals.lcp.value, vitals.lcp.status) : 0,
      cls: vitals?.cls ? calculateMetricScore(vitals.cls.value, vitals.cls.status) : 0,
      fid: vitals?.fid ? calculateMetricScore(vitals.fid.value, vitals.fid.status) : 0,
      tbt: tbt ? calculateMetricScore(tbt.value, tbt.status) : 0,
    };

    const performanceScore = Math.round(
      (scores.lcp + scores.cls + scores.fid + scores.tbt) / 4
    );

    const recommendations = generateRecommendations(vitals, tbt);

    return {
      lcp: vitals?.lcp || null,
      cls: vitals?.cls || null,
      fid: vitals?.fid || null,
      tbt: tbt,
      performanceScore: performanceScore,
      recommendations: recommendations,
      rawScores: scores,
      method: 'custom',
    };
  } catch (error) {
    logger.error('Performance analysis failed', error);
    return {
      lcp: null,
      cls: null,
      fid: null,
      tbt: null,
      performanceScore: 40, // Low but non-zero on error
      estimated: true,
      recommendations: ['Performance analysis failed, using conservative estimate'],
      error: error.message,
      method: 'estimated',
    };
  }
}

/**
 * Hybrid performance analysis: Fast custom first, then Lighthouse if needed
 * @param {object} crawlData - Crawl data with metrics
 * @param {object} options - Analysis options
 * @param {object} options.browser - Playwright browser instance (required for Lighthouse)
 * @param {string} options.url - URL being analyzed (required for Lighthouse)
 * @param {boolean} options.enableLighthouse - Enable Lighthouse fallback (default: true)
 * @param {number} options.lighthouseThreshold - Score threshold to trigger Lighthouse (default: 60)
 */
async function analyzePerformance(crawlData, options = {}) {
  const {
    browser = null,
    url = null,
    enableLighthouse = true,
    lighthouseThreshold = LIGHTHOUSE_THRESHOLD,
  } = options;

  // Step 1: Run fast custom analysis
  const fastResult = analyzePerformanceFast(crawlData);

  logger.info('Fast performance analysis completed', {
    score: fastResult.performanceScore,
    method: 'custom',
  });

  // Step 2: Check if Lighthouse is needed
  const needsLighthouse =
    enableLighthouse &&
    browser &&
    url &&
    fastResult.performanceScore < lighthouseThreshold;

  if (!needsLighthouse) {
    return fastResult;
  }

  // Step 3: Run PageSpeed Insights for detailed analysis
  try {
    logger.info('Running PageSpeed Insights for detailed analysis', {
      url,
      customScore: fastResult.performanceScore,
      threshold: lighthouseThreshold,
    });

    const PageSpeedAnalyzer = require('./lighthouse');
    const pageSpeedAnalyzer = new PageSpeedAnalyzer({
      enabled: true,
      timeout: 60000,
      strategy: 'desktop',
    });

    const pageSpeedResult = await pageSpeedAnalyzer.runPageSpeed(url);

    if (pageSpeedResult && pageSpeedResult.performanceScore !== null) {
      // Merge results, preferring PageSpeed data
      return {
        ...fastResult,
        performanceScore: pageSpeedResult.performanceScore,
        lcp: pageSpeedResult.metrics.lcp ? {
          value: Math.round(pageSpeedResult.metrics.lcp),
          status: getMetricStatus(pageSpeedResult.metrics.lcp, 'lcp'),
        } : fastResult.lcp,
        cls: pageSpeedResult.metrics.cls ? {
          value: parseFloat(pageSpeedResult.metrics.cls.toFixed(3)),
          status: getMetricStatus(pageSpeedResult.metrics.cls, 'cls'),
        } : fastResult.cls,
        tbt: pageSpeedResult.metrics.tbt ? {
          value: Math.round(pageSpeedResult.metrics.tbt),
          status: getMetricStatus(pageSpeedResult.metrics.tbt, 'tbt'),
        } : fastResult.tbt,
        pageSpeed: {
          score: pageSpeedResult.performanceScore,
          metrics: pageSpeedResult.metrics,
          opportunities: pageSpeedResult.opportunities,
          fieldData: pageSpeedResult.fieldData, // Real Chrome UX Report data
          duration: pageSpeedResult.duration,
        },
        method: 'hybrid',
        recommendations: [
          ...fastResult.recommendations,
          ...(pageSpeedResult.opportunities || []).map(opp => opp.title),
        ],
      };
    } else {
      logger.warn('PageSpeed Insights analysis failed, using custom results', {
        error: pageSpeedResult?.error,
        rateLimited: pageSpeedResult?.rateLimited,
        quotaExceeded: pageSpeedResult?.quotaExceeded,
      });
      return fastResult;
    }
  } catch (error) {
    logger.error('PageSpeed Insights analysis error, falling back to custom results', error);
    return fastResult;
  }
}

function generateRecommendations(vitals, tbt) {
  const recommendations = [];

  if (vitals?.lcp?.status === 'poor') {
    recommendations.push('Optimize Largest Contentful Paint - defer non-critical resources');
  }

  if (vitals?.cls?.status === 'poor') {
    recommendations.push('Reduce Cumulative Layout Shift - reserve space for dynamic content');
  }

  if (vitals?.fid?.status === 'poor') {
    recommendations.push('Improve First Input Delay - break up long JavaScript tasks');
  }

  if (tbt?.status === 'poor') {
    recommendations.push('Reduce Total Blocking Time - optimize JavaScript execution');
  }

  if (recommendations.length === 0) {
    recommendations.push('Performance metrics are within acceptable ranges');
  }

  return recommendations;
}

module.exports = {
  analyzePerformance,
  analyzePerformanceFast, // Export for direct use without Lighthouse
  extractWebVitals,
  calculateTotalBlockingTime,
  THRESHOLDS,
  LIGHTHOUSE_THRESHOLD,
};
