const logger = require('../logger');

const KNOWN_NETWORKS = {
  'google.com': 'Google Ad Manager',
  'pubmatic.com': 'PubMatic',
  'appnexus.com': 'Xandr (AppNexus)',
  'openx.com': 'OpenX',
  'adform.com': 'Adform',
  'criteo.com': 'Criteo',
  'triplelift.com': 'TripleLift',
  'unruly.co': 'Unruly',
  'somoaudience.com': 'Somoaudience',
  'spotxchange.com': 'SpotX',
  'pulsepoint.com': 'PulsePoint',
  'smaato.com': 'Smaato',
  'loopme.com': 'LoopMe',
  'medianet.com': 'Media.net',
  'inmobi.com': 'InMobi',
  'teads.tv': 'Teads',
  'amobee.com': 'Amobee',
  'flourish.com': 'Flourish',
  'visjsm.com': 'Improve Digital',
  'smartyads.com': 'SmartyAds',
};

async function fetchAdsTxt(domain, timeout = 10000) {
  const protocols = ['https://', 'http://'];

  for (const protocol of protocols) {
    try {
      const url = `${protocol}${domain}/ads.txt`;
      logger.info(`Fetching ads.txt from ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const content = await response.text();
          return {
            found: true,
            statusCode: 200,
            content: content,
          };
        } else if (response.status === 404) {
          // If 404, no need to try other protocols usually, but maybe mixed content issues?
          // Let's continue to next protocol only if it was HTTPS and we want to try HTTP
          if (protocol === 'https://') continue;

          return {
            found: false,
            statusCode: response.status,
            content: null,
          };
        }
      } catch (error) {
        clearTimeout(timeoutId);
        logger.warn(`Failed to fetch ads.txt from ${url}: ${error.message}`);
        // Continue to next protocol
      }
    } catch (e) {
      // Ignore setup errors
    }
  }

  return {
    found: false,
    error: 'Failed to fetch ads.txt from all protocols',
    content: null,
    skipped: true,
  };
}

/**
 * Fetch ads.txt using browser (bypasses bot detection)
 * @param {string} domain - Domain to fetch ads.txt from
 * @param {object} page - Playwright page instance (optional)
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<{found: boolean, statusCode: number, content: string|null, method: string}>}
 */
async function fetchAdsTxtWithBrowser(domain, page = null, timeout = 10000) {
  if (!page) {
    logger.info('No browser page provided, falling back to HTTP fetch');
    return await fetchAdsTxt(domain, timeout);
  }

  const protocols = ['https://', 'http://'];

  for (const protocol of protocols) {
    try {
      const url = `${protocol}${domain}/ads.txt`;
      logger.info(`Fetching ads.txt via browser from ${url}`);

      // Navigate to ads.txt URL
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeout
      }).catch(err => {
        logger.warn(`Browser navigation failed for ${url}: ${err.message}`);
        return null;
      });

      if (!response) {
        if (protocol === 'https://') continue;
        return {
          found: false,
          statusCode: 0,
          content: null,
          method: 'browser',
          error: 'Navigation failed'
        };
      }

      const statusCode = response.status();

      if (statusCode === 200) {
        // Extract text content from the page
        const content = await page.textContent('body').catch(() => null);

        if (content) {
          logger.info(`Successfully fetched ads.txt via browser from ${url}`);
          return {
            found: true,
            statusCode: 200,
            content: content.trim(),
            method: 'browser'
          };
        }
      } else if (statusCode === 404) {
        if (protocol === 'https://') continue;
        return {
          found: false,
          statusCode: 404,
          content: null,
          method: 'browser'
        };
      }
    } catch (error) {
      logger.warn(`Failed to fetch ads.txt via browser from ${protocol}${domain}: ${error.message}`);
      if (protocol === 'http://') {
        // Last attempt failed, return error
        return {
          found: false,
          error: error.message,
          content: null,
          method: 'browser',
          skipped: false
        };
      }
    }
  }

  return {
    found: false,
    error: 'Failed to fetch ads.txt from all protocols via browser',
    content: null,
    method: 'browser',
    skipped: true,
  };
}

function parseAdsTxt(content) {
  if (!content) return [];

  const lines = content.split('\n');
  const entries = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(',').map(p => p.trim());

    if (parts.length >= 3) {
      entries.push({
        domain: parts[0],
        sellerId: parts[1],
        accountType: parts[2],
        certId: parts[3] || null,
        raw: trimmed,
      });
    }
  }

  return entries;
}

function validateSellerIds(entries) {
  const results = {
    valid: [],
    unknown: [],
    invalid: [],
  };

  for (const entry of entries) {
    if (!entry.sellerId || !entry.domain) {
      results.invalid.push({
        entry: entry,
        reason: 'Missing seller ID or domain',
      });
      continue;
    }

    const domainKey = entry.domain.toLowerCase();
    const networkName = KNOWN_NETWORKS[domainKey];

    if (networkName) {
      results.valid.push({
        entry: entry,
        networkName: networkName,
      });
    } else {
      const isValidFormat = /^[a-zA-Z0-9-]+$/.test(entry.sellerId);
      if (isValidFormat) {
        results.unknown.push({
          entry: entry,
          reason: 'Unknown domain',
        });
      } else {
        results.invalid.push({
          entry: entry,
          reason: 'Invalid seller ID format',
        });
      }
    }
  }

  return results;
}

function analyzeSupplyChain(entries) {
  let directCount = 0;
  let resellerCount = 0;

  for (const entry of entries) {
    if (entry.accountType && entry.accountType.toUpperCase() === 'DIRECT') {
      directCount++;
    } else if (entry.accountType && entry.accountType.toUpperCase() === 'RESELLER') {
      resellerCount++;
    }
  }

  const total = directCount + resellerCount;
  const rawRatio = total > 0 ? directCount / total : 0;
  const directRatio = Number.isNaN(rawRatio) ? 0 : rawRatio;

  logger.info(`Supply Chain Analysis: Found ${directCount} DIRECT and ${resellerCount} RESELLER entries. Direct Ratio: ${(directRatio * 100).toFixed(1)}%`);

  return {
    directCount,
    resellerCount,
    directRatio,
    isArbitrageRisk: total > 5 && directCount === 0, // High risk if many partners but ZERO direct relationships
  };
}

function calculateAdsTxtScore(validation, supplyChain) {
  if (validation.valid.length === 0 && validation.unknown.length === 0) {
    return {
      score: 30,
      quality: 'poor',
      reason: 'No valid entries or likely malformed ads.txt',
    };
  }

  const totalEntries = validation.valid.length + validation.unknown.length + validation.invalid.length;
  const validRatio = (validation.valid.length + validation.unknown.length) / totalEntries;

  let score = 100;

  // Penalty for invalid formatting
  if (validRatio < 0.5) score -= 40;
  else if (validRatio < 0.8) score -= 20;

  if (validation.invalid.length > 0) score -= 10;
  if (validation.valid.length === 0) score -= 15;

  // Supply Chain Penalties (Phase 3)
  if (supplyChain && supplyChain.isArbitrageRisk) {
    score -= 30; // Heavy penalty for pure arbitrage sites
    logger.info('Penalty applied: Site identified as Arbitrage (0 DIRECT entries)');
  } else if (supplyChain && supplyChain.directRatio < 0.1) {
    score -= 10; // Minor penalty for very low direct relationships
  }

  return {
    score: Math.max(20, Math.round(score)),
    quality: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'poor',
    validCount: validation.valid.length,
    unknownCount: validation.unknown.length,
    invalidCount: validation.invalid.length,
    supplyChain: supplyChain,
  };
}

async function validateAdsTxt(domain, page = null) {
  try {
    // Use browser-based fetching if page is provided
    let fetchResult = null;
    if (page) {
      try {
        fetchResult = await fetchAdsTxtWithBrowser(domain, page);
      } catch (e) {
        logger.warn('Browser fetch for ads.txt threw error, falling back to standard fetch', { error: e.message });
      }
    }

    // Fallback to standard fetch if browser fetch failed or wasn't attempted
    if (!fetchResult || (!fetchResult.found && fetchResult.error === 'Navigation failed')) {
      logger.info('Using standard HTTP fetch for ads.txt (fallback or primary)');
      fetchResult = await fetchAdsTxt(domain);
    }

    if (!fetchResult.found) {
      if (fetchResult.skipped) {
        logger.warn('ads.txt validation skipped', {
          domain,
          reason: fetchResult.error,
        });
        return {
          found: false,
          valid: null,
          statusCode: fetchResult.statusCode || 0,
          error: fetchResult.error,
          entries: [],
          validation: null,
          score: 50,
          quality: 'skipped',
          skipped: true,
        };
      }

      return {
        found: false,
        valid: false,
        statusCode: fetchResult.statusCode || 404,
        error: fetchResult.error,
        entries: [],
        validation: null,
        score: 0,
        quality: 'missing',
      };
    }

    const entries = parseAdsTxt(fetchResult.content);
    const validation = validateSellerIds(entries);
    const supplyChain = analyzeSupplyChain(entries); // Phase 3
    const scoreResult = calculateAdsTxtScore(validation, supplyChain);

    return {
      found: true,
      valid: validation.invalid.length === 0,
      statusCode: 200,
      entries: entries,
      validation: validation,
      supplyChain: supplyChain, // Return this data
      score: scoreResult.score,
      quality: scoreResult.quality,
      summary: {
        totalEntries: entries.length,
        validEntries: validation.valid.length,
        unknownEntries: validation.unknown.length,
        invalidEntries: validation.invalid.length,
        directEntries: supplyChain.directCount,
        resellerEntries: supplyChain.resellerCount,
        directRatio: entries.length > 0
          ? Math.round((supplyChain.directCount / entries.length) * 100)
          : 0,
        resellerRatio: entries.length > 0
          ? Math.round((supplyChain.resellerCount / entries.length) * 100)
          : 0,
      },
    };
  } catch (error) {
    logger.warn('ads.txt validation error, audit will continue', {
      domain,
      error: error.message,
    });
    return {
      found: false,
      valid: null,
      error: error.message,
      entries: [],
      validation: null,
      score: 50,
      quality: 'error',
      skipped: true,
    };
  }
}

module.exports = {
  validateAdsTxt,
  fetchAdsTxt,
  parseAdsTxt,
  validateSellerIds,
  calculateAdsTxtScore,
  analyzeSupplyChain,
  KNOWN_NETWORKS,
};
