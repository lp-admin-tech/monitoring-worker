const logger = require('../logger');

class RateLimiter {
  constructor(options = {}) {
    this.maxRequestsPerMinute = options.maxRequestsPerMinute || 10;
    this.maxConcurrent = options.maxConcurrent || 3;
    this.queue = [];
    this.activeRequests = 0;
    this.requestTimestamps = [];
    this.lastResetTime = Date.now();
  }

  async acquire() {
    while (true) {
      const now = Date.now();

      // Reset timestamps if a minute has passed
      if (now - this.lastResetTime > 60000) {
        this.requestTimestamps = [];
        this.lastResetTime = now;
      }

      // Remove old timestamps outside the minute window
      this.requestTimestamps = this.requestTimestamps.filter(
        (ts) => now - ts < 60000
      );

      const canProceed =
        this.activeRequests < this.maxConcurrent &&
        this.requestTimestamps.length < this.maxRequestsPerMinute;

      if (canProceed) {
        this.activeRequests++;
        this.requestTimestamps.push(now);
        logger.debug('Rate limiter acquired', {
          activeRequests: this.activeRequests,
          requestsThisMinute: this.requestTimestamps.length,
        });
        return;
      }

      // Calculate wait time based on oldest request
      const oldestTimestamp = this.requestTimestamps[0];
      const waitTime = Math.max(
        100,
        60000 - (now - oldestTimestamp) + 500
      );

      logger.debug('Rate limiter waiting', {
        waitMs: waitTime,
        activeRequests: this.activeRequests,
        requestsThisMinute: this.requestTimestamps.length,
      });

      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  release() {
    this.activeRequests--;
    logger.debug('Rate limiter released', {
      activeRequests: this.activeRequests,
    });
  }
}

class OpenRouterRateLimiter extends RateLimiter {
  constructor(options = {}) {
    super({
      maxRequestsPerMinute: parseInt(process.env.AI_RATE_LIMIT_RPM || '1000', 10),
      maxConcurrent: parseInt(process.env.AI_RATE_LIMIT_CONCURRENT || '50', 10),
    });
    this.maxRetries = options.maxRetries || 3;
    this.initialBackoffMs = options.initialBackoffMs || 10000; // Increased to 10 seconds
    this.backoffMultiplier = options.backoffMultiplier || 3; // Increased to 3x
  }

  calculateBackoffDelay(attempt) {
    return this.initialBackoffMs * Math.pow(this.backoffMultiplier, attempt - 1);
  }

  async executeWithRetry(fn, maxRetries = null) {
    const retries = maxRetries ?? this.maxRetries;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.acquire();
        try {
          const result = await fn();
          this.release();
          return { success: true, data: result };
        } catch (error) {
          this.release();

          if (error.status === 429) {
            const backoffDelay = this.calculateBackoffDelay(attempt);
            const retryAfter = error.retryAfter || backoffDelay;

            logger.warn(
              `Rate limited (429), retry attempt ${attempt}/${retries}`,
              {
                waitMs: retryAfter,
                backoffDelay,
                multiplier: this.backoffMultiplier,
              }
            );

            if (attempt < retries) {
              await new Promise((resolve) =>
                setTimeout(resolve, retryAfter)
              );
              continue;
            } else {
              logger.error(
                'Rate limit retries exhausted',
                {
                  totalAttempts: attempt,
                  maxRetries: retries,
                  lastBackoffMs: retryAfter,
                }
              );
              return { success: false, error, retryExhausted: true };
            }
          }

          throw error;
        }
      } catch (error) {
        this.release();
        logger.error(
          'Error during executeWithRetry',
          {
            attempt,
            error: error.message,
          }
        );
        return { success: false, error, attempt };
      }
    }
  }
}

module.exports = { RateLimiter, OpenRouterRateLimiter };
