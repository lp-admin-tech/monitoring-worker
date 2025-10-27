import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { WebsiteCrawler } from './modules/crawler.js';
import { ContentAnalyzer } from './modules/content-analyzer.js';
import { AdAnalyzer } from './modules/ad-analyzer.js';
import { TechnicalChecker } from './modules/technical-checker.js';
import { MFAScorer } from './modules/mfa-scorer.js';
import { SEOAnalyzer } from './modules/seo-analyzer.js';
import { LayoutAnalyzer } from './modules/layout-analyzer.js';
import { PolicyComplianceChecker } from './modules/policy-compliance-checker.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PORT = process.env.PORT || 3001;
const WORKER_SECRET = process.env.WORKER_SECRET || 'your-secret-key';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const crawler = new WebsiteCrawler();
const contentAnalyzer = new ContentAnalyzer();
const adAnalyzer = new AdAnalyzer();
const technicalChecker = new TechnicalChecker();
const mfaScorer = new MFAScorer();
const seoAnalyzer = new SEOAnalyzer();
const layoutAnalyzer = new LayoutAnalyzer();
const policyChecker = new PolicyComplianceChecker();

const app = express();
app.use(express.json());

async function auditWebsite(publisherId, domain) {
  console.log(`Starting audit for ${domain} (Publisher: ${publisherId})`);

  try {
    const { data: auditRecord } = await supabase
      .from('site_audits')
      .insert({
        publisher_id: publisherId,
        domain,
        scan_status: 'in_progress'
      })
      .select()
      .single();

    const auditId = auditRecord?.id;

    const crawlResult = await crawler.crawlSite(domain);

    if (!crawlResult.success) {
      await supabase
        .from('site_audits')
        .update({
          scan_status: 'failed',
          error_message: crawlResult.error
        })
        .eq('id', auditId);

      console.error(`Crawl failed for ${domain}: ${crawlResult.error}`);
      return { success: false, error: crawlResult.error };
    }

    console.log(`Crawl successful for ${domain}, analyzing content...`);

    const contentData = contentAnalyzer.analyzeContent(
      crawlResult.htmlContent,
      crawlResult.links
    );

    const adData = adAnalyzer.analyzeAdDensity(crawlResult.htmlContent);

    const hasClickInterference = adAnalyzer.detectClickInterference(
      crawlResult.htmlContent
    );

    const adNetworks = adAnalyzer.detectAdNetworks(crawlResult.htmlContent);

    const imageData = contentAnalyzer.analyzeImages(crawlResult.htmlContent);

    const publishingData = contentAnalyzer.analyzePublishingMetadata(
      crawlResult.htmlContent,
      crawlResult.links
    );

    const seoEngagementData = seoAnalyzer.analyzeSEOAndEngagement(
      crawlResult.htmlContent,
      crawlResult.links,
      crawlResult.loadTime,
      crawlResult.metrics
    );

    const seoData = seoEngagementData;
    const engagementData = seoEngagementData;

    const layoutData = layoutAnalyzer.analyzeLayout(crawlResult.htmlContent);

    console.log(`Performing technical checks for ${domain}...`);

    const [adsTxtValid, mobileFriendly, brokenLinks, safeBrowsingResult, domainData] = await Promise.all([
      technicalChecker.checkAdsTxt(domain),
      crawler.checkMobileFriendly(domain),
      technicalChecker.checkBrokenLinks(domain, crawlResult.links),
      contentAnalyzer.checkSafeBrowsing(domain),
      technicalChecker.checkDomainAge(domain)
    ]);

    const pageSpeedScore = technicalChecker.calculatePageSpeedScore(
      crawlResult.loadTime,
      crawlResult.metrics
    );

    const auditData = {
      contentLength: contentData.contentLength,
      contentUniqueness: contentData.contentUniqueness,
      hasPrivacyPolicy: contentData.hasPrivacyPolicy,
      hasContactPage: contentData.hasContactPage,
      adDensity: adData.adDensity,
      totalAds: adData.totalAds,
      adsAboveFold: adData.adsAboveFold,
      adsInContent: adData.adsInContent,
      adsSidebar: adData.adsSidebar,
      stickyAds: adData.stickyAds,
      autoRefreshAds: adData.autoRefreshAds,
      adToContentRatio: adData.adToContentRatio,
      hasClickInterference,
      adsTxtValid,
      mobileFriendly,
      pageSpeedScore,
      brokenLinks,
      popupsDetected: crawlResult.popupCount,
      loadTime: crawlResult.loadTime,
      hasFeaturedImages: imageData.hasFeaturedImages,
      totalImages: imageData.totalImages,
      imagesWithAlt: imageData.imagesWithAlt,
      optimizedImages: imageData.optimizedImages,
      videosCount: imageData.videosCount,
      hasPublishDates: publishingData.hasPublishDates,
      hasAuthorInfo: publishingData.hasAuthorInfo,
      latestPostDate: publishingData.latestPostDate,
      postFrequencyDays: publishingData.postFrequencyDays,
      totalPostsFound: publishingData.totalPostsFound,
      contentFreshnessScore: publishingData.contentFreshnessScore,
      domainAgeDays: domainData.domainAgeDays,
      domainCreatedDate: domainData.domainCreatedDate,
      sslValid: domainData.sslValid,
      domainAuthorityScore: domainData.domainAuthorityScore,
      safeBrowsing: safeBrowsingResult
    };

    console.log(`Calculating website quality score for ${domain}...`);

    const scoreResult = mfaScorer.calculateWebsiteQualityScore(auditData, seoData, engagementData, layoutData);

    console.log(`Running policy compliance checks for ${domain}...`);

    const policyCompliance = await policyChecker.checkFullCompliance(
      domain,
      crawlResult.htmlContent,
      crawlResult.links,
      auditData
    );

    const htmlSnapshot = crawlResult.htmlContent.substring(0, 5000);

    await supabase
      .from('site_audits')
      .update({
        scanned_at: new Date().toISOString(),
        load_time: crawlResult.loadTime,
        has_privacy_policy: contentData.hasPrivacyPolicy,
        has_contact_page: contentData.hasContactPage,
        ads_txt_valid: adsTxtValid,
        content_length: contentData.contentLength,
        content_uniqueness: contentData.contentUniqueness,
        ad_density: adData.adDensity,
        total_ads: adData.totalAds,
        ads_above_fold: adData.adsAboveFold,
        ads_in_content: adData.adsInContent,
        ads_sidebar: adData.adsSidebar,
        sticky_ads_count: adData.stickyAds,
        auto_refresh_ads: adData.autoRefreshAds,
        ad_to_content_ratio: adData.adToContentRatio,
        page_speed_score: pageSpeedScore,
        mobile_friendly: mobileFriendly,
        popups_detected: crawlResult.popupCount,
        broken_links: brokenLinks,
        has_featured_images: imageData.hasFeaturedImages,
        total_images: imageData.totalImages,
        images_with_alt: imageData.imagesWithAlt,
        optimized_images: imageData.optimizedImages,
        videos_count: imageData.videosCount,
        has_publish_dates: publishingData.hasPublishDates,
        has_author_info: publishingData.hasAuthorInfo,
        latest_post_date: publishingData.latestPostDate?.toISOString(),
        post_frequency_days: publishingData.postFrequencyDays,
        total_posts_found: publishingData.totalPostsFound,
        content_freshness_score: publishingData.contentFreshnessScore,
        domain_age_days: domainData.domainAgeDays,
        domain_created_date: domainData.domainCreatedDate?.toISOString(),
        ssl_valid: domainData.sslValid,
        domain_authority_score: domainData.domainAuthorityScore,
        mfa_score: scoreResult.websiteQualityScore,
        safe_browsing_status: safeBrowsingResult.isSafe ? 'safe' : 'unsafe',
        safe_browsing_threats: safeBrowsingResult.threats || [],
        seo_score: seoData.score,
        seo_meta_quality: seoData.metaQuality,
        seo_keyword_spam_score: seoData.keywordSpamScore,
        seo_navigation_status: seoData.navigationStatus,
        seo_categories_checked: seoData.categoriesChecked,
        seo_categories_with_articles: seoData.categoriesWithArticles,
        seo_has_sitemap: seoData.sitemap,
        seo_has_robots_txt: seoData.robotsTxt,
        seo_issues: seoData.issues,
        engagement_score: engagementData.score,
        engagement_scroll_depth: engagementData.avgScrollDepth,
        engagement_session_time: engagementData.sessionTimeEstimate,
        engagement_clickable_links: engagementData.clickableLinks,
        engagement_navigation_blocked: engagementData.navigationBlocked,
        engagement_redirects_detected: engagementData.redirectsDetected,
        engagement_issues: engagementData.issues,
        layout_score: layoutData.score,
        layout_menu_position: layoutData.menuPosition,
        layout_content_above_fold: layoutData.contentAboveFold,
        layout_content_before_ads: layoutData.contentBeforeAds,
        layout_menu_accessible: layoutData.menuAccessible,
        layout_overlapping_ads: layoutData.overlappingAds,
        layout_issues: layoutData.issues,
        ad_networks_detected: adNetworks.networks,
        ad_networks_count: adNetworks.count,
        has_google_ads: adNetworks.hasGoogleAds,
        has_multiple_ad_networks: adNetworks.hasMultipleNetworks,
        policy_compliance_score: policyCompliance.overallScore,
        policy_compliance_level: policyCompliance.complianceLevel,
        policy_critical_issues: policyCompliance.criticalIssues,
        policy_user_consent_score: policyCompliance.checks.userConsent.score,
        policy_cookie_compliance_score: policyCompliance.checks.cookieCompliance.score,
        policy_content_violations: policyCompliance.checks.contentPolicy.issues,
        policy_ad_placement_score: policyCompliance.checks.adPlacement.score,
        policy_technical_compliance_score: policyCompliance.checks.technicalCompliance.score,
        policy_invalid_traffic_risk_score: policyCompliance.checks.invalidTraffic.score,
        policy_transparency_score: policyCompliance.checks.transparency.score,
        policy_data_handling_score: policyCompliance.checks.dataHandling.score,
        policy_recommendations: policyCompliance.recommendations,
        has_consent_mechanism: policyCompliance.checks.userConsent.hasConsentMechanism,
        has_opt_out_option: policyCompliance.checks.userConsent.hasOptOut,
        mentions_third_party_ads: policyCompliance.checks.userConsent.mentionsThirdParties,
        has_cookie_policy: policyCompliance.checks.cookieCompliance.cookiePolicyExists,
        has_pii_protection: policyCompliance.checks.cookieCompliance.hasPIIProtection,
        coppa_compliant: policyCompliance.checks.contentPolicy.isCoppaCompliant,
        content_value_score: policyCompliance.checks.contentPolicy.contentValueScore,
        encourages_ad_clicks: policyCompliance.checks.invalidTraffic.encouragesClicks,
        has_hidden_iframes: policyCompliance.checks.technicalCompliance.hiddenIframes > 0,
        has_about_page: policyCompliance.checks.transparency.hasAboutPage,
        has_sponsored_content_disclosure: policyCompliance.checks.transparency.hasDisclaimer,
        raw_html_snapshot: htmlSnapshot,
        scan_status: 'completed'
      })
      .eq('id', auditId);

    console.log(
      `Audit completed for ${domain}. Website Quality Score: ${scoreResult.websiteQualityScore}/60, Policy Compliance: ${policyCompliance.overallScore}/100 (${policyCompliance.complianceLevel})`
    );

    return {
      success: true,
      auditId,
      websiteQualityScore: scoreResult.websiteQualityScore,
      maxScore: scoreResult.maxScore,
      componentScores: scoreResult.componentScores,
      breakdown: scoreResult.breakdown,
      recommendations: mfaScorer.generateRecommendations(auditData, scoreResult.breakdown, seoData, engagementData, layoutData),
      seoScore: seoData.score,
      engagementScore: engagementData.score,
      layoutScore: layoutData.score,
      adNetworks: adNetworks.networks,
      policyCompliance: {
        score: policyCompliance.overallScore,
        level: policyCompliance.complianceLevel,
        criticalIssues: policyCompliance.criticalIssues,
        recommendations: policyCompliance.recommendations
      }
    };

  } catch (error) {
    console.error(`Audit error for ${domain}:`, error);
    return { success: false, error: error.message };
  }
}

