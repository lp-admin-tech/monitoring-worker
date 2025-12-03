# Site Monitoring Worker

Automated website quality monitoring and MFA (Made For Advertising) scoring system for publisher sites.

## Overview

This is a backend API service that crawls and analyzes websites for ad quality issues, content quality, and technical problems. It uses Playwright for browser automation to capture real-world ad behavior.

## Architecture

### Core Components

- **Worker Runner** (`scripts/worker-runner.js`): Main Express API server that handles audit requests
- **Scheduler** (`scripts/scheduler.js`): Cron-based scheduling for automated audits
- **Webhook Handler** (`scripts/webhook-handler.js`): Handles completion/failure webhooks

### Analysis Modules

- **Crawler** (`modules/crawler/`): Playwright-based web crawling with ad detection
- **Content Analyzer** (`modules/content-analyzer/`): Text quality, AI detection, readability analysis
- **Ad Analyzer** (`modules/ad-analyzer/`): Ad density, auto-refresh, visibility checks
- **Technical Checker** (`modules/technical-checker/`): SSL, ads.txt, performance metrics
- **Policy Checker** (`modules/policy-checker/`): Regulatory compliance checking
- **Scorer** (`modules/scoerer/`): Risk scoring and MFA probability calculation
- **AI Assistance** (`modules/ai-assistance/`): LLM-powered report generation

## Required Environment Variables

### Essential (Required)
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_KEY`: Supabase service role key
- `WORKER_SECRET`: Secret for API authentication

### AI Provider (Choose one)
- `AI_MODEL_API_KEY` + `AI_MODEL_PROVIDER`: For Alibaba Tongyi
- `OPENROUTER_API_KEY`: For OpenRouter API

### Optional
- `GOOGLE_SAFE_BROWSING_API_KEY`: For threat detection
- `GAM_API_KEY` + `GAM_ACCOUNT_ID`: For Google Ad Manager integration

## API Endpoints

All endpoints require `Authorization: Bearer <WORKER_SECRET>` header.

- `GET /`: Service info
- `GET /health`: Health check
- `POST /audit`: Audit single website
- `POST /audit-batch`: Audit multiple websites
- `GET /audit-all`: Audit all active publishers

## Recent Changes

### 2024-12-03: Improved Ad Detection and Metrics

**Fixes Applied:**
1. **Crawler Resource Blocking** - Fixed overly aggressive resource blocking that was preventing ad scripts from loading. Now allows:
   - All JavaScript (including ad scripts)
   - Ad network domains (Google, Prebid, Taboola, etc.)
   - XHR/fetch requests for bid data

2. **Enhanced Ad Detection** - Improved pattern matching for ad elements:
   - More comprehensive ID/class patterns
   - Better data-attribute detection
   - Support for native ad networks (Taboola, Outbrain, etc.)
   - Parent context detection for wrapped ads

3. **HAR Capture Enhancement** - Better network request classification:
   - Automatic ad network identification
   - Bid request detection
   - Ad network statistics in HAR data

4. **Validation Checks** - Added data quality validation after crawling:
   - Content extraction validation
   - Ad element count checking
   - Network request verification
   - Logging for empty/failed data

## Development

```bash
npm install
npx playwright install chromium
npm start
```

## Port Configuration

The service runs on port 5000 (configurable via PORT env var).
