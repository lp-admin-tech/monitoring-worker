const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { envConfig, validateConfig } = require('../modules/env-config');
const logger = require('../modules/logger');
const supabase = require('../modules/supabase-client');
const gamFetcher = require('../modules/gam-fetcher');

let contentAnalyzer, adAnalyzer, scorer, aiAssistance, crawler, policyChecker, technicalChecker;
let server = null;
const activeProcesses = new Set();

try {
  const ContentAnalyzerClass = require('../modules/content-analyzer');
  const AdAnalyzerClass = require('../modules/ad-analyzer');
  const policyCheckerModule = require('../modules/policy-checker');
  const technicalCheckerModule = require('../modules/technical-checker');
  const ScoringEngineClass = require('../modules/scoerer');
  const AIAssistanceClass = require('../modules/ai-assistance');
  const crawlerModule = require('../modules/crawler');
  const { createClient } = require('@supabase/supabase-js');

  crawler = crawlerModule;
  policyChecker = policyCheckerModule;
  technicalChecker = technicalCheckerModule;
  contentAnalyzer = new ContentAnalyzerClass();
  adAnalyzer = new AdAnalyzerClass();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  const supabaseClient = supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

  scorer = new ScoringEngineClass(supabaseClient);
  aiAssistance = new AIAssistanceClass();
} catch (err) {
  console.error('Failed to initialize analysis modules:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
}

const app = express();
app.use(express.json());

const WORKER_SECRET = process.env.WORKER_SECRET;
const BATCH_CONCURRENCY_LIMIT = parseInt(process.env.BATCH_CONCURRENCY_LIMIT || '3');
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '3');
const MODULE_TIMEOUT = parseInt(process.env.MODULE_TIMEOUT || '30000');
const RETRY_ENABLED = process.env.RETRY_ENABLED !== 'false';
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

class JobQueue {
  constructor() {
    this.activeJobs = new Map();
    this.jobResults = new Map();
  }

  isAtCapacity() {
    return this.activeJobs.size >= MAX_CONCURRENT_JOBS;
  }

  addJob(jobId) {
    this.activeJobs.set(jobId, { startTime: Date.now(), status: 'running' });
  }

  removeJob(jobId) {
    this.activeJobs.delete(jobId);
  }

  storeResult(jobId, result) {
    this.jobResults.set(jobId, result);
    setTimeout(() => this.jobResults.delete(jobId), 3600000);
  }

  getResult(jobId) {
    return this.jobResults.get(jobId);
  }

  getActiveJobCount() {
    return this.activeJobs.size;
  }
}

const jobQueue = new JobQueue();

class BatchSiteProcessor {
  constructor(concurrencyLimit = 3) {
    this.concurrencyLimit = concurrencyLimit;
    this.activeProcesses = new Map();
    this.processQueue = [];
  }

  async processBatch(sites, jobId, publisherId, requestId) {
    const deduplicatedSites = [...new Set(sites.map(s => typeof s === 'string' ? s : s.site_name))];

    logger.info(`[${requestId}] Processing batch of ${deduplicatedSites.length} unique sites`, {
      jobId,
      publisherId,
      siteCount: deduplicatedSites.length,
      requestId,
    });

    const siteAudits = [];
    for (const siteName of deduplicatedSites) {
      siteAudits.push({
        site_name: siteName,
        status: 'pending',
      });
    }

    for (const audit of siteAudits) {
      await this.queueSiteAudit(audit, jobId, publisherId, requestId);
    }

    return siteAudits.length;
  }

  async queueSiteAudit(siteAudit, jobId, publisherId, requestId) {
    return new Promise((resolve) => {
      this.processQueue.push({ siteAudit, jobId, publisherId, requestId, resolve });
      this.processNextSite();
    });
  }

  processNextSite() {
    if (this.processQueue.length === 0 || this.activeProcesses.size >= this.concurrencyLimit) {
      return;
    }

    const { siteAudit, jobId, publisherId, requestId, resolve } = this.processQueue.shift();
    const processId = uuidv4();

    this.activeProcesses.set(processId, true);

    this.executeSiteAudit(siteAudit, jobId, publisherId, requestId)
      .then(() => resolve())
      .finally(() => {
        this.activeProcesses.delete(processId);
        this.processNextSite();
      });
  }

