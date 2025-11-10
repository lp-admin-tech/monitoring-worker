const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { envConfig, validateConfig } = require('../modules/env-config');
const logger = require('../modules/logger');
const supabase = require('../modules/supabase-client');

const WORKER_SECRET = process.env.WORKER_SECRET || '';
const ALERT_FUNCTION_URL =
  process.env.ALERT_FUNCTION_URL ||
  'https://your-supabase-url.functions.supabase.co/send-alert-email';
const RISK_THRESHOLD = parseInt(process.env.ALERT_RISK_THRESHOLD || '75');

const app = express();
app.use(express.json());

function verifyWebhookSignature(payload, signature) {
  if (!WORKER_SECRET) {
    logger.warn('WORKER_SECRET not configured, skipping signature verification');
    return true;
  }

  const expectedSignature = crypto
    .createHmac('sha256', WORKER_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expectedSignature)
  );
}

async function notifyAdminOfHighRiskAudit(jobResult) {
  try {
    if (jobResult.riskScore < RISK_THRESHOLD) {
      return;
    }

    logger.info('Notifying admin of high-risk audit', {
      publisherId: jobResult.publisherId,
      riskScore: jobResult.riskScore,
    });

    const alertPayload = {
      publisher_id: jobResult.publisherId,
      risk_score: jobResult.riskScore,
      alert_type: 'high_risk_audit',
      findings: jobResult.findings || [],
      timestamp: new Date().toISOString(),
    };

    const response = await fetch(ALERT_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY || ''}`,
      },
      body: JSON.stringify(alertPayload),
    });

    if (!response.ok) {
      logger.warn(`Alert function returned ${response.status}`, {
        status: response.status,
        publisherId: jobResult.publisherId,
      });
    } else {
      logger.info('Admin notification sent successfully', {
        publisherId: jobResult.publisherId,
      });
    }
  } catch (error) {
    logger.error('Failed to notify admin of high-risk audit', error, {
      publisherId: jobResult.publisherId,
    });
  }
}

async function updateAuditQueueStatus(jobId, status, result) {
  try {
    const updates = {
      status,
      completed_at: new Date().toISOString(),
    };

    if (result?.error) {
      updates.error_message = result.error;
    }

    await supabase.update('audit_queue', jobId, updates);

    logger.info(`Updated audit queue status for job ${jobId}`, {
      jobId,
      status,
    });
  } catch (error) {
    logger.error(`Failed to update audit queue status for job ${jobId}`, error, { jobId });
  }
}

async function storeAuditFailure(jobId, publisherId, module, error) {
  try {
    await supabase.insert('audit_failures', {
      publisher_id: publisherId,
      module,
      error_message: error.message || error,
      error_stack: error.stack,
      failure_timestamp: new Date().toISOString(),
      job_id: jobId,
    });

    logger.info(`Stored failure record for job ${jobId}`, {
      jobId,
      publisherId,
      module,
    });
  } catch (error) {
    logger.error(`Failed to store failure record for job ${jobId}`, error, { jobId });
  }
}

async function processCompletionEvent(jobResult, requestId) {
  try {
    logger.info(`Processing completion event for job ${jobResult.jobId}`, {
      jobId: jobResult.jobId,
      publisherId: jobResult.publisherId,
      status: jobResult.status,
      requestId,
    });

    if (jobResult.status === 'failed') {
      await updateAuditQueueStatus(jobResult.jobId, 'failed', {
        error: jobResult.error,
      });

      await storeAuditFailure(
        jobResult.jobId,
        jobResult.publisherId,
        'full_pipeline',
        jobResult.error || 'Unknown error'
      );

      logger.error(`Audit job ${jobResult.jobId} completed with failure`, jobResult.error, {
        jobId: jobResult.jobId,
        publisherId: jobResult.publisherId,
        requestId,
      });

      return {
        success: true,
        handled: true,
        status: 'failed',
        reason: jobResult.error,
      };
    }

    const completionData = {
      job_id: jobResult.jobId,
      publisher_id: jobResult.publisherId,
      status: 'completed',
      risk_score: jobResult.modules?.scorer?.data?.riskScore || 0,
      completion_timestamp: new Date().toISOString(),
      result_summary: {
        crawlerSuccess: jobResult.modules?.crawler?.success,
        analysisModulesSuccess: [
          jobResult.modules?.contentAnalyzer?.success,
          jobResult.modules?.adAnalyzer?.success,
          jobResult.modules?.policyChecker?.success,
          jobResult.modules?.technicalChecker?.success,
        ].filter(v => v !== undefined),
        scorerSuccess: jobResult.modules?.scorer?.success,
        aiReportSuccess: jobResult.modules?.aiAssistance?.success,
      },
      findings: jobResult.modules?.scorer?.data?.findings || [],
      ai_recommendations: jobResult.modules?.aiAssistance?.data?.recommendations || [],
    };

    await updateAuditQueueStatus(jobResult.jobId, 'completed', completionData);

    if (
      jobResult.modules?.scorer?.data?.riskScore &&
      jobResult.modules.scorer.data.riskScore >= RISK_THRESHOLD
    ) {
      await notifyAdminOfHighRiskAudit({
        jobId: jobResult.jobId,
        publisherId: jobResult.publisherId,
        riskScore: jobResult.modules.scorer.data.riskScore,
        findings: jobResult.modules.scorer.data.findings,
      });
    }

    logger.info(`Completion event processed successfully for job ${jobResult.jobId}`, {
      jobId: jobResult.jobId,
      publisherId: jobResult.publisherId,
      riskScore: completionData.risk_score,
      requestId,
    });

    return {
      success: true,
      handled: true,
      status: 'completed',
      riskScore: completionData.risk_score,
    };
  } catch (error) {
    logger.error(
      `Failed to process completion event for job ${jobResult.jobId}`,
      error,
      {
        jobId: jobResult.jobId,
        publisherId: jobResult.publisherId,
        requestId,
      }
    );

    return {
      success: false,
      handled: false,
      error: error.message,
    };
  }
}

app.post('/webhook/audit-completion', async (req, res) => {
  const requestId = uuidv4();
  const { signature } = req.headers;

  logger.info(`Received audit completion webhook`, {
    requestId,
    hasSignature: !!signature,
  });

  try {
    if (!verifyWebhookSignature(req.body, signature)) {
      logger.warn(`Invalid webhook signature`, { requestId });
      return res.status(401).json({
        success: false,
        error: 'Invalid signature',
        requestId,
      });
    }

    const { jobResult } = req.body;

    if (!jobResult || !jobResult.jobId || !jobResult.publisherId) {
      logger.warn(`Invalid webhook payload`, { requestId });
      return res.status(400).json({
        success: false,
        error: 'Missing required fields in webhook payload',
        requestId,
      });
    }

    const result = await processCompletionEvent(jobResult, requestId);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error,
        requestId,
      });
    }

    res.json({
      success: true,
      handled: result.handled,
      status: result.status,
      requestId,
    });
  } catch (error) {
    logger.error(`Webhook handler error`, error, { requestId });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      requestId,
    });
  }
});

app.post('/webhook/audit-failure', async (req, res) => {
  const requestId = uuidv4();
  const { signature } = req.headers;

  logger.info(`Received audit failure webhook`, {
    requestId,
    hasSignature: !!signature,
  });

  try {
    if (!verifyWebhookSignature(req.body, signature)) {
      logger.warn(`Invalid webhook signature`, { requestId });
      return res.status(401).json({
        success: false,
        error: 'Invalid signature',
        requestId,
      });
    }

    const { jobId, publisherId, module, error, stackTrace } = req.body;

    if (!jobId || !publisherId) {
      logger.warn(`Invalid failure webhook payload`, { requestId });
      return res.status(400).json({
        success: false,
        error: 'Missing required fields in webhook payload',
        requestId,
      });
    }

    logger.info(`Processing failure event for job ${jobId}`, {
      jobId,
      publisherId,
      module,
      requestId,
    });

    await storeAuditFailure(jobId, publisherId, module || 'unknown', {
      message: error,
      stack: stackTrace,
    });

    await updateAuditQueueStatus(jobId, 'failed', {
      error: error || 'Unknown error',
    });

    res.json({
      success: true,
      handled: true,
      requestId,
    });
  } catch (error) {
    logger.error(`Failure webhook handler error`, error, { requestId });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      requestId,
    });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    riskThreshold: RISK_THRESHOLD,
    timestamp: new Date().toISOString(),
  });
});

app.get('/stats', async (req, res) => {
  try {
    const recentFailures = await supabase.query('audit_failures', null);
    const recentQueue = await supabase.query('audit_queue', null);

    const stats = {
      totalFailures: recentFailures?.length || 0,
      totalQueued: recentQueue?.length || 0,
      queueStatusDistribution: {
        pending: recentQueue?.filter(j => j.status === 'pending').length || 0,
        running: recentQueue?.filter(j => j.status === 'running').length || 0,
        completed: recentQueue?.filter(j => j.status === 'completed').length || 0,
        failed: recentQueue?.filter(j => j.status === 'failed').length || 0,
      },
      timestamp: new Date().toISOString(),
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Failed to retrieve statistics', error);

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve statistics',
    });
  }
});

async function start() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed', new Error(errors.join(', ')));
    process.exit(1);
  }

  const PORT = parseInt(process.env.WEBHOOK_HANDLER_PORT || '9002');

  app.listen(PORT, () => {
    logger.info(`Webhook handler started on port ${PORT}`, {
      port: PORT,
      riskThreshold: RISK_THRESHOLD,
      signatureVerificationEnabled: !!WORKER_SECRET,
    });
  });
}

if (require.main === module) {
  start().catch(err => {
    logger.error('Failed to start webhook handler', err);
    process.exit(1);
  });
}

module.exports = { app };