app.post('/audit', async (req, res) => {
  try {
    const { secret, publisherId, domain } = req.body;

    if (secret !== WORKER_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!publisherId || !domain) {
      return res.status(400).json({ error: 'Missing publisherId or domain' });
    }

    const result = await auditWebsite(publisherId, domain);

    res.json(result);

  } catch (error) {
    console.error('Audit endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/audit-batch', async (req, res) => {
  try {
    const { secret, publishers } = req.body;

    if (secret !== WORKER_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!publishers || !Array.isArray(publishers)) {
      return res.status(400).json({ error: 'Invalid publishers array' });
    }

    res.json({ message: 'Batch audit started', count: publishers.length });

    for (const publisher of publishers) {
      try {
        await auditWebsite(publisher.id, publisher.domain);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Error auditing ${publisher.domain}:`, error);
      }
    }

  } catch (error) {
    console.error('Batch audit error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/audit-all', async (req, res) => {
  try {
    const { secret } = req.query;

    if (secret !== WORKER_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data: publishers, error } = await supabase
      .from('publishers')
      .select('id, domain')
      .not('domain', 'is', null);

    if (error) throw error;

    res.json({ message: 'Audit all started', count: publishers.length });

    for (const publisher of publishers) {
      try {
        await auditWebsite(publisher.id, publisher.domain);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.error(`Error auditing ${publisher.domain}:`, error);
      }
    }

  } catch (error) {
    console.error('Audit all error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'site-monitoring-worker' });
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, cleaning up...');
  await crawler.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, cleaning up...');
  await crawler.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Site Monitoring Worker running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  POST /audit - Audit a single site`);
  console.log(`  POST /audit-batch - Audit multiple sites`);
  console.log(`  GET /audit-all - Audit all publishers`);
  console.log(`  GET /health - Health check`);
});
