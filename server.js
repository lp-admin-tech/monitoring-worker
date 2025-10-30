import express from 'express';
import dotenv from 'dotenv';
import { AdvancedWebsiteCrawler } from './index.js';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '900000');

app.use(express.json());

let crawler = null;
let supabase = null;

function validateWorkerSecret(req, res, next) {
  const authHeader = req.headers['authorization'];
  const workerSecret = process.env.WORKER_SECRET;

  if (!workerSecret) {
    console.warn('[AUTH] WORKER_SECRET not set - allowing all requests');
    return next();
  }

  if (!authHeader || authHeader !== `Bearer ${workerSecret}`) {
    console.warn('[AUTH] Invalid or missing authorization header');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

function initializeCrawler() {
  if (!crawler) {
    console.log('[SERVER] Initializing crawler instance...');
    crawler = new AdvancedWebsiteCrawler({
      cacheTimeout: 3600000,
      maxRetries: 3,
      concurrency: 2
    });
  }
  return crawler;
}

function initializeSupabase() {
  if (!supabase && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    console.log('[SERVER] Initializing Supabase client...');
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }
  return supabase;
}

app.get('/', (req, res) => {
  res.json({
    service: 'MFA Buster Site Monitoring Worker',
    status: 'running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: 'GET /health',
      audit: 'POST /audit',
      auditBatch: 'POST /audit-batch',
      auditAll: 'GET /audit-all',
      crawl: 'POST /crawl',
      crawlMultiple: 'POST /crawl-multiple',
      clearCache: 'POST /clear-cache'
    }
  });
});

app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
      workerSecretConfigured: !!process.env.WORKER_SECRET
    }
  };

  res.json(health);
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

    if (result.success && publisherId && supabase) {
      console.log(`[CRAWL-REQUEST] Saving results to database for publisher ${publisherId}`);

      const { error: dbError } = await supabase
        .from('site_audits')
        .upsert({
          publisher_id: publisherId,
          domain: domain,
          last_crawled: new Date().toISOString(),
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
          accessibility_missing_alt_tags: result.accessibilityData?.issues?.filter(i => i.type === 'missing-alt').length || 0
        }, {
          onConflict: 'publisher_id'
        });

      if (dbError) {
        console.error('[CRAWL-REQUEST] Database error:', dbError);
      } else {
        console.log(`[CRAWL-REQUEST] Successfully saved results for publisher ${publisherId}`);
      }
    }

    console.log(`[CRAWL-REQUEST] Successfully crawled ${domain}`);
    res.json({
      success: true,
      domain,
      publisherId,
      result
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
  const { publisherId, domain } = req.body;

  if (!domain) {
    return res.status(400).json({ error: 'Domain is required' });
  }

  console.log(`[AUDIT] Single audit request for domain: ${domain}, publisherId: ${publisherId || 'N/A'}`);

  res.setTimeout(REQUEST_TIMEOUT);

  try {
    const crawlerInstance = initializeCrawler();
    const supabaseClient = initializeSupabase();
    const result = await crawlerInstance.crawlSite(domain);

    if (result.success && publisherId && supabaseClient) {
      console.log(`[AUDIT] Saving results to database for publisher ${publisherId}`);

      const { error: dbError } = await supabaseClient
        .from('site_audits')
        .upsert({
          publisher_id: publisherId,
          domain: domain,
          last_crawled: new Date().toISOString(),
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
          accessibility_missing_alt_tags: result.accessibilityData?.issues?.filter(i => i.type === 'missing-alt').length || 0
        }, {
          onConflict: 'publisher_id'
        });

      if (dbError) {
        console.error('[AUDIT] Database error:', dbError);
      } else {
        console.log(`[AUDIT] Successfully saved results for publisher ${publisherId}`);
      }
    }

    console.log(`[AUDIT] Successfully completed audit for ${domain}`);
    res.json({
      success: true,
      domain,
      publisherId,
      result
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

    for (const publisher of publishers) {
      try {
        console.log(`[AUDIT-BATCH] Auditing ${publisher.domain} (${publisher.id})`);
        const result = await crawlerInstance.crawlSite(publisher.domain);

        if (result.success && supabaseClient) {
          await supabaseClient
            .from('site_audits')
            .upsert({
              publisher_id: publisher.id,
              domain: publisher.domain,
              last_crawled: new Date().toISOString(),
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
              accessibility_missing_alt_tags: result.accessibilityData?.issues?.filter(i => i.type === 'missing-alt').length || 0
            }, {
              onConflict: 'publisher_id'
            });
        }

        results.push({
          publisherId: publisher.id,
          domain: publisher.domain,
          success: result.success
        });
      } catch (error) {
        console.error(`[AUDIT-BATCH] Error auditing ${publisher.domain}:`, error.message);
        results.push({
          publisherId: publisher.id,
          domain: publisher.domain,
          success: false,
          error: error.message
        });
      }
    }

    console.log(`[AUDIT-BATCH] Completed batch audit for ${publishers.length} publishers`);
    res.json({
      success: true,
      count: publishers.length,
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

    const crawlerInstance = initializeCrawler();
    const results = [];

    for (const publisher of publishers) {
      try {
        console.log(`[AUDIT-ALL] Auditing ${publisher.domain} (${publisher.id})`);
        const result = await crawlerInstance.crawlSite(publisher.domain);

        if (result.success) {
          await supabaseClient
            .from('site_audits')
            .upsert({
              publisher_id: publisher.id,
              domain: publisher.domain,
              last_crawled: new Date().toISOString(),
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
              accessibility_missing_alt_tags: result.accessibilityData?.issues?.filter(i => i.type === 'missing-alt').length || 0
            }, {
              onConflict: 'publisher_id'
            });
        }

        results.push({
          publisherId: publisher.id,
          domain: publisher.domain,
          success: result.success
        });
      } catch (error) {
        console.error(`[AUDIT-ALL] Error auditing ${publisher.domain}:`, error.message);
        results.push({
          publisherId: publisher.id,
          domain: publisher.domain,
          success: false,
          error: error.message
        });
      }
    }

    console.log(`[AUDIT-ALL] Completed audit for ${publishers.length} publishers`);
    res.json({
      success: true,
      count: publishers.length,
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

initializeSupabase();

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[SERVER] ✓ Monitoring worker running on http://0.0.0.0:${PORT}`);
  console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[SERVER] Request timeout: ${REQUEST_TIMEOUT}ms`);

  console.log('[SERVER] Pre-warming browser instance...');
  try {
    const crawlerInstance = initializeCrawler();
    await crawlerInstance.initBrowser();
    console.log('[SERVER] ✓ Browser pre-warmed and ready for requests');
  } catch (error) {
    console.error('[SERVER] ⚠ Failed to pre-warm browser:', error.message);
    console.log('[SERVER] Browser will be initialized on first request');
  }
});