  async executeSiteAudit(siteAudit, jobId, publisherId, requestId) {
    const siteStartTime = Date.now();

    try {
      const siteAuditRecord = {
        audit_queue_id: jobId,
        publisher_id: publisherId,
        site_name: siteAudit.site_name,
        status: 'processing',
        started_at: new Date().toISOString(),
      };

      let siteAuditId;
      try {
        const result = await supabase.insert('site_audits', siteAuditRecord);
        siteAuditId = result[0]?.id;
        logger.info(`[${requestId}] Successfully created site audit record`, {
          jobId,
          publisherId,
          siteName: siteAudit.site_name,
          siteAuditId,
          requestId,
        });
      } catch (insertErr) {
        logger.error(`[${requestId}] Failed to create site audit record`, insertErr, {
          jobId,
          publisherId,
          siteName: siteAudit.site_name,
          record: siteAuditRecord,
          requestId,
        });
        throw insertErr;
      }

      logger.info(`[${requestId}] Started processing site ${siteAudit.site_name}`, {
        jobId,
        publisherId,
        siteName: siteAudit.site_name,
        siteAuditId,
        requestId,
      });

      const crawlerResult = await executeWithRetry(
        'Crawler',
        async () => {
          return {
            data: {
              content: [],
              ads: [],
            },
            error: null,
          };
        },
        {},
        requestId
      );

      const modules = {
        crawler: crawlerResult,
      };

      const analysisPromises = [];

      analysisPromises.push(
        executeWithRetry(
          'ContentAnalyzer',
          async () => {
            const result = await contentAnalyzer.analyzeContent(crawlerResult.data?.content || []);
            return { data: result, error: null };
          },
          {},
          requestId
        ).then(result => ({ name: 'contentAnalyzer', ...result }))
      );

      analysisPromises.push(
        executeWithRetry(
          'AdAnalyzer',
          async () => {
            const result = await adAnalyzer.processPublisher(crawlerResult.data, { width: 1920, height: 1080 });
            return { data: result, error: null };
          },
          {},
          requestId
        ).then(result => ({ name: 'adAnalyzer', ...result }))
      );

      analysisPromises.push(
        executeWithRetry(
          'PolicyChecker',
          async () => {
            const result = await policyChecker.runPolicyCheck(crawlerResult.data?.content || []);
            return { data: result, error: null };
          },
          {},
          requestId
        ).then(result => ({ name: 'policyChecker', ...result }))
      );

      analysisPromises.push(
        executeWithRetry(
          'TechnicalChecker',
          async () => {
            const result = await technicalChecker.runTechnicalHealthCheck(crawlerResult.data, siteAudit.site_name);
            return { data: result, error: null };
          },
          {},
          requestId
        ).then(result => ({ name: 'technicalChecker', ...result }))
      );

      const analysisResults = await Promise.all(analysisPromises);

      analysisResults.forEach(result => {
        modules[result.name] = result;
        if (result.data) {
          logger.detailedModuleLog(result.name, result, {
            requestId,
            siteAuditId,
            siteName: siteAudit.site_name,
          });
        }
      });

      const scorerInput = {
        crawlerData: modules.crawler.data,
        contentAnalysis: modules.contentAnalyzer.data,
        adAnalysis: modules.adAnalyzer.data,
        policyCheck: modules.policyChecker.data,
        technicalCheck: modules.technicalChecker.data,
      };

      const scorerResult = await executeWithRetry(
        'Scorer',
        async () => {
          const result = await scorer.calculateComprehensiveScore(scorerInput);
          return { data: result, error: null };
        },
        {},
        requestId
      );

      modules.scorer = scorerResult;

      if (scorerResult.data) {
        logger.detailedModuleLog('Scorer', scorerResult, {
          requestId,
          siteAuditId,
          siteName: siteAudit.site_name,
        });
      }

      const aiInput = {
        riskScore: scorerResult.data?.riskScore,
        findings: scorerResult.data?.findings,
        recommendations: scorerResult.data?.recommendations,
      };

      const aiResult = await executeWithRetry(
        'AIAssistance',
        async () => {
          try {
            const result = await aiAssistance.generateComprehensiveReport(
              { domain: siteAudit.site_name },
              scorerResult.data,
              modules.policyChecker.data?.issues || []
            );
            return { data: result, error: null };
          } catch (err) {
            logger.warn(`[${requestId}] AI Assistance failed, using fallback`, { error: err.message, requestId });
            return { data: null, error: err.message };
          }
        },
        {},
        requestId
      );

      modules.aiAssistance = aiResult;

      if (aiResult.data) {
        logger.detailedModuleLog('AIAssistance', aiResult, {
          requestId,
          siteAuditId,
          siteName: siteAudit.site_name,
        });
      }

      const completedAudit = {
        status: 'completed',
        crawler_data: modules.crawler.data,
        content_analysis: modules.contentAnalyzer.data,
        ad_analysis: modules.adAnalyzer.data,
        policy_check: modules.policyChecker.data,
        technical_check: modules.technicalChecker.data,
        risk_score: modules.scorer.data?.riskScore || 0,
        ai_report: aiResult.data ? {
          llmResponse: aiResult.data.llmResponse,
          interpretation: aiResult.data.interpretation,
          timestamp: aiResult.data.timestamp,
          metadata: aiResult.data.metadata
        } : null,
        raw_results: modules,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      try {
        await supabase.update('site_audits', siteAuditId, completedAudit);
        logger.info(`[${requestId}] Successfully updated site audit with final results`, {
          jobId,
          publisherId,
          siteName: siteAudit.site_name,
          siteAuditId,
          status: completedAudit.status,
          riskScore: completedAudit.risk_score,
          requestId,
        });
      } catch (updateErr) {
        logger.error(`[${requestId}] Failed to update site audit with final results`, updateErr, {
          jobId,
          publisherId,
          siteName: siteAudit.site_name,
          siteAuditId,
          requestId,
        });
        throw updateErr;
      }

      logger.auditSummary(siteAudit.site_name, modules);
      logger.findingsReport(modules);

      logger.success(`Audit completed for ${siteAudit.site_name}`, {
        jobId,
        publisherId,
        siteName: siteAudit.site_name,
        riskScore: modules.scorer.data?.riskScore,
        duration: `${Date.now() - siteStartTime}ms`,
        requestId,
      });
    } catch (error) {
      logger.error(
        `[${requestId}] Failed to process site ${siteAudit.site_name}`,
        error,
        { jobId, publisherId, siteName: siteAudit.site_name, requestId }
      );

      try {
        const failedAudit = {
          status: 'failed',
          error_message: error.message,
          error_stack: error.stack,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        logger.info(`[${requestId}] Querying for existing site audit to update failure status`, {
          jobId,
          siteName: siteAudit.site_name,
          requestId,
        });

        const existingSite = await supabase.query('site_audits', {
          audit_queue_id: jobId,
          site_name: siteAudit.site_name,
        });

        if (existingSite && existingSite.length > 0) {
          logger.info(`[${requestId}] Found existing site audit, updating with failure status`, {
            jobId,
            siteName: siteAudit.site_name,
            siteAuditId: existingSite[0].id,
            requestId,
          });
          await supabase.update('site_audits', existingSite[0].id, failedAudit);
          logger.info(`[${requestId}] Successfully updated site audit with failure status`, {
            jobId,
            siteName: siteAudit.site_name,
            siteAuditId: existingSite[0].id,
            requestId,
          });
        } else {
          logger.warn(`[${requestId}] No existing site audit found to update`, {
            jobId,
            siteName: siteAudit.site_name,
            requestId,
          });
        }
      } catch (updateError) {
        logger.error(
          `[${requestId}] Failed to update site audit status after error`,
          updateError,
          { jobId, siteName: siteAudit.site_name, requestId }
        );
      }
    }
  }
}

const batchProcessor = new BatchSiteProcessor(BATCH_CONCURRENCY_LIMIT);

function validateWorkerSecret(req, res, next) {
  if (!WORKER_SECRET) {
    logger.error('WORKER_SECRET is not configured in environment variables', new Error('Missing WORKER_SECRET'));
    return res.status(500).json({
      success: false,
      error: 'Server configuration error: WORKER_SECRET not set',
    });
  }

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    logger.warn('Request received without Authorization header');
    return res.status(401).json({
      success: false,
      error: 'Missing Authorization header. Expected: Authorization: Bearer <WORKER_SECRET>',
    });
  }

  if (!authHeader.startsWith('Bearer ')) {
    logger.warn('Request received with invalid Authorization header format');
    return res.status(401).json({
      success: false,
      error: 'Invalid Authorization header format. Expected: Bearer <WORKER_SECRET>',
    });
  }

  const token = authHeader.substring(7).trim();

  if (!token) {
    logger.warn('Request received with empty token');
    return res.status(401).json({
      success: false,
      error: 'Empty token provided',
    });
  }

  if (token !== WORKER_SECRET) {
    logger.warn('Request received with invalid token');
    return res.status(401).json({
      success: false,
      error: 'Invalid WORKER_SECRET token',
    });
  }

  next();
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function addJitter(ms, jitterPercent = 0.1) {
  const jitterAmount = ms * jitterPercent;
  return ms + (Math.random() * jitterAmount * 2 - jitterAmount);
}

async function executeWithRetry(
  moduleName,
  moduleFunction,
  args,
  requestId
) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`[${requestId}] ${moduleName}: Attempt ${attempt}/${MAX_RETRIES}`, {
        moduleName,
        attempt,
        requestId,
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${moduleName} timeout`)), MODULE_TIMEOUT)
      );

      const result = await Promise.race([
        moduleFunction(...(Array.isArray(args) ? args : [])),
        timeoutPromise,
      ]);

      logger.info(`[${requestId}] ${moduleName}: Success on attempt ${attempt}`, {
        moduleName,
        attempt,
        requestId,
      });

      return { success: true, data: result };
    } catch (error) {
      lastError = error;
      logger.warn(
        `[${requestId}] ${moduleName}: Attempt ${attempt} failed`,
        { moduleName, attempt, error: error.message, requestId }
      );

      if (attempt < MAX_RETRIES && RETRY_ENABLED) {
        const delay = addJitter(RETRY_DELAYS[attempt - 1]);
        logger.info(`[${requestId}] Retrying ${moduleName} in ${delay}ms`, {
          moduleName,
          delay,
          requestId,
        });
        await sleep(delay);
      }
    }
  }

  logger.error(
    `[${requestId}] ${moduleName}: Failed after ${MAX_RETRIES} attempts`,
    lastError,
    { moduleName, maxRetries: MAX_RETRIES, requestId }
  );

  return { success: false, error: lastError?.message || 'Unknown error' };
}

async function executeAuditPipeline(job, requestId) {
  const pipelineResults = {
    jobId: job.id,
    publisherId: job.publisher_id,
    requestId,
    startTime: new Date().toISOString(),
    modules: {},
    error: null,
    status: 'running',
  };

  const processId = uuidv4();
  activeProcesses.add(processId);

  try {
    await supabase.update('audit_queue', job.id, {
      status: 'running',
      started_at: new Date().toISOString(),
    });

    logger.info(`[${requestId}] Starting audit pipeline for publisher ${job.publisher_id}`, {
      publisherId: job.publisher_id,
      siteCount: job.sites.length,
      requestId,
    });

    const publisherContext = await executeWithRetry(
      'PublisherContextFetch',
      async () => gamFetcher.fetchExistingPublishersData({ start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), end: new Date().toISOString() }),
      [],
      requestId
    );

    if (!publisherContext.success) {
      throw new Error(`Failed to fetch publisher context: ${publisherContext.error}`);
    }

    const crawlerResult = await executeWithRetry(
      'Crawler',
      async () => crawler.crawlMultipleSites(job.sites),
      [],
      requestId
    );

    pipelineResults.modules.crawler = {
      success: crawlerResult.success,
      data: crawlerResult.data,
      error: crawlerResult.error,
    };

    if (!crawlerResult.success) {
      logger.warn(`[${requestId}] Crawler failed, continuing with other modules`, {
        requestId,
      });
    }

    const analysisPromises = [];

    analysisPromises.push(
      executeWithRetry(
        'ContentAnalyzer',
        async () => contentAnalyzer.analyzeContent(crawlerResult.data?.content || []),
        [],
        requestId
      ).then(result => ({ name: 'contentAnalyzer', ...result }))
    );

    analysisPromises.push(
      executeWithRetry(
        'AdAnalyzer',
        async () => adAnalyzer.analyzeAds(crawlerResult.data?.ads || []),
        [],
        requestId
      ).then(result => ({ name: 'adAnalyzer', ...result }))
    );

    analysisPromises.push(
      executeWithRetry(
        'PolicyChecker',
        async () => policyChecker.checkPolicies(crawlerResult.data?.content || []),
        [],
        requestId
      ).then(result => ({ name: 'policyChecker', ...result }))
    );

    analysisPromises.push(
      executeWithRetry(
        'TechnicalChecker',
        async () => technicalChecker.checkTechnical(job.sites[0]?.url),
        [],
        requestId
      ).then(result => ({ name: 'technicalChecker', ...result }))
    );

    const analysisResults = await Promise.all(analysisPromises);

    analysisResults.forEach(result => {
      pipelineResults.modules[result.name] = {
        success: result.success,
        data: result.data,
        error: result.error,
      };
    });

    const scorerInput = {
      crawlerData: crawlerResult.data,
      contentAnalysis: pipelineResults.modules.contentAnalyzer.data,
      adAnalysis: pipelineResults.modules.adAnalyzer.data,
      policyCheck: pipelineResults.modules.policyChecker.data,
      technicalCheck: pipelineResults.modules.technicalChecker.data,
    };

    const scorerResult = await executeWithRetry(
      'Scorer',
      async () => scorer.computeRiskScore(scorerInput),
      [],
      requestId
    );

    pipelineResults.modules.scorer = {
      success: scorerResult.success,
      data: scorerResult.data,
      error: scorerResult.error,
    };

    const aiInput = {
      riskScore: scorerResult.data?.riskScore,
      findings: scorerResult.data?.findings,
      recommendations: scorerResult.data?.recommendations,
    };

    const aiResult = await executeWithRetry(
      'AIAssistance',
      async () => aiAssistance.generateReport(aiInput),
      [],
      requestId
    );

    pipelineResults.modules.aiAssistance = {
      success: aiResult.success,
      data: aiResult.data,
      error: aiResult.error,
    };

    pipelineResults.status = 'completed';
    pipelineResults.endTime = new Date().toISOString();

    const auditResult = {
      publisher_id: job.publisher_id,
      audit_type: 'full_site_audit',
      crawler_data: pipelineResults.modules.crawler.data,
      content_analysis: pipelineResults.modules.contentAnalyzer.data,
      ad_analysis: pipelineResults.modules.adAnalyzer.data,
      policy_check: pipelineResults.modules.policyChecker.data,
      technical_check: pipelineResults.modules.technicalChecker.data,
      risk_score: pipelineResults.modules.scorer.data?.riskScore || 0,
      ai_report: pipelineResults.modules.aiAssistance.data,
      audit_timestamp: new Date().toISOString(),
      raw_results: pipelineResults.modules,
    };

    await supabase.insert('audit_results', auditResult);

    await supabase.update('audit_queue', job.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: null,
    });

    await supabase.update('publishers', job.publisher_id, {
      last_audit_at: new Date().toISOString(),
    });

    logger.info(`[${requestId}] Audit pipeline completed successfully`, {
      publisherId: job.publisher_id,
      riskScore: pipelineResults.modules.scorer.data?.riskScore,
      requestId,
    });

    return pipelineResults;
  } catch (error) {
    logger.error(
      `[${requestId}] Audit pipeline failed`,
      error,
      { publisherId: job.publisher_id, requestId }
    );

    pipelineResults.status = 'failed';
    pipelineResults.error = error.message;
    pipelineResults.endTime = new Date().toISOString();

    await supabase.update('audit_queue', job.id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: error.message,
    });

    await supabase.insert('audit_failures', {
      publisher_id: job.publisher_id,
      module: 'full_pipeline',
      error_message: error.message,
      error_stack: error.stack,
      failure_timestamp: new Date().toISOString(),
      request_id: requestId,
    });

    return pipelineResults;
  } finally {
    activeProcesses.delete(processId);
    jobQueue.removeJob(job.id);
    logger.info(`[${requestId}] Audit pipeline cleanup completed`, {
      jobId: job.id,
      requestId,
    });
  }
}

app.post('/audit', validateWorkerSecret, async (req, res) => {
  const requestId = uuidv4();
  const { publisher_id, sites, priority = 'normal' } = req.body;

  try {
    if (!publisher_id || !sites || !Array.isArray(sites) || sites.length === 0) {
      logger.warn(`[${requestId}] Invalid audit request parameters`, {
        hasPublisherId: !!publisher_id,
        hasSites: !!sites,
        isSitesArray: Array.isArray(sites),
        requestId,
      });
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: publisher_id, sites (non-empty array)',
        requestId,
      });
    }

    if (jobQueue.isAtCapacity()) {
      logger.warn(`[${requestId}] Job queue at capacity`, {
        activeJobs: jobQueue.getActiveJobCount(),
        maxConcurrent: MAX_CONCURRENT_JOBS,
        requestId,
      });
      return res.status(503).json({
        success: false,
        error: `Job queue at capacity (${MAX_CONCURRENT_JOBS} concurrent jobs). Please retry later.`,
        requestId,
      });
    }

    const jobId = uuidv4();

    const job = {
      id: jobId,
      publisher_id,
      sites,
      priority,
      status: 'pending',
      queued_at: new Date().toISOString(),
    };

    await supabase.insert('audit_queue', job);
    jobQueue.addJob(jobId);

    logger.info(`[${requestId}] Audit job queued successfully`, {
      jobId,
      publisherId: publisher_id,
      siteCount: sites.length,
      requestId,
    });

    res.status(202).json({
      success: true,
      jobId,
      requestId,
      message: 'Audit job queued for processing',
      siteCount: sites.length,
    });

    const processId = uuidv4();
    activeProcesses.add(processId);

    executeAuditPipeline(job, requestId)
      .then(result => {
        jobQueue.storeResult(jobId, result);
        logger.info(`[${requestId}] Pipeline execution completed`, {
          jobId,
          status: result.status,
          requestId,
        });
      })
      .catch(err => {
        logger.error(`[${requestId}] Pipeline execution failed`, err, {
          jobId,
          requestId,
        });
      })
      .finally(() => {
        activeProcesses.delete(processId);
        jobQueue.removeJob(jobId);
      });
  } catch (error) {
    logger.error(`[${requestId}] Failed to queue audit job`, error, {
      publisherId: req.body?.publisher_id,
      requestId,
    });

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to queue audit job',
      requestId,
    });
  }
});

app.post('/audit-batch-sites', validateWorkerSecret, async (req, res) => {
  const requestId = uuidv4();
  const { publisher_id, site_names, priority = 'normal' } = req.body;

  logger.info(`[${requestId}] Received batch audit request`, {
    publisherId: publisher_id,
    siteCount: site_names?.length || 0,
    priority,
    requestId,
  });

  try {
    if (!publisher_id) {
      logger.warn(`[${requestId}] Missing publisher_id in batch audit request`, { requestId });
      return res.status(400).json({
        success: false,
        error: 'Missing required field: publisher_id',
        requestId,
      });
    }

    if (!site_names || !Array.isArray(site_names) || site_names.length === 0) {
      logger.warn(`[${requestId}] Invalid site_names in batch audit request`, {
        hasSiteNames: !!site_names,
        isSiteNamesArray: Array.isArray(site_names),
        requestId,
      });
      return res.status(400).json({
        success: false,
        error: 'Missing required field: site_names (non-empty array)',
        requestId,
      });
    }

    const jobId = uuidv4();
    const job = {
      id: jobId,
      publisher_id,
      sites: site_names,
      priority,
      status: 'pending',
      queued_at: new Date().toISOString(),
    };

    await supabase.insert('audit_queue', job);
    jobQueue.addJob(jobId);

    logger.info(`[${requestId}] Batch audit job queued successfully`, {
      jobId,
      publisherId: publisher_id,
      siteCount: site_names.length,
      requestId,
    });

    res.status(202).json({
      success: true,
      jobId,
      requestId,
      message: 'Batch audit job queued for processing',
      siteCount: site_names.length,
      estimatedProcessingTime: `${site_names.length * 10}s`,
    });

    const processId = uuidv4();
    activeProcesses.add(processId);

    (async () => {
      try {
        await supabase.update('audit_queue', jobId, {
          status: 'running',
          started_at: new Date().toISOString(),
        });

        const siteCount = await batchProcessor.processBatch(site_names, jobId, publisher_id, requestId);

        logger.info(`[${requestId}] Batch processing completed successfully`, {
          jobId,
          publisherId: publisher_id,
          sitesProcessed: siteCount,
          requestId,
        });

        await supabase.update('audit_queue', jobId, {
          status: 'completed',
          completed_at: new Date().toISOString(),
          error_message: null,
        });
      } catch (error) {
        logger.error(`[${requestId}] Batch processing failed`, error, {
          jobId,
          publisherId: publisher_id,
          requestId,
        });

        await supabase.update('audit_queue', jobId, {
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error.message,
        });

        await supabase.insert('audit_failures', {
          publisher_id,
          module: 'batch_processor',
          error_message: error.message,
          error_stack: error.stack,
          failure_timestamp: new Date().toISOString(),
          request_id: requestId,
        });
      } finally {
        activeProcesses.delete(processId);
        jobQueue.removeJob(jobId);
      }
    })();
  } catch (error) {
    logger.error(`[${requestId}] Failed to queue batch audit job`, error, {
      publisherId: req.body?.publisher_id,
      requestId,
    });

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to queue batch audit job',
      requestId,
    });
  }
});

app.get('/job/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const requestId = uuidv4();

  try {
    const result = jobQueue.getResult(jobId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Job result not found in cache',
        requestId,
      });
    }

    res.json({
      success: true,
      data: result,
      requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Failed to retrieve job status`, error, { jobId, requestId });

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve job status',
      requestId,
    });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeJobs: jobQueue.getActiveJobCount(),
    maxConcurrent: MAX_CONCURRENT_JOBS,
    timestamp: new Date().toISOString(),
  });
});

