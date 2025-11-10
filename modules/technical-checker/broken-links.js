const logger = require('../logger');

function extractInternalLinks(crawlData, baseDomain) {
  if (!crawlData || !crawlData.har) {
    return [];
  }

  const links = [];
  const har = crawlData.har;

  if (har.log && har.log.entries) {
    for (const entry of har.log.entries) {
      const url = entry.request?.url;
      if (!url) continue;

      try {
        const entryUrl = new URL(url);
        const baseDomainUrl = new URL(`https://${baseDomain}`);

        if (entryUrl.hostname === baseDomainUrl.hostname) {
          links.push({
            url: url,
            pathname: entryUrl.pathname,
            statusCode: entry.response?.status,
            statusText: entry.response?.statusText,
            headers: entry.response?.headers || [],
          });
        }
      } catch (error) {
        logger.debug('Invalid URL in HAR entry', { url });
      }
    }
  }

  return links;
}

function categorizeLinks(links) {
  const categories = {
    success: [],
    redirect: [],
    clientError: [],
    serverError: [],
    unknown: [],
  };

  for (const link of links) {
    const status = link.statusCode;

    if (!status) {
      categories.unknown.push(link);
    } else if (status >= 200 && status < 300) {
      categories.success.push(link);
    } else if (status >= 300 && status < 400) {
      categories.redirect.push(link);
    } else if (status >= 400 && status < 500) {
      categories.clientError.push(link);
    } else if (status >= 500) {
      categories.serverError.push(link);
    }
  }

  return categories;
}

function detectBrokenLinks(categorized) {
  const broken = [];

  for (const link of categorized.clientError) {
    broken.push({
      url: link.url,
      statusCode: link.statusCode,
      statusText: link.statusText,
      errorType: 'client-error',
      severity: link.statusCode === 404 ? 'high' : 'medium',
    });
  }

  for (const link of categorized.serverError) {
    broken.push({
      url: link.url,
      statusCode: link.statusCode,
      statusText: link.statusText,
      errorType: 'server-error',
      severity: 'critical',
    });
  }

  return broken;
}

function calculateLinkHealthScore(categorized, broken) {
  const totalLinks = Object.values(categorized).reduce((sum, arr) => sum + arr.length, 0);

  if (totalLinks === 0) {
    return {
      score: 100,
      quality: 'unknown',
      reason: 'No internal links found',
    };
  }

  const successRatio = categorized.success.length / totalLinks;
  const brokenRatio = broken.length / totalLinks;

  let score = 100;

  if (brokenRatio > 0.1) score -= 30;
  else if (brokenRatio > 0.05) score -= 15;
  else if (brokenRatio > 0.02) score -= 10;

  if (categorized.redirect.length > totalLinks * 0.1) score -= 10;

  if (categorized.unknown.length > totalLinks * 0.2) score -= 5;

  return {
    score: Math.max(20, Math.round(score)),
    quality: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'poor',
    successRatio: parseFloat((successRatio * 100).toFixed(2)),
    brokenRatio: parseFloat((brokenRatio * 100).toFixed(2)),
  };
}

async function analyzeBrokenLinks(crawlData, domain) {
  try {
    if (!crawlData || !domain) {
      logger.warn('Missing crawl data or domain for broken link analysis');
      return {
        brokenCount: 0,
        brokenLinks: [],
        categories: null,
        score: 0,
        quality: 'unknown',
        error: 'Invalid input',
      };
    }

    const links = extractInternalLinks(crawlData, domain);

    if (links.length === 0) {
      return {
        brokenCount: 0,
        brokenLinks: [],
        categories: {
          success: [],
          redirect: [],
          clientError: [],
          serverError: [],
          unknown: [],
        },
        totalLinks: 0,
        score: 100,
        quality: 'unknown',
        reason: 'No internal links found in HAR',
      };
    }

    const categorized = categorizeLinks(links);
    const broken = detectBrokenLinks(categorized);
    const healthScore = calculateLinkHealthScore(categorized, broken);

    const summary = {
      totalLinks: links.length,
      successCount: categorized.success.length,
      redirectCount: categorized.redirect.length,
      clientErrorCount: categorized.clientError.length,
      serverErrorCount: categorized.serverError.length,
      unknownCount: categorized.unknown.length,
    };

    return {
      brokenCount: broken.length,
      brokenLinks: broken,
      categories: {
        success: categorized.success.map(l => ({ url: l.url, status: l.statusCode })),
        redirect: categorized.redirect.map(l => ({ url: l.url, status: l.statusCode })),
        clientError: categorized.clientError.map(l => ({ url: l.url, status: l.statusCode })),
        serverError: categorized.serverError.map(l => ({ url: l.url, status: l.statusCode })),
      },
      summary: summary,
      score: healthScore.score,
      quality: healthScore.quality,
      successRatio: healthScore.successRatio,
      brokenRatio: healthScore.brokenRatio,
    };
  } catch (error) {
    logger.error('Broken link analysis failed', error, { domain });
    return {
      brokenCount: 0,
      brokenLinks: [],
      categories: null,
      score: 0,
      quality: 'error',
      error: error.message,
    };
  }
}

module.exports = {
  analyzeBrokenLinks,
  extractInternalLinks,
  categorizeLinks,
  detectBrokenLinks,
  calculateLinkHealthScore,
};
