import { load } from 'cheerio';
import fetch from 'node-fetch';

export class PolicyComplianceChecker {
  constructor(supabaseClient = null) {
    this.coppaKeywords = [
      'kid', 'child', 'children', 'teen', 'youth', 'junior', 'baby',
      'toddler', 'preschool', 'elementary', 'school', 'student'
    ];
  }

  async checkFullCompliance(domain, htmlContent, links, auditData) {
    console.log(`[POLICY-CHECKER] Starting full compliance check for ${domain}`);
    const $ = load(htmlContent);

    console.log('[POLICY-CHECKER] 1/9 Checking user consent requirements...');
    const userConsent = this.checkUserConsent($, htmlContent);
    console.log('[POLICY-CHECKER] 2/9 Checking cookie compliance...');
    const cookieCompliance = this.checkCookieCompliance($, htmlContent);
    console.log('[POLICY-CHECKER] 3/9 Checking ads.txt compliance...');
    const adsTxt = this.checkAdsTxtCompliance(auditData.adsTxtValid, domain);
    console.log('[POLICY-CHECKER] 4/9 Checking content policy...');
    const contentPolicy = await this.checkContentPolicy($, htmlContent, domain);
    console.log('[POLICY-CHECKER] 5/9 Checking ad placement policies...');
    const adPlacement = this.checkAdPlacementPolicies($, auditData);
    console.log('[POLICY-CHECKER] 6/9 Checking technical compliance...');
    const technicalCompliance = this.checkTechnicalCompliance($, auditData);
    console.log('[POLICY-CHECKER] 7/9 Checking invalid traffic risks...');
    const invalidTraffic = this.checkInvalidTrafficRisks($, auditData);
    console.log('[POLICY-CHECKER] 8/9 Checking transparency requirements...');
    const transparency = this.checkTransparencyRequirements($, links);
    console.log('[POLICY-CHECKER] 9/9 Checking data handling...');
    const dataHandling = this.checkDataHandling($, htmlContent);

    const checks = {
      userConsent,
      cookieCompliance,
      adsTxt,
      contentPolicy,
      adPlacement,
      technicalCompliance,
      invalidTraffic,
      transparency,
      dataHandling
    };

    const overallScore = this.calculateComplianceScore(checks);
    const criticalIssues = this.identifyCriticalIssues(checks);
    const recommendations = this.generateComplianceRecommendations(checks);

    console.log(`[POLICY-CHECKER] Compliance score: ${overallScore}/100`);
    console.log(`[POLICY-CHECKER] Critical issues found: ${criticalIssues.length}`);
    console.log(`[POLICY-CHECKER] Recommendations: ${recommendations.length}`);

    const metrics = {
      overallScore,
      criticalIssues,
      checks,
      recommendations,
      complianceLevel: this.getComplianceLevel(overallScore, criticalIssues)
    };

    console.log(`[POLICY-CHECKER] Compliance level: ${metrics.complianceLevel}`);
    console.log('[POLICY-CHECKER] ✓ Full compliance check complete');
    return metrics;
  }