async function gracefulShutdown(signal) {
  logger.info(`Received ${signal} signal, initiating graceful shutdown`);

  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
    });
  }

  const shutdownTimeout = setTimeout(() => {
    logger.warn('Graceful shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, 30000);

  try {
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (activeProcesses.size === 0 && jobQueue.getActiveJobCount() === 0) {
          clearInterval(checkInterval);
          clearTimeout(shutdownTimeout);
          logger.info('All processes completed, shutting down');
          resolve();
        }
      }, 500);

      if (activeProcesses.size === 0 && jobQueue.getActiveJobCount() === 0) {
        clearInterval(checkInterval);
        clearTimeout(shutdownTimeout);
        resolve();
      }
    });
  } catch (error) {
    logger.error('Error during graceful shutdown', error);
  }

  process.exit(0);
}

async function start() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed', new Error(errors.join(', ')));
    process.exit(1);
  }

  const PORT = envConfig.worker.port;

  server = app.listen(PORT, () => {
    logger.info(`Worker runner started successfully on port ${PORT}`, {
      port: PORT,
      maxConcurrentJobs: MAX_CONCURRENT_JOBS,
      moduleTimeout: MODULE_TIMEOUT,
      retryEnabled: RETRY_ENABLED,
      nodeEnv: process.env.NODE_ENV || 'production',
    });
  });

  server.on('error', (err) => {
    logger.error('Server error', err);
    process.exit(1);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', new Error(`Unhandled Promise rejection: ${reason}`));
});

start().catch(err => {
  logger.error('Failed to start worker runner', err);
  process.exit(1);
});

module.exports = { app, jobQueue, executeAuditPipeline };
