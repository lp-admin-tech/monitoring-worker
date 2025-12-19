/**
 * CDP Full Analysis Test Script
 * Tests CDP crawler + ALL analysis modules (like the real worker)
 */

const CDPCrawler = require('../modules/cdp-crawler');
const ContentAnalyzer = require('../modules/content-analyzer');
const AdBehaviorAggregator = require('../modules/ad-analyzer');
const { runPolicyCheck } = require('../modules/policy-checker');
const { runTechnicalHealthCheck } = require('../modules/technical-checker');

// Helper to convert CDP data to format expected by modules
function convertToCrawlDataFormat(crawlResult, publisherId) {
    const networkRequests = crawlResult.networkAnalysis?.rawRequests || [];
    const harEntries = networkRequests.map(req => ({
        request: { url: req.url, method: req.method || 'GET' },
        response: { status: req.status || 200, bodySize: req.size || 0 },
        startedDateTime: new Date(req.timestamp || Date.now()).toISOString()
    }));

    const adElements = [];
    (crawlResult.adHeatmap?.levels || []).forEach(level => {
        (level.ads || []).forEach(ad => {
            adElements.push({
                selector: ad.selector, tagName: ad.tagName, id: ad.id,
                className: ad.className, x: ad.x, y: ad.y,
                width: ad.width, height: ad.height,
                isAboveFold: ad.isAboveFold || false, isIframe: ad.isIframe || false
            });
        });
    });

    return {
        publisherId, url: crawlResult.url,
        har: { log: { entries: harEntries } },
        adElements, networkRequests, requests: networkRequests,
        content: crawlResult.content,
        adNetworks: crawlResult.networkAnalysis?.adNetworks || [],
        hasAutoRefresh: crawlResult.networkAnalysis?.hasAutoRefresh || false,
        adDensity: crawlResult.mfaIndicators?.adDensity || 0,
        adsAboveFold: crawlResult.mfaIndicators?.adsAboveFold || 0,
        totalAds: crawlResult.mfaIndicators?.totalAds || 0,
        contentLength: crawlResult.contentLength || 0
    };
}

