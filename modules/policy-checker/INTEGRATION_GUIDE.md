# Policy Checker Integration Guide

This guide shows how to integrate the Policy Checker Module into your site-monitoring-worker pipeline.

## Quick Start

### 1. Basic Integration

```javascript
// In your main worker file or crawler integration
const { runPolicyCheck } = require('./modules/policy-checker');
const crawler = require('./modules/crawler');

async function analyzeSite(url) {
  // Step 1: Crawl the site
  const crawlData = await crawler.crawlSite(url);
  
  // Step 2: Run policy check
  const policyResults = await runPolicyCheck(crawlData, url);
  
  // Step 3: Process results
  if (policyResults.complianceLevel !== 'compliant') {
    console.warn(`Compliance issues detected on ${url}:`, policyResults.violations);
  }
  
  return policyResults;
}
```

### 2. Integration with Audit Queue

```javascript
const { runPolicyCheck, formatComplianceReport } = require('./modules/policy-checker');
const supabase = require('./modules/supabase-client');

async function queueAuditWithCompliance(crawlData, domain) {
  // Run compliance check
  const policyResults = await runPolicyCheck(crawlData, domain);
  
  // Store in audit queue
  const auditEntry = {
    domain,
    crawler_data: crawlData,
    policy_results: policyResults,
    compliance_level: policyResults.complianceLevel,
    violations_count: policyResults.violations.length,
    critical_violations: policyResults.summary.criticalViolations,
    timestamp: new Date().toISOString(),
  };
  
  const { data, error } = await supabase
    .from('audit_queue')
    .insert([auditEntry]);
  
  if (error) {
    console.error('Failed to queue audit:', error);
    return null;
  }
  
  return data;
}
```

### 3. Integration with Dashboard

```javascript
// In your API endpoint
const { runPolicyCheck, getComplianceSummary } = require('./modules/policy-checker');

app.get('/api/compliance/:domain', async (req, res) => {
  const { domain } = req.params;
  
  try {
    // Get crawl data from cache or re-crawl
    const crawlData = await getCrawlData(domain);
    
    // Run compliance check
    const policyResults = await runPolicyCheck(crawlData, domain);
    
    // Return summary for dashboard
    res.json({
      domain,
      summary: getComplianceSummary(policyResults),
      policies: policyResults.summary.policyStatus,
      violations: policyResults.violations.slice(0, 10), // Top 10
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### 4. Scheduled Compliance Monitoring

```javascript
// In your scheduler
const schedule = require('node-schedule');
const { runPolicyCheck } = require('./modules/policy-checker');

// Run compliance check every 24 hours for all tracked domains
schedule.scheduleJob('0 2 * * *', async () => {
  console.log('Starting scheduled compliance checks...');
  
  const domains = await getTrackedDomains();
  
  for (const domain of domains) {
    try {
      const crawlData = await crawler.crawlSite(domain);
      const results = await runPolicyCheck(crawlData, domain);
      
      // Store results
      await storeComplianceResults(domain, results);
      
      // Alert if violations detected
      if (results.violations.length > 0) {
        await sendAlert(domain, results);
      }
    } catch (error) {
      console.error(`Compliance check failed for ${domain}:`, error);
    }
  }
});
```

### 5. Real-time Alerts

```javascript
const { runPolicyCheck } = require('./modules/policy-checker');
const { sendAlert } = require('./modules/alerts');

async function checkAndAlert(crawlData, domain) {
  const results = await runPolicyCheck(crawlData, domain);
  
  // Alert on critical violations
  if (results.summary.criticalViolations > 0) {
    await sendAlert({
      type: 'critical_compliance_violation',
      domain,
      violations: results.violations.filter(v => v.severity === 'critical'),
      message: `${results.summary.criticalViolations} critical violations detected on ${domain}`,
    });
  }
  
  // Alert on high violations
  if (results.summary.highViolations > 3) {
    await sendAlert({
      type: 'high_compliance_violations',
      domain,
      violations: results.violations.filter(v => v.severity === 'high'),
      message: `${results.summary.highViolations} high-severity violations detected on ${domain}`,
    });
  }
  
  return results;
}
```

## Advanced Integration

### 1. Custom Policies

Extend the policy checker with custom policies:

```javascript
const { ruleset } = require('./modules/policy-checker/ruleset');

// Add custom policy
ruleset.ALL_POLICIES.MY_CUSTOM_POLICY = {
  id: 'my_custom_policy',
  name: 'My Custom Policy',
  severity: 'high',
  jurisdictions: ['global'],
  rules: [
    {
      type: 'keyword',
      pattern: /my_custom_keyword/gi,
      threshold: 1,
      context: 'content,metadata',
    },
  ],
};
```

### 2. Custom Keywords

Add domain-specific restricted keywords:

```javascript
const { createCustomKeywordList } = require('./modules/policy-checker/restricted-keywords');

