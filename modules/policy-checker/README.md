# Policy Checker Module - Compliance Validation System

A comprehensive compliance validation system for the site-monitoring-worker that ensures websites follow Google, GDPR, CCPA, COPPA, and IAS policy standards.

## Overview

The Policy Checker Module uses multi-layered detection to identify policy violations and ensure compliance with global regulatory frameworks. It combines jurisdiction detection, NLP-based content classification, keyword matching, and technical analysis.

## Architecture

### Core Components

#### 1. **index.js** - Orchestrator
Runs all policy checks in parallel and aggregates results into comprehensive compliance reports.

**Key Functions:**
- `runPolicyCheck(crawlData, domain, options)` - Main entry point
- `generateComplianceReport()` - Creates detailed compliance analysis
- `formatComplianceReport()` - Generates markdown-formatted reports
- `getComplianceSummary()` - Returns concise summary

#### 2. **jurisdiction.js** - Geographic Detection
Detects applicable jurisdictions using multiple signals:
- **TLD Analysis** (.de → EU, .us → US, etc.)
- **Language Tags** (HTML lang attribute)
- **Currency Indicators** ($, €, £, etc.)
- **IP Geolocation** (when available)
- **Cookie Consent Detection** (GDPR indicator)
- **Privacy Indicators** (GDPR, CCPA, COPPA notices)

**Jurisdiction Map:**
- EU: Germany, France, UK, Netherlands, etc.
- US: Federal United States
- US_CA: California (CCPA/CPRA)
- CA: Canada (PIPEDA/CASL)
- AU: Australia
- JP, CN, IN, etc.

#### 3. **category-detector.js** - Content Classification
NLP-based categorization using keyword analysis and content indicators.

**Supported Categories:**
- adult
- gambling
- violence
- drugs
- weapons
- hate
- education
- health
- news
- finance
- technology

**Detection Methods:**
- Primary keyword patterns (high weight)
- Secondary keyword patterns (medium weight)
- Content indicators (URLs, domains, metadata, images)
- Entropy analysis for pattern detection

#### 4. **restricted-keywords.js** - Policy Violation Detection
Pattern-based detection of banned monetization phrases and prohibited content.

**Keyword Categories:**
- **Monetization Abuse:** Ad blocking tricks, deceptive CTAs, fake system warnings
- **Prohibited Content:** Counterfeits, hacking, financial fraud, fake credentials
- **Regulatory Violations:** Undisclosed affiliations, health fraud, get-rich-quick schemes
- **Google Banned:** Adult, gambling, drugs

#### 5. **ruleset.js** - Dynamic Policy Definitions
JSON-based policy definitions with flexible rule evaluation engine.

**Policy Scopes:**
- Google Policies (AdSense, AdMob)
- CCPA/GDPR Rules (data protection)
- IAS Standards (brand safety)

**Rule Types:**
- `keyword` - Pattern matching with context
- `category` - Content categorization
- `entropy` - Text randomness analysis
- `clickbait` - Deceptive title detection
- `restricted_keyword` - Banned phrase matching
- `technical` - Technical checks
- `content` - Content metadata validation

#### 6. **policy-map.json** - Policy Registry
Central registry mapping policies to detection logic and compliance frameworks.

**Structure:**
```json
{
  "policies": [
    {
      "id": "policy_id",
      "name": "Policy Name",
      "provider": "Google/EU/IAS",
      "severity": "critical/high/medium/low",
      "detectionLogic": { ... },
      "jurisdictions": ["global", "US", "EU"],
      "complianceFrameworks": ["Google AdSense", "GDPR"]
    }
  ],
  "detectionComponents": { ... },
  "violationSeverity": { ... },
  "complianceFrameworks": { ... }
}
```

## Supported Policies

### Google Policies
- **No Adult Content** - Prohibits pornographic/explicit content (Critical)
- **No Gambling** - Prohibits casino, poker, betting content (Critical)
- **No Malware** - Prohibits unsafe software and exploits (Critical)
- **No Deceptive Practices** - Prohibits clickbait, ad blocking evasion (High)
- **No Violent Content** - Prohibits violence and hate speech (High)

### Regulatory Compliance
- **COPPA Compliance** - Children's privacy protection (US) (Critical)
- **GDPR Compliance** - EU data protection (EU) (High)
- **CCPA Compliance** - California privacy (US_CA) (High)

### Industry Standards
- **IAS Brand Safety** - Integral Ad Science standards (High)
- **IAS Viewability** - Ad viewability requirements (Medium)

## Usage

### Basic Usage

