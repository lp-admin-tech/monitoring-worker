require('dotenv').config();

const envConfig = {
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
  },
  aiModel: {
    apiKey: process.env.AI_MODEL_API_KEY || '',
    model: process.env.AI_MODEL_NAME || 'alibaba/tongyi-qwen-plus',
    provider: process.env.AI_MODEL_PROVIDER || 'alibaba',
  },
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-nano-12b-vision',
  },
  gam: {
    apiKey: process.env.GAM_API_KEY || '',
    accountId: process.env.GAM_ACCOUNT_ID || '',
  },
  worker: {
    secret: process.env.WORKER_SECRET || '',
    port: parseInt(process.env.PORT || '8080', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'INFO',
    verbosity: process.env.LOG_VERBOSITY || 'minimal',
  },
  playwright: {
    browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH || '',
  },
  googleSafeBrowsing: {
    apiKey: process.env.GOOGLE_SAFE_BROWSING_API_KEY || '',
  },
  // Runtime configuration with sensible defaults
  runtime: {
    moduleTimeout: parseInt(process.env.MODULE_TIMEOUT || '30000', 10),
    batchConcurrency: parseInt(process.env.BATCH_CONCURRENCY_LIMIT || '1', 10),
    retryEnabled: process.env.RETRY_ENABLED !== 'false',
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    aiRequestDelay: parseInt(process.env.AI_REQUEST_DELAY_MS || '10000', 10),
    llmTimeout: parseInt(process.env.LLM_TIMEOUT_MS || '180000', 10),
    gracefulShutdownTimeout: parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT || '30000', 10),
  },
};

function validateConfig() {
  const errors = [];
  const warnings = [];

  // Required: Supabase
  if (!envConfig.supabase.url) errors.push('SUPABASE_URL is required');
  if (!envConfig.supabase.serviceKey) errors.push('SUPABASE_SERVICE_KEY is required');

  // Required: At least one AI provider
  const hasAIConfig = envConfig.aiModel.apiKey && envConfig.aiModel.provider;
  const hasOpenRouterConfig = envConfig.openRouter.apiKey;

  if (!hasAIConfig && !hasOpenRouterConfig) {
    errors.push('Either AI_MODEL_API_KEY with AI_MODEL_PROVIDER or OPENROUTER_API_KEY is required');
  }

  // Warnings for recommended but optional vars
  if (!envConfig.googleSafeBrowsing.apiKey) {
    warnings.push('GOOGLE_SAFE_BROWSING_API_KEY not set - Safe Browsing checks will be limited');
  }
  if (!envConfig.worker.secret) {
    warnings.push('WORKER_SECRET not set - API endpoints will not be protected');
  }
  if (!envConfig.gam.apiKey) {
    warnings.push('GAM_API_KEY not set - GAM enrichment will be skipped');
  }

  // Validate runtime config ranges
  if (envConfig.runtime.moduleTimeout < 5000) {
    warnings.push('MODULE_TIMEOUT is very low (<5s), may cause premature timeouts');
  }
  if (envConfig.runtime.aiRequestDelay < 1000) {
    warnings.push('AI_REQUEST_DELAY_MS is very low (<1s), may trigger rate limits');
  }

  return { errors, warnings };
}

function printConfigWarnings() {
  const { errors, warnings } = validateConfig();

  if (errors.length > 0) {
    console.error('Configuration Errors:');
    errors.forEach(err => console.error(`  ✗ ${err}`));
  }

  if (warnings.length > 0 && envConfig.worker.nodeEnv !== 'production') {
    console.warn('Configuration Warnings:');
    warnings.forEach(warn => console.warn(`  ⚠ ${warn}`));
  }

  return errors.length === 0;
}

module.exports = {
  envConfig,
  validateConfig,
  printConfigWarnings,
};
