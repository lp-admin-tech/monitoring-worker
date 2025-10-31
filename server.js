import express from 'express';
import dotenv from 'dotenv';
import { AdvancedWebsiteCrawler } from './index.js';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '900000');

app.use(express.json());

let crawler = null;
let supabase = null;

// === AUTH MIDDLEWARE ===
function validateWorkerSecret(req, res, next) {
  const authHeader = req.headers['authorization'];
  const workerSecret = process.env.WORKER_SECRET;

  if (!workerSecret) {
    console.warn('[AUTH] WORKER_SECRET not set — allowing all requests');
    return next();
  }

  if (!authHeader || authHeader !== `Bearer ${workerSecret}`) {
    console.warn('[AUTH] Invalid or missing authorization header');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

// === INITIALIZATION HELPERS ===
function initializeCrawler() {
  if (!crawler) {
    console.log('[SERVER] Initializing crawler instance...');
    crawler = new AdvancedWebsiteCrawler({
      cacheTimeout: 3600000, // 1 hour
      maxRetries: 3,
      concurrency: 2
    });
  }
  return crawler;
}

function initializeSupabase() {
  if (!supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      console.error('[SERVER] ❌ Missing Supabase configuration');
      return null;
    }
    console.log('[SERVER] Initializing Supabase client...');
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    console.log('[SERVER] ✓ Supabase client ready');
  }
  return supabase;
}

// === MAIN API ROUTE ===
app.post('/api/audit', validateWorkerSecret, async (req, res) => {
  try {
    const { publisher_id, domain } = req.body;
    if (!publisher_id || !domain) {
      return res.status(400).json({ error: 'publisher_id and domain are required' });
    }

    const crawler = initializeCrawler();
    const supabase = initializeSupabase();

    console.log(`[AI-HELPER] ✗ Starting audit for: ${domain}`);

    const results = await crawler.auditWebsite(domain);

    if (supabase) {
      const { error } = await supabase
        .from('site_audits')
        .upsert([{ publisher_id, domain, audit_result: results }], {
          onConflict: ['publisher_id', 'domain']
        });

      if (error) {
        console.error('[DB] ❌ Failed to save results:', error.message);
      } else {
        console.log('[DB] ✓ Audit results saved to Supabase');
      }
    }

    console.log(`[AI-HELPER] ✓ Completed audit for: ${domain}`);
    res.json({ success: true, results });
  } catch (err) {
    console.error('[SERVER] ❌ Error during audit:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// === HEALTH CHECK ===
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Audit worker running' });
});

// === START SERVER ===
app.listen(PORT, () => {
  console.log(`[SERVER] Listening on port ${PORT}`);
});
