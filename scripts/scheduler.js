const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { envConfig, validateConfig } = require('../modules/env-config');
const logger = require('../modules/logger');
const supabase = require('../modules/supabase-client');

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:9001';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const BATCH_SIZE = parseInt(process.env.SCHEDULER_BATCH_SIZE || '5');
const RATE_LIMIT_DELAY = parseInt(process.env.SCHEDULER_RATE_LIMIT_DELAY || '2000');

class SchedulerManager {
  constructor() {
    this.tasks = new Map();
    this.executionLog = new Map();
    this.circuitBreakers = new Map();
    this.isRunning = false;
  }

  async initialize() {
    const errors = validateConfig();
    if (errors.length > 0) {
      throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
    }

    logger.info('Scheduler initialized', {
      workerUrl: WORKER_URL,
      batchSize: BATCH_SIZE,
      rateLimitDelay: RATE_LIMIT_DELAY,
    });

    this.isRunning = true;
  }

  async loadPublisherSchedules() {
    try {
      const schedules = await supabase.query('publisher_schedules', {
        enabled: true,
      });

      if (!schedules || schedules.length === 0) {
        logger.info('No active publisher schedules found');
        return [];
      }

      logger.info(`Loaded ${schedules.length} active publisher schedules`, {
        scheduleCount: schedules.length,
      });

      return schedules;
    } catch (error) {
      logger.error('Failed to load publisher schedules', error);
      return [];
    }
  }

  async getPublishersDueForAudit(schedule) {
    try {
      const lastRun = schedule.last_run_at ? new Date(schedule.last_run_at) : new Date(0);
      const now = new Date();
      const intervalMs = schedule.interval_ms || 24 * 60 * 60 * 1000;

      const publishers = await supabase.query('publishers', {
        enabled: true,
      });

      if (!publishers || publishers.length === 0) {
        return [];
      }

      const duePublishers = publishers.filter(pub => {
        const lastAudit = pub.last_audit_at ? new Date(pub.last_audit_at) : new Date(0);
        const timeSinceAudit = now.getTime() - lastAudit.getTime();
        return timeSinceAudit >= intervalMs;
      });

      logger.info(`Found ${duePublishers.length} publishers due for audit`, {
        scheduleId: schedule.id,
        totalPublishers: publishers.length,
        duePublishers: duePublishers.length,
      });

      return duePublishers;
    } catch (error) {
      logger.error('Failed to get publishers due for audit', error, {
        scheduleId: schedule.id,
      });
      return [];
    }
  }

  getPriorityWeight(publisher) {
    const riskScore = publisher.current_risk_score || 0;
    const lastAuditDays =
      (Date.now() - (publisher.last_audit_at ? new Date(publisher.last_audit_at) : 0)) /
      (1000 * 60 * 60 * 24);

    const riskWeight = riskScore > 75 ? 2 : riskScore > 50 ? 1.5 : 1;
    const ageWeight = lastAuditDays > 30 ? 1.5 : 1;

    return riskWeight * ageWeight;
  }

  async getPublisherSites(publisherId) {
    try {
      const sites = await supabase.query('publisher_sites', {
        publisher_id: publisherId,
        enabled: true,
      });

      return sites || [];
    } catch (error) {
      logger.error('Failed to get publisher sites', error, { publisherId });
      return [];
    }
  }

  isCircuitBreakerTripped(publisherId) {
    const breaker = this.circuitBreakers.get(publisherId);

    if (!breaker) {
      return false;
    }

    if (breaker.failures >= 3) {
      const timeSinceLast = Date.now() - breaker.lastFailure;
      const resetTime = 60 * 60 * 1000;

      if (timeSinceLast < resetTime) {
        logger.warn(`Circuit breaker tripped for publisher ${publisherId}`, {
          failures: breaker.failures,
          timeSinceReset: timeSinceLast,
        });
        return true;
      } else {
        this.circuitBreakers.delete(publisherId);
        return false;
      }
    }

    return false;
  }

  recordFailure(publisherId) {
    const breaker = this.circuitBreakers.get(publisherId) || {
      failures: 0,
      lastFailure: 0,
    };

    breaker.failures += 1;
    breaker.lastFailure = Date.now();

    this.circuitBreakers.set(publisherId, breaker);

    if (breaker.failures >= 3) {
      logger.warn(`Circuit breaker activated for publisher ${publisherId}`, {
        failures: breaker.failures,
      });
    }
  }

  recordSuccess(publisherId) {
    this.circuitBreakers.delete(publisherId);
  }

