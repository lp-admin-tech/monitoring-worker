# Monitoring Worker Logging Guide

## Overview
The Advanced Website Crawler now includes comprehensive logging for all operations, making it easy to track progress and debug issues.

## Log Prefixes

### Initialization & Configuration
- `[CRAWLER-INIT]` - Crawler initialization and configuration
- `[BROWSER-INIT]` - Browser launch and status

### Caching
- `[CACHE-HIT]` - Cached data found and returned
- `[CACHE-MISS]` - Cache expired or not found
- `[CACHE-SET]` - Data cached for future use

### Core Operations
- `[CRAWL-START]` - Beginning of site crawl
- `[CRAWL-END]` - Completion or failure of crawl
- `[CRAWL-ERROR]` - Critical crawl errors
- `[CONTEXT-CREATE]` - Browser context creation
- `[PAGE-NAVIGATE]` - Navigation to target URL
- `[PAGE-LOADED]` - Page successfully loaded
- `[DATA-EXTRACT]` - Extracting page content
- `[CLEANUP]` - Resource cleanup

### Analyzers
- `[SEO-ANALYZER]` - SEO analysis operations
- `[SECURITY-ANALYZER]` - Security header analysis
- `[TECH-DETECTOR]` - Technology detection
- `[PERFORMANCE-ANALYZER]` - Performance metrics analysis
- `[LINK-ANALYZER]` - Link quality analysis
- `[ACCESSIBILITY]` - Accessibility checks
- `[MOBILE-CHECK]` - Mobile-friendly analysis
- `[LIGHTHOUSE-SCORE]` - Overall score calculation

### Advanced Operations
- `[RETRY]` - Retry logic for failed operations
- `[MULTI-CRAWL]` - Multiple domain crawling
- `[ANALYSIS-START]` - Beginning of analysis suite
- `[ANALYSIS-COMPLETE]` - All analyses finished

### System
- `[CRAWLER-CLOSE]` - Shutdown and cleanup

## Log Symbols

- ✓ (checkmark) - Successful operation
- ✗ (X mark) - Failed operation
- ⚠ (warning) - Warning or missing configuration

## Example Log Output

```
[CRAWLER-INIT] Initializing AdvancedWebsiteCrawler
[CRAWLER-INIT] Configuration: { cacheTimeout: 3600000, maxRetries: 3, concurrency: 3, deepCrawl: false, maxDepth: 2 }
[CRAWLER-INIT] ✓ Supabase client initialized

[CRAWL-START] ====== Starting crawl for example.com ======
[BROWSER-INIT] Launching Chromium browser...
[BROWSER-INIT] ✓ Browser launched successfully
[CONTEXT-CREATE] Creating browser context for example.com
[PAGE-NAVIGATE] Navigating to https://example.com
[PAGE-LOADED] ✓ Page loaded in 1234ms
[DATA-EXTRACT] Extracting page data...
[ANALYSIS-START] Running comprehensive analysis suite...
[SEO-ANALYZER] Starting SEO analysis for example.com
[SEO-ANALYZER] ✓ Analysis complete - Score: 85/100, Issues: 3
[SECURITY-ANALYZER] Starting security header analysis for example.com
[SECURITY-ANALYZER] ✓ Analysis complete - Score: 70/100, Issues: 5
[TECH-DETECTOR] Detecting technologies...
[TECH-DETECTOR] ✓ Detected 8 technologies
[PERFORMANCE-ANALYZER] Starting performance analysis for example.com
[PERFORMANCE-ANALYZER] ✓ Analysis complete - Score: 92/100, FCP: 1200ms, LCP: 2100ms
[LINK-ANALYZER] Analyzing link quality for example.com
[LINK-ANALYZER] ✓ Found 156 links (89 internal, 67 external)
[ACCESSIBILITY] Starting accessibility check for example.com
[ACCESSIBILITY] ✓ Check complete - Score: 88/100, Issues: 12
[ANALYSIS-COMPLETE] All analyses finished
[LIGHTHOUSE-SCORE] Overall: 84/100 (Good)
[CLEANUP] Closing page and context
[CACHE-SET] Cached data for key: a1b2c3d4
[CRAWL-END] ====== Successfully crawled example.com ======
```

## Error Handling

All errors are logged with descriptive messages:

```
[RETRY] Starting operation with 3 max retries
[RETRY] ✗ Attempt 1/3 failed: Connection timeout
[RETRY] Waiting 1000ms before retry...
[RETRY] ✗ Attempt 2/3 failed: Connection timeout
[RETRY] Waiting 2000ms before retry...
[RETRY] ✓ Operation succeeded on attempt 3
```

## Multi-Site Crawling

When crawling multiple sites:

```
[MULTI-CRAWL] Starting crawl for 10 domains with concurrency 3
[MULTI-CRAWL] Processing chunk 1/4 (3 domains)
[MULTI-CRAWL] Chunk 1/4 complete
[MULTI-CRAWL] Processing chunk 2/4 (3 domains)
[MULTI-CRAWL] Chunk 2/4 complete
[MULTI-CRAWL] Processing chunk 3/4 (3 domains)
[MULTI-CRAWL] Chunk 3/4 complete
[MULTI-CRAWL] Processing chunk 4/4 (1 domains)
[MULTI-CRAWL] Chunk 4/4 complete
[MULTI-CRAWL] ✓ All 10 domains processed
```

## Integration

The monitoring worker automatically logs all operations. No additional configuration needed.
