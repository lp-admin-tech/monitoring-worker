/**
 * CDP Crawler Test Script
 * Tests the new raw CDP crawler against a URL
 */

const CDPCrawler = require('../modules/cdp-crawler');

async function test(url) {
    console.log('='.repeat(60));
    console.log('CDP Crawler Test');
    console.log('='.repeat(60));
    console.log('URL:', url);
    console.log('');

    const crawler = new CDPCrawler({
        fingerprint: 'desktop',
        scrollDuration: 20000
    });

    try {
        // Launch without proxy for local test
        console.log('[1] Launching Chrome with CDP...');
        await crawler.launch();
        console.log('    ✓ Chrome launched');

        // Crawl the URL
        console.log('[2] Crawling page...');
        const result = await crawler.crawl(url);

        if (result.success) {
            console.log('    ✓ Crawl successful');
            console.log('');
            console.log('='.repeat(60));
            console.log('RESULTS');
            console.log('='.repeat(60));
            console.log('');

            // MFA Indicators
            console.log('MFA SCORE:', result.mfaIndicators.combinedScore, '/100');
            console.log('Risk Level:', result.mfaIndicators.riskLevel);
            console.log('');

            // Ad Heatmap
            console.log('AD HEATMAP:');
            console.log('  - Total Ads:', result.adHeatmap.totalAdsDetected);
            console.log('  - Ads Above Fold:', result.mfaIndicators.adsAboveFold);
            console.log('  - Avg Density:', (result.mfaIndicators.adDensity * 100).toFixed(1) + '%');
            console.log('  - Avg CLS:', result.mfaIndicators.layoutShift?.toFixed(3) || 'N/A');
            console.log('  - Scroll Levels:', result.adHeatmap.totalScrollLevels);
            console.log('');

            // Network
            console.log('NETWORK:');
            console.log('  - Total Requests:', result.networkAnalysis.totalRequests);
            console.log('  - Ad Requests:', result.networkAnalysis.adRequests);
            console.log('  - Ad Networks:', result.networkAnalysis.adNetworkCount);
            console.log('  - Networks:', result.networkAnalysis.adNetworks.slice(0, 10).join(', '));
            console.log('  - Auto-Refresh:', result.networkAnalysis.hasAutoRefresh ? 'YES ⚠️' : 'No');
            console.log('');

            // Patterns
            if (result.mfaIndicators.suspiciousPatterns.length > 0) {
                console.log('SUSPICIOUS PATTERNS:');
                result.mfaIndicators.suspiciousPatterns.forEach(p => {
                    console.log('  ⚠️', p);
                });
                console.log('');
            }

            // Content
            console.log('CONTENT:');
            console.log('  - Length:', result.contentLength, 'chars');
            console.log('  - Preview:', result.content?.substring(0, 200) + '...');
            console.log('');

            console.log('Duration:', result.duration, 'ms');
        } else {
            console.log('    ✗ Crawl failed:', result.error);
        }

    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        console.log('');
        console.log('[3] Closing crawler...');
        await crawler.close();
        console.log('    ✓ Closed');
    }
}

// Run test
const url = process.argv[2] || 'https://example.com';
test(url).catch(console.error);