  checkUserConsent($, htmlContent) {
    const issues = [];
    let score = 0;

    const hasPrivacyPolicy = $('a[href*="privacy"]').length > 0 ||
                            htmlContent.toLowerCase().includes('privacy policy');

    if (!hasPrivacyPolicy) {
      issues.push({
        severity: 'critical',
        policy: 'EU User Consent Policy / GDPR',
        issue: 'No visible Privacy Policy link found',
        impact: 'Account suspension, limited ad delivery in EU/EEA',
        fix: 'Add a clear Privacy Policy link on every page'
      });
    } else {
      score += 25;
    }

    const consentPatterns = [
      /cookie.*consent/i,
      /gdpr.*consent/i,
      /accept.*cookie/i,
      /privacy.*banner/i,
      /consent.*management/i,
      /cmp.*consent/i,
      /quantcast/i,
      /cookiebot/i,
      /onetrust/i,
      /didomi/i,
      /termly/i
    ];

    const hasConsentMechanism = consentPatterns.some(pattern =>
      pattern.test(htmlContent) ||
      $(`.${pattern.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).length > 0
    );

    if (!hasConsentMechanism) {
      issues.push({
        severity: 'critical',
        policy: 'GDPR / CCPA Compliance',
        issue: 'No consent management mechanism detected',
        impact: 'Limited ad delivery in EU/California, potential fines',
        fix: 'Implement a Consent Management Platform (CMP) like Google Consent Mode, Quantcast, or Cookiebot'
      });
    } else {
      score += 35;
    }

    const hasOptOut = /do.*not.*sell/i.test(htmlContent) ||
                     /opt.*out/i.test(htmlContent) ||
                     $('a[href*="opt-out"]').length > 0;

    if (!hasOptOut) {
      issues.push({
        severity: 'high',
        policy: 'CCPA Compliance',
        issue: 'No opt-out option for personalized ads (CCPA requirement)',
        impact: 'Limited ad delivery in California',
        fix: 'Add "Do Not Sell My Personal Information" link for California users'
      });
    } else {
      score += 20;
    }

    const mentionsThirdParties = /google.*ads/i.test(htmlContent) ||
                                 /third.*party/i.test(htmlContent) ||
                                 /ad.*partner/i.test(htmlContent);

    if (!mentionsThirdParties) {
      issues.push({
        severity: 'medium',
        policy: 'Transparency Requirements',
        issue: 'Privacy policy should disclose third-party ad partners (like Google)',
        impact: 'Policy warning, potential compliance issues',
        fix: 'Explicitly mention Google and other ad partners in privacy policy'
      });
    } else {
      score += 20;
    }

    return {
      score,
      maxScore: 100,
      passed: score >= 60,
      issues,
      hasPrivacyPolicy,
      hasConsentMechanism,
      hasOptOut,
      mentionsThirdParties
    };
  }

  checkCookieCompliance($, htmlContent) {
    const issues = [];
    let score = 0;

    const cookiePolicyExists = $('a[href*="cookie"]').length > 0 ||
                               /cookie.*policy/i.test(htmlContent);

    if (!cookiePolicyExists) {
      issues.push({
        severity: 'high',
        policy: 'Cookie Disclosure Requirements',
        issue: 'No cookie policy found',
        impact: 'GDPR/ePrivacy non-compliance, limited ad delivery',
        fix: 'Create and link to a comprehensive cookie policy'
      });
    } else {
      score += 40;
    }

    const hasPIIProtection = !/email|phone|address|social.*security/i.test(
      $('input[type="text"], input[type="email"]').attr('name') || ''
    );

    if (!hasPIIProtection) {
      issues.push({
        severity: 'critical',
        policy: 'PII Protection',
        issue: 'Potential PII collection detected - must not share with Google',
        impact: 'Account termination',
        fix: 'Never pass personally identifiable information (email, phone, names) to Google'
      });
      score -= 30;
    } else {
      score += 30;
    }

    const hasEncryption = $('form[action*="https"]').length > 0 ||
                         $('form').length === 0;

    if (!hasEncryption && $('form').length > 0) {
      issues.push({
        severity: 'high',
        policy: 'Data Security',
        issue: 'Forms should use HTTPS for data transmission',
        impact: 'Security vulnerability, potential policy violation',
        fix: 'Ensure all forms use HTTPS'
      });
    } else {
      score += 30;
    }

    return {
      score,
      maxScore: 100,
      passed: score >= 70,
      issues,
      cookiePolicyExists,
      hasPIIProtection,
      hasEncryption
    };
  }

  checkAdsTxtCompliance(adsTxtValid, domain) {
    const issues = [];
    let score = 0;

    if (!adsTxtValid) {
      issues.push({
        severity: 'critical',
        policy: 'Ads.txt Requirement',
        issue: 'Missing or invalid ads.txt file',
        impact: 'Loss of demand, reduced revenue, policy enforcement',
        fix: `Create ${domain}/ads.txt with correct google.com, pub-XXXXX entries`
      });
    } else {
      score = 100;
    }

    return {
      score,
      maxScore: 100,
      passed: adsTxtValid,
      issues,
      adsTxtValid
    };
  }

  async checkContentPolicy($, htmlContent, domain) {
    const issues = [];
    let score = 100;

    const prohibitedPatterns = [
      { pattern: /\b(sex|porn|xxx|adult)\b/i, type: 'Adult Content', severity: 'critical' },
      { pattern: /\b(hate|racist|discrimination)\b/i, type: 'Hate Speech', severity: 'critical' },
      { pattern: /\b(drug|marijuana|cannabis|weed)\b/i, type: 'Illegal Drugs', severity: 'critical' },
      { pattern: /\b(weapon|gun|firearm|explosive)\b/i, type: 'Weapons', severity: 'critical' },
      { pattern: /\b(fake.*news|clickbait|misleading)\b/i, type: 'Misleading Content', severity: 'high' },
      { pattern: /\b(gambling|casino|poker|bet)\b/i, type: 'Gambling (requires approval)', severity: 'high' },
      { pattern: /\b(pirated|torrent|download.*free.*movie)\b/i, type: 'Copyright Violation', severity: 'critical' },
      { pattern: /\b(malware|virus|hack|phishing)\b/i, type: 'Malicious Content', severity: 'critical' }
    ];

    const textContent = $('body').text().toLowerCase();
    const title = $('title').text().toLowerCase();

    for (const { pattern, type, severity } of prohibitedPatterns) {
      if (pattern.test(textContent) || pattern.test(title)) {
        const penaltyMap = { critical: 40, high: 20, medium: 10 };
        score -= penaltyMap[severity];

        issues.push({
          severity,
          policy: 'Content Policy Violations',
          issue: `Potential ${type} detected`,
          impact: severity === 'critical' ? 'Immediate account closure' : 'Policy warning, limited ad serving',
          fix: 'Remove prohibited content or apply for category approval if applicable'
        });
      }
    }

    const isCoppaCompliant = !this.coppaKeywords.some(keyword =>
      textContent.includes(keyword) || title.includes(keyword)
    );

    if (!isCoppaCompliant) {
      const hasAgeGate = /age.*verification|are.*you.*18|age.*gate/i.test(htmlContent);

      if (!hasAgeGate) {
        issues.push({
          severity: 'critical',
          policy: 'COPPA Compliance',
          issue: 'Site may target children without age verification',
          impact: 'Account suspension, legal liability',
          fix: 'If targeting children: disable personalized ads, implement age verification. Otherwise, clarify adult audience.'
        });
        score -= 30;
      }
    }

    const contentValueScore = this.assessContentValue($);

    if (contentValueScore < 40) {
      issues.push({
        severity: 'critical',
        policy: 'Made for Advertising (MFA) Policy',
        issue: 'Site appears to be low-value or MFA content',
        impact: 'Account closure, Google actively penalizes MFA sites',
        fix: 'Add substantial original content beyond ads - articles, tools, resources that provide real value'
      });
      score -= 40;
    }

    return {
      score: Math.max(0, score),
      maxScore: 100,
      passed: score >= 70,
      issues,
      contentValueScore,
      isCoppaCompliant
    };
  }

  assessContentValue($) {
    let score = 0;

    const textLength = $('body').text().trim().length;
    if (textLength > 2000) score += 20;
    if (textLength > 5000) score += 20;

    const articles = $('article, [class*="post"], [class*="article"]').length;
    if (articles > 3) score += 15;
    if (articles > 10) score += 15;

    const hasImages = $('img').length > 3;
    if (hasImages) score += 10;

    const hasNavigation = $('nav, [role="navigation"]').length > 0;
    if (hasNavigation) score += 10;

    const hasMultiplePages = $('a[href]').length > 10;
    if (hasMultiplePages) score += 10;

    return Math.min(100, score);
  }

  checkAdPlacementPolicies($, auditData) {
    const issues = [];
    let score = 100;

    if (auditData.hasClickInterference) {
      issues.push({
        severity: 'critical',
        policy: 'Accidental Clicks Prevention',
        issue: 'Ads placed near buttons, links, or navigation that encourage accidental clicks',
        impact: 'Invalid traffic flags, account suspension',
        fix: 'Move ads away from interactive elements, maintain proper spacing'
      });
      score -= 40;
    }

    if (auditData.adDensity > 30) {
      issues.push({
        severity: 'critical',
        policy: 'Ad Density Limits',
        issue: `Excessive ad density (${auditData.adDensity}%) - must have more content than ads`,
        impact: 'Policy violation, ad serving disabled',
        fix: 'Reduce ad units or increase content. Aim for ad density below 30%'
      });
      score -= 35;
    }

    if (auditData.stickyAds > 2) {
      issues.push({
        severity: 'high',
        policy: 'Intrusive Ad Placement',
        issue: 'Multiple sticky/fixed ads detected',
        impact: 'Policy warning, user experience penalty',
        fix: 'Limit to one sticky ad, ensure it does not obstruct content'
      });
      score -= 20;
    }

    if (auditData.autoRefreshAds) {
      issues.push({
        severity: 'critical',
        policy: 'Ad Refresh Policy',
        issue: 'Auto-refreshing ads detected without user interaction',
        impact: 'Invalid traffic, account termination',
        fix: 'Only refresh ads after genuine user interaction'
      });
      score -= 30;
    }

    if (auditData.popupsDetected > 0) {
      issues.push({
        severity: 'critical',
        policy: 'Pop-up/Pop-under Policy',
        issue: 'Pop-ups or intrusive overlays detected',
        impact: 'Immediate policy violation, account suspension',
        fix: 'Remove all pop-ups, pop-unders, and auto-redirects'
      });
      score -= 40;
    }

    const adsAboveFoldRatio = auditData.adsAboveFold / Math.max(1, auditData.totalAds);
    if (adsAboveFoldRatio > 0.6) {
      issues.push({
        severity: 'medium',
        policy: 'Above-the-Fold Ad Placement',
        issue: 'Too many ads above the fold',
        impact: 'Poor user experience, potential policy flag',
        fix: 'Balance ad placement throughout page content'
      });
      score -= 10;
    }

    return {
      score: Math.max(0, score),
      maxScore: 100,
      passed: score >= 70,
      issues,
      adDensity: auditData.adDensity,
      stickyAds: auditData.stickyAds,
      autoRefreshAds: auditData.autoRefreshAds,
      popupsDetected: auditData.popupsDetected
    };
  }

  checkTechnicalCompliance($, auditData) {
    const issues = [];
    let score = 100;

    if (!auditData.sslValid) {
      issues.push({
        severity: 'critical',
        policy: 'HTTPS Requirement',
        issue: 'Site must be served over HTTPS with valid SSL certificate',
        impact: 'Ad serving disabled, security flag',
        fix: 'Install valid SSL certificate and enforce HTTPS'
      });
      score -= 50;
    }

    if (auditData.brokenLinks > 5) {
      issues.push({
        severity: 'high',
        policy: 'Site Quality',
        issue: `Multiple broken links detected (${auditData.brokenLinks})`,
        impact: 'Poor user experience, quality score penalty',
        fix: 'Fix or remove broken links'
      });
      score -= 20;
    }

    if (auditData.loadTime > 5000) {
      issues.push({
        severity: 'medium',
        policy: 'Page Speed',
        issue: 'Slow page load time affects ad viewability',
        impact: 'Reduced ad performance, user experience penalty',
        fix: 'Optimize images, enable caching, reduce page weight'
      });
      score -= 15;
    }

    const hiddenIframes = $('iframe[style*="display:none"], iframe[style*="visibility:hidden"]').length;
    if (hiddenIframes > 0) {
      issues.push({
        severity: 'critical',
        policy: 'Hidden Ad Manipulation',
        issue: 'Hidden iframes detected - potential invalid traffic manipulation',
        impact: 'Account termination, fraud flag',
        fix: 'Remove hidden iframes, never manipulate ad visibility'
      });
      score -= 50;
    }

    return {
      score: Math.max(0, score),
      maxScore: 100,
      passed: score >= 70,
      issues,
      sslValid: auditData.sslValid,
      brokenLinks: auditData.brokenLinks,
      loadTime: auditData.loadTime,
      hiddenIframes
    };
  }

  checkInvalidTrafficRisks($, auditData) {
    const issues = [];
    let score = 100;

    const clickEncouragementPatterns = [
      /click.*ad/i,
      /support.*us.*clicking/i,
      /click.*here.*help/i,
      /please.*click/i
    ];

    const bodyText = $('body').text();
    const encouragesClicks = clickEncouragementPatterns.some(pattern =>
      pattern.test(bodyText)
    );

    if (encouragesClicks) {
      issues.push({
        severity: 'critical',
        policy: 'Click Encouragement',
        issue: 'Site appears to encourage users to click ads',
        impact: 'Immediate account termination, revenue clawback',
        fix: 'Remove any language encouraging ad clicks'
      });
      score -= 50;
    }

    const suspiciousScripts = $('script[src*="clickthroughrate"], script[src*="impression"], script[src*="bot"]').length;
    if (suspiciousScripts > 0) {
      issues.push({
        severity: 'critical',
        policy: 'Traffic Manipulation',
        issue: 'Suspicious scripts detected that may manipulate traffic',
        impact: 'Fraud detection, account closure',
        fix: 'Remove scripts that artificially inflate impressions or clicks'
      });
      score -= 50;
    }

    if (auditData.domainAgeDays !== null && auditData.domainAgeDays < 90) {
      issues.push({
        severity: 'medium',
        policy: 'New Domain Risk',
        issue: 'Domain is very new (< 90 days) - higher scrutiny for invalid traffic',
        impact: 'Increased monitoring, may face stricter enforcement',
        fix: 'Build organic traffic, avoid sudden traffic spikes'
      });
      score -= 15;
    }

    return {
      score: Math.max(0, score),
      maxScore: 100,
      passed: score >= 80,
      issues,
      encouragesClicks,
      suspiciousScripts,
      domainAge: auditData.domainAgeDays
    };
  }

  checkTransparencyRequirements($, links) {
    const issues = [];
    let score = 0;

    const hasAboutPage = links.some(link => /about/i.test(link)) ||
                        $('a[href*="about"]').length > 0;

    if (!hasAboutPage) {
      issues.push({
        severity: 'high',
        policy: 'Transparency Requirements',
        issue: 'No "About Us" page found with ownership details',
        impact: 'Trust issues, policy flag',
        fix: 'Add About page with real ownership and contact information'
      });
    } else {
      score += 40;
    }

    const hasContactInfo = $('a[href^="mailto:"]').length > 0 ||
                          /contact.*email|email.*address/i.test($('body').text());

    if (!hasContactInfo) {
      issues.push({
        severity: 'medium',
        policy: 'Contact Information',
        issue: 'No visible contact information found',
        impact: 'Transparency concern',
        fix: 'Provide email or contact form'
      });
    } else {
      score += 30;
    }

    const hasDisclaimer = /sponsor|advertis|affiliate/i.test($('body').text().toLowerCase());
    if (hasDisclaimer) {
      score += 30;
    } else {
      issues.push({
        severity: 'low',
        policy: 'Sponsored Content Disclosure',
        issue: 'Should clearly label sponsored or paid content',
        impact: 'Transparency best practice',
        fix: 'Add disclaimers for sponsored content'
      });
    }

    return {
      score,
      maxScore: 100,
      passed: score >= 60,
      issues,
      hasAboutPage,
      hasContactInfo,
      hasDisclaimer
    };
  }

  checkDataHandling($, htmlContent) {
    const issues = [];
    let score = 100;

    const hasDataRetentionPolicy = /data.*retention|retain.*data|delete.*data/i.test(htmlContent);

    if (!hasDataRetentionPolicy) {
      issues.push({
        severity: 'medium',
        policy: 'Data Retention',
        issue: 'Privacy policy should mention data retention periods',
        impact: 'GDPR compliance issue',
        fix: 'Add data retention policy (max 13 months for logs per Google policy)'
      });
      score -= 20;
    }

    const mentionsDataSharing = /share.*data|third.*party.*data|data.*partner/i.test(htmlContent);

    if (!mentionsDataSharing) {
      issues.push({
        severity: 'medium',
        policy: 'Data Sharing Disclosure',
        issue: 'Should disclose how user data is shared',
        impact: 'Transparency requirement',
        fix: 'Clearly state which third parties receive user data'
      });
      score -= 15;
    }

    const trackers = $('script[src*="analytics"], script[src*="track"], script[src*="tag"]').length;
    const mentionsTracking = /track|analytics|cookie/i.test(htmlContent);

    if (trackers > 0 && !mentionsTracking) {
      issues.push({
        severity: 'high',
        policy: 'Tracking Disclosure',
        issue: 'Tracking scripts present but not disclosed in privacy policy',
        impact: 'GDPR violation',
        fix: 'Disclose all tracking technologies in privacy policy'
      });
      score -= 25;
    }

    return {
      score: Math.max(0, score),
      maxScore: 100,
      passed: score >= 70,
      issues,
      hasDataRetentionPolicy,
      mentionsDataSharing,
      trackersCount: trackers
    };
  }

  calculateComplianceScore(checks) {
    const weights = {
      userConsent: 0.20,
      cookieCompliance: 0.15,
      adsTxt: 0.10,
      contentPolicy: 0.20,
      adPlacement: 0.15,
      technicalCompliance: 0.10,
      invalidTraffic: 0.05,
      transparency: 0.03,
      dataHandling: 0.02
    };

    let totalScore = 0;
    let totalWeight = 0;

    for (const [key, weight] of Object.entries(weights)) {
      if (checks[key]) {
        totalScore += (checks[key].score / checks[key].maxScore) * weight * 100;
        totalWeight += weight;
      }
    }

    return Math.round(totalScore / totalWeight);
  }

  identifyCriticalIssues(checks) {
    const critical = [];

    for (const check of Object.values(checks)) {
      if (check.issues) {
        const criticalIssues = check.issues.filter(issue =>
          issue.severity === 'critical'
        );
        critical.push(...criticalIssues);
      }
    }

    return critical;
  }

  getComplianceLevel(score, criticalIssues) {
    if (criticalIssues.length > 0) {
      return 'non-compliant';
    }

    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 60) return 'needs-improvement';
    return 'non-compliant';
  }

  generateComplianceRecommendations(checks) {
    const recommendations = [];

    const allIssues = [];
    for (const check of Object.values(checks)) {
      if (check.issues) {
        allIssues.push(...check.issues);
      }
    }

    allIssues.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    const priorityIssues = allIssues.slice(0, 10);

    for (const issue of priorityIssues) {
      recommendations.push({
        priority: issue.severity,
        policy: issue.policy,
        action: issue.fix,
        impact: issue.impact
      });
    }

    return recommendations;
  }
}
