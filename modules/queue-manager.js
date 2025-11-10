const logger = require('./logger');

class QueueManager {
  constructor() {
    this.queue = [];
    this.processing = new Set();
    this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_JOBS || '3');
    this.processingTimeout = parseInt(process.env.PROCESSING_TIMEOUT || '3600000');
    this.stats = {
      totalQueued: 0,
      totalProcessed: 0,
      totalFailed: 0,
      startTime: new Date(),
    };
  }

  enqueue(job) {
    if (!job || !job.id) {
      throw new Error('Job must have an id');
    }

    this.queue.push({
      ...job,
      enqueuedAt: new Date(),
      attempts: 0,
      lastError: null,
    });

    this.stats.totalQueued += 1;

    logger.info(`Job enqueued: ${job.id}`, {
      jobId: job.id,
      queueLength: this.queue.length,
      processingCount: this.processing.size,
    });

    return job.id;
  }

  async dequeue() {
    if (this.processing.size >= this.maxConcurrent) {
      return null;
    }

    if (this.queue.length === 0) {
      return null;
    }

    const priorityJob = this.queue.find(j => j.priority === 'high');
    const job = priorityJob || this.queue[0];

    this.queue = this.queue.filter(j => j.id !== job.id);
    this.processing.set(job.id, {
      startedAt: new Date(),
      attempts: job.attempts || 0,
    });

    logger.info(`Job dequeued for processing: ${job.id}`, {
      jobId: job.id,
      priority: job.priority,
      attempts: job.attempts,
      processingCount: this.processing.size,
    });

    return job;
  }

  markComplete(jobId, result) {
    if (!this.processing.has(jobId)) {
      logger.warn(`Attempted to mark complete job not in processing: ${jobId}`, {
        jobId,
      });
      return false;
    }

    const processingInfo = this.processing.get(jobId);
    const duration = new Date() - processingInfo.startedAt;

    this.processing.delete(jobId);
    this.stats.totalProcessed += 1;

    logger.info(`Job completed: ${jobId}`, {
      jobId,
      durationMs: duration,
      attempts: processingInfo.attempts,
      processingCount: this.processing.size,
    });

    return true;
  }

  markFailed(jobId, error, shouldRetry = true) {
    if (!this.processing.has(jobId)) {
      logger.warn(`Attempted to mark failed job not in processing: ${jobId}`, {
        jobId,
      });
      return false;
    }

    const processingInfo = this.processing.get(jobId);
    const duration = new Date() - processingInfo.startedAt;

    logger.warn(`Job failed: ${jobId}`, {
      jobId,
      error: error?.message || error,
      durationMs: duration,
      attempts: processingInfo.attempts,
    });

    this.processing.delete(jobId);

    if (shouldRetry && processingInfo.attempts < 3) {
      const retryJob = {
        id: jobId,
        attempts: processingInfo.attempts + 1,
        lastError: error?.message || error,
        retryAfter: new Date(Date.now() + (1000 * Math.pow(2, processingInfo.attempts))),
      };

      logger.info(`Requeuing job for retry: ${jobId}`, {
        jobId,
        attempt: retryJob.attempts,
        retryAfter: retryJob.retryAfter,
      });

      this.queue.push(retryJob);
      return true;
    }

    this.stats.totalFailed += 1;
    return false;
  }

  getStatus() {
    const uptime = new Date() - this.stats.startTime;

    return {
      queueLength: this.queue.length,
      processingCount: this.processing.size,
      maxConcurrent: this.maxConcurrent,
      availableSlots: Math.max(0, this.maxConcurrent - this.processing.size),
      totalQueued: this.stats.totalQueued,
      totalProcessed: this.stats.totalProcessed,
      totalFailed: this.stats.totalFailed,
      uptime: uptime,
      successRate:
        this.stats.totalProcessed > 0
          ? ((this.stats.totalProcessed / (this.stats.totalProcessed + this.stats.totalFailed)) *
              100).toFixed(2) + '%'
          : 'N/A',
      timestamp: new Date(),
    };
  }

  isAtCapacity() {
    return this.processing.size >= this.maxConcurrent;
  }

  getQueueLength() {
    return this.queue.length;
  }

  getProcessingCount() {
    return this.processing.size;
  }

  clear() {
    this.queue = [];
    this.processing.clear();
    logger.info('Queue cleared', {
      queueLength: this.queue.length,
      processingCount: this.processing.size,
    });
  }

  getPendingJobs() {
    return this.queue.map(j => ({
      id: j.id,
      priority: j.priority,
      attempts: j.attempts,
      enqueuedAt: j.enqueuedAt,
    }));
  }

  getProcessingJobs() {
    const jobs = [];
    this.processing.forEach((info, jobId) => {
      jobs.push({
        id: jobId,
        startedAt: info.startedAt,
        duration: new Date() - info.startedAt,
        attempts: info.attempts,
      });
    });
    return jobs;
  }

  removeJob(jobId) {
    if (this.processing.has(jobId)) {
      this.processing.delete(jobId);
      logger.info(`Job removed from processing: ${jobId}`, { jobId });
      return true;
    }

    const index = this.queue.findIndex(j => j.id === jobId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      logger.info(`Job removed from queue: ${jobId}`, { jobId });
      return true;
    }

    return false;
  }
}

module.exports = QueueManager;
