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
    port: process.env.PORT || 9001,
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'INFO',
  },
  playwright: {
    browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH || '',
  },
  googleSafeBrowsing: {
    apiKey: process.env.GOOGLE_SAFE_BROWSING_API_KEY || '',
  },
};

function validateConfig() {
  const errors = [];

  if (!envConfig.supabase.url) errors.push('SUPABASE_URL is required');
  if (!envConfig.supabase.serviceKey) errors.push('SUPABASE_SERVICE_KEY is required');

  const hasAIConfig = envConfig.aiModel.apiKey && envConfig.aiModel.provider;
  const hasOpenRouterConfig = envConfig.openRouter.apiKey;

  if (!hasAIConfig && !hasOpenRouterConfig) {
    errors.push('Either AI_MODEL_API_KEY with AI_MODEL_PROVIDER or OPENROUTER_API_KEY is required');
  }

  return errors;
}

module.exports = {
  envConfig,
  validateConfig,
};
