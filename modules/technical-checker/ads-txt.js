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

async function fetchAdsTxt(domain, timeout = 10000, retryAttempt = 1) {
  const maxRetries = 2;

  try {
    const url = `https://${domain}/ads.txt`;
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

      if (!response.ok) {
        return {
          found: false,
          statusCode: response.status,
          content: null,
        };
      }

      const content = await response.text();
      return {
        found: true,
        statusCode: 200,
        content: content,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        if (retryAttempt === 1 && retryAttempt < maxRetries) {
          logger.warn(
            `ads.txt fetch timeout on attempt ${retryAttempt}, retrying in 1 second`,
            { domain, timeout }
          );
          await new Promise(resolve => setTimeout(resolve, 1000));
          return fetchAdsTxt(domain, timeout, retryAttempt + 1);
        }

        logger.warn(
          'ads.txt fetch timeout (retries exhausted), skipping ads.txt',
          { domain, timeout, retryAttempt }
        );
        return {
          found: false,
          error: 'Fetch timeout - retries exhausted',
          content: null,
          skipped: true,
        };
      }

      throw error;
    }
  } catch (error) {
    logger.warn('Failed to fetch ads.txt, skipping ads.txt validation', {
      domain,
      error: error.message,
    });
    return {
      found: false,
      error: error.message,
      content: null,
      skipped: true,
    };
  }
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

function calculateAdsTxtScore(validation) {
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

  if (validRatio < 0.5) score -= 40;
  else if (validRatio < 0.8) score -= 20;

  if (validation.invalid.length > 0) score -= 10;

  if (validation.valid.length === 0) score -= 15;

  return {
    score: Math.max(20, Math.round(score)),
    quality: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'poor',
    validCount: validation.valid.length,
    unknownCount: validation.unknown.length,
    invalidCount: validation.invalid.length,
  };
}

async function validateAdsTxt(domain) {
  try {
    const fetchResult = await fetchAdsTxt(domain);

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
    const scoreResult = calculateAdsTxtScore(validation);

    return {
      found: true,
      valid: validation.invalid.length === 0,
      statusCode: 200,
      entries: entries,
      validation: validation,
      score: scoreResult.score,
      quality: scoreResult.quality,
      summary: {
        totalEntries: entries.length,
        validEntries: validation.valid.length,
        unknownEntries: validation.unknown.length,
        invalidEntries: validation.invalid.length,
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
  KNOWN_NETWORKS,
};
