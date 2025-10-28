import { load } from 'cheerio';

export class SEOAnalyzer {
  analyzeSEOAndEngagement(htmlContent, links, loadTime = 0, metrics = {}) {
    const $ = load(htmlContent);

    const seoData = this.analyzeSEO(htmlContent, links);
    const engagementData = this.analyzeEngagement(htmlContent, links, loadTime, metrics);

    return {
      ...seoData,
      ...engagementData,
      combinedScore: (seoData.score + engagementData.score) / 2,
      allIssues: [...seoData.issues, ...engagementData.issues]
    };
  }

  analyzeEngagement(htmlContent, links, loadTime, metrics = {}) {
    const $ = load(htmlContent);

    const scrollDepthAnalysis = this.analyzeScrollDepth($);
    const dwellTimeEstimate = this.estimateDwellTime($, loadTime);
    const interactivityAnalysis = this.analyzeInteractivity($, links);
    const adToContentRatio = this.calculateAdToContentRatio($);
    const bounceRateAnalysis = this.analyzeBounceRate($, loadTime, interactivityAnalysis);
    const ctrOptimization = this.analyzeCTROptimization($);
    const socialEngagement = this.analyzeSocialEngagement($, links);
    const userInteraction = this.analyzeUserInteractionElements($);

    const score = this.calculateEngagementScore({
      scrollDepthAnalysis,
      dwellTimeEstimate,
      interactivityAnalysis,
      adToContentRatio,
      loadTime,
      bounceRateAnalysis,
      ctrOptimization,
      socialEngagement,
      userInteraction
    });

    return {
      avgScrollDepth: scrollDepthAnalysis.estimatedDepth,
      pageLoadTime: loadTime,
      clickableLinks: interactivityAnalysis.validLinks,
      sessionTimeEstimate: dwellTimeEstimate,
      adToContentRatio,
      navigationBlocked: interactivityAnalysis.navigationBlocked,
      redirectsDetected: interactivityAnalysis.redirectsToHomepage,
      bounceRateIndicators: bounceRateAnalysis,
      ctrOptimizationScore: ctrOptimization.score,
      ctrSuggestions: ctrOptimization.suggestions,
      socialEngagementSignals: socialEngagement,
      userInteractionScore: userInteraction.score,
      interactionElements: userInteraction.elements,
      score,
      issues: this.collectEngagementIssues({
        scrollDepthAnalysis,
        dwellTimeEstimate,
        interactivityAnalysis,
        adToContentRatio,
        loadTime,
        bounceRateAnalysis,
        ctrOptimization,
        socialEngagement,
        userInteraction
      })
    };
  }

  analyzeScrollDepth($) {
    const mainContent = $('main, article, [role="main"], .content, .post-content');

    if (mainContent.length === 0) {
      return { estimatedDepth: 0.2, quality: 'Poor' };
    }

    const contentText = mainContent.first().text();
    const contentHeight = Math.max(contentText.length / 5, 800);
    const viewportHeight = 800;

    const foldContent = contentHeight / viewportHeight;

    let estimatedDepth = 0.3;
    if (contentHeight > viewportHeight * 2) estimatedDepth = 0.6;
    if (contentHeight > viewportHeight * 4) estimatedDepth = 0.8;

    const adsAboveFold = $('[id*="ad"], [class*="ad"], iframe[src*="doubleclick"]')
      .filter((i, el) => {
        const offset = $(el).offset();
        return offset && offset.top < viewportHeight;
      }).length;

    if (adsAboveFold > 2) estimatedDepth -= 0.1;

    let quality = 'Poor';
    if (estimatedDepth >= 0.5) quality = 'Good';
    else if (estimatedDepth >= 0.3) quality = 'Fair';

    return {
      estimatedDepth: Math.max(0.1, Math.min(1, estimatedDepth)),
      quality,
      contentBelowFold: foldContent > 1
    };
  }

