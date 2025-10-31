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

function validateWorkerSecret(req, res, next) {
  const authHeader = req.headers['authorization'];
  const workerSecret = process.env.WORKER_SECRET;

  if (!workerSecret) {
    console.warn('[AUTH] WORKER_SECRET not set - allowing all requests');
    return next();
  }

  if (!authHeader || authHeader !== `Bearer ${workerSecret}`) {
    console.warn('[AUTH] Invalid or missing authorization header');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

function initializeCrawler() {
  if (!crawler) {
    console.log('[SERVER] Initializing crawler instance...');
    crawler = new AdvancedWebsiteCrawler({
      cacheTimeout: 3600000,
      maxRetries: 3,
      concurrency: 2
    });
  }
  return crawler;
}

function initializeSupabase() {
  if (!supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      console.error('[SERVER] ❌ ERROR: Missing required environment variables for Supabase!');
      console.error('[SERVER] Required: SUPABASE_URL and SUPABASE_SERVICE_KEY');
      console.error('[SERVER] Current config: URL=' + (process.env.SUPABASE_URL ? '✓' : '✗') + ', SERVICE_KEY=' + (process.env.SUPABASE_SERVICE_KEY ? '✓' : '✗'));
      console.error('[SERVER] Database persistence DISABLED - audit results will NOT be saved!');
      return null;
    }
    console.log('[SERVER] Initializing Supabase client...');
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    console.log('[SERVER] ✓ Supabase client initialized successfully');
