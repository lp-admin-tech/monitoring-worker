const logger = require('../logger');

const THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 },
  cls: { good: 0.1, poor: 0.25 },
  fid: { good: 100, poor: 300 },
  tbt: { good: 200, poor: 600 },
};

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

function analyzePerformance(crawlData) {
  try {
    if (!crawlData) {
      logger.warn('No crawl data provided for performance analysis');
      return {
        lcp: null,
        cls: null,
        fid: null,
        tbt: null,
        performanceScore: 0,
        recommendations: ['Unable to analyze - no metrics available'],
      };
    }

    const vitals = extractWebVitals(crawlData.metrics);
    const tbt = calculateTotalBlockingTime(crawlData.metrics);

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
    };
  } catch (error) {
    logger.error('Performance analysis failed', error);
    return {
      lcp: null,
      cls: null,
      fid: null,
      tbt: null,
      performanceScore: 0,
      recommendations: ['Performance analysis failed'],
      error: error.message,
    };
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
  extractWebVitals,
  calculateTotalBlockingTime,
  THRESHOLDS,
};
