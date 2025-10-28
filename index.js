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
  console.log(`========================================`);
  console.log(`[AUDIT START] Domain: ${domain}`);
  console.log(`[AUDIT START] Publisher ID: ${publisherId}`);
  console.log(`[AUDIT START] Timestamp: ${new Date().toISOString()}`);
  console.log(`========================================`);

  try {
    console.log(`[DB] Creating audit record in site_audits table...`);
    const { data: auditRecord, error: insertError } = await supabase
      .from('site_audits')
      .insert({
        publisher_id: publisherId,
        domain,
        site_url: domain,
        scan_status: 'in_progress'
      })
      .select()
      .single();

    if (insertError) {
      console.error(`[DB] ERROR creating audit record:`, insertError);
      throw new Error(`Failed to create audit record: ${insertError.message}`);
    }

    const auditId = auditRecord?.id;
    console.log(`[DB] Audit record created with ID: ${auditId}`);

    console.log(`[MODULE: CRAWLER] Starting website crawl...`);
    const crawlResult = await crawler.crawlSite(domain);
    console.log(`[MODULE: CRAWLER] Crawl completed - Success: ${crawlResult.success}`);

    if (!crawlResult.success) {
      console.error(`[MODULE: CRAWLER] FAILED - Error: ${crawlResult.error}`);
      const { error: failUpdateError } = await supabase
        .from('site_audits')
        .update({
          scan_status: 'failed',
          error_message: crawlResult.error
        })
        .eq('id', auditId);

      if (failUpdateError) {
        console.error(`[DB] ERROR updating failed status:`, failUpdateError);
      }

      console.log(`[AUDIT END] Failed for ${domain}`);
      return { success: false, error: crawlResult.error };
    }

    console.log(`[MODULE: CONTENT-ANALYZER] Analyzing content quality...`);
    const contentData = contentAnalyzer.analyzeContent(
      crawlResult.htmlContent,
      crawlResult.links
    );
    console.log(`[MODULE: CONTENT-ANALYZER] Content length: ${contentData.contentLength} chars`);

    console.log(`[MODULE: AD-ANALYZER] Analyzing ad density...`);
    const adData = adAnalyzer.analyzeAdDensity(crawlResult.htmlContent);
    console.log(`[MODULE: AD-ANALYZER] Total ads detected: ${adData.totalAds}, Ad density: ${adData.adDensity.toFixed(2)}`);

    console.log(`[MODULE: AD-ANALYZER] Checking for click interference...`);
    const hasClickInterference = adAnalyzer.detectClickInterference(
      crawlResult.htmlContent
    );
    console.log(`[MODULE: AD-ANALYZER] Click interference: ${hasClickInterference ? 'YES' : 'NO'}`);

    console.log(`[MODULE: AD-ANALYZER] Detecting ad networks...`);
    const adNetworks = adAnalyzer.detectAdNetworks(crawlResult.htmlContent);
    console.log(`[MODULE: AD-ANALYZER] Ad networks found: ${adNetworks.count} - ${adNetworks.networks.join(', ')}`);

    console.log(`[MODULE: CONTENT-ANALYZER] Analyzing images...`);
    const imageData = contentAnalyzer.analyzeImages(crawlResult.htmlContent);
    console.log(`[MODULE: CONTENT-ANALYZER] Total images: ${imageData.totalImages}`);

    console.log(`[MODULE: CONTENT-ANALYZER] Analyzing publishing metadata...`);
    const publishingData = contentAnalyzer.analyzePublishingMetadata(
      crawlResult.htmlContent,
      crawlResult.links
    );
    console.log(`[MODULE: CONTENT-ANALYZER] Posts found: ${publishingData.totalPostsFound}`);

    console.log(`[MODULE: SEO-ANALYZER] Analyzing SEO and engagement...`);
    const seoEngagementData = seoAnalyzer.analyzeSEOAndEngagement(
      crawlResult.htmlContent,
      crawlResult.links,
      crawlResult.loadTime,
      crawlResult.metrics
    );
    console.log(`[MODULE: SEO-ANALYZER] SEO score: ${seoEngagementData.score.toFixed(2)}`);

    const seoData = seoEngagementData;
    const engagementData = seoEngagementData;

    console.log(`[MODULE: LAYOUT-ANALYZER] Analyzing layout quality...`);
    const layoutData = layoutAnalyzer.analyzeLayout(crawlResult.htmlContent);
    console.log(`[MODULE: LAYOUT-ANALYZER] Layout score: ${layoutData.score.toFixed(2)}, Menu position: ${layoutData.menuPosition}`);

    console.log(`[TECHNICAL-CHECKS] Running parallel technical checks...`);
    const [adsTxtValid, mobileFriendly, brokenLinks, safeBrowsingResult, domainData] = await Promise.all([
      technicalChecker.checkAdsTxt(domain),
      crawler.checkMobileFriendly(domain),
      technicalChecker.checkBrokenLinks(domain, crawlResult.links),
      contentAnalyzer.checkSafeBrowsing(domain),
      technicalChecker.checkDomainAge(domain)
    ]);
    console.log(`[TECHNICAL-CHECKS] Completed - Ads.txt: ${adsTxtValid ? 'Valid' : 'Invalid'}, Mobile friendly: ${mobileFriendly ? 'Yes' : 'No'}`);

    console.log(`[MODULE: TECHNICAL-CHECKER] Calculating page speed score...`);
    const pageSpeedScore = technicalChecker.calculatePageSpeedScore(
      crawlResult.loadTime,
      crawlResult.metrics
    );
    console.log(`[MODULE: TECHNICAL-CHECKER] Page speed score: ${pageSpeedScore}/100`);

    console.log(`[MODULE: MFA-SCORER] Preparing audit data...`);
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

    console.log(`[MODULE: MFA-SCORER] Calculating website quality score...`);
    const scoreResult = mfaScorer.calculateWebsiteQualityScore(auditData, seoData, engagementData, layoutData);
    console.log(`[MODULE: MFA-SCORER] Website Quality Score: ${scoreResult.websiteQualityScore}/${scoreResult.maxScore}`);

    console.log(`[MODULE: POLICY-COMPLIANCE-CHECKER] Running full compliance checks...`);
    const policyCompliance = await policyChecker.checkFullCompliance(
      domain,
      crawlResult.htmlContent,
      crawlResult.links,
      auditData
    );
    console.log(`[MODULE: POLICY-COMPLIANCE-CHECKER] Compliance Score: ${policyCompliance.overallScore}/100 (${policyCompliance.complianceLevel})`);

    const htmlSnapshot = crawlResult.htmlContent.substring(0, 5000);

    console.log(`[DB] Updating site_audits table with all results...`);
    const { error: updateError } = await supabase
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

    if (updateError) {
      console.error(`[DB] ERROR updating audit record:`, updateError);
      throw new Error(`Failed to update audit record: ${updateError.message}`);
    }

    console.log(`[DB] Database updated successfully`);

    console.log(`[MFA-SCORE] Triggering composite MFA score calculation...`);
    try {
      const scoreResponse = await fetch(
        `${SUPABASE_URL}/functions/v1/calculate-composite-mfa-score`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            publisherIds: [publisherId],
            forceRecalculate: true
          }),
        }
      );

      if (scoreResponse.ok) {
        const scoreResult = await scoreResponse.json();
        console.log(`[MFA-SCORE] Composite score calculated successfully`);
        if (scoreResult.scores && scoreResult.scores[0]) {
          const score = scoreResult.scores[0];
          console.log(`[MFA-SCORE] Overall MFA Score: ${score.overallScore.toFixed(2)}/100`);
          console.log(`[MFA-SCORE] Risk Level: ${score.riskLevel}`);
          console.log(`[MFA-SCORE] Risk Flags: ${score.riskFlags.join(', ') || 'None'}`);
          console.log(`[MFA-SCORE] Recommendations: ${score.recommendations.length} items`);
        }
      } else {
        const errorText = await scoreResponse.text();
        console.error(`[MFA-SCORE] Failed to calculate composite score:`, errorText);
      }
    } catch (scoreError) {
      console.error(`[MFA-SCORE] Error calculating composite score:`, scoreError.message);
    }

    console.log(`========================================`);
    console.log(`[AUDIT COMPLETE] Domain: ${domain}`);
    console.log(`[AUDIT COMPLETE] Website Quality Score: ${scoreResult.websiteQualityScore}/${scoreResult.maxScore}`);
    console.log(`[AUDIT COMPLETE] Policy Compliance: ${policyCompliance.overallScore}/100 (${policyCompliance.complianceLevel})`);
    console.log(`[AUDIT COMPLETE] SEO Score: ${seoData.score.toFixed(2)}`);
    console.log(`[AUDIT COMPLETE] Engagement Score: ${engagementData.score.toFixed(2)}`);
    console.log(`[AUDIT COMPLETE] Layout Score: ${layoutData.score.toFixed(2)}`);
    console.log(`========================================`);

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
    console.error(`========================================`);
    console.error(`[AUDIT ERROR] Domain: ${domain}`);
    console.error(`[AUDIT ERROR] Error Type: ${error.name}`);
    console.error(`[AUDIT ERROR] Error Message: ${error.message}`);
    console.error(`[AUDIT ERROR] Stack Trace:`, error.stack);
    console.error(`========================================`);
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

    // Respond immediately and process in background
    res.json({
      success: true,
      message: `Audit started for ${domain}`,
      publisherId,
      domain
    });

    // Process audit asynchronously in background
    auditWebsite(publisherId, domain).catch(error => {
      console.error(`Background audit error for ${domain}:`, error);
    });

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
