# Site Monitoring Worker

Automated website quality monitoring and MFA scoring system for publisher sites.

## Features

- **Website Crawling**: Automated crawling with Playwright
- **Content Analysis**: Length, uniqueness, privacy policy, contact pages
- **Enhanced Ad Metrics**:
  - Total ad count and placement analysis
  - Above-fold, in-content, and sidebar ad detection
  - Sticky and auto-refresh ad detection
  - Ad-to-content ratio calculation
- **Image & Media Analysis**:
  - Featured image detection
  - Alt text coverage tracking
  - Image optimization checks (WebP, lazy loading)
  - Video embed detection
- **Content Publishing Metadata**:
  - Publish date detection and tracking
  - Post frequency analysis
  - Author information verification
  - Content freshness scoring
- **Domain Authority Metrics**:
  - Domain age calculation via WHOIS
  - SSL certificate validation
  - Domain authority estimation
- **Technical Checks**: ads.txt, mobile-friendly, broken links, page speed
- **Google Safe Browsing**: Threat detection (optional, -30 point penalty if unsafe)
- **Comprehensive MFA Scoring**: 100-point scale with detailed breakdown
- **Results Storage**: All metrics stored in Supabase site_audits table

## Installation

```bash
npm install
```

## Environment Variables

Create a `.env` file with:

```
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
PORT=3001
WORKER_SECRET=your_secret_key

# Optional: Google Safe Browsing API
GOOGLE_SAFE_BROWSING_API_KEY=your_api_key
```

### Google Safe Browsing (Optional)

To enable threat detection:

1. Get an API key from [Google Safe Browsing](https://developers.google.com/safe-browsing/v4/get-started)
2. Add `GOOGLE_SAFE_BROWSING_API_KEY` to your `.env` file
3. Sites flagged as unsafe will receive a -30 point penalty to their MFA score

If no API key is provided, safe browsing checks are skipped.

## Usage

Start the worker:

```bash
npm start
```

Development mode with auto-reload:

```bash
npm run dev
```

## API Endpoints

All endpoints require the `Authorization: Bearer <WORKER_SECRET>` header.

### GET /

Service information and available endpoints.

### GET /health

Health check endpoint with system stats.

### POST /audit

Audit a single website:

```json
{
  "secret": "your-secret-key",
  "publisherId": "uuid",
  "domain": "example.com"
}
```

### POST /audit-batch

Audit multiple websites:

```json
{
  "secret": "your-secret-key",
  "publishers": [
    { "id": "uuid1", "domain": "example1.com" },
    { "id": "uuid2", "domain": "example2.com" }
  ]
}
```

### GET /audit-all?secret=your-secret-key

Audit all active publishers in the database.

### POST /crawl

Crawl a single site without saving to database:

```json
{
  "domain": "example.com",
  "publisherId": "uuid"
}
```

### POST /crawl-multiple

Crawl multiple sites:

```json
{
  "domains": ["example1.com", "example2.com"]
}
```

### POST /clear-cache

Clear the crawler cache.

## Modules

- `crawler.js` - Website crawling with Playwright
- `content-analyzer.js` - Content quality analysis
- `ad-analyzer.js` - Comprehensive ad placement, density, and interference analysis
- `content-metadata-analyzer.js` - Image analysis and publishing metadata extraction
- `domain-age-checker.js` - Domain age, SSL validation, and authority scoring
- `technical-checker.js` - Technical SEO and performance checks
- `safe-browsing.js` - Google Safe Browsing threat detection
- `mfa-scorer.js` - Advanced MFA score calculation with 20+ metrics and recommendations

## Deployment

This worker can be deployed to any Node.js hosting platform that supports Playwright (Render, Railway, etc.).

### Render Deployment

1. Use the included `render.yaml` configuration
2. The build process automatically installs Chrome for Playwright
3. Environment variables are configured in the `render.yaml` file
4. Set your `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `WORKER_SECRET` in the Render dashboard

The deployment process will:
- Install all npm dependencies
- Download and install Chrome via Playwright
- Configure the correct cache directory for Chrome binaries
- Start the monitoring worker on the specified port