const customKeywords = createCustomKeywordList({
  client_specific: [
    'my_banned_phrase',
    'another_banned_phrase',
  ],
});
```

### 3. Batch Processing

Process multiple domains efficiently:

```javascript
const { runPolicyCheck } = require('./modules/policy-checker');

async function batchCompliance(domains) {
  const results = await Promise.all(
    domains.map(domain => {
      return crawler.crawlSite(domain)
        .then(crawlData => runPolicyCheck(crawlData, domain))
        .catch(error => ({
          domain,
          error: error.message,
          complianceLevel: 'error',
        }));
    })
  );
  
  return results;
}
```

### 4. Report Generation

Generate compliance reports:

```javascript
const { formatComplianceReport } = require('./modules/policy-checker');
const fs = require('fs');

async function generateReport(domain) {
  const crawlData = await crawler.crawlSite(domain);
  const results = await runPolicyCheck(crawlData, domain);
  
  const report = formatComplianceReport(results);
  
  // Save to file
  fs.writeFileSync(`reports/${domain}-compliance.md`, report);
  
  // Send via email
  await sendEmail({
    to: 'compliance@example.com',
    subject: `Compliance Report: ${domain}`,
    body: report,
  });
}
```

## Data Flow

```
Crawler Output
    ↓
Policy Checker
    ├── Jurisdiction Detection
    ├── Category Detection
    ├── Keyword Scanning
    ├── Rule Evaluation
    └── Report Generation
    ↓
Compliance Results
    ├── Store in Database
    ├── Queue Audit
    ├── Send Alerts
    └── Update Dashboard
```

## Performance Considerations

### 1. Caching

```javascript
const cache = new Map();

async function checkWithCache(domain, forceRefresh = false) {
  if (!forceRefresh && cache.has(domain)) {
    const cached = cache.get(domain);
    if (Date.now() - cached.timestamp < 3600000) { // 1 hour
      return cached.results;
    }
  }
  
  const crawlData = await crawler.crawlSite(domain);
  const results = await runPolicyCheck(crawlData, domain);
  
  cache.set(domain, {
    results,
    timestamp: Date.now(),
  });
  
  return results;
}
```

### 2. Parallel Processing

```javascript
// Process multiple domains in parallel
const batchSize = 5;
for (let i = 0; i < domains.length; i += batchSize) {
  const batch = domains.slice(i, i + batchSize);
  await Promise.all(batch.map(domain => checkCompliance(domain)));
}
```

### 3. Async Processing

```javascript
// Queue compliance checks asynchronously
async function queueComplianceCheck(domain) {
  await queue.add({
    type: 'compliance_check',
    domain,
    priority: 'normal',
  });
}

// Process queue with worker threads
queue.process('compliance_check', async (job) => {
  const { domain } = job.data;
  const results = await runPolicyCheck(await crawler.crawlSite(domain), domain);
  return results;
});
```

## Error Handling

```javascript
const { runPolicyCheck } = require('./modules/policy-checker');

async function safeComplianceCheck(domain) {
  try {
    const crawlData = await crawler.crawlSite(domain);
    const results = await runPolicyCheck(crawlData, domain);
    return results;
  } catch (error) {
    console.error(`Compliance check failed for ${domain}:`, error);
    
    // Return default result
    return {
      domain,
      complianceLevel: 'error',
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}
```

## Testing

```javascript
const { runTest } = require('./modules/policy-checker/test-integration');

// Run integration tests
runTest().then(() => {
  console.log('Policy Checker tests passed');
}).catch(error => {
  console.error('Policy Checker tests failed:', error);
});
```

## Monitoring

```javascript
// Track policy check metrics
const metrics = {
  totalChecks: 0,
  violations: 0,
  avgExecutionTime: 0,
  lastCheck: null,
};

async function trackedPolicyCheck(domain) {
  const start = Date.now();
  const results = await runPolicyCheck(await crawler.crawlSite(domain), domain);
  const duration = Date.now() - start;
  
  metrics.totalChecks++;
  metrics.violations += results.violations.length;
  metrics.avgExecutionTime = (metrics.avgExecutionTime + duration) / 2;
  metrics.lastCheck = new Date().toISOString();
  
  return results;
}
```

## Best Practices

1. **Cache Results** - Don't re-check unchanged domains too frequently
2. **Batch Processing** - Process multiple domains in parallel for efficiency
3. **Error Handling** - Gracefully handle check failures
4. **Async Queue** - Use job queues for background processing
5. **Monitoring** - Track compliance metrics and trends
6. **Alerts** - Notify immediately on critical violations
7. **Reports** - Generate regular compliance reports
8. **Testing** - Regularly test with known problematic domains

---

For more details, see the main [README.md](./README.md)
