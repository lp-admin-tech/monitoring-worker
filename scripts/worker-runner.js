const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { envConfig, validateConfig } = require('../modules/env-config');
const logger = require('../modules/logger');
const supabase = require('../modules/supabase-client');
const gamFetcher = require('../modules/gam-fetcher');
const QueueManager = require('../core/queue/queue-manager');
const DataQualityDB = require('../modules/data-quality-db');

let contentAnalyzer, adAnalyzer, scorer, aiAssistance, crawler, policyChecker, technicalChecker, technicalCheckerDb, contentAnalyzerDb, adAnalyzerDb, policyCheckerDb, aiAssistanceDb, crawlerDb, moduleDataOrchestrator, directoryAuditOrchestrator, crossModuleAnalyzer, dataQualityDb;
let server = null;
const activeProcesses = new Set();

try {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  console.log('Worker Runner v2.2 - Regex Fix Applied');

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

  // Initialize DataQualityDB for audit_data_quality table
  dataQualityDb = supabaseClient ? new DataQualityDB(supabaseClient) : null;
} catch (err) {
  console.error('Failed to initialize analysis modules:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
}

const app = express();
app.use(express.json());

/**
 * Calculate data quality metrics based on module success and data completeness
 * @param {Object} modules - Module results
 * @param {Object} crawlData - Crawler data
 * @returns {Object} Data quality assessment
 */
function calculateDataQuality(modules, crawlData) {
  const metricsCollected = {};
  const failures = [];
  let successCount = 0;
  const totalModules = 5; // crawler, content, ads, policy, technical

  // Check crawler
  if (crawlData && crawlData.content && crawlData.content.length >= 100) {
    metricsCollected.crawler = true;
    successCount++;
  } else {
    metricsCollected.crawler = false;
    failures.push({
      module: 'crawler',
      reason: 'Insufficient content extracted',
      contentLength: crawlData?.content?.length || 0,
      timestamp: new Date().toISOString()
    });
  }

  // Check content analyzer
  const contentData = modules.contentAnalyzer?.data;
  if (contentData && contentData.textLength > 100 && contentData.entropy?.entropyScore > 0) {
    metricsCollected.content = true;
    successCount++;
  } else {
    metricsCollected.content = false;
    failures.push({
      module: 'content',
      reason: 'Content analysis failed or returned zero metrics',
      textLength: contentData?.textLength || 0,
      entropyScore: contentData?.entropy?.entropyScore || 0,
      timestamp: new Date().toISOString()
    });
  }

  // Check ad analyzer
  const adData = modules.adAnalyzer?.data;
  if (adData && (adData.summary?.totalAds > 0 || adData.summary?.adDensity >= 0)) {
    metricsCollected.ads = true;
    successCount++;
  } else {
    metricsCollected.ads = false;
    failures.push({
      module: 'ads',
      reason: 'Ad analysis returned no data or zero ads detected',
      totalAds: adData?.summary?.totalAds || 0,
      timestamp: new Date().toISOString()
    });
  }

  // Check policy checker
  const policyData = modules.policyChecker?.data;
  if (policyData && policyData.issues !== undefined) {
    metricsCollected.policy = true;
    successCount++;
  } else {
    metricsCollected.policy = false;
    failures.push({
      module: 'policy',
      reason: 'Policy check failed or returned no data',
      timestamp: new Date().toISOString()
    });
  }

  // Check technical checker
  const technicalData = modules.technicalChecker?.data;
  if (technicalData && technicalData.performance?.pageLoadTime > 0) {
    metricsCollected.technical = true;
    successCount++;
  } else {
    metricsCollected.technical = false;
    failures.push({
      module: 'technical',
      reason: 'Technical check failed or returned no performance data',
      pageLoadTime: technicalData?.performance?.pageLoadTime || 0,
      timestamp: new Date().toISOString()
    });
  }

  // Calculate quality score (0.0 - 1.0)
  const baseScore = successCount / totalModules;
  const failurePenalty = Math.min(failures.length * 0.05, 0.3);
  const qualityScore = Math.max(baseScore - failurePenalty, 0.0);

  // Determine quality level
  let qualityLevel;
  if (qualityScore >= 0.9) qualityLevel = 'excellent';
  else if (qualityScore >= 0.7) qualityLevel = 'good';
  else if (qualityScore >= 0.5) qualityLevel = 'warning';
  else qualityLevel = 'critical';

  // Audit is complete if at least 70% of metrics collected (3 out of 5)
  const isComplete = successCount >= Math.ceil(totalModules * 0.7);

  return {
    score: Math.round(qualityScore * 100) / 100,
    level: qualityLevel,
    isComplete,
    metricsCollected,
    failures,
    successCount,
    totalModules
  };
}

const WORKER_SECRET = process.env.WORKER_SECRET;
const BATCH_CONCURRENCY_LIMIT = parseInt(process.env.BATCH_CONCURRENCY_LIMIT || '5');
const MODULE_TIMEOUT = parseInt(process.env.MODULE_TIMEOUT || '30000');
const RETRY_ENABLED = process.env.RETRY_ENABLED !== 'false';
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

// --- JOB PROCESSOR FUNCTION ---
// This function contains the logic that was previously in BatchSiteProcessor.executeSiteAudit
// It is now called by the BullMQ worker for each job.
/**
 * Check if GAM data is available for a publisher
 * @param {string} publisherId - Publisher UUID
 * @param {string} dataSource - 'historical' or 'dimensional'
 * @returns {Promise<{hasData: boolean, count: number}>}
 */
async function checkGAMDataAvailable(publisherId, dataSource = 'dimensional') {
  try {
    const tableName = dataSource === 'historical' ? 'report_historical' : 'reports_dimensional';

    const { count, error } = await supabase.supabaseClient
      .from(tableName)
      .select('*', { count: 'exact', head: true })
      .eq('publisher_id', publisherId);

    if (error) {
      logger.error(`Error checking GAM data in ${tableName}:`, error);
      return { hasData: false, count: 0 };
    }

    return { hasData: count > 0, count };
  } catch (err) {
    logger.error(`Exception checking GAM data:`, err);
    return { hasData: false, count: 0 };
  }
}

async function processAuditJob(job) {
  const { siteAudit, jobId, publisherId, requestId, triggeredBy } = job.data;
  const siteStartTime = Date.now();

  // Determine which GAM data source to use
  const isNewPublisher = triggeredBy === 'new_publisher_edge_function' || triggeredBy === 'bulk_upload';
  const gamDataSource = isNewPublisher ? 'historical' : 'dimensional';

  logger.info(`[${requestId}] Processing job ${job.id} for site ${siteAudit.site_name}`, {
    jobId,
    publisherId,
    siteName: siteAudit.site_name,
    requestId,
    triggeredBy,
    gamDataSource
  });

  try {
    // Ensure parent audit_queue record exists (handling migration/compatibility)
    // The jobId comes from audit_job_queue, but site_audits references audit_queue
    // Ensure parent audit_queue record exists (handling migration/compatibility)
    // The jobId comes from audit_job_queue, but site_audits references audit_queue
    try {
      const { data: existingJob, error: fetchError } = await supabase.supabaseClient
        .from('audit_queue')
        .select('id')
        .eq('id', jobId)
        .maybeSingle(); // Use maybeSingle to avoid throwing on not found

      if (fetchError) throw fetchError;

      if (!existingJob) {
        logger.info(`[${requestId}] Creating missing parent audit_queue record for ${jobId}`);
        const { error: insertError } = await supabase.supabaseClient.from('audit_queue').insert({
          id: jobId,
          publisher_id: publisherId,
          sites: [siteAudit.site_name],
          status: 'running', // 'processing' is not allowed by check constraint, use 'running'
          queued_at: new Date().toISOString()
        });

        if (insertError) {
          logger.warn(`[${requestId}] Failed to create parent audit_queue record: ${insertError.message}`);
        }
      }
    } catch (checkErr) {
      logger.warn(`[${requestId}] Error checking/creating parent audit_queue record`, checkErr);
      // Continue anyway, as the foreign key might be removed or we might be lucky
    }

    const siteAuditRecord = {
      audit_queue_id: jobId,
      publisher_id: publisherId,
      site_name: siteAudit.site_name,
      site_url: siteAudit.site_url || siteAudit.site_name, // Ensure site_url is populated
      status: 'processing',
      started_at: new Date().toISOString(),
    };

    // Clean up any stale 'processing' audits for this site to prevent duplicates in UI
    try {
      await supabase.supabaseClient
        .from('site_audits')
        .update({
          status: 'cancelled',
          error_message: 'Superceded by new audit request',
          completed_at: new Date().toISOString()
        })
        .eq('publisher_id', publisherId)
        .eq('site_name', siteAudit.site_name)
        .eq('status', 'processing');

      logger.info(`[${requestId}] Cancelled stale processing audits for ${siteAudit.site_name}`);
    } catch (cleanupErr) {
      logger.warn(`[${requestId}] Failed to cleanup stale audits`, cleanupErr);
    }

    let siteAuditId;
    try {
      // Use supabase.supabaseClient for raw access to avoid wrapper issues
      const { data: result, error: insertError } = await supabase.supabaseClient
        .from('site_audits')
        .insert(siteAuditRecord)
        .select();

      if (insertError) throw insertError;

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

    // Check if site is reachable before attempting full crawl
    const siteUrl = siteAudit.site_url || siteAudit.site_name;
    const normalizedUrl = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;

    try {
      const axios = require('axios');
      const reachabilityCheck = await axios.head(normalizedUrl, {
        timeout: 10000,
        maxRedirects: 5,
        validateStatus: (status) => status < 500, // Accept any status < 500
      });
      logger.info(`[${requestId}] Site reachability check passed`, {
        url: normalizedUrl,
        status: reachabilityCheck.status,
      });
    } catch (reachError) {
      const isNotLive = reachError.code === 'ENOTFOUND' ||
        reachError.code === 'ECONNREFUSED' ||
        reachError.code === 'ETIMEDOUT' ||
        reachError.code === 'ECONNRESET' ||
        reachError.response?.status >= 500;

      if (isNotLive) {
        logger.warn(`[${requestId}] Site is NOT LIVE: ${siteUrl}`, {
          error: reachError.message,
          code: reachError.code,
        });

        // Update audit record with site_not_live status
        await supabase.supabaseClient
          .from('site_audits')
          .update({
            status: 'site_not_live',
            error_message: `Site is not reachable: ${reachError.code || reachError.message}`,
            risk_level: 'unknown',
            completed_at: new Date().toISOString(),
          })
          .eq('id', siteAuditId);

        logger.info(`[${requestId}] Marked site as not live in database`, { siteAuditId, siteUrl });
        return { success: false, reason: 'site_not_live', siteUrl };
      }
      // For other errors (like redirects), continue with crawl
      logger.warn(`[${requestId}] Reachability check had non-fatal error, continuing`, {
        error: reachError.message,
      });
    }

    // Use DirectoryAuditOrchestrator to run the audit
    const orchestratorResult = await directoryAuditOrchestrator.runDirectoryAwareAudit(
      {
        id: publisherId,
        site_url: siteUrl,
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

    // ✅ Calculate Data Quality Metrics
    let dataQuality = calculateDataQuality(modules, mainSiteCrawlData);
    logger.info(`[${requestId}] Data Quality Assessment:`, {
      score: dataQuality.score,
      level: dataQuality.level,
      isComplete: dataQuality.isComplete,
      metricsCollected: dataQuality.metricsCollected,
      failures: dataQuality.failures
    });

    // 🔄 Retry failed modules if data quality is critical (3+ failures)
    if (dataQuality.level === 'critical' && dataQuality.failures.length >= 3) {
      logger.warn(`[${requestId}] Critical data quality detected, attempting module recovery...`, {
        failureCount: dataQuality.failures.length,
        failedModules: dataQuality.failures.map(f => f.module)
      });

      try {
        // Re-run technical check if it failed (most common failure)
        if (!dataQuality.metricsCollected.technical && modules.technicalChecker?.data) {
          const domain = new URL(siteAudit.site_name.startsWith('http') ? siteAudit.site_name : `https://${siteAudit.site_name}`).hostname;
          logger.info(`[${requestId}] Retrying technical check for ${domain}`);

          const retryTechnical = await technicalChecker.runTechnicalHealthCheck(
            mainSiteCrawlData,
            domain,
            { enableLighthouse: true, lighthouseThreshold: 40 }
          );

          if (retryTechnical?.performance?.performanceScore > 0 || retryTechnical?.technicalHealthScore > 0) {
            modules.technicalChecker.data = retryTechnical;
            modules.technicalChecker.retried = true;
            logger.info(`[${requestId}] Technical check retry successful`, {
              performanceScore: retryTechnical.performance?.performanceScore,
              healthScore: retryTechnical.technicalHealthScore
            });
          }
        }

        // Re-run content analysis if it failed and we have content
        if (!dataQuality.metricsCollected.content && mainSiteCrawlData?.content) {
          const contentText = Array.isArray(mainSiteCrawlData.content)
            ? mainSiteCrawlData.content.join(' ')
            : mainSiteCrawlData.content;

          if (contentText && contentText.length > 50) {
            logger.info(`[${requestId}] Retrying content analysis with ${contentText.length} chars`);

            const retryContent = await contentAnalyzer.analyzeContent(contentText);

            if (retryContent && (retryContent.textLength > 50 || retryContent.entropy?.entropyScore > 0)) {
              modules.contentAnalyzer.data = retryContent;
              modules.contentAnalyzer.retried = true;
              logger.info(`[${requestId}] Content analysis retry successful`, {
                textLength: retryContent.textLength,
                entropyScore: retryContent.entropy?.entropyScore
              });
            }
          }
        }

        // Recalculate data quality after retries
        const updatedQuality = calculateDataQuality(modules, mainSiteCrawlData);
        logger.info(`[${requestId}] Data quality after retry:`, {
          before: { score: dataQuality.score, level: dataQuality.level },
          after: { score: updatedQuality.score, level: updatedQuality.level }
        });

        dataQuality = updatedQuality;

      } catch (retryError) {
        logger.error(`[${requestId}] Module retry failed`, retryError);
        // Continue with original data quality assessment
      }
    }

    // DEBUG: Log content analysis data
    logger.info('[DEBUG] Content Analysis Data:', {
      hasData: !!modules.contentAnalyzer.data,
      textLength: modules.contentAnalyzer.data?.textLength || 0,
      entropyScore: modules.contentAnalyzer.data?.entropy?.entropyScore || 0,
      readabilityScore: modules.contentAnalyzer.data?.readability?.readabilityScore || 0,
      aiLikelihood: modules.contentAnalyzer.data?.ai?.aiLikelihood || false,
      clickbaitScore: modules.contentAnalyzer.data?.clickbait?.clickbaitScore || 0
    });

    // DEBUG: Log ad analysis data
    logger.info('[DEBUG] Ad Analysis Data:', {
      hasData: !!modules.adAnalyzer.data,
      totalAds: modules.adAnalyzer.data?.summary?.totalAds || 0,
      adDensity: modules.adAnalyzer.data?.summary?.adDensity || 0,
      videoPlayerCount: modules.adAnalyzer.data?.summary?.videoPlayerCount || 0,
      suspiciousPatterns: modules.adAnalyzer.data?.summary?.suspiciousPatterns || 0
    });

    // DEBUG: Log technical check data
    logger.info('[DEBUG] Technical Check Data:', {
      hasData: !!modules.technicalChecker.data,
      pageLoadTime: modules.technicalChecker.data?.performance?.pageLoadTime || 0,
      ttfb: modules.technicalChecker.data?.performance?.metrics?.TTFB || 0,
      lcp: modules.technicalChecker.data?.performance?.metrics?.LCP || 0,
      cls: modules.technicalChecker.data?.performance?.metrics?.CLS || 0
    });

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
        logger.info(`[${requestId}] Enriching audit data with GAM metrics from ${gamDataSource}`, {
          publisherId,
          requestId,
          dataSource: gamDataSource
        });
        scorerInput = await scorer.enrichAuditDataWithGAM(scorerInput, publisherId, gamDataSource);
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
        const result = await scorer.calculateComprehensiveScore(scorerInput, { id: publisherId }, { dataQuality });
        return result;
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
          // Construct context data for robust fallback
          const contextData = {
            url: siteAudit.site_name,
            networkFindings: modules.adAnalyzer.data?.adNetworks || [],
            adBehavior: {
              popups: modules.adAnalyzer.data?.popups || false,
              redirects: modules.adAnalyzer.data?.redirects || false
            },
            contentIndicators: {
              // Fix: Access the correct property paths for entropy and AI likelihood
              textEntropy: modules.contentAnalyzer.data?.entropy?.entropyScore ||
                modules.contentAnalyzer.data?.entropyScore || 0,
              aiLikelihood: modules.contentAnalyzer.data?.ai?.aiScore ||
                modules.contentAnalyzer.data?.aiLikelihood?.percentage ||
                modules.contentAnalyzer.data?.aiLikelihood || 0
            },
            performance: {
              lcp: modules.crawler.data?.metrics?.coreLWP?.lcp || 0
            },
            seo: {
              title: modules.contentAnalyzer.data?.seo?.title || ''
            }
          };

          const result = await aiAssistance.generateComprehensiveReport(
            { domain: siteAudit.site_name },
            { ...scorerResult.data, directoryContext: aggregatedResults },
            modules.policyChecker.data?.issues || [],
            siteAuditId,
            publisherId,
            contextData
          );
          return result;
        } catch (err) {
          logger.warn(`[${requestId}] AI Assistance failed, using fallback`, { error: err.message, requestId });
          throw err; // Let executeWithRetry handle the error
        }
      },
      {},
      requestId
    );

    modules.aiAssistance = aiResult;

    const scorerData = modules.scorer.data || {};

    // DEBUG: Log scorer data structure to diagnose NULL fields
    logger.info('[DEBUG] Scorer Data Structure:', {
      hasRiskScore: !!scorerData.riskScore,
      hasMfaProbability: !!scorerData.mfaProbability,
      hasExplanation: !!scorerData.explanation,
      hasExplanationRiskLevel: !!scorerData.explanation?.riskLevel,
      riskScoreValue: scorerData.riskScore,
      mfaProbabilityValue: scorerData.mfaProbability,
      riskLevelValue: scorerData.explanation?.riskLevel
    });

    // Debug AI Result Structure
    logger.info('[DEBUG] AI Result Structure:', {
      hasData: !!aiResult.data,
      hasError: !!aiResult.error,
      dataKeys: aiResult.data ? Object.keys(aiResult.data) : [],
      hasLlmResponse: !!aiResult.data?.llmResponse,
      llmResponseLength: aiResult.data?.llmResponse?.length || 0,
      hasInterpretation: !!aiResult.data?.interpretation,
      interpretationKeys: aiResult.data?.interpretation ? Object.keys(aiResult.data.interpretation) : [],
      interpretationPreview: aiResult.data?.interpretation ?
        (typeof aiResult.data.interpretation === 'string' ?
          aiResult.data.interpretation.substring(0, 100) :
          JSON.stringify(aiResult.data.interpretation).substring(0, 100)) : null
    });

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
      ai_report: (aiResult.data && aiResult.data.interpretation) ? {
        llmResponse: typeof aiResult.data.llmResponse === 'string' ? aiResult.data.llmResponse : '',
        interpretation: aiResult.data.interpretation,
        timestamp: aiResult.data.timestamp || new Date().toISOString(),
        metadata: aiResult.data.metadata || {}
      } : {
        error: aiResult.error || 'AI analysis failed or returned no data',
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
      // ✅ Data Quality Fields
      data_quality_score: dataQuality.score,
      metrics_collected: dataQuality.metricsCollected,
      is_complete: dataQuality.isComplete,
      collection_failures: dataQuality.failures,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // DEBUG: Log what's being saved (using console.log to bypass verbosity filters)
    console.log('[DEBUG] Saving to database:', JSON.stringify({
      risk_score: completedAudit.risk_score,
      mfa_probability: completedAudit.mfa_probability,
      risk_level: completedAudit.risk_level,
      ai_report_keys: completedAudit.ai_report ? Object.keys(completedAudit.ai_report) : [],
      ai_report_interpretation_keys: completedAudit.ai_report?.interpretation ? Object.keys(completedAudit.ai_report.interpretation) : [],
      ai_report_parsed_findings: !!completedAudit.ai_report?.interpretation?.parsedFindings
    }, null, 2));

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

      // ✅ Save to audit_data_quality table for detailed per-module tracking
      if (dataQualityDb) {
        try {
          await dataQualityDb.saveDataQuality(siteAuditId, publisherId, dataQuality, modules);
          logger.info(`[${requestId}] ✅ Saved to audit_data_quality table`);
        } catch (dqErr) {
          logger.warn(`[${requestId}] Failed to save to audit_data_quality table`, { error: dqErr.message });
        }
      }

      // Cross-Module Comparison is already handled in moduleDataOrchestrator.saveAllModuleResults
      // Removing redundant call to prevent double execution

    } catch (updateErr) {
      logger.error(`[${requestId}] Failed to update site audit with final results`, updateErr, { requestId });
      throw updateErr;
    }

    // ✅ Update Publisher MFA Score
    logger.info(`[${requestId}] Attempting to update publisher MFA score`, {
      publisherId,
      hasMfaProbability: completedAudit.mfa_probability !== null && completedAudit.mfa_probability !== undefined,
      mfaProbabilityValue: completedAudit.mfa_probability,
      riskScore: completedAudit.risk_score
    });

    if (publisherId && (completedAudit.mfa_probability !== null && completedAudit.mfa_probability !== undefined)) {
      try {
        const mfaScore = Math.round(completedAudit.mfa_probability * 100);
        logger.info(`[${requestId}] Updating publisher ${publisherId} with MFA score: ${mfaScore}%`);

        const { error: pubUpdateError } = await supabase.supabaseClient
          .from('publishers')
          .update({
            mfa_score: mfaScore,
            last_audit_at: new Date().toISOString()
          })
          .eq('id', publisherId);

        if (pubUpdateError) {
          logger.error(`[${requestId}] Database error updating publisher MFA score:`, pubUpdateError);
        } else {
          logger.info(`[${requestId}] ✅ Successfully updated publisher ${publisherId} MFA score to ${mfaScore}%`);
        }

        // 🚨 Send Email Alert if MFA probability exceeds threshold (70%)
        const MFA_ALERT_THRESHOLD = 0.70;
        if (completedAudit.mfa_probability >= MFA_ALERT_THRESHOLD) {
          try {
            logger.info(`[${requestId}] 🚨 MFA detected above ${MFA_ALERT_THRESHOLD * 100}% threshold, triggering email alerts`);

            const notificationDispatcher = require('../modules/alert-engine/notification-dispatcher');

            // Get publisher details including partner
            const { data: publisherData } = await supabase.supabaseClient
              .from('publishers')
              .select('partner_id, primary_domain, name, contact_email')
              .eq('id', publisherId)
              .single();

            // Collect all recipients (partner + admins)
            const recipients = [];

            // 1. Get partner email (the partner assigned to this publisher)
            if (publisherData?.partner_id) {
              const { data: partnerData } = await supabase.supabaseClient
                .from('app_users')
                .select('email, full_name, role')
                .eq('id', publisherData.partner_id)
                .eq('status', 'active')
                .single();

              if (partnerData?.email) {
                recipients.push({
                  email: partnerData.email,
                  name: partnerData.full_name,
                  role: partnerData.role,
                  type: 'partner'
                });
              }
            }

            // 2. Get all admin and super_admin users
            const { data: adminUsers } = await supabase.supabaseClient
              .from('app_users')
              .select('email, full_name, role')
              .in('role', ['admin', 'super_admin'])
              .eq('status', 'active');

            if (adminUsers && adminUsers.length > 0) {
              for (const admin of adminUsers) {
                if (admin.email && !recipients.find(r => r.email === admin.email)) {
                  recipients.push({
                    email: admin.email,
                    name: admin.full_name,
                    role: admin.role,
                    type: 'admin'
                  });
                }
              }
            }

            if (recipients.length > 0) {
              const alertData = {
                id: `mfa-alert-${siteAuditId}`,
                alert_type: 'MFA_DETECTED',
                severity: mfaScore >= 90 ? 'critical' : mfaScore >= 80 ? 'high' : 'medium',
                message: `MFA detected with ${mfaScore}% probability on ${siteAudit.site_name}`,
                metadata: {
                  mfa_probability: completedAudit.mfa_probability,
                  risk_score: completedAudit.risk_score,
                  risk_level: completedAudit.risk_level,
                  site_url: siteAudit.site_name,
                  audit_id: siteAuditId,
                  primary_causes: completedAudit.primary_causes,
                  safe_browsing: modules.technicalChecker?.data?.components?.safeBrowsing?.status || 'unknown'
                },
                created_at: new Date().toISOString()
              };

              const publisherInfo = {
                name: publisherData?.name || 'Unknown Publisher',
                primary_domain: publisherData?.primary_domain || siteAudit.site_name
              };

              // Send email to each recipient
              let successCount = 0;
              for (const recipient of recipients) {
                try {
                  const emailResult = await notificationDispatcher.dispatchEmail(alertData, publisherInfo, recipient.email);
                  if (emailResult.success) {
                    successCount++;
                    logger.info(`[${requestId}] ✅ MFA alert sent to ${recipient.type} (${recipient.role}): ${recipient.email}`);
                  } else {
                    logger.warn(`[${requestId}] Failed to send MFA alert to ${recipient.email}: ${emailResult.error}`);
                  }
                } catch (emailErr) {
                  logger.warn(`[${requestId}] Error sending to ${recipient.email}:`, emailErr.message);
                }
              }

              logger.info(`[${requestId}] 📧 MFA alerts sent: ${successCount}/${recipients.length} recipients`);
            } else {
              logger.warn(`[${requestId}] No recipients found for MFA alert (no partner or admins configured)`);
            }
          } catch (alertError) {
            logger.error(`[${requestId}] Failed to send MFA alert emails`, alertError);
            // Don't fail the audit if email notification fails
          }
        }

      } catch (pubUpdateErr) {
        logger.error(`[${requestId}] Failed to update publisher MFA score`, pubUpdateErr, { requestId });
        // Don't fail the job if just this update fails
      }
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

async function pollAuditJobQueue() {
  try {
    // 1. Fetch pending jobs
    // Use supabase.supabaseClient to access the raw Supabase client
    const { data: jobs, error } = await supabase.supabaseClient
      .from('audit_job_queue')
      .select('*')
      .eq('status', 'pending')
      .limit(5);

    if (error) {
      // Ignore "relation does not exist" errors if table is missing/being restored
      if (!error.message.includes('relation "audit_job_queue" does not exist')) {
        logger.error('Error fetching pending audit jobs', error);
      }
      return;
    }

    if (!jobs || jobs.length === 0) return;

    logger.info(`Found ${jobs.length} pending audit jobs in queue`);

    for (const job of jobs) {
      const { id, publisher_id, sites, triggered_by } = job;
      const requestId = uuidv4();

      // Determine data source based on trigger type
      const isNewPublisher = triggered_by === 'new_publisher_edge_function' || triggered_by === 'bulk_upload';
      const gamDataSource = isNewPublisher ? 'historical' : 'dimensional';

      // ✅ Validate GAM data is available in the correct table
      const { hasData, count } = await checkGAMDataAvailable(publisher_id, gamDataSource);

      if (!hasData) {
        logger.warn(
          `[${requestId}] Skipping job ${id} - No GAM data in ${gamDataSource} table for publisher ${publisher_id}. ` +
          `Waiting for ${isNewPublisher ? 'historical' : 'daily'} data fetch.`
        );

        await supabase.supabaseClient
          .from('audit_job_queue')
          .update({
            last_error: `Waiting for GAM ${gamDataSource} data`,
            updated_at: new Date().toISOString()
          })
          .eq('id', id);

        continue;
      }

      logger.info(`[${requestId}] GAM data check passed (${count} records in ${gamDataSource})`);

      // 2. Mark as processing
      await supabase.supabaseClient
        .from('audit_job_queue')
        .update({ status: 'processing', started_at: new Date().toISOString() })
        .eq('id', id);

      try {
        // 3. Queue individual sites
        const siteList = Array.isArray(sites) ? sites : [];

        logger.info(`[${requestId}] Processing batch job ${id} with ${siteList.length} sites`);

        for (const site of siteList) {
          let siteName = null;

          if (typeof site === 'string') {
            // Check if it's a JSON string
            if (site.trim().startsWith('{')) {
              try {
                const parsed = JSON.parse(site);
                siteName = parsed.site_name || parsed.url || parsed.name;
              } catch (e) {
                siteName = site; // Fallback to raw string if parse fails
              }
            } else {
              siteName = site;
            }
          } else if (typeof site === 'object' && site !== null) {
            siteName = site.site_name || site.url || site.name;
          }

          if (!siteName) continue;

          const siteAudit = { site_name: siteName, status: 'pending' };

          // Add to internal in-memory queue
          await auditQueue.add(
            `audit-${siteName}`,
            {
              siteAudit,
              jobId: id,
              publisherId: publisher_id,
              requestId,
              triggeredBy: triggered_by // ✅ Pass triggeredBy to job data
            }
          );
        }

        // 4. Mark job as completed (handed off)
        await supabase.supabaseClient
          .from('audit_job_queue')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', id);

        logger.info(`[${requestId}] Batch job ${id} successfully queued to internal worker`);

      } catch (err) {
        logger.error(`[${requestId}] Failed to process batch job ${id}`, err);
        await supabase.supabaseClient
          .from('audit_job_queue')
          .update({ status: 'failed', last_error: err.message })
          .eq('id', id);
      }
    }
  } catch (err) {
    logger.error('Unexpected error in audit queue poller', err);
  }
}

// Start polling loop (every 10 seconds)
setInterval(pollAuditJobQueue, 10000);

// Auto-shutdown logic: exit if idle for 5 minutes
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
let lastActivityTime = Date.now();

// Log startup version to verify deployment
logger.info('🚀 Site Monitoring Worker v2.1 - Starting up (FK Fix + Auto-Wake)');

async function updateActivity() {
  lastActivityTime = Date.now();
}

// Check for idle timeout every minute
setInterval(() => {
  const idleTime = Date.now() - lastActivityTime;
  if (idleTime > IDLE_TIMEOUT_MS) {
    logger.info(`No activity for ${Math.round(idleTime / 60000)} minutes. Idle state.`);
    // On Render with Scale to Zero, we don't need to exit manually.
    // Render will automatically spin down the service if there are no HTTP requests.
    // However, since we are processing background jobs, we want to ensure we don't exit while working.
    // The activity update logic ensures we are "active" while processing.
    // If we are truly idle (no jobs, no HTTP), we just wait.
    // If the user wants to force a shutdown to save costs on non-Scale-to-Zero plans,
    // they can uncomment the line below, but it causes "Instance failed" logs on Render.
    // process.exit(0); 
  }
}, 60000);

// Update activity when jobs are processed
const originalPollFunction = pollAuditJobQueue;
pollAuditJobQueue = async function () {
  const result = await originalPollFunction();
  updateActivity();
  return result;
};

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
