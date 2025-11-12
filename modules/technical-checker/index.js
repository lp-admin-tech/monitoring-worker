const logger = require('../logger');
const { validateSSL } = require('./ssl');
const { analyzePerformance } = require('./performance');
const { validateAdsTxt } = require('./ads-txt');
const { analyzeBrokenLinks } = require('./broken-links');
const { checkDomainIntelligence } = require('./domain-intel');
const { analyzeViewportOcclusion } = require('./viewport-occlusion');

const COMPONENT_WEIGHTS = {
  ssl: 0.15,
  performance: 0.20,
  adsTxt: 0.15,
  brokenLinks: 0.15,
  domainIntel: 0.20,
  viewportOcclusion: 0.15,
};

async function runTechnicalHealthCheck(crawlData, domain, options = {}) {
  const {
    skipSSL = false,
    skipPerformance = false,
    skipAdsTxt = false,
    skipBrokenLinks = false,
    skipDomainIntel = false,
    skipViewportOcclusion = false,
  } = options;

  const startTime = Date.now();
  const results = {
    timestamp: new Date().toISOString(),
    domain: domain,
    components: {},
    technicalHealthScore: 0,
    summary: {},
    executionTime: 0,
  };

  const checks = [];

  if (!skipSSL) {
    checks.push(
      validateSSL(domain)
        .then(result => {
          results.components.ssl = {
            ...result,
            score: normalizeSSLScore(result),
          };
        })
        .catch(error => {
          logger.warn('SSL validation failed', { error: error.message, domain });
          results.components.ssl = {
            error: error.message,
            score: 0,
            valid: false,
          };
        })
    );
  }

  if (!skipPerformance && crawlData) {
    checks.push(
      Promise.resolve().then(() => {
        results.components.performance = analyzePerformance(crawlData);
      })
    );
  }

  if (!skipAdsTxt) {
    checks.push(
      validateAdsTxt(domain)
        .then(result => {
          results.components.adsTxt = result;
        })
        .catch(error => {
          logger.warn('ads.txt validation failed', { error: error.message, domain });
          results.components.adsTxt = {
            found: false,
            valid: false,
            score: 0,
            error: error.message,
          };
        })
    );
  }

  if (!skipBrokenLinks && crawlData) {
    checks.push(
      analyzeBrokenLinks(crawlData, domain)
        .then(result => {
          results.components.brokenLinks = result;
        })
        .catch(error => {
          logger.warn('Broken link analysis failed', { error: error.message, domain });
          results.components.brokenLinks = {
            brokenCount: 0,
            score: 0,
            error: error.message,
          };
        })
    );
  }

  if (!skipDomainIntel) {
    checks.push(
      Promise.resolve().then(() => {
        results.components.domainIntel = checkDomainIntelligence(domain, crawlData?.domainData || {});
      })
    );
  }

  if (!skipViewportOcclusion && crawlData) {
    checks.push(
      Promise.resolve().then(() => {
        results.components.viewportOcclusion = analyzeViewportOcclusion(crawlData);
      })
    );
  }

  await Promise.all(checks);

  results.technicalHealthScore = aggregateScores(results.components);
  results.summary = generateSummary(results.components);
  results.executionTime = Date.now() - startTime;

  logger.info('Technical health check completed', {
    domain,
    score: results.technicalHealthScore,
    executionTime: results.executionTime,
  });

  return results;
}

function normalizeSSLScore(sslResult) {
  if (sslResult.error || !sslResult.valid) {
    return 0;
  }

  let score = 100;

  if (sslResult.riskScore) {
    score -= sslResult.riskScore;
  }

  return Math.max(0, Math.round(score));
}

function getComponentScore(component) {
  if (!component) return 0;
  if (component.error) return 0;

  if (typeof component.score === 'number') {
    return component.score;
  }

  if (typeof component.performanceScore === 'number') {
    return component.performanceScore;
  }

  if (component.valid === false) {
    return 0;
  }

  return 0;
}

