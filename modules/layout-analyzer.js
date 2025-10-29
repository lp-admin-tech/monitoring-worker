import { load } from 'cheerio';
import { createAIHelper } from './ai-helper.js';

export class LayoutAnalyzer {
  constructor(supabaseClient = null, geminiApiKey = null) {
    this.aiHelper = supabaseClient && geminiApiKey ? createAIHelper(supabaseClient, geminiApiKey) : null;
  }

  async analyzeLayout(htmlContent) {
    const $ = load(htmlContent);

    const adPlacement = this.analyzeAdPlacement($);
    const contentVisibility = this.analyzeContentVisibility($);
    const navigationPlacement = this.analyzeNavigationPlacement($);
    const mobileFriendliness = this.analyzeMobileFriendliness($);

    const score = this.calculateLayoutScore({
      adPlacement,
      contentVisibility,
      navigationPlacement,
      mobileFriendliness
    });

    const metrics = {
      adsAboveFold: adPlacement.adsAboveFold,
      overlappingAds: adPlacement.overlapping,
      menuPosition: navigationPlacement.position,
      mobileFriendly: mobileFriendliness.isFriendly,
      contentAboveFold: contentVisibility.hasContent,
      contentBeforeAds: contentVisibility.contentFirst,
      menuAccessible: navigationPlacement.accessible,
      score,
      issues: this.collectIssues({
        adPlacement,
        contentVisibility,
        navigationPlacement,
        mobileFriendliness
      })
    };

    let aiAnalysis = null;
    if (this.aiHelper) {
      try {
        aiAnalysis = await this.aiHelper.analyze({
          type: 'layout_structure',
          context: 'Evaluating page layout, ad placement impact on UX, navigation accessibility, and mobile responsiveness',
          metrics,
          html: htmlContent
        });
      } catch (error) {
        console.error('[LAYOUT-ANALYZER] AI analysis error:', error.message);
      }
    }

    return {
      ...metrics,
      aiAnalysis
    };
  }

  analyzeAdPlacement($) {
    const adSelectors = [
      '[id*="ad"]', '[class*="ad"]',
      'iframe[src*="doubleclick"]',
      'iframe[src*="googlesyndication"]',
      'iframe[src*="adservice"]',
      '.adsbygoogle',
      '[data-ad-slot]'
    ];

    const allElements = $('body *').toArray();
    const bodyLength = allElements.length;

    let adsAboveFold = 0;
    let overlapping = false;

    const adElements = [];
    adSelectors.forEach(selector => {
      $(selector).each((i, el) => {
        const adIndex = allElements.indexOf(el);
        const estimatedPosition = (adIndex / bodyLength) * 100;

        if (estimatedPosition < 30) {
          adsAboveFold++;
          adElements.push({ el: $(el), position: estimatedPosition });
        }
      });
    });

    const navElements = $('nav, header, [role="navigation"], .menu, .navbar');
    navElements.each((i, navEl) => {
      const navIndex = allElements.indexOf(navEl);
      const navPosition = (navIndex / bodyLength) * 100;

      adElements.forEach(({ el, position }) => {
        const zIndex = parseInt(el.css('z-index')) || 0;
        const navZIndex = parseInt($(navEl).css('z-index')) || 0;

        if (
          Math.abs(position - navPosition) < 5 &&
          zIndex > navZIndex
        ) {
          overlapping = true;
        }
      });
    });

    return {
      adsAboveFold,
      overlapping,
      totalAdsChecked: adElements.length
    };
  }

  analyzeContentVisibility($) {
    const mainContent = $('main, article, [role="main"], .content, .post-content');

    if (mainContent.length === 0) {
      return {
        hasContent: false,
        contentFirst: false,
        contentPosition: null
      };
    }

    const allElements = $('body *').toArray();
    const bodyLength = allElements.length;
    const contentElement = mainContent.first()[0];
    const contentIndex = allElements.indexOf(contentElement);
    const estimatedPosition = (contentIndex / bodyLength) * 100;

    const hasContent = estimatedPosition < 50;

    const bodyChildren = $('body').children();
    let contentFirst = false;
    let adsBeforeContent = 0;

    bodyChildren.each((i, el) => {
      const $el = $(el);
      const tagName = $el.prop('tagName').toLowerCase();

      const isContent = tagName === 'main' ||
                       tagName === 'article' ||
                       $el.is('[role="main"]') ||
                       $el.hasClass('content') ||
                       $el.hasClass('post-content');

      const isAd = $el.find('[id*="ad"], [class*="ad"], iframe[src*="doubleclick"]').length > 0;

      if (isContent) {
        contentFirst = adsBeforeContent <= 1;
        return false;
      }

      if (isAd) {
        adsBeforeContent++;
      }
    });

    const contentText = mainContent.first().text().trim();
    const hasSubstantialContent = contentText.length > 200;

    return {
      hasContent: hasContent && hasSubstantialContent,
      contentFirst,
      contentPosition: estimatedPosition,
      adsBeforeContent
    };
  }

