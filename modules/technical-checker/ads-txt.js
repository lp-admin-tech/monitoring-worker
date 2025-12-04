// modules/technical-checker/ads-txt.js
const logger = require('../logger');
const axios = require('axios');

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

/**
 * Lightweight in-memory cache hook (optional)
 * Replace with redis/memcached if needed.
 */
const _simpleCache = new Map();
function cacheSet(key, value, ttl = 60) {
  _simpleCache.set(key, { value, expires: Date.now() + ttl * 1000 });
}
function cacheGet(key) {
  const v = _simpleCache.get(key);
  if (!v) return null;
  if (Date.now() > v.expires) {
    _simpleCache.delete(key);
    return null;
  }
  return v.value;
}

/**
 * Normalize domain string safely:
 * - remove protocol
 * - remove trailing port
 * - remove trailing slashes
 * - DO NOT strip subdomains other than `www.` when it's a prefix
 */
function normalizeDomain(input) {
  if (!input || typeof input !== 'string') return '';
  let domain = input.trim();

  // remove protocol
  domain = domain.replace(/^https?:\/\//i, '');

  // remove path after first slash (we only want host)
  if (domain.includes('/')) domain = domain.split('/')[0];

  // remove :port
  domain = domain.replace(/:\d+$/, '');

  // remove trailing dots/slashes
  domain = domain.replace(/[\/\s]+$/g, '');

  // keep subdomains except strip single leading "www."
  if (domain.toLowerCase().startsWith('www.')) domain = domain.slice(4);

  return domain;
}

/**
 * Basic "is likely valid seller id" check.
 * We allow letters, numbers, dashes, underscores, dots.
 * This covers "pub-1234567890123456", numeric IDs, and other provider IDs.
 */
function isLikelySellerId(id) {
  if (!id || typeof id !== 'string') return false;
  return /^[a-zA-Z0-9\-\_\.]+$/.test(id);
}

/**
 * Try multiple url variants to fetch ads.txt
 * Returns { found, url, statusCode, content, error, method }
 */
async function fetchAdsTxt(domain, timeout = 8000) {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    logger.warn('Invalid domain for ads.txt fetch after normalization', { original: domain });
    return { found: false, error: 'Invalid domain', content: null, skipped: true };
  }

  const cacheKey = `ads:${normalized}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    logger.debug('ads.txt cache hit', { domain: normalized });
    return cached;
  }

  logger.info('Fetching ads.txt for domain', { original: domain, normalized });

  const candidates = [
    `https://${normalized}/ads.txt`,
    `http://${normalized}/ads.txt`,
    `https://www.${normalized}/ads.txt`,
    `http://www.${normalized}/ads.txt`,
  ];

  for (const url of candidates) {
    try {
      logger.debug(`Trying ads.txt at ${url}`);
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'text/plain, */*',
        },
        timeout,
        maxRedirects: 5,
        validateStatus: () => true,
      });

      const status = response.status || 0;

      if (status >= 200 && status < 300) {
        let content = response.data;

        // strip BOM if present
        if (typeof content === 'string' && content.charCodeAt(0) === 0xFEFF) {
          content = content.slice(1);
        }

        if (content && String(content).trim().length > 0) {
          const result = { found: true, url, statusCode: status, content: String(content), method: 'http' };
          cacheSet(cacheKey, result, 120); // cache for 2 minutes
          logger.info('✓ Successfully fetched ads.txt', { url, statusCode: status, contentLength: result.content.length });
          return result;
        } else {
          logger.warn('ads.txt found but empty', { url, statusCode: status });
        }
      } else if (status === 404) {
        logger.debug(`ads.txt not found at ${url} (404)`);
      } else {
        logger.debug(`Unexpected status ${status} for ${url}`);
      }
    } catch (err) {
      if (err && err.code === 'ECONNABORTED') {
        logger.debug(`Timeout fetching ${url}`);
      } else if (err && err.code === 'ENOTFOUND') {
        logger.debug(`DNS failed for ${url}`);
      } else {
        logger.debug(`Error fetching ${url}: ${err && err.message ? err.message : String(err)}`);
      }
      // continue to next candidate
    }
  }

  logger.warn('ads.txt not found after trying all variants', { domain: normalized, candidatesTried: candidates.length });
  const res = { found: false, error: 'ads.txt not found', content: null, statusCode: 404, method: 'http' };
  cacheSet(cacheKey, res, 30); // cache misses short
  return res;
}

/**
 * Browser-based fetch fallback (use sparingly).
 * If page is null or navigation fails, falls back to fetchAdsTxt.
 */