  estimateDwellTime($, loadTime) {
    const text = $('main, article, .content, .post-content').text();
    const wordCount = text.split(/\s+/).length;

    const avgReadingSpeed = 200;
    const readingTime = (wordCount / avgReadingSpeed) * 60;

    const images = $('main img, article img, .content img').length;
    const imageTime = images * 2;

    const videos = $('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length;
    const videoTime = videos * 10;

    const estimatedTime = Math.min(
      readingTime + imageTime + videoTime,
      300
    );

    const penaltyForSlowLoad = loadTime > 5 ? 5 : 0;

    return Math.max(3, estimatedTime - penaltyForSlowLoad);
  }

  analyzeInteractivity($, links) {
    const navLinks = $('nav a, header a, [role="navigation"] a, .menu a');
    const validLinks = [];
    const adLinks = [];

    navLinks.each((i, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      if (href.match(/doubleclick|googlesyndication|adservice|ad\.|ads\./)) {
        adLinks.push(href);
      } else if (!href.startsWith('#') && !href.startsWith('javascript:')) {
        validLinks.push(href);
      }
    });

    const stickyElements = $('[style*="position: fixed"], [style*="position:fixed"], .sticky, .fixed');
    const stickyAds = stickyElements.filter((i, el) => {
      const html = $(el).html() || '';
      return html.includes('ad') || html.includes('doubleclick') || html.includes('googlesyndication');
    }).length;

    const navigationBlocked = stickyAds > 1;

    const internalLinks = links.filter(link =>
      !link.match(/doubleclick|googlesyndication|adservice|facebook|twitter|instagram/)
    );

    const uniqueDomains = new Set();
    internalLinks.forEach(link => {
      try {
        const url = new URL(link);
        uniqueDomains.add(url.hostname);
      } catch (e) {
      }
    });

    const redirectsToHomepage = uniqueDomains.size === 1 && internalLinks.length > 5;

    return {
      validLinks: validLinks.length,
      adLinks: adLinks.length,
      navigationBlocked,
      redirectsToHomepage,
      uniqueDestinations: uniqueDomains.size
    };
  }

  calculateAdToContentRatio($) {
    const adElements = $('[id*="ad"], [class*="ad"], iframe[src*="doubleclick"], iframe[src*="googlesyndication"], .adsbygoogle');

    let totalAdArea = 0;
    adElements.each((i, el) => {
      const width = parseInt($(el).css('width')) || parseInt($(el).attr('width')) || 300;
      const height = parseInt($(el).css('height')) || parseInt($(el).attr('height')) || 250;
      totalAdArea += width * height;
    });

    const mainText = $('main, article, .content').first().text();
    const contentArea = $('main, article, .content').length > 0
      ? Math.max(mainText.length / 2, 1000) * 800
      : 800000;

    return Math.min(totalAdArea / contentArea, 1);
  }

  analyzeBounceRate($, loadTime, interactivityAnalysis) {
    const indicators = {
      slowLoadTime: loadTime > 3,
      lowContentQuality: $('main, article').text().split(/\s+/).length < 300,
      poorNavigation: interactivityAnalysis.validLinks < 3,
      noCallToAction: $('button, .cta, [class*="subscribe"], [class*="download"]').length === 0,
      mobileUnfriendly: !$('meta[name="viewport"]').length
    };

    const riskFactors = Object.values(indicators).filter(v => v).length;
    let bounceRateEstimate = 'low';

    if (riskFactors >= 4) bounceRateEstimate = 'very_high';
    else if (riskFactors >= 3) bounceRateEstimate = 'high';
    else if (riskFactors >= 2) bounceRateEstimate = 'medium';

    return {
      estimate: bounceRateEstimate,
      riskFactors,
      indicators
    };
  }

  analyzeCTROptimization($) {
    const suggestions = [];
    let score = 100;

    const title = $('title').text();
    if (!title || title.length < 30 || title.length > 60) {
      suggestions.push('Optimize title length (30-60 characters) for better CTR');
      score -= 15;
    }

    const metaDesc = $('meta[name="description"]').attr('content') || '';
    if (!metaDesc || metaDesc.length < 120 || metaDesc.length > 160) {
      suggestions.push('Optimize meta description (120-160 characters) with compelling copy');
      score -= 15;
    }

    if (!title.match(/\d+|how|why|best|guide|tips/i)) {
      suggestions.push('Add power words or numbers to title for higher CTR');
      score -= 10;
    }

    const hasSchema = $('script[type="application/ld+json"]').length > 0;
    if (!hasSchema) {
      suggestions.push('Add structured data markup for rich snippets');
      score -= 20;
    }

    const ogImage = $('meta[property="og:image"]').attr('content');
    if (!ogImage) {
      suggestions.push('Add Open Graph image for social media CTR');
      score -= 15;
    }

    const h1 = $('h1').first().text();
    if (!h1 || h1.length < 20) {
      suggestions.push('Improve H1 headline to be more compelling');
      score -= 10;
    }

    return {
      score: Math.max(0, score),
      suggestions
    };
  }

  analyzeSocialEngagement($, links) {
    const socialLinks = {
      facebook: links.filter(l => l.includes('facebook.com')).length,
      twitter: links.filter(l => l.includes('twitter.com') || l.includes('x.com')).length,
      instagram: links.filter(l => l.includes('instagram.com')).length,
      linkedin: links.filter(l => l.includes('linkedin.com')).length,
      youtube: links.filter(l => l.includes('youtube.com')).length
    };

    const shareButtons = $('[class*="share"], [class*="social"], [data-share]').length;
    const socialWidgets = $('[class*="twitter-timeline"], [class*="fb-"], iframe[src*="facebook"]').length;

    const totalSocialPresence = Object.values(socialLinks).reduce((a, b) => a + b, 0) +
                                shareButtons +
                                socialWidgets;

    let engagementLevel = 'low';
    if (totalSocialPresence >= 10) engagementLevel = 'high';
    else if (totalSocialPresence >= 5) engagementLevel = 'medium';

    return {
      level: engagementLevel,
      socialLinks,
      shareButtons,
      socialWidgets,
      totalSignals: totalSocialPresence
    };
  }

  analyzeUserInteractionElements($) {
    const elements = {
      forms: $('form').length,
      searchBoxes: $('input[type="search"], [role="search"]').length,
      comments: $('[class*="comment"], [id*="comment"], [data-comments]').length > 0,
      ratings: $('[class*="rating"], [class*="star"], [data-rating]').length > 0,
      polls: $('[class*="poll"], [data-poll]').length,
      subscribeBoxes: $('[class*="subscribe"], [class*="newsletter"]').length,
      ctaButtons: $('button, .btn, .cta, [class*="call-to-action"]').length,
      videoPlayers: $('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length,
      accordions: $('[class*="accordion"], [data-toggle="collapse"]').length,
      tabs: $('[role="tablist"], [class*="tab"]').length
    };

    const totalInteractiveElements = Object.values(elements).reduce((a, b) => {
      return a + (typeof b === 'number' ? b : (b ? 1 : 0));
    }, 0);

    let score = 0;
    if (totalInteractiveElements >= 10) score = 100;
    else if (totalInteractiveElements >= 7) score = 80;
    else if (totalInteractiveElements >= 5) score = 60;
    else if (totalInteractiveElements >= 3) score = 40;
    else if (totalInteractiveElements >= 1) score = 20;

    return {
      score,
      elements,
      totalCount: totalInteractiveElements
    };
  }

  calculateEngagementScore(analysis) {
    let score = 0;

    if (analysis.scrollDepthAnalysis.estimatedDepth >= 0.5) score += 0.15;
    else if (analysis.scrollDepthAnalysis.estimatedDepth >= 0.3) score += 0.1;
    else score += 0.03;

    if (analysis.loadTime < 3) score += 0.08;
    else if (analysis.loadTime < 5) score += 0.04;
    else if (analysis.loadTime > 8) score -= 0.04;

    if (analysis.interactivityAnalysis.validLinks >= 5) score += 0.15;
    else if (analysis.interactivityAnalysis.validLinks >= 3) score += 0.1;
    else score += 0.03;

    if (analysis.dwellTimeEstimate >= 20) score += 0.15;
    else if (analysis.dwellTimeEstimate >= 10) score += 0.1;
    else score += 0.03;

    if (analysis.adToContentRatio < 0.4) score += 0.1;
    else if (analysis.adToContentRatio < 0.6) score += 0.07;
    else if (analysis.adToContentRatio > 0.9) score -= 0.08;

    if (analysis.bounceRateAnalysis.estimate === 'low') score += 0.1;
    else if (analysis.bounceRateAnalysis.estimate === 'medium') score += 0.05;
    else if (analysis.bounceRateAnalysis.estimate === 'very_high') score -= 0.1;

    if (analysis.ctrOptimization.score >= 80) score += 0.1;
    else if (analysis.ctrOptimization.score >= 60) score += 0.07;
    else score += 0.03;

    if (analysis.socialEngagement.level === 'high') score += 0.08;
    else if (analysis.socialEngagement.level === 'medium') score += 0.05;

    if (analysis.userInteraction.score >= 80) score += 0.09;
    else if (analysis.userInteraction.score >= 60) score += 0.06;
    else if (analysis.userInteraction.score >= 40) score += 0.03;

    if (analysis.interactivityAnalysis.navigationBlocked) score -= 0.1;
    if (analysis.interactivityAnalysis.redirectsToHomepage) score -= 0.15;

    return Math.max(0, Math.min(1, score));
  }

  collectEngagementIssues(analysis) {
    const issues = [];

    if (analysis.scrollDepthAnalysis.estimatedDepth < 0.3) {
      issues.push('Content appears too short or heavily ad-laden - low scroll depth expected');
    }

    if (analysis.loadTime > 5) {
      issues.push(`Slow page load (${analysis.loadTime.toFixed(1)}s) negatively impacts user engagement`);
    }

    if (analysis.interactivityAnalysis.validLinks < 3) {
      issues.push('Insufficient navigation links - poor site structure');
    }

    if (analysis.dwellTimeEstimate < 10) {
      issues.push('Low estimated session time - content may be thin');
    }

    if (analysis.adToContentRatio > 0.6) {
      issues.push('High ad-to-content ratio may frustrate users');
    }

    if (analysis.interactivityAnalysis.navigationBlocked) {
      issues.push('Sticky ads are blocking navigation elements');
    }

    if (analysis.interactivityAnalysis.redirectsToHomepage) {
      issues.push('All internal links redirect to homepage - suspicious pattern');
    }

    if (analysis.bounceRateAnalysis.estimate === 'very_high' || analysis.bounceRateAnalysis.estimate === 'high') {
      issues.push(`High bounce rate risk detected (${analysis.bounceRateAnalysis.riskFactors} risk factors)`);
    }

    if (analysis.ctrOptimization.score < 60) {
      issues.push('Poor CTR optimization - meta tags need improvement');
    }

    if (analysis.socialEngagement.level === 'low') {
      issues.push('Limited social engagement signals detected');
    }

    if (analysis.userInteraction.score < 40) {
      issues.push('Few user interaction elements - site may feel static');
    }

    return issues;
  }

  analyzeSEO(htmlContent, links) {
    const $ = load(htmlContent);

    const metaQuality = this.analyzeMetaTags($);
    const keywordSpamScore = this.analyzeKeywordDensity($);
    const navigationStatus = this.analyzeNavigation($, links);
    const categoryAnalysis = this.analyzeCategories($, links);
    const sitemap = this.checkSitemap($);

    const score = this.calculateSEOScore({
      metaQuality,
      keywordSpamScore,
      navigationStatus,
      categoryAnalysis,
      sitemap
    });

    return {
      metaQuality: metaQuality.quality,
      metaTags: metaQuality.tags,
      keywordSpamScore,
      navigationStatus: navigationStatus.status,
      navigationLinks: navigationStatus.linkCount,
      categoriesChecked: categoryAnalysis.totalCategories,
      categoriesWithArticles: categoryAnalysis.categoriesWithContent,
      categoryIssues: categoryAnalysis.issues,
      sitemap: sitemap.hasSitemap,
      robotsTxt: sitemap.hasRobotsTxt,
      score,
      issues: this.collectIssues({
        metaQuality,
        keywordSpamScore,
        navigationStatus,
        categoryAnalysis,
        sitemap
      })
    };
  }

  analyzeMetaTags($) {
    const tags = {
      title: $('title').text().trim(),
      description: $('meta[name="description"]').attr('content') || '',
      keywords: $('meta[name="keywords"]').attr('content') || '',
      ogTitle: $('meta[property="og:title"]').attr('content') || '',
      ogDescription: $('meta[property="og:description"]').attr('content') || '',
      canonical: $('link[rel="canonical"]').attr('href') || ''
    };

    let quality = 'Poor';
    let score = 0;

    if (tags.title && tags.title.length >= 30 && tags.title.length <= 60) score += 25;
    if (tags.description && tags.description.length >= 120 && tags.description.length <= 160) score += 25;
    if (tags.canonical) score += 15;
    if (tags.ogTitle) score += 10;
    if (tags.ogDescription) score += 10;
    if (tags.keywords && tags.keywords.split(',').length <= 10) score += 15;

    if (score >= 80) quality = 'Excellent';
    else if (score >= 60) quality = 'Good';
    else if (score >= 40) quality = 'Fair';

    return { quality, score, tags };
  }

  analyzeKeywordDensity($) {
    const text = $('body').text().toLowerCase();
    const words = text.split(/\s+/).filter(w => w.length > 3);
    const totalWords = words.length;

    if (totalWords === 0) return 0;

    const wordFrequency = {};
    words.forEach(word => {
      wordFrequency[word] = (wordFrequency[word] || 0) + 1;
    });

    const sortedWords = Object.entries(wordFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    let maxDensity = 0;
    sortedWords.forEach(([word, count]) => {
      const density = (count / totalWords) * 100;
      if (density > maxDensity) maxDensity = density;
    });

    return Math.min(maxDensity / 100, 1);
  }

  analyzeNavigation($, links) {
    const navElements = $('nav, header, [role="navigation"], .menu, .nav, .navbar');
    const navLinks = [];

    navElements.each((i, el) => {
      $(el).find('a').each((j, link) => {
        const href = $(link).attr('href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          navLinks.push(href);
        }
      });
    });

    const uniqueNavLinks = [...new Set(navLinks)];
    const validLinks = uniqueNavLinks.filter(link => {
      return !link.match(/doubleclick|googlesyndication|adservice|ad\./) &&
             !link.includes('?ad=') &&
             !link.includes('&ad=');
    });

    const keyPages = ['/about', '/contact', '/privacy', '/categories', '/blog', '/articles'];
    const foundKeyPages = keyPages.filter(page => {
      return validLinks.some(link =>
        link.toLowerCase().includes(page) ||
        links.some(l => l.toLowerCase().includes(page))
      );
    });

    let status = 'Poor';
    if (validLinks.length >= 5 && foundKeyPages.length >= 3) status = 'Healthy';
    else if (validLinks.length >= 3 && foundKeyPages.length >= 2) status = 'Fair';

    return {
      status,
      linkCount: validLinks.length,
      keyPagesFound: foundKeyPages,
      issues: validLinks.length < 3 ? ['Navigation has too few valid links'] : []
    };
  }

  analyzeCategories($, links) {
    const categoryLinks = links.filter(link =>
      link.includes('/category/') ||
      link.includes('/categories/') ||
      link.includes('/tag/')
    );

    const uniqueCategories = [...new Set(categoryLinks)];

    const categoriesWithContent = uniqueCategories.filter(catLink => {
      const matchingLinks = links.filter(link =>
        link.startsWith(catLink) && link !== catLink
      );
      return matchingLinks.length > 0;
    });

    const issues = [];
    if (uniqueCategories.length === 0) {
      issues.push('No category structure detected');
    } else if (categoriesWithContent.length < uniqueCategories.length) {
      const emptyCats = uniqueCategories.length - categoriesWithContent.length;
      issues.push(`${emptyCats} categories appear to have no articles`);
    }

    return {
      totalCategories: uniqueCategories.length,
      categoriesWithContent: categoriesWithContent.length,
      issues
    };
  }

  checkSitemap($) {
    const sitemapLink = $('link[rel="sitemap"]').attr('href');
    const hasSitemap = !!sitemapLink;

    const robotsMeta = $('meta[name="robots"]').attr('content') || '';
    const hasRobotsTxt = !robotsMeta.includes('noindex');

    return {
      hasSitemap,
      hasRobotsTxt
    };
  }

  calculateSEOScore(analysis) {
    let score = 0;

    if (analysis.navigationStatus.status === 'Healthy') score += 0.3;
    else if (analysis.navigationStatus.status === 'Fair') score += 0.15;

    if (analysis.categoryAnalysis.totalCategories > 0) {
      const categoryRatio = analysis.categoryAnalysis.categoriesWithContent /
                          analysis.categoryAnalysis.totalCategories;
      score += categoryRatio * 0.3;
    }

    if (analysis.metaQuality.score >= 80) score += 0.4;
    else if (analysis.metaQuality.score >= 60) score += 0.3;
    else if (analysis.metaQuality.score >= 40) score += 0.2;
    else score += 0.1;

    if (analysis.sitemap.hasSitemap) score += 0.05;
    if (analysis.sitemap.hasRobotsTxt) score += 0.05;

    if (analysis.keywordSpamScore > 0.05) score -= 0.1;

    return Math.max(0, Math.min(1, score));
  }

  collectIssues(analysis) {
    const issues = [];

    if (analysis.metaQuality.score < 60) {
      issues.push('Meta tags need improvement for better SEO');
    }

    if (analysis.keywordSpamScore > 0.05) {
      issues.push('High keyword density detected - may be keyword stuffing');
    }

    if (analysis.navigationStatus.status === 'Poor') {
      issues.push('Navigation structure is inadequate');
    }

    issues.push(...analysis.navigationStatus.issues);
    issues.push(...analysis.categoryAnalysis.issues);

    if (!analysis.sitemap.hasSitemap) {
      issues.push('No sitemap.xml detected');
    }

    return issues;
  }
}