  analyzeNavigationPlacement($) {
    const navElements = $('nav, header, [role="navigation"], .menu, .navbar');

    if (navElements.length === 0) {
      return {
        position: 'Missing',
        accessible: false,
        offsetTop: null
      };
    }

    const allElements = $('body *').toArray();
    const bodyLength = allElements.length;
    const navElement = navElements.first()[0];
    const navIndex = allElements.indexOf(navElement);
    const estimatedPosition = (navIndex / bodyLength) * 100;

    let position = 'Below Fold';
    if (estimatedPosition < 10) position = 'Top';
    else if (estimatedPosition < 25) position = 'Above Fold';
    else if (estimatedPosition < 40) position = 'Near Fold';

    const stickyAds = $('[style*="position: fixed"], [style*="position:fixed"]').filter((i, el) => {
      const html = $(el).html() || '';
      return html.includes('ad') || html.includes('doubleclick');
    });

    const accessible = stickyAds.length <= 1;

    return {
      position,
      accessible,
      offsetTop: estimatedPosition
    };
  }

  analyzeMobileFriendliness($) {
    const viewport = $('meta[name="viewport"]').attr('content') || '';

    const hasViewport = viewport.includes('width=device-width') ||
                       viewport.includes('initial-scale');

    const hasResponsiveImages = $('img').length > 0 &&
      ($('img[srcset]').length > 0 || $('picture').length > 0);

    const hasMediaQueries = $('style').text().includes('@media') ||
                           $('link[rel="stylesheet"]').length > 0;

    const hasFlexOrGrid = $('body').html()?.match(/display:\s*(flex|grid)/) !== null;

    let friendlinessScore = 0;
    if (hasViewport) friendlinessScore += 40;
    if (hasResponsiveImages) friendlinessScore += 20;
    if (hasMediaQueries) friendlinessScore += 20;
    if (hasFlexOrGrid) friendlinessScore += 20;

    const isFriendly = friendlinessScore >= 60;

    return {
      isFriendly,
      score: friendlinessScore,
      hasViewport,
      hasResponsiveImages
    };
  }

  calculateLayoutScore(analysis) {
    let score = 0;

    if (analysis.contentVisibility.hasContent) {
      score += 0.4;
      if (analysis.contentVisibility.contentFirst) score += 0.1;
    } else {
      score += 0.1;
    }

    if (analysis.navigationPlacement.position === 'Top') score += 0.3;
    else if (analysis.navigationPlacement.position === 'Above Fold') score += 0.2;
    else if (analysis.navigationPlacement.position === 'Near Fold') score += 0.1;

    if (analysis.adPlacement.adsAboveFold <= 2) score += 0.15;
    else if (analysis.adPlacement.adsAboveFold <= 4) score += 0.08;

    if (!analysis.adPlacement.overlapping) score += 0.1;

    if (analysis.navigationPlacement.accessible) score += 0.05;

    if (analysis.mobileFriendliness.isFriendly) score += 0.1;

    return Math.max(0, Math.min(1, score));
  }

  collectIssues(analysis) {
    const issues = [];

    if (!analysis.contentVisibility.hasContent) {
      issues.push('No substantial content detected above the fold');
    }

    if (!analysis.contentVisibility.contentFirst) {
      issues.push(`${analysis.contentVisibility.adsBeforeContent} ad(s) appear before main content`);
    }

    if (analysis.navigationPlacement.position === 'Missing') {
      issues.push('Navigation menu not found');
    } else if (analysis.navigationPlacement.position === 'Below Fold') {
      issues.push('Navigation menu is pushed below the fold - poor UX');
    }

    if (analysis.adPlacement.adsAboveFold > 3) {
      issues.push(`Too many ads above fold (${analysis.adPlacement.adsAboveFold}) - violates ad policies`);
    }

    if (analysis.adPlacement.overlapping) {
      issues.push('Ads are overlapping navigation elements');
    }

    if (!analysis.navigationPlacement.accessible) {
      issues.push('Navigation is blocked by sticky ads');
    }

    if (!analysis.mobileFriendliness.isFriendly) {
      issues.push('Site is not mobile-friendly - missing viewport or responsive design');
    }

    return issues;
  }
}