  async queueAuditJob(publisher, sites) {
    try {
      if (sites.length === 0) {
        logger.warn(`No sites available for publisher ${publisher.id}`);
        return false;
      }

      const jobPayload = {
        publisher_id: publisher.id,
        sites: sites.map(s => ({ name: s.site_name || s.name, url: s.site_url || s.url })),
        priority: this.getPriorityWeight(publisher) > 1.5 ? 'high' : 'normal',
      };

      const headers = {
        'Content-Type': 'application/json',
      };

      if (WORKER_SECRET) {
        headers['Authorization'] = `Bearer ${WORKER_SECRET}`;
      }

      const response = await fetch(`${WORKER_URL}/audit`, {
        method: 'POST',
        headers,
        body: JSON.stringify(jobPayload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Worker returned ${response.status}: ${errorData.error || 'Unknown error'}`
        );
      }

      const result = await response.json();

      logger.info(`Queued audit job for publisher ${publisher.id}`, {
        publisherId: publisher.id,
        jobId: result.jobId,
        sites: sites.length,
      });

      this.recordSuccess(publisher.id);
      return true;
    } catch (error) {
      logger.error(`Failed to queue audit job for publisher ${publisher.id}`, error, {
        publisherId: publisher.id,
      });

      this.recordFailure(publisher.id);
      return false;
    }
  }

  async executeSchedule(schedule) {
    const executionId = uuidv4();
    const startTime = new Date();

    logger.info(`Starting schedule execution ${executionId}`, {
      executionId,
      scheduleId: schedule.id,
      scheduleName: schedule.schedule_name,
    });

    try {
      const publishersDue = await this.getPublishersDueForAudit(schedule);

      if (publishersDue.length === 0) {
        logger.info(`No publishers due for audit in schedule ${schedule.id}`, {
          scheduleId: schedule.id,
        });

        await this.updateScheduleExecution(schedule.id, {
          last_run_at: startTime.toISOString(),
          jobs_queued: 0,
          execution_status: 'completed_no_jobs',
        });

        return;
      }

      const prioritized = publishersDue.sort(
        (a, b) => this.getPriorityWeight(b) - this.getPriorityWeight(a)
      );

      const batches = [];
      for (let i = 0; i < prioritized.length; i += BATCH_SIZE) {
        batches.push(prioritized.slice(i, i + BATCH_SIZE));
      }

      let totalQueued = 0;
      let totalFailed = 0;

      for (const batch of batches) {
        for (const publisher of batch) {
          if (this.isCircuitBreakerTripped(publisher.id)) {
            logger.info(
              `Skipping publisher ${publisher.id} due to circuit breaker`,
              { publisherId: publisher.id }
            );
            totalFailed += 1;
            continue;
          }

          const sites = await this.getPublisherSites(publisher.id);
          const queued = await this.queueAuditJob(publisher, sites);

          if (queued) {
            totalQueued += 1;
          } else {
            totalFailed += 1;
          }

          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
        }
      }

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      logger.info(`Schedule execution ${executionId} completed`, {
        executionId,
        scheduleId: schedule.id,
        totalQueued,
        totalFailed,
        durationMs: duration,
      });

      await this.updateScheduleExecution(schedule.id, {
        last_run_at: startTime.toISOString(),
        jobs_queued: totalQueued,
        execution_status: totalFailed === 0 ? 'completed' : 'completed_with_errors',
        last_execution_duration_ms: duration,
      });
    } catch (error) {
      logger.error(`Schedule execution ${executionId} failed`, error, {
        executionId,
        scheduleId: schedule.id,
      });

      await this.updateScheduleExecution(schedule.id, {
        last_run_at: startTime.toISOString(),
        execution_status: 'failed',
        last_error: error.message,
      });
    }
  }

  async updateScheduleExecution(scheduleId, updates) {
    try {
      await supabase.update('publisher_schedules', scheduleId, updates);
    } catch (error) {
      logger.error('Failed to update schedule execution', error, { scheduleId });
    }
  }

  async registerCronSchedule(schedule) {
    try {
      const cronExpression = schedule.cron_expression || '0 2 * * *';

      const task = cron.schedule(cronExpression, async () => {
        await this.executeSchedule(schedule);
      });

      this.tasks.set(schedule.id, task);

      logger.info(`Registered cron schedule`, {
        scheduleId: schedule.id,
        scheduleName: schedule.schedule_name,
        cronExpression,
      });

      return task;
    } catch (error) {
      logger.error('Failed to register cron schedule', error, {
        scheduleId: schedule.id,
      });
      return null;
    }
  }

  async stopAllSchedules() {
    this.tasks.forEach((task, scheduleId) => {
      try {
        task.stop();
        this.tasks.delete(scheduleId);
        logger.info(`Stopped schedule ${scheduleId}`);
      } catch (error) {
        logger.error(`Failed to stop schedule ${scheduleId}`, error);
      }
    });

    this.isRunning = false;
    logger.info('All schedules stopped');
  }

  async start() {
    try {
      await this.initialize();

      const schedules = await this.loadPublisherSchedules();

      if (schedules.length === 0) {
        logger.warn('No active publisher schedules to register');
        return;
      }

      for (const schedule of schedules) {
        await this.registerCronSchedule(schedule);
      }

      logger.info(`Scheduler started with ${schedules.length} active schedules`, {
        activeSchedules: schedules.length,
      });
    } catch (error) {
      logger.error('Failed to start scheduler', error);
      throw error;
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      activeSchedules: this.tasks.size,
      circuitBreakersActive: this.circuitBreakers.size,
      timestamp: new Date().toISOString(),
    };
  }
}

const scheduler = new SchedulerManager();

if (require.main === module) {
  scheduler.start().catch(err => {
    logger.error('Scheduler startup failed', err);
    process.exit(1);
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, stopping scheduler');
    scheduler.stopAllSchedules().then(() => process.exit(0));
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, stopping scheduler');
    scheduler.stopAllSchedules().then(() => process.exit(0));
  });
}

module.exports = scheduler;
