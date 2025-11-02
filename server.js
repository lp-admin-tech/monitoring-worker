import express from 'express';
import dotenv from 'dotenv';
import { AdvancedWebsiteCrawler } from './index.js';
import { createClient } from '@supabase/supabase-js';
import { saveAuditRecord, checkDatabaseHealth } from './dbClient.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '900000');
const MAX_QUEUE_SIZE = parseInt(process.env.MAX_QUEUE_SIZE || '100');
const REQUEST_RATE_LIMIT = parseInt(process.env.REQUEST_RATE_LIMIT || '10000');

app.use(express.json());

let crawler = null;
let supabase = null;
let requestQueue = [];
let lastRequestTime = 0;
let activeRequests = 0;

class RequestQueue {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.queue = [];
  }

  enqueue(request) {
    if (this.queue.length >= this.maxSize) {
      return { success: false, error: 'Queue is full' };
    }
    this.queue.push({
      ...request,
      enqueuedAt: Date.now()
    });
    return { success: true, queueLength: this.queue.length };
  }

  dequeue() {
    return this.queue.shift();
  }

  getLength() {
    return this.queue.length;
  }

  getOldestRequestAge() {
    if (this.queue.length === 0) return null;
    return Date.now() - this.queue[0].enqueuedAt;
  }
}

const auditQueue = new RequestQueue(MAX_QUEUE_SIZE);

// === RATE LIMITING MIDDLEWARE ===
function rateLimitMiddleware(req, res, next) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < REQUEST_RATE_LIMIT) {
    const waitTime = REQUEST_RATE_LIMIT - timeSinceLastRequest;
    console.warn(`[RATE-LIMIT] Request rate limited. Wait ${waitTime}ms before next request`);
    return res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfterMs: waitTime,
      queueLength: auditQueue.getLength(),
      activeRequests
    });
  }

  lastRequestTime = now;
  next();
}

// === AUTH MIDDLEWARE ===
function validateWorkerSecret(req, res, next) {
  const authHeader = req.headers['authorization'];
  const workerSecret = process.env.WORKER_SECRET;

  if (!workerSecret) {
    console.warn('[AUTH] WORKER_SECRET not set — allowing all requests');
    return next();
  }

  if (!authHeader || authHeader !== `Bearer ${workerSecret}`) {
    console.warn('[AUTH] Invalid or missing authorization header');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

// === INITIALIZATION HELPERS ===
function initializeCrawler() {
  if (!crawler) {
    console.log('[SERVER] Initializing crawler instance...');
    crawler = new AdvancedWebsiteCrawler({
      cacheTimeout: 3600000, // 1 hour
      maxRetries: 3,
      concurrency: 2
    });
  }
  return crawler;
}

function initializeSupabase() {
  if (!supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      console.error('[SERVER] ❌ Missing Supabase configuration');
      return null;
    }
    console.log('[SERVER] Initializing Supabase client...');
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    console.log('[SERVER] ✓ Supabase client ready');
  }
  return supabase;
}

function resolveSiteNameToDomain(siteName, publisherDomain) {
  if (!siteName || siteName === 'primary' || siteName === 'Unknown' || siteName.toLowerCase() === 'unknown') {
    console.log(`[DOMAIN-RESOLVER] Resolving siteName "${siteName}" to publisher primary domain: ${publisherDomain}`);
    return publisherDomain;
  }

  let domain = siteName;
  if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
    domain = `https://${domain}`;
  }

  console.log(`[DOMAIN-RESOLVER] Resolved siteName "${siteName}" to domain: ${domain}`);
  return domain;
}

app.get('/', (req, res) => {
  res.json({
    service: 'MFA Buster Site Monitoring Worker',
    status: 'running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    queue: {
      size: auditQueue.getLength(),
      maxSize: MAX_QUEUE_SIZE,
      oldestRequestAgeMs: auditQueue.getOldestRequestAge()
    },
    performance: {
      activeRequests,
      rateLimitMs: REQUEST_RATE_LIMIT
    },
    endpoints: {
      health: 'GET /health',
      queue: 'GET /queue-status',
      audit: 'POST /audit',
      auditBatch: 'POST /audit-batch',
      auditAll: 'GET /audit-all',
      crawl: 'POST /crawl',
      crawlMultiple: 'POST /crawl-multiple',
      clearCache: 'POST /clear-cache'
    }
  });
});

app.get('/queue-status', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    queue: {
      length: auditQueue.getLength(),
      maxSize: MAX_QUEUE_SIZE,
      utilizationPercent: (auditQueue.getLength() / MAX_QUEUE_SIZE * 100).toFixed(2),
      oldestRequestAgeMs: auditQueue.getOldestRequestAge()
    },
    performance: {
      activeRequests,
      rateLimitMs: REQUEST_RATE_LIMIT,
      timeSinceLastRequestMs: Date.now() - lastRequestTime
    }
  });
});

