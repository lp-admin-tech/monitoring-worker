const logger = require('../logger');

function calculateAreaFromRect(rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return 0;
  return rect.width * rect.height;
}

function isElementInViewport(rect, viewportHeight = 1080, viewportWidth = 1920) {
  if (!rect) return false;

  return !(
    rect.bottom < 0 ||
    rect.top > viewportHeight ||
    rect.right < 0 ||
    rect.left > viewportWidth
  );
}

function calculateVisibleArea(rect, viewportHeight = 1080, viewportWidth = 1920) {
  if (!isElementInViewport(rect, viewportHeight, viewportWidth)) return 0;

  const visibleTop = Math.max(0, rect.top);
  const visibleBottom = Math.min(viewportHeight, rect.bottom);
  const visibleLeft = Math.max(0, rect.left);
  const visibleRight = Math.min(viewportWidth, rect.right);

  const visibleWidth = Math.max(0, visibleRight - visibleLeft);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);

  return visibleWidth * visibleHeight;
}

function calculateOcclusionRatio(crawlData, viewportHeight = 1080, viewportWidth = 1920) {
  if (!crawlData) {
    return {
      occlusionRatio: 0,
      visibleContentArea: 0,
      adCoverageArea: 0,
      error: 'No crawl data provided',
    };
  }

  const domSnapshot = crawlData.domSnapshot;
  const adElements = crawlData.adElements || [];
  const iframes = crawlData.iframes || [];

  if (!domSnapshot) {
    return {
      occlusionRatio: 0,
      visibleContentArea: 0,
      adCoverageArea: 0,
      warning: 'No DOM snapshot available',
    };
  }

  const viewportArea = viewportWidth * viewportHeight;

  let totalAdArea = 0;
  let totalContentArea = 0;

  for (const ad of adElements) {
    if (ad.position) {
      const visibleArea = calculateVisibleArea(ad.viewportPosition || ad.position, viewportHeight, viewportWidth);
      totalAdArea += visibleArea;
    }
  }

  for (const iframe of iframes) {
    if (iframe.position && !iframe.isHidden) {
      const visibleArea = calculateVisibleArea(iframe.viewportPosition || iframe.position, viewportHeight, viewportWidth);
      totalAdArea += visibleArea;
    }
  }

  const contentEstimate = viewportArea * 0.8;
  totalContentArea = Math.max(contentEstimate - totalAdArea, 0);

  const occlusionRatio = totalAdArea > 0 ? (totalAdArea / viewportArea) : 0;

  return {
    occlusionRatio: parseFloat(occlusionRatio.toFixed(4)),
    occlusionPercentage: parseFloat((occlusionRatio * 100).toFixed(2)),
    visibleContentArea: Math.round(totalContentArea),
    adCoverageArea: Math.round(totalAdArea),
    viewportArea: viewportArea,
    adCount: adElements.length,
    iframeCount: iframes.length,
  };
}

function assessOcclusionRisk(occlusionRatio) {
  if (occlusionRatio > 0.6) {
    return {
      risk: 'critical',
      mfaLikelihood: 'very-high',
      score: 20,
      reasoning: 'Extreme occlusion (>60%) strongly indicates MFA behavior',
    };
  }

  if (occlusionRatio > 0.45) {
    return {
      risk: 'high',
      mfaLikelihood: 'high',
      score: 35,
      reasoning: 'High occlusion (45-60%) suggests potential MFA patterns',
    };
  }

  if (occlusionRatio > 0.3) {
    return {
      risk: 'medium',
      mfaLikelihood: 'moderate',
      score: 55,
      reasoning: 'Moderate occlusion (30-45%) warrants investigation',
    };
  }

  if (occlusionRatio > 0.15) {
    return {
      risk: 'low',
      mfaLikelihood: 'low',
      score: 75,
      reasoning: 'Low occlusion (15-30%) within normal ranges',
    };
  }

  return {
    risk: 'minimal',
    mfaLikelihood: 'very-low',
    score: 90,
    reasoning: 'Minimal occlusion (<15%) indicates healthy content visibility',
  };
}

async function analyzeViewportOcclusion(crawlData, viewportConfig = {}) {
  try {
    const {
      viewportHeight = 1080,
      viewportWidth = 1920,
    } = viewportConfig;

    if (!crawlData) {
      return {
        occlusionRatio: 0,
        visibleContentArea: 0,
        adCoverageArea: 0,
        risk: 'unknown',
        mfaLikelihood: 'unknown',
        score: 0,
        error: 'No crawl data provided',
      };
    }

    const occlusionMetrics = calculateOcclusionRatio(crawlData, viewportHeight, viewportWidth);

    if (occlusionMetrics.error) {
      return {
        occlusionRatio: 0,
        visibleContentArea: 0,
        adCoverageArea: 0,
        risk: 'unknown',
        mfaLikelihood: 'unknown',
        score: 0,
        error: occlusionMetrics.error,
      };
    }

    const riskAssessment = assessOcclusionRisk(occlusionMetrics.occlusionRatio);

    return {
      occlusionRatio: occlusionMetrics.occlusionRatio,
      occlusionPercentage: occlusionMetrics.occlusionPercentage,
      visibleContentArea: occlusionMetrics.visibleContentArea,
      adCoverageArea: occlusionMetrics.adCoverageArea,
      viewportArea: occlusionMetrics.viewportArea,
      adCount: occlusionMetrics.adCount,
      iframeCount: occlusionMetrics.iframeCount,
      risk: riskAssessment.risk,
      mfaLikelihood: riskAssessment.mfaLikelihood,
      score: riskAssessment.score,
      reasoning: riskAssessment.reasoning,
    };
  } catch (error) {
    logger.error('Viewport occlusion analysis failed', error);
    return {
      occlusionRatio: 0,
      visibleContentArea: 0,
      adCoverageArea: 0,
      risk: 'error',
      mfaLikelihood: 'unknown',
      score: 0,
      error: error.message,
    };
  }
}

module.exports = {
  analyzeViewportOcclusion,
  calculateOcclusionRatio,
  assessOcclusionRisk,
  calculateVisibleArea,
  isElementInViewport,
};