async function fetchAdsTxtWithBrowser(domain, page = null, timeout = 10000) {
  if (!page) {
    logger.info('No browser page provided, falling back to HTTP fetch');
    return await fetchAdsTxt(domain, timeout);
  }

  const normalized = normalizeDomain(domain);
  if (!normalized) {
    logger.warn('Invalid domain for browser ads.txt fetch', { domain });
    return { found: false, error: 'Invalid domain', method: 'browser', skipped: true };
  }

  // Only attempt https then http; let fetchAdsTxt handle other variants if browser fails
  const urls = [`https://${normalized}/ads.txt`, `http://${normalized}/ads.txt`];

  for (const url of urls) {
    try {
      logger.debug(`Browser navigating to ${url}`);
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout }).catch(e => {
        logger.debug(`Browser navigation failed: ${e && e.message}`);
        return null;
      });

      if (!response) continue;

      const status = response.status && typeof response.status === 'function' ? response.status() : (response.status || 0);
      if (status >= 200 && status < 300) {
        // Attempt to read raw text from page
        let content = null;
        try {
          // prefer raw text content from body or pre tags
          content = await page.evaluate(() => {
            const pre = document.querySelector('pre');
            if (pre) return pre.innerText || pre.textContent;
            const body = document.body;
            if (body) return body.innerText || body.textContent;
            return document.documentElement ? document.documentElement.textContent : null;
          });
        } catch (e) {
          logger.debug('Page evaluate failed', { error: e && e.message });
          // fallback to Playwright textContent if available
          try {
            content = await page.textContent('body');
          } catch (_) {
            content = null;
          }
        }

        if (content && String(content).trim().length > 0) {
          const result = { found: true, url, statusCode: status, content: String(content).trim(), method: 'browser' };
          logger.info('✓ Successfully fetched ads.txt via browser', { url, contentLength: result.content.length });
          return result;
        } else {
          logger.warn('Browser fetched ads.txt but content empty', { url });
        }
      } else {
        logger.debug('Browser response code', { url, status });
      }
    } catch (err) {
      logger.warn('Browser attempt to fetch ads.txt failed', { domain: normalized, error: err && err.message });
      // continue to next url
    }
  }

  // fallback to HTTP fetch
  logger.info('Falling back to HTTP fetch after browser attempts failed', { domain: normalized });
  return await fetchAdsTxt(domain, timeout);
}

/**
 * Parse ads.txt content robustly:
 * - Normalize CRLF
 * - Remove inline comments
 * - Support multiple separators (comma, tab)
 */
function parseAdsTxt(content) {
  if (!content || typeof content !== 'string') return [];

  // Normalize
  let text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Remove BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const lines = text.split('\n');
  const entries = [];

  for (let raw of lines) {
    if (!raw) continue;
    // strip leading/trailing whitespace
    let line = raw.trim();

    // skip comments & empty
    if (!line || line.startsWith('#')) continue;

    // remove inline comments (anything after unescaped '#')
    const commentIdx = line.indexOf('#');
    if (commentIdx >= 0) {
      line = line.substring(0, commentIdx).trim();
      if (!line) continue;
    }

    // split by comma or tab (ads.txt spec uses comma but some sites use tabs)
    const parts = line.split(/\s*,\s*|\t+/).map(p => p.trim()).filter(Boolean);

    if (parts.length < 3) {
      // ignore malformed lines but record them as raw for diagnostics
      entries.push({ raw: raw.trim(), malformed: true });
      continue;
    }

    entries.push({
      domain: parts[0],
      sellerId: parts[1],
      accountType: parts[2],
      certId: parts[3] || null,
      raw: line
    });
  }

  return entries;
}

/**
 * Validate seller ids and match known networks by suffix (not only exact).
 */
function validateSellerIds(entries) {
  const results = { valid: [], unknown: [], invalid: [] };

  for (const entry of entries) {
    if (!entry || entry.malformed) {
      results.invalid.push({ entry, reason: 'malformed' });
      continue;
    }

    const sellerId = entry.sellerId;
    const domain = entry.domain;
    if (!sellerId || !domain) {
      results.invalid.push({ entry, reason: 'Missing seller ID or domain' });
      continue;
    }

    // match known network by checking if domain endsWith a known key
    const domainKey = domain.toLowerCase();
    let matchedNetwork = null;
    for (const k of Object.keys(KNOWN_NETWORKS)) {
      if (domainKey === k || domainKey.endsWith('.' + k) || k.endsWith('.' + domainKey)) {
        matchedNetwork = KNOWN_NETWORKS[k];
        break;
      }
    }

    if (matchedNetwork) {
      // if known network, accept it if sellerId looks like a plausible id
      if (isLikelySellerId(sellerId)) {
        results.valid.push({ entry, networkName: matchedNetwork });
      } else {
        results.invalid.push({ entry, reason: 'Invalid seller ID format for known network' });
      }
    } else {
      // unknown network: accept any plausible format as unknown (not invalid)
      if (isLikelySellerId(sellerId)) {
        results.unknown.push({ entry, reason: 'Unknown network but plausible seller id' });
      } else {
        results.invalid.push({ entry, reason: 'Invalid seller ID format' });
      }
    }
  }

  return results;
}

