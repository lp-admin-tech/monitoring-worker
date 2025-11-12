class LogQueueManager {
  constructor(maxQueueSize = 1000) {
    this.queue = [];
    this.maxQueueSize = maxQueueSize;
    this.isProcessing = false;
    this.retryInterval = 5000;
    this.maxRetries = 3;
    this.retryTimer = null;
  }

  addToQueue(logEntry) {
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
      console.warn(`[LogQueueManager] Queue at capacity. Dropped oldest entry. Current size: ${this.queue.length}`);
    }

    this.queue.push({
      entry: logEntry,
      timestamp: new Date().toISOString(),
      retryCount: 0,
      addedAt: Date.now(),
    });
  }

  getQueueSize() {
    return this.queue.length;
  }

  async processQueue(persistCallback) {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const failedEntries = [];

    while (this.queue.length > 0) {
      const queuedLog = this.queue.shift();

      try {
        await persistCallback(queuedLog.entry);
        console.log(`[LogQueueManager] Successfully persisted queued log (${queuedLog.retryCount + 1} attempt)`);
      } catch (error) {
        queuedLog.retryCount++;

        if (queuedLog.retryCount < this.maxRetries) {
          failedEntries.push(queuedLog);
          console.warn(`[LogQueueManager] Log persist failed, will retry. Attempt ${queuedLog.retryCount}/${this.maxRetries}`);
        } else {
          console.error(`[LogQueueManager] Log persist failed after ${this.maxRetries} retries. Dropping entry.`, error.message);
        }
      }
    }

    this.queue = failedEntries;
    this.isProcessing = false;

    if (this.queue.length > 0) {
      console.log(`[LogQueueManager] ${this.queue.length} entries remain in queue. Scheduling retry.`);
      this.scheduleRetry(persistCallback);
    }
  }

  scheduleRetry(persistCallback) {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    this.retryTimer = setTimeout(() => {
      this.processQueue(persistCallback);
    }, this.retryInterval);
  }

  clearRetryTimer() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  getQueueStats() {
    return {
      queueSize: this.queue.length,
      maxQueueSize: this.maxQueueSize,
      oldestEntryAge: this.queue.length > 0 ? Date.now() - this.queue[0].addedAt : null,
      isProcessing: this.isProcessing,
    };
  }

  async flush(persistCallback) {
    await this.processQueue(persistCallback);
    this.clearRetryTimer();
  }
}

module.exports = LogQueueManager;