app.get('/health', async (req, res) => {
  try {
    const supabaseClient = initializeSupabase();
    let databaseConnected = false;
    let databaseError = null;

    if (supabaseClient) {
      try {
        const healthResult = await checkDatabaseHealth();
        databaseConnected = healthResult.connected;
        databaseError = healthResult.connected ? null : healthResult.message;
      } catch (error) {
        databaseError = error instanceof Error ? error.message : 'Unknown error';
      }
    }

    const health = {
      status: databaseConnected ? 'healthy' : (supabaseClient ? 'degraded' : 'unhealthy'),
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
        workerSecretConfigured: !!process.env.WORKER_SECRET
      },
      database: {
        connected: databaseConnected,
        configured: !!supabaseClient,
        error: databaseError
      }
    };

    res.json(health);
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/crawl', validateWorkerSecret, async (req, res) => {
  const { domain, publisherId } = req.body;

  if (!domain) {
    return res.status(400).json({ error: 'Domain is required' });
  }

  console.log(`[CRAWL-REQUEST] Received request for domain: ${domain}, publisherId: ${publisherId || 'N/A'}`);

  res.setTimeout(REQUEST_TIMEOUT);

  try {
    const crawlerInstance = initializeCrawler();
    const result = await crawlerInstance.crawlSite(domain);

    let dbSaveSuccess = false;
    let dbSaveError = null;

    if (result.success && publisherId) {
      const supabaseClient = initializeSupabase();

      if (!supabaseClient) {
        console.warn(`[CRAWL-REQUEST] ⚠ Supabase not configured - skipping database save for publisher ${publisherId}`);
        dbSaveError = 'Supabase client not available. Check SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.';
      } else {
        console.log(`[CRAWL-REQUEST] Saving results to database for publisher ${publisherId}`);

        const auditPayload = {
          publisher_id: publisherId,
          domain: domain,
          site_url: domain,
          last_crawled: new Date().toISOString(),
          scanned_at: new Date().toISOString(),
          is_online: true,
          seo_score: result.seoAnalysis?.score || 0,
          security_score: result.securityAnalysis?.score || 0,
          performance_score: result.performanceAnalysis?.score || 0,
          accessibility_score: result.accessibilityData?.score || 0,
          mobile_score: 0,
          overall_score: result.lighthouseScore?.overall || 0,
          lighthouse_data: result.lighthouseScore || {},
          seo_data: result.seoAnalysis || {},
          security_data: result.securityAnalysis || {},
          performance_data: result.performanceAnalysis || {},
          accessibility_data: result.accessibilityData || {},
          mobile_data: {},
          technologies: result.technologies || {},
          screenshot: result.screenshot,
          performance_total_requests: result.requestStats?.total || 0,
          performance_third_party_requests: result.requestStats?.thirdParty || 0,
          performance_transfer_size: result.requestStats?.totalSize || 0,
          performance_script_requests: result.requestStats?.scripts || 0,
          accessibility_issues_count: result.accessibilityData?.issueCount || 0,
          accessibility_missing_alt_tags: result.accessibilityData?.issues?.filter(i => i.type === 'missing-alt').length || 0,
          content_length: result.contentAnalysis?.contentLength || 0,
          content_uniqueness: result.contentAnalysis?.contentUniqueness || 0,
          has_privacy_policy: result.contentAnalysis?.hasPrivacyPolicy || false,
          has_contact_page: result.contentAnalysis?.hasContactPage || false,
          total_images: result.imageAnalysis?.totalImages || 0,
          has_featured_images: result.imageAnalysis?.hasFeaturedImages || false,
          total_ads: result.adDensityAnalysis?.totalAds || 0,
          ads_above_fold: result.adDensityAnalysis?.adsAboveFold || 0,
          ads_in_content: result.adDensityAnalysis?.adsInContent || 0,
          ads_sidebar: result.adDensityAnalysis?.adsSidebar || 0,
          sticky_ads_count: result.adDensityAnalysis?.stickyAds || 0,
          auto_refresh_ads: result.adDensityAnalysis?.autoRefreshAds > 0 || false,
          ad_density: result.adDensityAnalysis?.adDensity || 0,
          ad_to_content_ratio: result.adDensityAnalysis?.adToContentRatio || 0,
          ad_networks_detected: result.adNetworksAnalysis?.networks || [],
          ad_networks_count: result.adNetworksAnalysis?.count || 0,
          has_google_ads: result.adNetworksAnalysis?.hasGoogleAds || false,
          has_multiple_ad_networks: result.adNetworksAnalysis?.hasMultipleNetworks || false,
          layout_score: result.layoutAnalysis?.score || 0,
          layout_menu_position: result.layoutAnalysis?.menuPosition || null,
          layout_content_above_fold: result.layoutAnalysis?.contentAboveFold || false,
          layout_content_before_ads: result.layoutAnalysis?.contentBeforeAds || false,
          layout_menu_accessible: result.layoutAnalysis?.menuAccessible || false,
          layout_overlapping_ads: result.layoutAnalysis?.overlappingAds || false,
          layout_issues: result.layoutAnalysis?.issues || [],
          safe_browsing_status: result.safeBrowsingCheck?.isSafe === true ? 'safe' :
                                 result.safeBrowsingCheck?.isSafe === false ? 'unsafe' : 'not_checked',
          safe_browsing_threats: result.safeBrowsingCheck?.threats || []
        };

        console.log(`[CRAWL-REQUEST] Analyzer outputs:`, {
          contentAnalysis: result.contentAnalysis,
          imageAnalysis: result.imageAnalysis,
          adDensityAnalysis: result.adDensityAnalysis,
          safeBrowsingCheck: result.safeBrowsingCheck
        });

        const saveResult = await saveAuditRecord(auditPayload);
        if (saveResult.success) {
          console.log(`[CRAWL-REQUEST] ✓ Successfully saved results for publisher ${publisherId}`);
          dbSaveSuccess = true;
        } else {
          console.error('[CRAWL-REQUEST] ❌ Database error:', saveResult.error);
          dbSaveError = saveResult.error;
        }
      }
    } else if (result.success && !publisherId) {
      console.log(`[CRAWL-REQUEST] No publisherId provided - skipping database save`);
    } else {
      console.warn(`[CRAWL-REQUEST] Crawl failed - no database save attempted`);
    }

    console.log(`[CRAWL-REQUEST] Successfully crawled ${domain}`);
    res.json({
      success: true,
      domain,
      publisherId,
      result,
      database: {
        saved: dbSaveSuccess,
        error: dbSaveError
      }
    });
  } catch (error) {
    console.error(`[CRAWL-REQUEST] Error crawling ${domain}:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      domain,
      publisherId
    });
  }
});

app.post('/crawl-multiple', validateWorkerSecret, async (req, res) => {
  const { domains } = req.body;

  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({ error: 'Domains array is required' });
  }

  console.log(`[MULTI-CRAWL-REQUEST] Received request for ${domains.length} domains`);

  res.setTimeout(REQUEST_TIMEOUT);

  try {
    const crawlerInstance = initializeCrawler();
    const results = await crawlerInstance.crawlMultipleSites(domains);

    console.log(`[MULTI-CRAWL-REQUEST] Successfully crawled ${domains.length} domains`);
    res.json({
      success: true,
      count: domains.length,
      results
    });
  } catch (error) {
    console.error(`[MULTI-CRAWL-REQUEST] Error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/audit', validateWorkerSecret, async (req, res) => {
  const { publisherId, domain, site_names } = req.body;

  if (!publisherId) {
    return res.status(400).json({ error: 'publisherId is required' });
  }

  if (!domain) {
    return res.status(400).json({ error: 'Domain is required' });
  }

  res.setTimeout(REQUEST_TIMEOUT);

  try {
    const crawlerInstance = initializeCrawler();
    const supabaseClient = initializeSupabase();

    let sitesToAudit = [];
    if (site_names && Array.isArray(site_names) && site_names.length > 0) {
      sitesToAudit = site_names.filter(name => name && typeof name === 'string' && name.trim().length > 0);
    }

    if (sitesToAudit.length === 0 && supabaseClient) {
      try {
        console.log(`[AUDIT] Fetching site_names from database for publisher ${publisherId}`);
        const { data: siteNamesFromDb, error: siteNamesError } = await supabaseClient.rpc('get_publisher_site_names', {
          p_publisher_id: publisherId
        });

        if (!siteNamesError && siteNamesFromDb && Array.isArray(siteNamesFromDb) && siteNamesFromDb.length > 0) {
          sitesToAudit = siteNamesFromDb
            .map(item => item.site_name)
            .filter(name => name && typeof name === 'string' && name.trim().length > 0);
          console.log(`[AUDIT] Fetched ${sitesToAudit.length} site_name(s) from database: ${sitesToAudit.join(', ')}`);
        } else if (siteNamesError) {
          console.warn(`[AUDIT] Error fetching site_names from database:`, siteNamesError.message);
        }
      } catch (err) {
        console.warn(`[AUDIT] Exception fetching site_names from database:`, err.message);
      }
    }

    if (sitesToAudit.length === 0) {
      sitesToAudit = ['primary'];
    }

    console.log(`[AUDIT] Single audit request for publisherId: ${publisherId}, auditing ${sitesToAudit.length} site(s): ${sitesToAudit.join(', ')}`);

    let cleanupSuccess = false;
    let cleanupMessage = '';

    if (supabaseClient && publisherId) {
      try {
        console.log(`[AUDIT] Triggering cleanup of old audit data for publisher ${publisherId}`);
        const { data: cleanupResult, error: cleanupError } = await supabaseClient.rpc('trigger_audit_cleanup', {
          p_publisher_id: publisherId,
          p_all_publishers: false
        });
        if (cleanupError) {
          console.warn(`[AUDIT] Cleanup warning:`, cleanupError.message);
        } else if (cleanupResult && cleanupResult.length > 0) {
          cleanupSuccess = true;
          cleanupMessage = cleanupResult[0].message;
          console.log(`[AUDIT] Cleanup completed:`, cleanupMessage);
        }
      } catch (cleanupErr) {
        console.warn(`[AUDIT] Cleanup exception:`, cleanupErr.message);
      }
    }

    const auditResults = [];

    for (const siteName of sitesToAudit) {
      try {
        const resolvedDomain = resolveSiteNameToDomain(siteName, domain);
        console.log(`[AUDIT] Starting audit for site_name: ${siteName}, resolved domain: ${resolvedDomain}`);
        const result = await crawlerInstance.crawlSite(resolvedDomain);

        let dbSaveSuccess = false;
        let dbSaveError = null;

        if (result.success && publisherId) {
          if (!supabaseClient) {
            console.warn(`[AUDIT] ⚠ Supabase not configured - skipping database save for publisher ${publisherId}`);
            dbSaveError = 'Supabase client not available. Check SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.';
          } else {
            console.log(`[AUDIT] Saving results to database for publisher ${publisherId} with site_name: ${siteName}`);

            const resolvedDomain = resolveSiteNameToDomain(siteName, domain);
            const auditPayload = {
              publisher_id: publisherId,
              domain: resolvedDomain,
              site_url: resolvedDomain,
              site_name: siteName,
              last_crawled: new Date().toISOString(),
              scanned_at: new Date().toISOString(),
              is_online: true,
              seo_score: result.seoAnalysis?.score || 0,
              security_score: result.securityAnalysis?.score || 0,
              performance_score: result.performanceAnalysis?.score || 0,
              accessibility_score: result.accessibilityData?.score || 0,
              mobile_score: 0,
              overall_score: result.lighthouseScore?.overall || 0,
              lighthouse_data: result.lighthouseScore || {},
              seo_data: result.seoAnalysis || {},
              security_data: result.securityAnalysis || {},
              performance_data: result.performanceAnalysis || {},
              accessibility_data: result.accessibilityData || {},
              mobile_data: {},
              technologies: result.technologies || {},
              screenshot: result.screenshot,
              performance_total_requests: result.requestStats?.total || 0,
              performance_third_party_requests: result.requestStats?.thirdParty || 0,
              performance_transfer_size: result.requestStats?.totalSize || 0,
              performance_script_requests: result.requestStats?.scripts || 0,
              accessibility_issues_count: result.accessibilityData?.issueCount || 0,
              accessibility_missing_alt_tags: result.accessibilityData?.issues?.filter(i => i.type === 'missing-alt').length || 0,
              content_length: result.contentAnalysis?.contentLength || 0,
              content_uniqueness: result.contentAnalysis?.contentUniqueness || 0,
              has_privacy_policy: result.contentAnalysis?.hasPrivacyPolicy || false,
              has_contact_page: result.contentAnalysis?.hasContactPage || false,
              total_images: result.imageAnalysis?.totalImages || 0,
              has_featured_images: result.imageAnalysis?.hasFeaturedImages || false,
              total_ads: result.adDensityAnalysis?.totalAds || 0,
              ads_above_fold: result.adDensityAnalysis?.adsAboveFold || 0,
              ads_in_content: result.adDensityAnalysis?.adsInContent || 0,
              ads_sidebar: result.adDensityAnalysis?.adsSidebar || 0,
              sticky_ads_count: result.adDensityAnalysis?.stickyAds || 0,
              auto_refresh_ads: result.adDensityAnalysis?.autoRefreshAds > 0 || false,
              ad_density: result.adDensityAnalysis?.adDensity || 0,
              ad_to_content_ratio: result.adDensityAnalysis?.adToContentRatio || 0,
              ad_networks_detected: result.adNetworksAnalysis?.networks || [],
              ad_networks_count: result.adNetworksAnalysis?.count || 0,
              has_google_ads: result.adNetworksAnalysis?.hasGoogleAds || false,
              has_multiple_ad_networks: result.adNetworksAnalysis?.hasMultipleNetworks || false,
              layout_score: result.layoutAnalysis?.score || 0,
              layout_menu_position: result.layoutAnalysis?.menuPosition || null,
              layout_content_above_fold: result.layoutAnalysis?.contentAboveFold || false,
              layout_content_before_ads: result.layoutAnalysis?.contentBeforeAds || false,
              layout_menu_accessible: result.layoutAnalysis?.menuAccessible || false,
              layout_overlapping_ads: result.layoutAnalysis?.overlappingAds || false,
              layout_issues: result.layoutAnalysis?.issues || [],
              safe_browsing_status: result.safeBrowsingCheck?.isSafe === true ? 'safe' :
                                     result.safeBrowsingCheck?.isSafe === false ? 'unsafe' : 'not_checked',
              safe_browsing_threats: result.safeBrowsingCheck?.threats || []
            };

            console.log(`[AUDIT] Analyzer outputs:`, {
              contentAnalysis: result.contentAnalysis,
              imageAnalysis: result.imageAnalysis,
              adDensityAnalysis: result.adDensityAnalysis,
              safeBrowsingCheck: result.safeBrowsingCheck
            });

            const saveResult = await saveAuditRecord(auditPayload);
            if (saveResult.success) {
              console.log(`[AUDIT] ✓ Successfully saved results for publisher ${publisherId} with site_name: ${siteName}`);
              dbSaveSuccess = true;
            } else {
              console.error('[AUDIT] ❌ Database error:', saveResult.error);
              dbSaveError = saveResult.error;
            }
          }
        }

        auditResults.push({
          site_name: siteName,
          success: result.success,
          database: {
            saved: dbSaveSuccess,
            error: dbSaveError
          }
        });

        console.log(`[AUDIT] ✓ Completed audit for ${domain} with site_name: ${siteName}`);
      } catch (siteError) {
        console.error(`[AUDIT] Error auditing site_name ${siteName}:`, siteError.message);
        auditResults.push({
          site_name: siteName,
          success: false,
          error: siteError.message,
          database: {
            saved: false,
            error: siteError.message
          }
        });
      }
    }

    console.log(`[AUDIT] ✓ Successfully completed audit for ${domain} with ${sitesToAudit.length} site(s)`);
    res.json({
      success: true,
      domain,
      publisherId,
      sitesAudited: sitesToAudit.length,
      results: auditResults,
      cleanup: {
        executed: cleanupSuccess,
        message: cleanupMessage
      }
    });
  } catch (error) {
    console.error(`[AUDIT] Error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      domain,
      publisherId
    });
  }
});

app.post('/audit-batch', validateWorkerSecret, async (req, res) => {
  const { publishers } = req.body;

  if (!Array.isArray(publishers) || publishers.length === 0) {
    return res.status(400).json({ error: 'Publishers array is required' });
  }

  console.log(`[AUDIT-BATCH] Batch audit request for ${publishers.length} publishers`);

  res.setTimeout(REQUEST_TIMEOUT);

  try {
    const crawlerInstance = initializeCrawler();
    const supabaseClient = initializeSupabase();
    const results = [];
    let dbSuccessCount = 0;
    let dbFailureCount = 0;
    let cleanupCount = 0;

    if (!supabaseClient) {
      console.warn('[AUDIT-BATCH] Supabase not configured - database saves will be skipped');
    } else {
      console.log(`[AUDIT-BATCH] Triggering cleanup of old audit data for batch publishers`);
      for (const publisher of publishers) {
        try {
          const { data: cleanupResult, error: cleanupError } = await supabaseClient.rpc('trigger_audit_cleanup', {
            p_publisher_id: publisher.id,
            p_all_publishers: false
          });
          if (!cleanupError && cleanupResult && cleanupResult.length > 0) {
            cleanupCount++;
            console.log(`[AUDIT-BATCH] Cleanup for ${publisher.id}:`, cleanupResult[0].message);
          }
        } catch (cleanupErr) {
          console.warn(`[AUDIT-BATCH] Cleanup exception for ${publisher.id}:`, cleanupErr.message);
        }
      }
      console.log(`[AUDIT-BATCH] Cleanup completed for ${cleanupCount}/${publishers.length} publishers`);
    }

    for (const publisher of publishers) {
      try {
        let site_names = publisher.site_names && Array.isArray(publisher.site_names) ? publisher.site_names : [];

        site_names = site_names.filter(name => name && typeof name === 'string' && name.trim().length > 0);

        if (site_names.length === 0) {
          console.log(`[AUDIT-BATCH] No site_names provided for publisher ${publisher.id}, auditing primary domain`);
          site_names = ['primary'];
        }

        for (const siteName of site_names) {
          try {
            const resolvedDomain = resolveSiteNameToDomain(siteName, publisher.domain);
            console.log(`[AUDIT-BATCH] Auditing ${publisher.domain} (${publisher.id}) with site_name: ${siteName}, resolved domain: ${resolvedDomain}`);
            const result = await crawlerInstance.crawlSite(resolvedDomain);

            let dbSaveSuccess = false;
            let dbSaveError = null;

            if (result.success && supabaseClient) {
              console.log(`[AUDIT-BATCH] Saving results to database for publisher ${publisher.id} with site_name: ${siteName}`);
              const resolvedDomain = resolveSiteNameToDomain(siteName, publisher.domain);
              const auditPayload = {
                publisher_id: publisher.id,
                domain: resolvedDomain,
                site_url: resolvedDomain,
                site_name: siteName,
                last_crawled: new Date().toISOString(),
                scanned_at: new Date().toISOString(),
                is_online: true,
                seo_score: result.seoAnalysis?.score || 0,
                security_score: result.securityAnalysis?.score || 0,
                performance_score: result.performanceAnalysis?.score || 0,
                accessibility_score: result.accessibilityData?.score || 0,
                mobile_score: 0,
                overall_score: result.lighthouseScore?.overall || 0,
                lighthouse_data: result.lighthouseScore || {},
                seo_data: result.seoAnalysis || {},
                security_data: result.securityAnalysis || {},
                performance_data: result.performanceAnalysis || {},
                accessibility_data: result.accessibilityData || {},
                mobile_data: {},
                technologies: result.technologies || {},
                screenshot: result.screenshot,
                performance_total_requests: result.requestStats?.total || 0,
                performance_third_party_requests: result.requestStats?.thirdParty || 0,
                performance_transfer_size: result.requestStats?.totalSize || 0,
                performance_script_requests: result.requestStats?.scripts || 0,
                accessibility_issues_count: result.accessibilityData?.issueCount || 0,
                accessibility_missing_alt_tags: result.accessibilityData?.issues?.filter(i => i.type === 'missing-alt').length || 0,
                content_length: result.contentAnalysis?.contentLength || 0,
                content_uniqueness: result.contentAnalysis?.contentUniqueness || 0,
                has_privacy_policy: result.contentAnalysis?.hasPrivacyPolicy || false,
                has_contact_page: result.contentAnalysis?.hasContactPage || false,
                total_images: result.imageAnalysis?.totalImages || 0,
                has_featured_images: result.imageAnalysis?.hasFeaturedImages || false,
                total_ads: result.adDensityAnalysis?.totalAds || 0,
                ads_above_fold: result.adDensityAnalysis?.adsAboveFold || 0,
                ads_in_content: result.adDensityAnalysis?.adsInContent || 0,
                ads_sidebar: result.adDensityAnalysis?.adsSidebar || 0,
                sticky_ads_count: result.adDensityAnalysis?.stickyAds || 0,
                auto_refresh_ads: result.adDensityAnalysis?.autoRefreshAds > 0 || false,
                ad_density: result.adDensityAnalysis?.adDensity || 0,
                ad_to_content_ratio: result.adDensityAnalysis?.adToContentRatio || 0,
                ad_networks_detected: result.adNetworksAnalysis?.networks || [],
                ad_networks_count: result.adNetworksAnalysis?.count || 0,
                has_google_ads: result.adNetworksAnalysis?.hasGoogleAds || false,
                has_multiple_ad_networks: result.adNetworksAnalysis?.hasMultipleNetworks || false,
                layout_score: result.layoutAnalysis?.score || 0,
                layout_menu_position: result.layoutAnalysis?.menuPosition || null,
                layout_content_above_fold: result.layoutAnalysis?.contentAboveFold || false,
                layout_content_before_ads: result.layoutAnalysis?.contentBeforeAds || false,
                layout_menu_accessible: result.layoutAnalysis?.menuAccessible || false,
                layout_overlapping_ads: result.layoutAnalysis?.overlappingAds || false,
                layout_issues: result.layoutAnalysis?.issues || [],
                safe_browsing_status: result.safeBrowsingCheck?.isSafe === true ? 'safe' :
                                       result.safeBrowsingCheck?.isSafe === false ? 'unsafe' : 'not_checked',
                safe_browsing_threats: result.safeBrowsingCheck?.threats || []
              };
              const saveResult = await saveAuditRecord(auditPayload);
              if (saveResult.success) {
                console.log(`[AUDIT-BATCH] ✓ Successfully saved results for publisher ${publisher.id} with site_name: ${siteName}`);
                dbSaveSuccess = true;
                dbSuccessCount++;
              } else {
                console.error(`[AUDIT-BATCH] ❌ Database error for publisher ${publisher.id}:`, saveResult.error);
                dbSaveError = saveResult.error;
                dbFailureCount++;
              }
            } else if (result.success && !supabaseClient) {
              console.warn(`[AUDIT-BATCH] ⚠ Supabase not configured - skipping database save for publisher ${publisher.id}`);
              dbSaveError = 'Supabase client not available';
              dbFailureCount++;
            }

            results.push({
              publisherId: publisher.id,
              domain: publisher.domain,
              site_name: siteName,
              success: result.success,
              database: {
                saved: dbSaveSuccess,
                error: dbSaveError
              }
            });
          } catch (siteError) {
            console.error(`[AUDIT-BATCH] Error auditing ${publisher.domain} for site_name ${siteName}:`, siteError.message);
            results.push({
              publisherId: publisher.id,
              domain: publisher.domain,
              site_name: siteName,
              success: false,
              error: siteError.message,
              database: {
                saved: false,
                error: siteError.message
              }
            });
            dbFailureCount++;
          }
        }
      } catch (error) {
        console.error(`[AUDIT-BATCH] Error processing publisher ${publisher.id}:`, error.message);
        results.push({
          publisherId: publisher.id,
          domain: publisher.domain,
          site_names: publisher.site_names || [],
          success: false,
          error: error.message,
          database: {
            saved: false,
            error: error.message
          }
        });
        dbFailureCount++;
      }
    }

    console.log(`[AUDIT-BATCH] Completed batch audit: ${publishers.length} total, ${dbSuccessCount} db saves successful, ${dbFailureCount} db saves failed, ${cleanupCount} cleanups executed`);
    res.json({
      success: true,
      count: publishers.length,
      cleanup: {
        executed: cleanupCount,
        total: publishers.length
      },
      database: {
        successCount: dbSuccessCount,
        failureCount: dbFailureCount
      },
      results
    });
  } catch (error) {
    console.error(`[AUDIT-BATCH] Error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/audit-all', validateWorkerSecret, async (req, res) => {
  console.log(`[AUDIT-ALL] Audit all publishers request received`);

  res.setTimeout(REQUEST_TIMEOUT);

  try {
    const supabaseClient = initializeSupabase();

    if (!supabaseClient) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    const { data: publishers, error } = await supabaseClient
      .from('publishers')
      .select('id, domain')
      .not('gam_status', 'in', '("Rejected","Withdrawn","Policy Issues","IVT Issues","Not Approved","inactive")');

    if (error) throw error;

    console.log(`[AUDIT-ALL] Found ${publishers.length} active publishers to audit`);

    const publishersWithSiteNames = [];
    for (const publisher of publishers) {
      try {
        const { data: siteNames, error: siteNamesError } = await supabaseClient.rpc('get_publisher_site_names', {
          p_publisher_id: publisher.id
        });

        if (siteNamesError) {
          console.warn(`[AUDIT-ALL] Error fetching site_names for publisher ${publisher.id}:`, siteNamesError.message);
        }

        let site_names = siteNames && Array.isArray(siteNames) && siteNames.length > 0
          ? siteNames.map(item => item.site_name)
          : [];

        site_names = site_names.filter(name => name && typeof name === 'string' && name.trim().length > 0);

        if (site_names.length === 0) {
          site_names = ['primary'];
        }

        publishersWithSiteNames.push({
          id: publisher.id,
          domain: publisher.domain,
          site_names
        });
      } catch (err) {
        console.warn(`[AUDIT-ALL] Exception fetching site_names for publisher ${publisher.id}:`, err.message);
        publishersWithSiteNames.push({
          id: publisher.id,
          domain: publisher.domain,
          site_names: ['primary']
        });
      }
    }

    console.log(`[AUDIT-ALL] Fetched site_names for all publishers, total publisher-site combinations: ${publishersWithSiteNames.reduce((sum, p) => sum + p.site_names.length, 0)}`);

    console.log(`[AUDIT-ALL] Triggering cleanup of old audit data for all publishers`);
    const { data: cleanupResult, error: cleanupError } = await supabaseClient.rpc('trigger_audit_cleanup', {
      p_publisher_id: null,
      p_all_publishers: true
    });
    if (cleanupError) {
      console.warn(`[AUDIT-ALL] Cleanup warning:`, cleanupError.message);
    } else if (cleanupResult && cleanupResult.length > 0) {
      console.log(`[AUDIT-ALL] Cleanup completed:`, cleanupResult[0].message);
    }

    const crawlerInstance = initializeCrawler();
    const results = [];
    let dbSuccessCount = 0;
    let dbFailureCount = 0;

    for (const publisher of publishersWithSiteNames) {
      for (const siteName of publisher.site_names) {
        try {
          const resolvedDomain = resolveSiteNameToDomain(siteName, publisher.domain);
          console.log(`[AUDIT-ALL] Auditing ${publisher.domain} (${publisher.id}) with site_name: ${siteName}, resolved domain: ${resolvedDomain}`);
          const result = await crawlerInstance.crawlSite(resolvedDomain);

          let dbSaveSuccess = false;
          let dbSaveError = null;

          if (result.success) {
            console.log(`[AUDIT-ALL] Saving results to database for publisher ${publisher.id} with site_name: ${siteName}`);
            const resolvedDomain = resolveSiteNameToDomain(siteName, publisher.domain);
            const auditPayload = {
              publisher_id: publisher.id,
              domain: resolvedDomain,
              site_url: resolvedDomain,
              site_name: siteName,
              last_crawled: new Date().toISOString(),
              scanned_at: new Date().toISOString(),
              is_online: true,
              seo_score: result.seoAnalysis?.score || 0,
              security_score: result.securityAnalysis?.score || 0,
              performance_score: result.performanceAnalysis?.score || 0,
              accessibility_score: result.accessibilityData?.score || 0,
              mobile_score: 0,
              overall_score: result.lighthouseScore?.overall || 0,
              lighthouse_data: result.lighthouseScore || {},
              seo_data: result.seoAnalysis || {},
              security_data: result.securityAnalysis || {},
              performance_data: result.performanceAnalysis || {},
              accessibility_data: result.accessibilityData || {},
              mobile_data: {},
              technologies: result.technologies || {},
              screenshot: result.screenshot,
              performance_total_requests: result.requestStats?.total || 0,
              performance_third_party_requests: result.requestStats?.thirdParty || 0,
              performance_transfer_size: result.requestStats?.totalSize || 0,
              performance_script_requests: result.requestStats?.scripts || 0,
              accessibility_issues_count: result.accessibilityData?.issueCount || 0,
              accessibility_missing_alt_tags: result.accessibilityData?.issues?.filter(i => i.type === 'missing-alt').length || 0,
              content_length: result.contentAnalysis?.contentLength || 0,
              content_uniqueness: result.contentAnalysis?.contentUniqueness || 0,
              has_privacy_policy: result.contentAnalysis?.hasPrivacyPolicy || false,
              has_contact_page: result.contentAnalysis?.hasContactPage || false,
              total_images: result.imageAnalysis?.totalImages || 0,
              has_featured_images: result.imageAnalysis?.hasFeaturedImages || false,
              total_ads: result.adDensityAnalysis?.totalAds || 0,
              ads_above_fold: result.adDensityAnalysis?.adsAboveFold || 0,
              ads_in_content: result.adDensityAnalysis?.adsInContent || 0,
              ads_sidebar: result.adDensityAnalysis?.adsSidebar || 0,
              sticky_ads_count: result.adDensityAnalysis?.stickyAds || 0,
              auto_refresh_ads: result.adDensityAnalysis?.autoRefreshAds > 0 || false,
              ad_density: result.adDensityAnalysis?.adDensity || 0,
              ad_to_content_ratio: result.adDensityAnalysis?.adToContentRatio || 0,
              ad_networks_detected: result.adNetworksAnalysis?.networks || [],
              ad_networks_count: result.adNetworksAnalysis?.count || 0,
              has_google_ads: result.adNetworksAnalysis?.hasGoogleAds || false,
              has_multiple_ad_networks: result.adNetworksAnalysis?.hasMultipleNetworks || false,
              layout_score: result.layoutAnalysis?.score || 0,
              layout_menu_position: result.layoutAnalysis?.menuPosition || null,
              layout_content_above_fold: result.layoutAnalysis?.contentAboveFold || false,
              layout_content_before_ads: result.layoutAnalysis?.contentBeforeAds || false,
              layout_menu_accessible: result.layoutAnalysis?.menuAccessible || false,
              layout_overlapping_ads: result.layoutAnalysis?.overlappingAds || false,
              layout_issues: result.layoutAnalysis?.issues || [],
              safe_browsing_status: result.safeBrowsingCheck?.isSafe === true ? 'safe' :
                                     result.safeBrowsingCheck?.isSafe === false ? 'unsafe' : 'not_checked',
              safe_browsing_threats: result.safeBrowsingCheck?.threats || []
            };
            const saveResult = await saveAuditRecord(auditPayload);
            if (saveResult.success) {
              console.log(`[AUDIT-ALL] ✓ Successfully saved results for publisher ${publisher.id} with site_name: ${siteName}`);
              dbSaveSuccess = true;
              dbSuccessCount++;
            } else {
              console.error(`[AUDIT-ALL] ❌ Database error for publisher ${publisher.id}:`, saveResult.error);
              dbSaveError = saveResult.error;
              dbFailureCount++;
            }
          }

          results.push({
            publisherId: publisher.id,
            domain: publisher.domain,
            site_name: siteName,
            success: result.success,
            database: {
              saved: dbSaveSuccess,
              error: dbSaveError
            }
          });
        } catch (error) {
          console.error(`[AUDIT-ALL] Error auditing ${publisher.domain} for site_name ${siteName}:`, error.message);
          results.push({
            publisherId: publisher.id,
            domain: publisher.domain,
            site_name: siteName,
            success: false,
            error: error.message,
            database: {
              saved: false,
              error: error.message
            }
          });
          dbFailureCount++;
        }
      }
    }

    console.log(`[AUDIT-ALL] Completed audit: ${publishersWithSiteNames.length} publishers, ${results.length} total audits, ${dbSuccessCount} db saves successful, ${dbFailureCount} db saves failed`);
    res.json({
      success: true,
      publisherCount: publishersWithSiteNames.length,
      auditCount: results.length,
      cleanup: {
        executed: true,
        message: cleanupResult && cleanupResult.length > 0 ? cleanupResult[0].message : 'Cleanup executed'
      },
      database: {
        successCount: dbSuccessCount,
        failureCount: dbFailureCount
      },
      results
    });
  } catch (error) {
    console.error(`[AUDIT-ALL] Error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/clear-cache', validateWorkerSecret, (req, res) => {
  console.log('[CACHE-CLEAR] Clearing crawler cache...');

  if (crawler) {
    crawler.clearCache();
  }

  res.json({
    success: true,
    message: 'Cache cleared'
  });
});

process.on('SIGTERM', async () => {
  console.log('[SERVER] SIGTERM received, shutting down gracefully...');
  if (crawler) {
    await crawler.close();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[SERVER] SIGINT received, shutting down gracefully...');
  if (crawler) {
    await crawler.close();
  }
  process.exit(0);
});

const supabaseClient = initializeSupabase();

function validateWorkerConfiguration() {
  console.log('[SERVER] Validating worker configuration...');
  const errors = [];
  const warnings = [];

  if (!process.env.SUPABASE_URL) {
    errors.push('❌ SUPABASE_URL not set');
  } else {
    console.log('[SERVER] ✓ SUPABASE_URL configured');
  }

  if (!process.env.SUPABASE_SERVICE_KEY) {
    errors.push('❌ SUPABASE_SERVICE_KEY not set');
  } else {
    console.log('[SERVER] ✓ SUPABASE_SERVICE_KEY configured');
  }

  if (!process.env.WORKER_SECRET) {
    warnings.push('⚠ WORKER_SECRET not set - all requests will be allowed');
  } else {
    console.log('[SERVER] ✓ WORKER_SECRET configured');
  }

  if (errors.length > 0) {
    console.error('[SERVER] Configuration validation failed:');
    errors.forEach(err => console.error(err));
    return false;
  }

  if (warnings.length > 0) {
    console.warn('[SERVER] Configuration warnings:');
    warnings.forEach(warn => console.warn(warn));
  }

  return true;
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[SERVER] ✓ Monitoring worker running on http://0.0.0.0:${PORT}`);
  console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[SERVER] Request timeout: ${REQUEST_TIMEOUT}ms`);
  console.log(`[SERVER] Queue settings: Max size=${MAX_QUEUE_SIZE}, Rate limit=${REQUEST_RATE_LIMIT}ms between requests`);
  console.log(`[SERVER] Database persistence: ${supabaseClient ? '✓ ENABLED' : '❌ DISABLED (missing credentials)'}`);

  const configValid = validateWorkerConfiguration();
  if (!configValid) {
    console.error('[SERVER] ❌ Worker failed startup validation - not all required environment variables are set');
    console.error('[SERVER] Check your Render deployment environment variables');
    process.exit(1);
  }

  console.log('[SERVER] Pre-warming browser instance...');
  try {
    const crawlerInstance = initializeCrawler();
    await crawlerInstance.initBrowser();
    console.log('[SERVER] ✓ Browser pre-warmed and ready for requests');
  } catch (error) {
    console.error('[SERVER] ⚠ Failed to pre-warm browser:', error.message);
    console.log('[SERVER] Browser will be initialized on first request');
  }

  console.log('[SERVER] ========================================');
  console.log('[SERVER] Worker startup complete and ready for audits');
  console.log('[SERVER] ========================================');
});