async function test(url) {
    console.log('='.repeat(70));
    console.log('CDP FULL ANALYSIS TEST (All Modules)');
    console.log('='.repeat(70));
    console.log('URL:', url);
    console.log('');

    const crawler = new CDPCrawler({ fingerprint: 'desktop', scrollDuration: 20000 });
    const contentAnalyzer = new ContentAnalyzer();
    const adAnalyzer = new AdBehaviorAggregator();
    const publisherId = 'test-publisher-' + Date.now();
    const viewport = { width: 1920, height: 1080 };

    try {
        // ========== PHASE 1: CDP CRAWL ==========
        console.log('[1] Launching Chrome with CDP...');
        await crawler.launch();
        console.log('    ✓ Chrome launched');

        console.log('[2] Crawling page...');
        const crawlResult = await crawler.crawl(url);

        if (!crawlResult.success) {
            console.log('    ✗ Crawl failed:', crawlResult.error);
            return;
        }
        console.log('    ✓ Crawl complete (' + crawlResult.duration + 'ms)');
        console.log('');

        // ========== PHASE 2: CONTENT ANALYSIS ==========
        console.log('[3] Running Content Analysis...');
        let contentResult = null;
        try {
            contentResult = await contentAnalyzer.analyzeContent(crawlResult.content || '');
            console.log('    ✓ Content analysis complete');
        } catch (err) {
            console.log('    ✗ Content analysis failed:', err.message);
        }

        // ========== PHASE 3: AD BEHAVIOR ANALYSIS ==========
        console.log('[4] Running Ad Behavior Analysis...');
        let adResult = null;
        try {
            const crawlData = convertToCrawlDataFormat(crawlResult, publisherId);
            adResult = adAnalyzer.aggregateAnalysis(crawlData, viewport);
            console.log('    ✓ Ad analysis complete');
        } catch (err) {
            console.log('    ✗ Ad analysis failed:', err.message);
        }

        // ========== PHASE 4: POLICY CHECK ==========
        console.log('[5] Running Policy Check...');
        let policyResult = null;
        try {
            const crawlData = convertToCrawlDataFormat(crawlResult, publisherId);
            const hostname = new URL(url).hostname;
            policyResult = await runPolicyCheck(crawlData, hostname);
            console.log('    ✓ Policy check complete');
        } catch (err) {
            console.log('    ✗ Policy check failed:', err.message);
        }

        // ========== PHASE 5: TECHNICAL CHECK ==========
        console.log('[6] Running Technical Health Check...');
        let technicalResult = null;
        try {
            const crawlData = convertToCrawlDataFormat(crawlResult, publisherId);
            const hostname = new URL(url).hostname;
            technicalResult = await runTechnicalHealthCheck(crawlData, hostname, {
                skipBrokenLinks: true,
                skipViewportOcclusion: true
            });
            console.log('    ✓ Technical check complete');
        } catch (err) {
            console.log('    ✗ Technical check failed:', err.message);
        }

        // ========== RESULTS ==========
        console.log('');
        console.log('='.repeat(70));
        console.log('FULL ANALYSIS RESULTS');
        console.log('='.repeat(70));
        console.log('');

        // CDP MFA Indicators
        console.log('📊 MFA INDICATORS (CDP):');
        console.log('   Combined Score:', crawlResult.mfaIndicators?.combinedScore || 0, '/100');
        console.log('   Risk Level:', crawlResult.mfaIndicators?.riskLevel || 'UNKNOWN');
        console.log('   Heatmap Score:', crawlResult.mfaIndicators?.heatmapScore || 0);
        console.log('   Network Score:', crawlResult.mfaIndicators?.networkScore || 0);
        console.log('');

        // Ad Heatmap
        console.log('📈 AD HEATMAP:');
        console.log('   Total Ads:', crawlResult.adHeatmap?.totalAdsDetected || 0);
        console.log('   Ads Above Fold:', crawlResult.mfaIndicators?.adsAboveFold || 0);
        console.log('   Avg Density:', ((crawlResult.mfaIndicators?.adDensity || 0) * 100).toFixed(1) + '%');
        console.log('   Avg CLS:', (crawlResult.mfaIndicators?.layoutShift || 0).toFixed(3));
        console.log('   Scroll Levels:', crawlResult.adHeatmap?.totalScrollLevels || 0);
        console.log('   Infinite Scroll MFA:', crawlResult.adHeatmap?.infiniteAdsPattern ? 'YES ⚠️' : 'No');
        console.log('');

        // Network
        console.log('🌐 NETWORK ANALYSIS:');
        console.log('   Total Requests:', crawlResult.networkAnalysis?.totalRequests || 0);
        console.log('   Ad Requests:', crawlResult.networkAnalysis?.adRequests || 0);
        console.log('   Ad Networks:', (crawlResult.networkAnalysis?.adNetworks || []).slice(0, 5).join(', '));
        console.log('   Auto-Refresh:', crawlResult.networkAnalysis?.hasAutoRefresh ? 'YES ⚠️' : 'No');
        console.log('   Prebid Events:', crawlResult.networkAnalysis?.prebidEvents || 0);
        console.log('   VAST Calls:', crawlResult.networkAnalysis?.vastCalls || 0);
        console.log('');

        // Suspicious Patterns
        const patterns = crawlResult.mfaIndicators?.suspiciousPatterns || [];
        if (patterns.length > 0) {
            console.log('⚠️  SUSPICIOUS PATTERNS:');
            patterns.forEach(p => console.log('   -', p));
            console.log('');
        }

        // Content Analysis
        if (contentResult && !contentResult.error) {
            console.log('📝 CONTENT ANALYSIS:');
            console.log('   Word Count:', contentResult.readability?.wordCount || 0);
            console.log('   Reading Level:', contentResult.readability?.readingLevel || 'N/A');
            console.log('   AI Likelihood:', ((contentResult.aiLikelihood?.aiLikelihood || 0) * 100).toFixed(1) + '%');
            console.log('   Clickbait Score:', ((contentResult.clickbait?.clickbaitScore || 0) * 100).toFixed(1) + '%');
            console.log('   Freshness:', contentResult.freshness?.freshness || 'N/A');
            console.log('   Content Quality:', ((contentResult.qualityScore || 0) * 100).toFixed(1) + '%');
            if (contentResult.thinContent?.isThinContent) {
                console.log('   ⚠️ THIN CONTENT DETECTED');
            }
            console.log('');
        }

        // Ad Behavior Analysis
        if (adResult && !adResult.error) {
            console.log('🎯 AD BEHAVIOR ANALYSIS:');
            console.log('   Risk Score:', adResult.riskAssessment?.overallRiskScore || 0, '/100');
            console.log('   Risk Level:', adResult.riskAssessment?.riskLevel || 'N/A');
            console.log('   Ad Density Score:', adResult.analysis?.density?.score || 0);
            console.log('   Visibility Score:', adResult.analysis?.visibility?.score || 0);
            console.log('   Auto-Refresh:', adResult.analysis?.autoRefresh?.detected ? 'YES ⚠️' : 'No');
            console.log('   Scroll Injection:', adResult.analysis?.scrollInjection?.summary?.scrollInjectionDetected ? 'YES ⚠️' : 'No');
            console.log('   Traffic Arbitrage:', adResult.analysis?.trafficArbitrage?.summary?.arbitrageDetected ? 'YES ⚠️' : 'No');
            console.log('');
        }

        // Policy Check
        if (policyResult && !policyResult.error) {
            console.log('📋 POLICY CHECK:');
            console.log('   Compliance Level:', policyResult.complianceLevel || 'N/A');
            console.log('   Violations:', policyResult.violations?.length || 0);
            console.log('   Jurisdiction:', policyResult.jurisdiction?.primaryJurisdiction || 'N/A');
            if (policyResult.violations?.length > 0) {
                console.log('   ⚠️ VIOLATIONS:');
                policyResult.violations.slice(0, 3).forEach(v => {
                    console.log('      -', v.type || v.rule?.id || 'Unknown');
                });
            }
            console.log('');
        }

        // Technical Health
        if (technicalResult && !technicalResult.error) {
            console.log('🔧 TECHNICAL HEALTH:');
            console.log('   Health Score:', technicalResult.technicalHealthScore || 0, '/100');
            console.log('   SSL Valid:', technicalResult.components?.ssl?.valid ? 'YES ✓' : 'NO ✗');
            console.log('   SSL Expiry:', technicalResult.components?.ssl?.daysToExpiry || 'N/A', 'days');
            console.log('   ads.txt Found:', technicalResult.components?.adsTxt?.found ? 'YES ✓' : 'NO ✗');
            console.log('   ads.txt Valid:', technicalResult.components?.adsTxt?.valid ? 'YES ✓' : 'NO ✗');
            console.log('   Safe Browsing:', technicalResult.components?.safeBrowsing?.safe === true ? 'SAFE ✓' :
                technicalResult.components?.safeBrowsing?.safe === false ? 'UNSAFE ✗' : 'N/A');
            console.log('   Performance Score:', technicalResult.components?.performance?.score || 0);
            console.log('');
        }

        // Summary
        console.log('='.repeat(70));
        console.log('SUMMARY');
        console.log('='.repeat(70));
        console.log('   CDP MFA Score:', crawlResult.mfaIndicators?.combinedScore || 0, '/100');
        console.log('   Ad Risk Score:', adResult?.riskAssessment?.overallRiskScore || 0, '/100');
        console.log('   Technical Score:', technicalResult?.technicalHealthScore || 0, '/100');
        console.log('   Compliance:', policyResult?.complianceLevel || 'N/A');
        console.log('   Total Duration:', crawlResult.duration, 'ms');
        console.log('');

    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        console.log('[7] Closing crawler...');
        await crawler.close();
        console.log('    ✓ Closed');
    }
}

// Run test
const url = process.argv[2] || 'https://example.com';
test(url).catch(console.error);
