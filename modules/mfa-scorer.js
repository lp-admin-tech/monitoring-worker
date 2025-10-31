export class MFAScorer {
  constructor(supabaseClient = null) {
  }
  /**
   * Calculates website quality score ONLY (0-60 points)
   * Does NOT include GAM metrics - those are calculated by the composite scoring edge function
   * Breakdown:
   * - Content Quality: 20 points
   * - Ad Compliance: 15 points
   * - Technical Quality: 15 points
   * - SEO & Engagement: 10 points
   */
  async calculateWebsiteQualityScore(auditData, seoData = null, engagementData = null, layoutData = null) {
    console.log('[MFA-SCORER] Starting website quality score calculation');
    let score = 0;
    const breakdown = {
      contentQuality: 0,
      adCompliance: 0,
      technicalQuality: 0,
      seoEngagement: 0
    };

    // CONTENT QUALITY (20 points total)
    let contentQualityScore = 0;

    // Content length >= 300 chars: 5 points
    if (auditData.contentLength >= 300) {
      contentQualityScore += 5;
      breakdown.contentLength = 5;
    } else {
      breakdown.contentLength = Math.floor((auditData.contentLength / 300) * 5);
      contentQualityScore += breakdown.contentLength;
    }

    // Content uniqueness >= 50%: 4 points
    if (auditData.contentUniqueness >= 50) {
      contentQualityScore += 4;
      breakdown.contentUniqueness = 4;
    } else {
      breakdown.contentUniqueness = Math.floor((auditData.contentUniqueness / 50) * 4);
      contentQualityScore += breakdown.contentUniqueness;
    }

    // Has privacy policy: 3 points
    breakdown.privacyPolicy = auditData.hasPrivacyPolicy ? 3 : 0;
    contentQualityScore += breakdown.privacyPolicy;

    // Has contact page: 3 points
    breakdown.contactPage = auditData.hasContactPage ? 3 : 0;
    contentQualityScore += breakdown.contactPage;

    // Content freshness score >= 60: 5 points
    if (auditData.contentFreshnessScore >= 60) {
      breakdown.contentFreshness = 5;
      contentQualityScore += 5;
    } else if (auditData.contentFreshnessScore >= 40) {
      breakdown.contentFreshness = 3;
      contentQualityScore += 3;
    } else if (auditData.contentFreshnessScore >= 20) {
      breakdown.contentFreshness = 1;
      contentQualityScore += 1;
    } else {
      breakdown.contentFreshness = 0;
    }

    breakdown.contentQuality = contentQualityScore;
    score += contentQualityScore;

    // AD COMPLIANCE (15 points total)
    let adComplianceScore = 0;

    // Ad density < 0.15: 5 points
    if (auditData.adDensity < 0.15) {
      adComplianceScore += 5;
      breakdown.adDensity = 5;
    } else if (auditData.adDensity < 0.20) {
      adComplianceScore += 3;
      breakdown.adDensity = 3;
    } else if (auditData.adDensity < 0.30) {
      adComplianceScore += 1;
      breakdown.adDensity = 1;
    } else {
      breakdown.adDensity = 0;
    }

    // No auto-refresh ads: 3 points
    breakdown.autoRefreshAds = auditData.autoRefreshAds === 0 ? 3 : 0;
    adComplianceScore += breakdown.autoRefreshAds;

    // No click interference: 3 points
    breakdown.clickInterference = auditData.hasClickInterference ? 0 : 3;
    adComplianceScore += breakdown.clickInterference;

    // Ads.txt valid: 2 points
    breakdown.adsTxt = auditData.adsTxtValid ? 2 : 0;
    adComplianceScore += breakdown.adsTxt;

    // Ad-to-content ratio < 0.5: 2 points (calculate from ad density and content)
    const adToContentRatio = auditData.totalAds > 0 && auditData.contentLength > 0
      ? auditData.totalAds / (auditData.contentLength / 100)
      : 0;
    breakdown.adToContentRatio = adToContentRatio < 0.5 ? 2 : 0;
    adComplianceScore += breakdown.adToContentRatio;

    breakdown.adCompliance = adComplianceScore;
    score += adComplianceScore;

    // TECHNICAL QUALITY (15 points total)
    let technicalQualityScore = 0;

    // SSL valid: 5 points
    breakdown.sslValid = auditData.sslValid ? 5 : 0;
    technicalQualityScore += breakdown.sslValid;

    // Page speed score >= 70: 4 points (adjusted for performance metrics)
    let pageSpeedBase = 0;
    if (auditData.pageSpeedScore >= 70) {
      pageSpeedBase = 4;
    } else if (auditData.pageSpeedScore >= 50) {
      pageSpeedBase = 2;
    } else {
      pageSpeedBase = Math.floor((auditData.pageSpeedScore / 70) * 4);
    }

    // Bonus/penalty based on actual performance metrics
    if (auditData.performanceTotalRequests !== undefined && auditData.performanceTotalRequests !== null) {
      if (auditData.performanceTotalRequests < 50) {
        pageSpeedBase = Math.min(4, pageSpeedBase + 0.5);
      } else if (auditData.performanceTotalRequests > 150) {
        pageSpeedBase = Math.max(0, pageSpeedBase - 1);
      }

      const thirdPartyRatio = auditData.performanceThirdPartyRequests / Math.max(1, auditData.performanceTotalRequests);
      if (thirdPartyRatio > 0.5) {
        pageSpeedBase = Math.max(0, pageSpeedBase - 0.5);
      }
    }

    breakdown.pageSpeed = Math.floor(pageSpeedBase);
    technicalQualityScore += breakdown.pageSpeed;

    // Mobile friendly: 3 points
    breakdown.mobileFriendly = auditData.mobileFriendly ? 3 : 0;
    technicalQualityScore += breakdown.mobileFriendly;

    // Domain age >= 1 year: 3 points
    if (auditData.domainAgeDays !== null && auditData.domainAgeDays !== undefined) {
      if (auditData.domainAgeDays >= 365) {
        breakdown.domainAge = 3;
        technicalQualityScore += 3;
      } else if (auditData.domainAgeDays >= 180) {
        breakdown.domainAge = 2;
        technicalQualityScore += 2;
      } else if (auditData.domainAgeDays >= 90) {
        breakdown.domainAge = 1;
        technicalQualityScore += 1;
      } else {
        breakdown.domainAge = 0;
      }
    } else {
      breakdown.domainAge = 0;
    }

    // Accessibility bonus (up to 1 point)
    if (auditData.accessibilityIssuesCount !== undefined && auditData.accessibilityIssuesCount !== null) {
      if (auditData.accessibilityIssuesCount === 0) {
        breakdown.accessibilityBonus = 1;
        technicalQualityScore += 1;
      } else if (auditData.accessibilityIssuesCount < 5) {
        breakdown.accessibilityBonus = 0.5;
        technicalQualityScore += 0.5;
      } else {
        breakdown.accessibilityBonus = 0;
      }
    }

    breakdown.technicalQuality = technicalQualityScore;
    score += technicalQualityScore;

    // SEO & ENGAGEMENT (10 points total)
    let seoEngagementScore = 0;

    // SEO score >= 0.7: 4 points
    if (seoData && seoData.score >= 0.7) {
      breakdown.seoScore = 4;
      seoEngagementScore += 4;
    } else if (seoData && seoData.score >= 0.5) {
      breakdown.seoScore = 2;
      seoEngagementScore += 2;
    } else if (seoData) {
      breakdown.seoScore = Math.floor(seoData.score * 4);
      seoEngagementScore += breakdown.seoScore;
    } else {
      breakdown.seoScore = 0;
    }

    // Has sitemap: 2 points
    breakdown.sitemap = (seoData && seoData.sitemap) ? 2 : 0;
    seoEngagementScore += breakdown.sitemap;

    // Has robots.txt: 1 point
    breakdown.robotsTxt = (seoData && seoData.robotsTxt) ? 1 : 0;
    seoEngagementScore += breakdown.robotsTxt;

    // Engagement score >= 0.6: 3 points
    if (engagementData && engagementData.score >= 0.6) {
      breakdown.engagementScore = 3;
      seoEngagementScore += 3;
    } else if (engagementData && engagementData.score >= 0.4) {
      breakdown.engagementScore = 2;
      seoEngagementScore += 2;
    } else if (engagementData) {
      breakdown.engagementScore = Math.floor(engagementData.score * 3);
      seoEngagementScore += breakdown.engagementScore;
    } else {
      breakdown.engagementScore = 0;
    }

    breakdown.seoEngagement = seoEngagementScore;
    score += seoEngagementScore;

    // Apply critical penalties (moved from removed sections below)
    if (auditData.safeBrowsing && !auditData.safeBrowsing.isSafe) {
      breakdown.safeBrowsingPenalty = -20;
      score += breakdown.safeBrowsingPenalty;
    }

    if (engagementData && engagementData.navigationBlocked) {
      breakdown.navBlockedPenalty = -3;
      score += breakdown.navBlockedPenalty;
    }

    if (engagementData && engagementData.redirectsDetected) {
      breakdown.suspiciousRedirectsPenalty = -5;
      score += breakdown.suspiciousRedirectsPenalty;
    }

    if (layoutData && layoutData.overlappingAds) {
      breakdown.overlappingAdsPenalty = -3;
      score += breakdown.overlappingAdsPenalty;
    }

    if (seoData && seoData.keywordSpamScore > 0.1) {
      breakdown.keywordSpamPenalty = -5;
      score += breakdown.keywordSpamPenalty;
    }

    breakdown.pageSpeed = Math.floor((auditData.pageSpeedScore / 100) * 5);
    // Cap score at 60 (max for website quality component)
    score = Math.max(0, Math.min(60, score));

    console.log(`[MFA-SCORER] Content quality: ${breakdown.contentQuality}/20`);
    console.log(`[MFA-SCORER] Ad compliance: ${breakdown.adCompliance}/15`);
    console.log(`[MFA-SCORER] Technical quality: ${breakdown.technicalQuality}/15`);
    console.log(`[MFA-SCORER] SEO & engagement: ${breakdown.seoEngagement}/10`);
    console.log(`[MFA-SCORER] Final website quality score: ${score}/60`);

    const metrics = {
      websiteQualityScore: score,
      maxScore: 60,
      breakdown,
      componentScores: {
        contentQuality: breakdown.contentQuality,
        adCompliance: breakdown.adCompliance,
        technicalQuality: breakdown.technicalQuality,
        seoEngagement: breakdown.seoEngagement
      }
    };

    return metrics;
  }

  generateRecommendations(auditData, breakdown, seoData = null, engagementData = null, layoutData = null) {
    const recommendations = [];

    // Performance-based recommendations
    if (auditData.performanceTotalRequests > 150) {
      recommendations.push(`Reduce total HTTP requests (current: ${auditData.performanceTotalRequests}) - combine resources and optimize assets`);
    }

    if (auditData.performanceThirdPartyRequests > 50) {
      const thirdPartyRatio = ((auditData.performanceThirdPartyRequests / auditData.performanceTotalRequests) * 100).toFixed(0);
      recommendations.push(`Minimize third-party requests (${thirdPartyRatio}% of total) - review tracking scripts and external dependencies`);
    }

    if (auditData.performanceTransferSize > 3000000) {
      const sizeMB = (auditData.performanceTransferSize / 1024 / 1024).toFixed(2);
      recommendations.push(`Reduce page weight (${sizeMB}MB transferred) - optimize images, minify scripts, enable compression`);
    }

    // Accessibility recommendations
    if (auditData.accessibilityIssuesCount > 10) {
      recommendations.push(`Fix ${auditData.accessibilityIssuesCount} accessibility issues - improves compliance and user experience`);
    }

    if (auditData.accessibilityMissingAltTags > 5) {
      recommendations.push(`Add alt text to ${auditData.accessibilityMissingAltTags} images - critical for WCAG compliance and SEO`);
    }

    if (breakdown.contentLength < 15) {
      recommendations.push('Increase content length to at least 300 characters');
    }

    if (breakdown.contentUniqueness < 10) {
      recommendations.push('Improve content uniqueness and originality');
    }

    if (breakdown.privacyPolicy === 0) {
      recommendations.push('Add a privacy policy page');
    }

    if (breakdown.contactPage === 0) {
      recommendations.push('Add a contact page');
    }

    if (breakdown.adDensity < 5) {
      recommendations.push('Reduce ad density on the page');
    }

    if (breakdown.totalAds === 0) {
      recommendations.push('Too many ads detected - consider reducing total ad count');
    }

    if (breakdown.adsInContent < 0) {
      recommendations.push('Reduce ads within article content - improves user experience');
    }

    if (breakdown.stickyAds < 0) {
      recommendations.push('Remove sticky/fixed positioned ads');
    }

    if (breakdown.autoRefreshAds < 0) {
      recommendations.push('Disable auto-refresh ads - violates Better Ads Standards');
    }

    if (breakdown.clickInterference < 0) {
      recommendations.push('Remove click interference elements (interstitials, overlays)');
    }

    if (breakdown.adsTxt === 0) {
      recommendations.push('Add or fix ads.txt file with Google authorization');
    }

    if (breakdown.mobileFriendly === 0) {
      recommendations.push('Make site mobile-friendly with proper viewport meta tag');
    }

    if (breakdown.pageSpeed < 4) {
      recommendations.push('Improve page load speed and performance');
    }

    if (breakdown.featuredImages === 0) {
      recommendations.push('Add featured images to articles');
    }

    if (breakdown.imageAltText === 0 && auditData.totalImages > 0) {
      recommendations.push('Add alt text to images for accessibility and SEO');
    }

    if (breakdown.optimizedImages === 0) {
      recommendations.push('Optimize images with modern formats (WebP, AVIF) and lazy loading');
    }

    if (breakdown.publishDates === 0) {
      recommendations.push('Display publish dates on articles');
    }

    if (breakdown.authorInfo === 0) {
      recommendations.push('Add author information to articles');
    }

    if (breakdown.contentFreshness <= 1) {
      recommendations.push('Publish fresh content more regularly - site appears inactive');
    }

    if (breakdown.postFrequency === 0 && auditData.totalPostsFound > 1) {
      recommendations.push('Increase posting frequency - regular updates improve rankings');
    }

    if (breakdown.domainAge === 0 && auditData.domainAgeDays !== null) {
      recommendations.push('New domain - focus on building trust and quality content');
    }

    if (breakdown.sslValid < 0) {
      recommendations.push('CRITICAL: Fix SSL certificate - required for ads and user trust');
    }

    if (auditData.safeBrowsing && !auditData.safeBrowsing.isSafe) {
      const threatTypes = auditData.safeBrowsing.threats.map(t => t.threatType).join(', ');
      recommendations.push(`CRITICAL: Site flagged by Google Safe Browsing (${threatTypes}). Must be resolved immediately.`);
    }

    if (seoData) {
      if (seoData.score < 0.6) {
        recommendations.push('Improve SEO quality - optimize meta tags, navigation, and site structure');
      }
      if (seoData.keywordSpamScore > 0.05) {
        recommendations.push('Reduce keyword density to avoid appearing as spam');
      }
      if (!seoData.sitemap) {
        recommendations.push('Add sitemap.xml for better search engine indexing');
      }
      if (seoData.categoriesChecked > 0 && seoData.categoriesWithArticles < seoData.categoriesChecked) {
        recommendations.push('Ensure all category pages have articles - empty categories hurt SEO');
      }
    }

    if (engagementData) {
      if (engagementData.score < 0.5) {
        recommendations.push('Improve user engagement - content may be too short or ad-heavy');
      }
      if (engagementData.navigationBlocked) {
        recommendations.push('Remove sticky ads blocking navigation elements');
      }
      if (engagementData.redirectsDetected) {
        recommendations.push('Fix suspicious redirects - all internal links point to homepage');
      }
      if (engagementData.avgScrollDepth < 0.3) {
        recommendations.push('Increase content quality to encourage deeper page engagement');
      }
    }

    if (layoutData) {
      if (layoutData.score < 0.6) {
        recommendations.push('Improve page layout - ensure content is accessible and well-structured');
      }
      if (layoutData.overlappingAds) {
        recommendations.push('Fix ad placement - ads are overlapping navigation elements');
      }
      if (!layoutData.contentAboveFold) {
        recommendations.push('Ensure main content appears above the fold');
      }
      if (!layoutData.contentBeforeAds) {
        recommendations.push('Place content before ads to improve user experience');
      }
    }

    return recommendations;
  }
}
