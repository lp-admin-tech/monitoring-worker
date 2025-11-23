const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { envConfig, validateConfig } = require('../modules/env-config');
const logger = require('../modules/logger');
const supabase = require('../modules/supabase-client');
const gamFetcher = require('../modules/gam-fetcher');
const QueueManager = require('../core/queue/queue-manager');

let contentAnalyzer, adAnalyzer, scorer, aiAssistance, crawler, policyChecker, technicalChecker, technicalCheckerDb, contentAnalyzerDb, adAnalyzerDb, policyCheckerDb, aiAssistanceDb, crawlerDb, moduleDataOrchestrator, directoryAuditOrchestrator, crossModuleAnalyzer;
let server = null;
const activeProcesses = new Set();

try {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  const ContentAnalyzerClass = require('../modules/content-analyzer');
  const AdAnalyzerClass = require('../modules/ad-analyzer');
  const policyCheckerModule = require('../modules/policy-checker');
  const technicalCheckerModule = require('../modules/technical-checker');
  const technicalCheckerDbModule = require('../modules/technical-checker/db');
  const contentAnalyzerDbModule = require('../modules/content-analyzer/db');
  const adAnalyzerDbModule = require('../modules/ad-analyzer/db');
  const policyCheckerDbModule = require('../modules/policy-checker/db');
  const aiAssistanceDbModule = require('../modules/ai-assistance/db');
  const crawlerDbModule = require('../modules/crawler/db');
  const ScoringEngineClass = require('../modules/scoerer');
  const AIAssistanceClass = require('../modules/ai-assistance');
  const crawlerModule = require('../modules/crawler');
  const ModuleDataPersistence = require('../modules/database-orchestrator');
  const DirectoryAuditOrchestrator = require('../modules/directory-audit-orchestrator');
  const crossModuleAnalyzerModule = require('../modules/cross-module-analyzer');
  const { createClient } = require('@supabase/supabase-js');

  crawler = crawlerModule;
  policyChecker = policyCheckerModule;
  technicalChecker = technicalCheckerModule;
  crawlerDb = crawlerDbModule;
  policyCheckerDb = policyCheckerDbModule;
  technicalCheckerDb = technicalCheckerDbModule;
  contentAnalyzerDb = contentAnalyzerDbModule;
  adAnalyzerDb = new adAnalyzerDbModule(supabaseUrl, supabaseServiceKey);
  aiAssistanceDb = aiAssistanceDbModule;
  contentAnalyzer = new ContentAnalyzerClass();
  adAnalyzer = new AdAnalyzerClass();


  const supabaseClient = supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

  scorer = new ScoringEngineClass(supabaseClient);
  aiAssistance = new AIAssistanceClass();
  moduleDataOrchestrator = new ModuleDataPersistence({
    contentAnalyzerDb,
    adAnalyzerDb,
    policyCheckerDb,
    technicalCheckerDb,
    aiAssistanceDb,
    crawlerDb,
    scorerDb,
    logger
  });

  directoryAuditOrchestrator = new DirectoryAuditOrchestrator({
    contentAnalyzer,
    adAnalyzer,
    policyChecker,
    technicalChecker,
    crawler
  });

  crossModuleAnalyzer = crossModuleAnalyzerModule;
} catch (err) {
  console.error('Failed to initialize analysis modules:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
}

const app = express();
app.use(express.json());

const WORKER_SECRET = process.env.WORKER_SECRET;
const BATCH_CONCURRENCY_LIMIT = parseInt(process.env.BATCH_CONCURRENCY_LIMIT || '3');
const MODULE_TIMEOUT = parseInt(process.env.MODULE_TIMEOUT || '30000');
const RETRY_ENABLED = process.env.RETRY_ENABLED !== 'false';
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

// --- JOB PROCESSOR FUNCTION ---
// This function contains the logic that was previously in BatchSiteProcessor.executeSiteAudit
// It is now called by the BullMQ worker for each job.
async function processAuditJob(job) {
  const { siteAudit, jobId, publisherId, requestId } = job.data;
  const siteStartTime = Date.now();

  logger.info(`[${requestId}] Processing job ${job.id} for site ${siteAudit.site_name}`, {
    jobId,
    publisherId,
    siteName: siteAudit.site_name,
    requestId
  });

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

    // Use DirectoryAuditOrchestrator to run the audit
    const orchestratorResult = await directoryAuditOrchestrator.runDirectoryAwareAudit(
      {
        id: publisherId,
        site_url: siteAudit.site_name,
        subdirectories: []
      },
      siteAuditId
    );

    // Extract main site results
    const mainSiteResult = orchestratorResult.mainSite.desktop || orchestratorResult.mainSite.mobile;
    const mainSiteModules = mainSiteResult.modules;
    const mainSiteCrawlData = mainSiteResult.crawlData;

    // Map to expected 'modules' structure
    const modules = {
      crawler: { success: true, data: mainSiteCrawlData },
      contentAnalyzer: { name: 'contentAnalyzer', ...mainSiteModules.contentAnalyzer },
      adAnalyzer: { name: 'adAnalyzer', ...mainSiteModules.adAnalyzer },
      policyChecker: { name: 'policyChecker', ...mainSiteModules.policyChecker },
      technicalChecker: { name: 'technicalChecker', ...mainSiteModules.technicalChecker },
    };

    // Aggregate results
    const aggregatedResults = directoryAuditOrchestrator.aggregateResults(orchestratorResult);

    let scorerInput = {
      crawlerData: modules.crawler.data,
      contentAnalysis: modules.contentAnalyzer.data,
      adAnalysis: modules.adAnalyzer.data,
      policyCheck: modules.policyChecker.data,
      technicalCheck: modules.technicalChecker.data,
      directoryContext: aggregatedResults
    };

    if (publisherId) {
      try {
        logger.info(`[${requestId}] Enriching audit data with GAM metrics`, { publisherId, requestId });
        scorerInput = await scorer.enrichAuditDataWithGAM(scorerInput, publisherId);
      } catch (gamError) {
        logger.warn(`[${requestId}] GAM enrichment failed, continuing without GAM data`, {
          error: gamError.message,
          requestId
        });
      }
    }

    const scorerResult = await executeWithRetry(
      'Scorer',
      async () => {
        const result = await scorer.calculateComprehensiveScore(scorerInput, { id: publisherId });
        return { data: result, error: null };
      },
      {},
      requestId
    );

    modules.scorer = scorerResult;

    const aiInput = {
      riskScore: scorerResult.data?.riskScore,
      findings: scorerResult.data?.findings,
      recommendations: scorerResult.data?.recommendations,
      directoryContext: aggregatedResults
    };

    const aiResult = await executeWithRetry(
      'AIAssistance',
      async () => {
        try {
          const result = await aiAssistance.generateComprehensiveReport(
            { domain: siteAudit.site_name },
            { ...scorerResult.data, directoryContext: aggregatedResults },
            modules.policyChecker.data?.issues || [],
            siteAuditId,
            publisherId
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

    const scorerData = modules.scorer.data || {};

    const completedAudit = {
      status: 'completed',
      crawler_data: modules.crawler.data,
      content_analysis: modules.contentAnalyzer.data,
      ad_analysis: modules.adAnalyzer.data,
      policy_check: modules.policyChecker.data,
      technical_check: modules.technicalChecker.data,
      risk_score: Number(scorerData.riskScore) || 0,
      score_breakdown: scorerData.scores?.componentScores || null,
      mfa_probability: scorerData.mfaProbability || null,
      risk_level: scorerData.explanation?.riskLevel || null,
      methodology: scorerData.methodology || null,
      primary_causes: scorerData.explanation?.primaryReasons || null,
      contributing_factors: scorerData.explanation?.contributingFactors || null,
      recommendations: scorerData.explanation?.recommendations || null,
      trend_data: scorerData.trend || null,
      explanation_details: scorerData.explanation || null,
      confidence_score: scorerData.explanation?.confidenceScore || null,
      explanation_timestamp: scorerData.timestamp || null,
      ai_report: aiResult.data ? {
        llmResponse: aiResult.data.llmResponse,
        interpretation: aiResult.data.interpretation,
        timestamp: aiResult.data.timestamp,
        metadata: aiResult.data.metadata
      } : {
        error: aiResult.error || 'Unknown error',
        status: 'failed',
        timestamp: new Date().toISOString()
      },
      raw_results: modules,
      is_directory: aggregatedResults.isDirectory,
      directory_type: aggregatedResults.directoryType,
      directory_confidence: aggregatedResults.directoryConfidence,
      directory_data: {
        detection: orchestratorResult.directoryDetection,
        summary: orchestratorResult.summary,
        directories: orchestratorResult.directories.map(d => ({
          directory: d.directory,
          url: d.url,
          success: d.success,
          modules: d.modules,
          error: d.error
        })),
        aggregatedScores: aggregatedResults.aggregatedScores
      },
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      await supabase.update('site_audits', siteAuditId, completedAudit);

      const persistenceResults = await moduleDataOrchestrator.saveAllModuleResults(
        siteAuditId,
        publisherId,
        modules,
        requestId
      );

      // Persist results for all discovered directories
      if (orchestratorResult.directories && orchestratorResult.directories.length > 0) {
        for (const dirResult of orchestratorResult.directories) {
          if (dirResult.success && dirResult.modules) {
            try {
              await moduleDataOrchestrator.saveAllModuleResults(
                siteAuditId,
                publisherId,
                dirResult.modules,
                requestId,
                dirResult.url
              );
            } catch (dirPersistErr) {
              logger.error(`[${requestId}] Failed to persist directory data for ${dirResult.url}`, dirPersistErr, { requestId });
            }
          }
        }
      }

      // Trigger Cross-Module Comparison
      try {
        await crossModuleAnalyzer.runComparison(siteAuditId, publisherId);
      } catch (comparisonError) {
        logger.error(`[${requestId}] Error triggering cross-module comparison`, comparisonError, { requestId });
      }

    } catch (updateErr) {
      logger.error(`[${requestId}] Failed to update site audit with final results`, updateErr, { requestId });
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

    return completedAudit;

  } catch (error) {
    logger.error(
      `[${requestId}] Failed to process site ${siteAudit.site_name}`,
      error,
      { jobId, publisherId, siteName: siteAudit.site_name, requestId, errorSource: 'site_audit_processing' }
    );

    // Update failure status in DB
    try {
      const existingSite = await supabase.query('site_audits', {
        audit_queue_id: jobId,
        site_name: siteAudit.site_name,
      });

      if (existingSite && existingSite.length > 0) {
        await supabase.update('site_audits', existingSite[0].id, {
          status: 'failed',
          error_message: error.message,
          error_stack: error.stack,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    } catch (updateError) {
      logger.error(`[${requestId}] Failed to update site audit status after error`, updateError);
    }

    throw error; // Rethrow to let BullMQ know the job failed
  }
}

// Initialize Queue Manager
const auditQueue = new QueueManager('audit-queue', processAuditJob, {
  concurrency: BATCH_CONCURRENCY_LIMIT
});

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

    const deduplicatedSites = [...new Set(site_names.map(s => typeof s === 'string' ? s : s.site_name))];
    const jobId = uuidv4();

    // Create a parent job record in Supabase
    const job = {
      id: jobId,
      publisher_id,
      sites: site_names,
      priority,
      status: 'pending',
      queued_at: new Date().toISOString(),
    };

    await supabase.insert('audit_queue', job);

    // Add individual site jobs to BullMQ
    for (const siteName of deduplicatedSites) {
      const siteAudit = { site_name: siteName, status: 'pending' };

      await auditQueue.add(
        `audit-${siteName}`,
        {
          siteAudit,
          jobId,
          publisherId: publisher_id,
          requestId
        },
        {
          priority: priority === 'high' ? 1 : 2,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        }
      );
    }

    logger.info(`[${requestId}] Batch audit job queued successfully`, {
      jobId,
      publisherId: publisher_id,
      siteCount: deduplicatedSites.length,
      requestId,
    });

    res.status(202).json({
      success: true,
      jobId,
      requestId,
      message: 'Batch audit job queued for processing',
      siteCount: deduplicatedSites.length,
      estimatedProcessingTime: `${deduplicatedSites.length * 10}s`,
    });

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
    // With BullMQ, job results are not stored in a simple in-memory cache like the old JobQueue.
    // To get job status, you would query BullMQ directly or check the database.
    // For now, this endpoint will just return a placeholder or indicate it's not supported.
    // A proper implementation would involve querying BullMQ for job status or fetching from the DB.
    const job = await auditQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found in queue system',
        requestId,
      });
    }

    const status = await job.getState();
    const result = job.returnvalue; // This might be null if job is not completed

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
    activeJobs: auditQueue.getActiveJobCount(),
    maxConcurrent: BATCH_CONCURRENCY_LIMIT,
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

  if (crawler) {
    try {
      await crawler.close();
      logger.info('Crawler closed');
    } catch (err) {
      logger.error('Error closing crawler', err);
    }
  }

  const shutdownTimeout = setTimeout(() => {
    logger.warn('Graceful shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, 30000);

  try {
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (activeProcesses.size === 0 && auditQueue.getActiveJobCount() === 0) {
          clearInterval(checkInterval);
          clearTimeout(shutdownTimeout);
          logger.info('All processes completed, shutting down');
          resolve();
        }
      }, 500);

      if (activeProcesses.size === 0 && auditQueue.getActiveJobCount() === 0) {
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

  try {
    logger.info('Initializing crawler...');
    await crawler.initialize();
    logger.info('Crawler initialized successfully');
  } catch (err) {
    logger.error('Failed to initialize crawler', err);
    process.exit(1);
  }

  const PORT = envConfig.worker.port;

  server = app.listen(PORT, () => {
    logger.info(`Worker runner started successfully on port ${PORT}`, {
      port: PORT,
      maxConcurrentJobs: BATCH_CONCURRENCY_LIMIT,
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

module.exports = { app, auditQueue };
