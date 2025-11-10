const logger = require('../logger');
const { detectJurisdiction, isJurisdictionRelevant } = require('./jurisdiction');
const { detectCategories } = require('./category-detector');
const { scanForViolations } = require('./restricted-keywords');
const { getPoliciesByJurisdiction, evaluateRule, getPolicyById } = require('./ruleset');
const policyMap = require('./policy-map.json');

async function runPolicyCheck(crawlData, domain, options = {}) {
  const {
    skipJurisdictionDetection = false,
    skipCategoryDetection = false,
    skipRestrictedKeywords = false,
    skipDetailedAnalysis = false,
  } = options;

  const startTime = Date.now();
  const results = {
    timestamp: new Date().toISOString(),
    domain: domain,
    jurisdiction: null,
    violations: [],
    complianceLevel: 'compliant',
    policies: {},
    summary: {},
    executionTime: 0,
  };

  const checks = [];

  if (!skipJurisdictionDetection) {
    checks.push(
      Promise.resolve().then(() => {
        results.jurisdiction = detectJurisdiction(crawlData);
      })
    );
  }

  await Promise.all(checks);

  const applicablePolicies = getPoliciesByJurisdiction(
    results.jurisdiction?.primaryJurisdiction || 'US'
  );

  const policyChecks = [];

  if (!skipCategoryDetection) {
    policyChecks.push(
      Promise.resolve().then(() => {
        const categoryResults = detectCategories(crawlData);
        results.categories = categoryResults;

        for (const [policyName, policy] of Object.entries(applicablePolicies)) {
          if (!results.policies[policyName]) {
            results.policies[policyName] = {
              name: policy.name,
              status: 'pending',
              violations: [],
            };
          }

          const categoryRules = policy.rules?.filter(r => r.type === 'category') || [];
          categoryRules.forEach(rule => {
            const evaluation = evaluateRule(rule, categoryResults);
            if (evaluation.matched) {
              results.policies[policyName].violations.push({
                type: 'category_violation',
                rule: rule,
                evaluation: evaluation,
                severity: policy.severity,
              });
            }
          });
        }
      })
    );
  }

  if (!skipRestrictedKeywords) {
    policyChecks.push(
      Promise.resolve().then(() => {
        const keywordResults = scanForViolations(crawlData);
        results.restrictedKeywords = keywordResults;

        for (const [policyName, policy] of Object.entries(applicablePolicies)) {
          if (!results.policies[policyName]) {
            results.policies[policyName] = {
              name: policy.name,
              status: 'pending',
              violations: [],
            };
          }

          const restrictedRules = policy.rules?.filter(r => r.type === 'restricted_keyword') || [];
          restrictedRules.forEach(rule => {
            const evaluation = evaluateRule(rule, crawlData);
            if (evaluation.matched) {
              results.policies[policyName].violations.push({
                type: 'restricted_keyword_violation',
                rule: rule,
                evaluation: evaluation,
                severity: policy.severity,
              });
            }
          });
        }
      })
    );
  }

  await Promise.all(policyChecks);

  for (const [policyName, policy] of Object.entries(applicablePolicies)) {
    if (!results.policies[policyName]) {
      results.policies[policyName] = {
        name: policy.name,
        status: 'compliant',
        violations: [],
      };
    }

    const policyResult = results.policies[policyName];
    policyResult.severity = policy.severity;
    policyResult.status = policyResult.violations.length > 0 ? 'violation' : 'compliant';

    if (policyResult.status === 'violation' && policy.severity === 'critical') {
      results.complianceLevel = 'non_compliant';
    } else if (policyResult.status === 'violation' && results.complianceLevel !== 'non_compliant') {
      results.complianceLevel = 'warning';
    }
  }

  aggregateViolations(results);

  results.summary = generateComplianceReport(results, applicablePolicies);
  results.executionTime = Date.now() - startTime;

  logger.info('Policy check completed', {
    domain,
    complianceLevel: results.complianceLevel,
    violationCount: results.violations.length,
    executionTime: results.executionTime,
  });

  return results;
}

function aggregateViolations(results) {
  const violations = [];

  for (const [policyName, policy] of Object.entries(results.policies)) {
    if (policy.violations && policy.violations.length > 0) {
      policy.violations.forEach(violation => {
        violations.push({
          policy: policyName,
          policyName: policy.name,
          severity: policy.severity,
          ...violation,
        });
      });
    }
  }

  violations.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  results.violations = violations;
}

