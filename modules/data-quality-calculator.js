/**
 * Data Quality Calculator Module
 * Calculates data quality metrics based on module success and data completeness
 */

/**
 * Calculate data quality metrics based on module success and data completeness
 * @param {Object} modules - Module results
 * @param {Object} crawlData - Crawler data
 * @returns {Object} Data quality assessment
 */
function calculateDataQuality(modules, crawlData) {
    const metricsCollected = {};
    const failures = [];
    let successCount = 0;
    const totalModules = 5; // crawler, content, ads, policy, technical

    // Check crawler
    const crawlerContentLength = crawlData?.contentLength || (crawlData?.content?.length) || 0;
    if (crawlData && crawlerContentLength >= 100) {
        metricsCollected.crawler = true;
        successCount++;
    } else {
        metricsCollected.crawler = false;
        failures.push({
            module: 'crawler',
            reason: 'Insufficient content extracted',
            contentLength: crawlerContentLength,
            timestamp: new Date().toISOString()
        });
    }

    // Check content analyzer
    const contentData = modules.contentAnalyzer?.data || modules.contentAnalyzer;
    const contentTextLength = contentData?.textLength || 0;
    const contentEntropyScore = contentData?.entropy?.entropyScore || 0;
    if (contentData && !contentData.error && (contentTextLength > 50 || contentEntropyScore > 0)) {
        metricsCollected.content = true;
        successCount++;
    } else {
        metricsCollected.content = false;
        failures.push({
            module: 'content',
            reason: contentData?.error || 'Content analysis failed or returned zero metrics',
            textLength: contentTextLength,
            entropyScore: contentEntropyScore,
            timestamp: new Date().toISOString()
        });
    }

    // Check ad analyzer
    const adData = modules.adAnalyzer?.data || modules.adAnalyzer;
    const totalAds = adData?.summary?.totalAds ?? adData?.totalAds ?? 0;
    const adDensity = adData?.summary?.adDensity ?? adData?.adDensity ?? -1;
    if (adData && !adData.error && (totalAds >= 0 || adDensity >= 0)) {
        metricsCollected.ads = true;
        successCount++;
    } else {
        metricsCollected.ads = false;
        failures.push({
            module: 'ads',
            reason: adData?.error || 'Ad analysis returned no data',
            totalAds: totalAds,
            timestamp: new Date().toISOString()
        });
    }

    // Check policy checker
    const policyData = modules.policyChecker?.data || modules.policyChecker;
    const hasPolicyData = policyData && !policyData.error && (
        policyData.issues !== undefined ||
        policyData.violations !== undefined ||
        policyData.complianceLevel !== undefined ||
        policyData.policyViolations !== undefined
    );
    if (hasPolicyData) {
        metricsCollected.policy = true;
        successCount++;
    } else {
        metricsCollected.policy = false;
        failures.push({
            module: 'policy',
            reason: policyData?.error || 'Policy check failed or returned no data',
            timestamp: new Date().toISOString()
        });
    }

    // Check technical checker
    const technicalData = modules.technicalChecker?.data || modules.technicalChecker;
    const pageLoadTime = technicalData?.performance?.pageLoadTime ?? technicalData?.components?.performance?.pageLoadTime ?? 0;
    const hasTechnicalData = technicalData && !technicalData.error && (
        pageLoadTime > 0 ||
        technicalData?.performance ||
        technicalData?.components?.performance ||
        technicalData?.components?.ssl?.valid !== undefined ||
        technicalData?.sslValid !== undefined ||
        technicalData?.summary
    );
    if (hasTechnicalData) {
        metricsCollected.technical = true;
        successCount++;
    } else {
        metricsCollected.technical = false;
        failures.push({
            module: 'technical',
            reason: technicalData?.error || 'Technical check failed or returned no performance data',
            pageLoadTime: pageLoadTime,
            timestamp: new Date().toISOString()
        });
    }

    // Calculate quality score (0.0 - 1.0)
    const baseScore = successCount / totalModules;
    const failurePenalty = Math.min(failures.length * 0.05, 0.3);
    const qualityScore = Math.max(baseScore - failurePenalty, 0.0);

    // Determine quality level
    let qualityLevel;
    if (qualityScore >= 0.9) qualityLevel = 'excellent';
    else if (qualityScore >= 0.7) qualityLevel = 'good';
    else if (qualityScore >= 0.5) qualityLevel = 'warning';
    else qualityLevel = 'critical';

    // Audit is complete if at least 70% of metrics collected (3 out of 5)
    const isComplete = successCount >= Math.ceil(totalModules * 0.7);

    return {
        score: Math.round(qualityScore * 100) / 100,
        level: qualityLevel,
        isComplete,
        metricsCollected,
        failures,
        successCount,
        totalModules
    };
}

module.exports = { calculateDataQuality };