function aggregateScores(components) {
  const scores = {
    ssl: getComponentScore(components.ssl),
    performance: getComponentScore(components.performance),
    adsTxt: getComponentScore(components.adsTxt),
    brokenLinks: getComponentScore(components.brokenLinks),
    domainIntel: getComponentScore(components.domainIntel),
    viewportOcclusion: getComponentScore(components.viewportOcclusion),
  };

  const activeWeights = {};
  let totalWeight = 0;

  Object.entries(COMPONENT_WEIGHTS).forEach(([key, weight]) => {
    if (components[key]) {
      activeWeights[key] = weight;
      totalWeight += weight;
    }
  });

  if (totalWeight === 0) return 0;

  let weightedScore = 0;

  Object.entries(activeWeights).forEach(([key, weight]) => {
    const normalizedWeight = weight / totalWeight;
    weightedScore += scores[key] * normalizedWeight;
  });

  return Math.round(weightedScore);
}

function generateSummary(components) {
  const summary = {
    totalIssues: 0,
    criticalIssues: [],
    warnings: [],
    recommendations: [],
    componentStatus: {},
  };

  if (components.ssl) {
    const sslStatus = components.ssl.valid ? 'healthy' : 'unhealthy';
    summary.componentStatus.ssl = sslStatus;

    if (!components.ssl.valid) {
      summary.totalIssues++;
      summary.criticalIssues.push(`SSL Certificate issue: ${components.ssl.error || 'Invalid'}`);
    }

    if (components.ssl.warnings && components.ssl.warnings.length > 0) {
      summary.warnings.push(...components.ssl.warnings.map(w => `SSL: ${w}`));
    }
  }

  if (components.performance) {
    const perfScore = components.performance.performanceScore;
    const perfStatus = perfScore >= 80 ? 'excellent' : perfScore >= 60 ? 'good' : perfScore >= 40 ? 'fair' : 'poor';
    summary.componentStatus.performance = perfStatus;

    if (components.performance.recommendations && components.performance.recommendations.length > 0) {
      summary.recommendations.push(...components.performance.recommendations);
    }
  }

  if (components.adsTxt) {
    let adsTxtStatus = 'missing';
    if (components.adsTxt.skipped) {
      adsTxtStatus = 'skipped';
    } else if (components.adsTxt.found) {
      adsTxtStatus = components.adsTxt.valid ? 'healthy' : 'invalid';
    }
    summary.componentStatus.adsTxt = adsTxtStatus;

    if (!components.adsTxt.found && !components.adsTxt.skipped) {
      summary.totalIssues++;
      summary.criticalIssues.push('Missing ads.txt file');
    }

    if (components.adsTxt.skipped) {
      summary.warnings.push(`ads.txt validation skipped: ${components.adsTxt.error}`);
    }

    if (!components.adsTxt.valid && !components.adsTxt.skipped && components.adsTxt.summary?.invalidEntries > 0) {
      summary.warnings.push(`ads.txt: ${components.adsTxt.summary.invalidEntries} invalid entries found`);
    }
  }

  if (components.brokenLinks) {
    const brokenStatus = components.brokenLinks.brokenCount === 0 ? 'healthy' : 'has-issues';
    summary.componentStatus.brokenLinks = brokenStatus;

    if (components.brokenLinks.brokenCount > 0) {
      summary.warnings.push(`${components.brokenLinks.brokenCount} broken links detected`);
    }
  }

  if (components.domainIntel) {
    summary.componentStatus.domainIntel = components.domainIntel.severity || 'unknown';

    if (components.domainIntel.riskFlags && components.domainIntel.riskFlags.length > 0) {
      summary.warnings.push(...components.domainIntel.riskFlags.map(f => `Domain: ${f}`));
    }
  }

  if (components.viewportOcclusion) {
    summary.componentStatus.viewportOcclusion = components.viewportOcclusion.mfaLikelihood || 'unknown';

    if (components.viewportOcclusion.occlusionPercentage > 60) {
      summary.totalIssues++;
      summary.criticalIssues.push(`Critical: Viewport occlusion at ${components.viewportOcclusion.occlusionPercentage}% (indicates MFA)`);
    }

    if (components.viewportOcclusion.reasoning) {
      summary.recommendations.push(components.viewportOcclusion.reasoning);
    }
  }

  summary.hasIssues = summary.totalIssues > 0 || summary.warnings.length > 0;

  return summary;
}

module.exports = {
  runTechnicalHealthCheck,
  aggregateScores,
  generateSummary,
  COMPONENT_WEIGHTS,
};