function generateComplianceReport(results, applicablePolicies) {
  const report = {
    complianceLevel: results.complianceLevel,
    totalPolicies: Object.keys(applicablePolicies).length,
    compliantPolicies: 0,
    violatingPolicies: 0,
    totalViolations: results.violations.length,
    criticalViolations: 0,
    highViolations: 0,
    mediumViolations: 0,
    lowViolations: 0,
    jurisdiction: results.jurisdiction?.primaryJurisdiction || 'Unknown',
    violations: [],
    recommendations: [],
    policyStatus: {},
  };

  for (const [policyName, policy] of Object.entries(results.policies)) {
    if (policy.status === 'compliant') {
      report.compliantPolicies++;
    } else {
      report.violatingPolicies++;
    }

    report.policyStatus[policyName] = {
      name: policy.name,
      status: policy.status,
      violationCount: policy.violations?.length || 0,
      severity: policy.severity,
    };
  }

  results.violations.forEach(violation => {
    if (violation.severity === 'critical') report.criticalViolations++;
    else if (violation.severity === 'high') report.highViolations++;
    else if (violation.severity === 'medium') report.mediumViolations++;
    else if (violation.severity === 'low') report.lowViolations++;

    const violationSummary = {
      policy: violation.policyName,
      type: violation.type,
      severity: violation.severity,
    };

    if (violation.type === 'restricted_keyword_violation') {
      violationSummary.keywords = violation.evaluation?.foundKeywords || [];
    } else if (violation.type === 'category_violation') {
      violationSummary.category = violation.evaluation?.category;
      violationSummary.confidence = violation.evaluation?.confidence;
    }

    report.violations.push(violationSummary);
  });

  if (report.criticalViolations > 0) {
    report.recommendations.push('CRITICAL: Address critical policy violations immediately to maintain compliance');
  }

  if (report.highViolations > 0) {
    report.recommendations.push('Review and remediate high-severity policy violations');
  }

  if (results.jurisdiction?.signals.cookieConsent === 'not_detected' &&
      results.jurisdiction?.primaryJurisdiction === 'EU') {
    report.recommendations.push('Missing cookie consent banner: EU GDPR requires explicit consent');
  }

  if (results.categories?.analysis?.riskLevel === 'high') {
    report.recommendations.push(`Content contains ${results.categories.analysis.sensitiveCategories.join(', ')} - verify compliance with brand safety standards`);
  }

  if (results.restrictedKeywords?.total > 0) {
    report.recommendations.push(`${results.restrictedKeywords.total} restricted keywords detected - review content for policy compliance`);
  }

  if (report.violatingPolicies === 0) {
    report.recommendations.push(' Site appears compliant with applicable policies');
  }

  return report;
}

function getComplianceSummary(policyCheckResults) {
  const summary = {
    overallCompliance: policyCheckResults.complianceLevel,
    domain: policyCheckResults.domain,
    jurisdiction: policyCheckResults.jurisdiction?.primaryJurisdiction || 'Unknown',
    scanDate: policyCheckResults.timestamp,
    totalViolations: policyCheckResults.violations.length,
    criticalViolations: (policyCheckResults.summary?.criticalViolations || 0),
    highViolations: (policyCheckResults.summary?.highViolations || 0),
    recommendedActions: policyCheckResults.summary?.recommendations || [],
  };

  return summary;
}

function formatComplianceReport(policyCheckResults) {
  const markdown = `# Policy Compliance Report

**Domain:** ${policyCheckResults.domain}
**Scan Date:** ${policyCheckResults.timestamp}
**Jurisdiction:** ${policyCheckResults.jurisdiction?.primaryJurisdiction || 'Unknown'}
**Compliance Level:** ${policyCheckResults.complianceLevel.toUpperCase()}

## Summary

- **Total Policies Reviewed:** ${policyCheckResults.summary.totalPolicies}
- **Compliant Policies:** ${policyCheckResults.summary.compliantPolicies}
- **Violations Found:** ${policyCheckResults.summary.totalViolations}
- **Critical Violations:** ${policyCheckResults.summary.criticalViolations}

## Violations by Severity

- **Critical:** ${policyCheckResults.summary.criticalViolations}
- **High:** ${policyCheckResults.summary.highViolations}
- **Medium:** ${policyCheckResults.summary.mediumViolations}
- **Low:** ${policyCheckResults.summary.lowViolations}

## Detected Violations

${policyCheckResults.summary.violations.map(v =>
  `- **${v.policy}** (${v.severity.toUpperCase()}): ${v.type}`
).join('\n')}

## Recommendations

${policyCheckResults.summary.recommendations.map(r => `- ${r}`).join('\n')}

## Policy Status

${Object.entries(policyCheckResults.summary.policyStatus).map(([name, status]) =>
  `- **${status.name}**: ${status.status.toUpperCase()} (${status.violationCount} violations)`
).join('\n')}

---
*Report generated on ${new Date().toISOString()}*
`;

  return markdown;
}

module.exports = {
  runPolicyCheck,
  aggregateViolations,
  generateComplianceReport,
  getComplianceSummary,
  formatComplianceReport,
};