```javascript
const { runPolicyCheck } = require('./modules/policy-checker');

const crawlData = {
  url: 'https://example.com',
  html: '<html>...</html>',
  content: 'Page content...',
  title: 'Page Title',
  metadata: { keywords: 'key1, key2' }
};

const results = await runPolicyCheck(crawlData, 'example.com');

console.log(results.complianceLevel); // 'compliant', 'warning', or 'non_compliant'
console.log(results.violations); // Array of violations
console.log(results.summary); // Compliance report
```

### With Options

```javascript
const results = await runPolicyCheck(crawlData, 'example.com', {
  skipJurisdictionDetection: false,
  skipCategoryDetection: false,
  skipRestrictedKeywords: false,
  skipDetailedAnalysis: false
});
```

### Generate Reports

```javascript
const { getComplianceSummary, formatComplianceReport } = require('./modules/policy-checker');

const summary = getComplianceSummary(results);
const markdownReport = formatComplianceReport(results);
```

## Output Structure

### Compliance Results

```javascript
{
  timestamp: '2024-11-09T03:56:00.000Z',
  domain: 'example.com',
  jurisdiction: {
    primaryJurisdiction: 'EU',
    allJurisdictions: ['EU', 'US'],
    signals: { ... },
    confidence: 0.85
  },
  violations: [
    {
      policy: 'no_gambling',
      policyName: 'No Gambling Content',
      severity: 'critical',
      type: 'restricted_keyword_violation',
      keywords: ['best casino sites', 'poker']
    }
  ],
  complianceLevel: 'non_compliant', // 'compliant' | 'warning' | 'non_compliant'
  policies: {
    'no_gambling': {
      name: 'No Gambling Content',
      status: 'violation',
      severity: 'critical',
      violations: [...]
    }
  },
  summary: {
    complianceLevel: 'non_compliant',
    totalPolicies: 10,
    compliantPolicies: 8,
    violatingPolicies: 2,
    totalViolations: 3,
    criticalViolations: 1,
    highViolations: 2,
    recommendations: [...]
  }
}
```

## Severity Levels

| Level | Action | Description |
|-------|--------|-------------|
| **critical** | immediate_suspension | Immediate action required |
| **high** | warning_and_monitoring | Corrective action required |
| **medium** | monitoring | Attention required |
| **low** | observation | Observation only |

## Integration with Site Monitoring

The Policy Checker Module integrates with the site-monitoring-worker pipeline:

1. **Crawler** captures page data (content, metadata, structure)
2. **Policy Checker** analyzes compliance
3. **Results** feed into audit queue and dashboards

```javascript
const crawler = require('./crawler');
const { runPolicyCheck } = require('./policy-checker');

const crawlData = await crawler.crawlSite(url);
const policyResults = await runPolicyCheck(crawlData, domain);

// Store or process results
```

## Performance

- **Parallel Execution:** All checks run concurrently
- **Execution Time:** Typically 100-500ms
- **Memory Efficient:** Streaming processing of large content
- **Scalable:** Handles multiple concurrent scans

## Compliance Frameworks

Supported frameworks and standards:
- Google AdSense
- Google AdMob
- GDPR (EU)
- COPPA (US - Children)
- CCPA/CPRA (California)
- CASL (Canada)
- IAS (Integral Ad Science)
- FTC (Federal Trade Commission)

## Extension Points

### Custom Keywords

```javascript
const { createCustomKeywordList } = require('./restricted-keywords');

const customKeywords = createCustomKeywordList({
  custom_category: ['keyword1', 'keyword2']
});
```

### Custom Policies

Extend ruleset.js:
```javascript
const ALL_POLICIES = {
  MY_CUSTOM_POLICY: {
    id: 'my_custom_policy',
    rules: [ ... ]
  },
  ...GOOGLE_POLICIES
};
```

### Custom Jurisdiction Rules

Extend JURISDICTION_COMPLIANCE_POLICIES in jurisdiction.js

## Testing

Run the integration test:
```bash
node modules/policy-checker/test-integration.js
```

Test output includes:
- Compliance summary
- Detailed markdown report
- Full results object

## Data Safety

- **No PII Storage:** Keywords and patterns don't capture personal data
- **No Content Caching:** Results are ephemeral
- **No Third-Party Transmission:** Analysis stays in-process
- **Audit Trail:** All violations logged for review

## Future Enhancements

- [ ] Machine learning classification refinement
- [ ] Custom policy builder UI
- [ ] Real-time violation alerts
- [ ] Policy update notifications
- [ ] Internationalization for more jurisdictions
- [ ] Advanced entropy analysis for obfuscation detection