/**
 * Analyze supply chain: count DIRECT vs RESELLER entries
 */
function analyzeSupplyChain(entries) {
  let directCount = 0;
  let resellerCount = 0;
  let otherCount = 0;

  for (const entry of entries) {
    if (!entry || entry.malformed) continue;
    const t = entry.accountType ? String(entry.accountType).toUpperCase().trim() : '';
    if (t === 'DIRECT') directCount++;
    else if (t === 'RESELLER') resellerCount++;
    else otherCount++;
  }

  const total = directCount + resellerCount + otherCount;
  const directRatio = total > 0 ? directCount / total : 0;

  logger.info('Supply Chain Analysis', { directCount, resellerCount, otherCount, directRatio });

  return {
    directCount,
    resellerCount,
    otherCount,
    directRatio,
    isArbitrageRisk: total > 5 && directCount === 0
  };
}

/**
 * Calculate ads.txt score - safer math and clearer boundaries
 */
function calculateAdsTxtScore(validation, supplyChain) {
  const validCount = validation.valid.length;
  const unknownCount = validation.unknown.length;
  const invalidCount = validation.invalid.length;
  const totalEntries = validCount + unknownCount + invalidCount;

  // if no entries at all, consider poor but not catastrophic (site might rely on other monetization)
  if (totalEntries === 0) {
    return {
      score: 30,
      quality: 'poor',
      reason: 'No entries',
      validCount,
      unknownCount,
      invalidCount
    };
  }

  // weight valid higher than unknown
  const weightedValid = validCount + (unknownCount * 0.5);
  const validRatio = Math.max(0, Math.min(1, weightedValid / totalEntries));

  let score = 100;
  // penalty scale
  if (validRatio < 0.2) score -= 50;
  else if (validRatio < 0.5) score -= 30;
  else if (validRatio < 0.8) score -= 10;

  score -= invalidCount * 5; // small penalty per invalid line

  // supply chain penalties
  if (supplyChain && supplyChain.isArbitrageRisk) {
    score -= 30;
  } else if (supplyChain && supplyChain.directRatio < 0.1) {
    score -= 8;
  }

  score = Math.round(Math.max(20, score));

  const quality = score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'poor';

  return {
    score,
    quality,
    reason: null,
    validCount,
    unknownCount,
    invalidCount,
  };
}

/**
 * Main validator function
 */
async function validateAdsTxt(domain, page = null) {
  try {
    // try browser only if page is provided; browser may bypass bot protections
    let fetchResult = null;
    if (page) {
      try {
        fetchResult = await fetchAdsTxtWithBrowser(domain, page);
      } catch (e) {
        logger.warn('Browser fetch threw, falling back to HTTP', { error: e && e.message });
      }
    }

    if (!fetchResult || !fetchResult.found) {
      fetchResult = await fetchAdsTxt(domain);
    }

    if (!fetchResult || !fetchResult.found) {
      // Not found
      return {
        found: false,
        valid: false,
        statusCode: fetchResult ? fetchResult.statusCode || 404 : 404,
        error: fetchResult ? fetchResult.error : 'not_found',
        entries: [],
        validation: null,
        score: 0,
        quality: 'missing',
        url: fetchResult ? fetchResult.url : null
      };
    }

    const entries = parseAdsTxt(fetchResult.content);
    const validation = validateSellerIds(entries);
    const supplyChain = analyzeSupplyChain(entries);
    const scoreResult = calculateAdsTxtScore(validation, supplyChain);

    return {
      found: true,
      valid: validation.invalid.length === 0,
      statusCode: fetchResult.statusCode || 200,
      entries,
      validation,
      supplyChain,
      score: scoreResult.score,
      quality: scoreResult.quality,
      summary: {
        totalEntries: entries.length,
        validEntries: validation.valid.length,
        unknownEntries: validation.unknown.length,
        invalidEntries: validation.invalid.length,
        directEntries: supplyChain.directCount,
        resellerEntries: supplyChain.resellerCount,
        directRatio: entries.length > 0 ? Math.round((supplyChain.directCount / entries.length) * 100) : 0,
        resellerRatio: entries.length > 0 ? Math.round((supplyChain.resellerCount / entries.length) * 100) : 0,
      },
      url: fetchResult.url || null
    };
  } catch (error) {
    logger.warn('ads.txt validation error', { domain, error: error && error.message });
    return {
      found: false,
      valid: null,
      error: error && error.message,
      entries: [],
      validation: null,
      score: 50,
      quality: 'error'
    };
  }
}

module.exports = {
  validateAdsTxt,
  fetchAdsTxt,
  fetchAdsTxtWithBrowser,
  parseAdsTxt,
  validateSellerIds,
  calculateAdsTxtScore,
  analyzeSupplyChain,
  KNOWN_NETWORKS,
};
