const logger = require('../../modules/logger');

class QueueManager {
    constructor(queueName, processor, options = {}) {
        this.queueName = queueName;
        this.processor = processor;
        this.options = options;
        this.queue = [];
        this.isProcessing = false;
        this.isReady = true; // Always ready in-memory

        logger.info(`[Queue:${this.queueName}] Initialized In-Memory Queue`);
    }

    async add(name, data, opts = {}) {
        const job = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            name,
            data,
            opts,
            timestamp: Date.now()
        };

        this.queue.push(job);
        logger.info(`[Queue:${this.queueName}] Added job ${job.id} to in-memory queue`);

        // Trigger processing asynchronously
        this.processNext();

        return job;
    }

    async processNext() {
        logger.info(`[Queue:${this.queueName}] processNext called - isProcessing: ${this.isProcessing}, queueLength: ${this.queue.length}`);

        if (this.isProcessing || this.queue.length === 0) {
            logger.info(`[Queue:${this.queueName}] Skipping: isProcessing=${this.isProcessing}, queueEmpty=${this.queue.length === 0}`);
            return;
        }

        this.isProcessing = true;
        const job = this.queue.shift();

        try {
            logger.info(`[Queue:${this.queueName}] 🚀 Starting job ${job.id}`, { name: job.name, data: JSON.stringify(job.data).slice(0, 200) });
            await this.processor(job);
            logger.info(`[Queue:${this.queueName}] ✅ Job ${job.id} completed successfully`);
        } catch (error) {
            logger.error(`[Queue:${this.queueName}] ❌ Job ${job.id} failed`, { error: error.message, stack: error.stack?.slice(0, 500) });
        } finally {
            this.isProcessing = false;
            // Process next job if any
            if (this.queue.length > 0) {
                logger.info(`[Queue:${this.queueName}] More jobs in queue (${this.queue.length}), scheduling next...`);
                setImmediate(() => this.processNext());
            }
        }
    }

    async close() {
        this.queue = [];
        this.isProcessing = false;
        logger.info(`[Queue:${this.queueName}] In-Memory Queue closed`);
    }

    getActiveJobCount() {
        return this.isProcessing ? 1 : 0;
    }

    async getJob(jobId) {
        // In-memory queue doesn't persist completed jobs, so we only check pending
        return this.queue.find(j => j.id === jobId) || null;
    }
}

module.exports = QueueManager;
