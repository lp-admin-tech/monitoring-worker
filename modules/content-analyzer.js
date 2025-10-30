import { load } from 'cheerio';
import fetch from 'node-fetch';
import { createAIHelper } from './ai-helper.js';
import { WebsiteCrawler } from './crawler.js';

export class ContentAnalyzer {
  constructor(supabaseClient = null, geminiApiKey = null) {
    this.supabase = supabaseClient;
    this.safeBrowsingApiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
    this.safeBrowsingApiUrl = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';
    this.aiHelper = supabaseClient && geminiApiKey ? createAIHelper(supabaseClient, geminiApiKey) : null;
    this.crawler = new WebsiteCrawler();
  }

  async analyzeContent(htmlContent, links) {
    console.log('[CONTENT-ANALYZER] Starting content analysis');
    const $ = load(htmlContent);

    const textContent = $('body').text().trim();
    const contentLength = textContent.length;
    console.log(`[CONTENT-ANALYZER] Extracted text content: ${contentLength} characters`);

    const contentUniqueness = this.calculateUniqueness(textContent);
    console.log(`[CONTENT-ANALYZER] Content uniqueness: ${contentUniqueness.toFixed(2)}%`);

    const hasPrivacyPolicy = links.some(link =>
      /privacy|policy/i.test(link)
    ) || $('a:contains("Privacy"), a:contains("privacy")').length > 0;
    console.log(`[CONTENT-ANALYZER] Privacy policy: ${hasPrivacyPolicy ? 'found' : 'not found'}`);

    const hasContactPage = links.some(link =>
      /contact/i.test(link)
    ) || $('a:contains("Contact"), a:contains("contact")').length > 0;
    console.log(`[CONTENT-ANALYZER] Contact page: ${hasContactPage ? 'found' : 'not found'}`);

    const metrics = {
      contentLength,
      contentUniqueness,
      hasPrivacyPolicy,
      hasContactPage
    };

    let aiAnalysis = null;
    if (this.aiHelper) {
      try {
        console.log('[CONTENT-ANALYZER] Requesting AI analysis for content quality');
        aiAnalysis = await this.aiHelper.analyze({
          type: 'content_quality',
          context: 'Assessing overall content quality, uniqueness, and required page presence',
          metrics,
          html: htmlContent
        });
        console.log(`[CONTENT-ANALYZER] ✓ AI analysis complete - Score: ${aiAnalysis?.score || 'N/A'}`);
      } catch (error) {
        console.error('[CONTENT-ANALYZER] ✗ AI analysis error:', error.message);
      }
    }

    console.log('[CONTENT-ANALYZER] ✓ Content analysis complete');
    return {
      ...metrics,
      aiAnalysis
    };
  }

  calculateUniqueness(text) {
    const words = text.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words);

    if (words.length === 0) return 0;

    return (uniqueWords.size / words.length) * 100;
  }

  async analyzeImages(htmlContent) {
    console.log('[CONTENT-ANALYZER] Starting image analysis');
    const $ = load(htmlContent);

    const allImages = $('img');
    const totalImages = allImages.length;
    console.log(`[CONTENT-ANALYZER] Found ${totalImages} images on page`);

    let imagesWithAlt = 0;
    let hasFeaturedImages = false;
    let optimizedImages = false;

    allImages.each((i, img) => {
      const $img = $(img);

      if ($img.attr('alt') && $img.attr('alt').trim().length > 0) {
        imagesWithAlt++;
      }

      const src = $img.attr('src') || '';
      const classes = $img.attr('class') || '';

      if (classes.includes('featured') ||
          classes.includes('thumbnail') ||
          classes.includes('post-image') ||
          $img.parents('[class*="featured"]').length > 0) {
        hasFeaturedImages = true;
      }

      if (src.includes('.webp') ||
          src.includes('.avif') ||
          $img.attr('loading') === 'lazy') {
        optimizedImages = true;
      }
    });

    console.log(`[CONTENT-ANALYZER] Images with alt text: ${imagesWithAlt}/${totalImages}`);
    console.log(`[CONTENT-ANALYZER] Featured images: ${hasFeaturedImages ? 'yes' : 'no'}`);
    console.log(`[CONTENT-ANALYZER] Optimized images: ${optimizedImages ? 'yes' : 'no'}`);

    const videos = $('video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="dailymotion"]');
    const videosCount = videos.length;
    console.log(`[CONTENT-ANALYZER] Video embeds found: ${videosCount}`);

    const metrics = {
      totalImages,
      imagesWithAlt,
      hasFeaturedImages,
      optimizedImages,
      videosCount
    };

    let aiAnalysis = null;
    if (this.aiHelper) {
      try {
        console.log('[CONTENT-ANALYZER] Requesting AI analysis for images/media');
        aiAnalysis = await this.aiHelper.analyze({
          type: 'images_media',
          context: 'Evaluating image optimization, accessibility (alt tags), and media usage',
          metrics,
          html: htmlContent
        });
        console.log(`[CONTENT-ANALYZER] ✓ Image analysis complete - Score: ${aiAnalysis?.score || 'N/A'}`);
      } catch (error) {
        console.error('[CONTENT-ANALYZER] ✗ Image AI analysis error:', error.message);
      }
    }

    console.log('[CONTENT-ANALYZER] ✓ Image analysis complete');
    return {
      ...metrics,
      aiAnalysis
    };
  }

  async analyzePublishingMetadata(htmlContent, links) {
    console.log('[CONTENT-ANALYZER] Starting publishing metadata analysis');
    const $ = load(htmlContent);

    let hasPublishDates = false;
    let hasAuthorInfo = false;
    const postDates = [];
    let totalPostsFound = 0;

    const dateSelectors = [
      'time[datetime]',
      '[class*="date"]',
      '[class*="published"]',
      '[itemprop="datePublished"]',
      'meta[property="article:published_time"]'
    ];

    dateSelectors.forEach(selector => {
      const elements = $(selector);
      if (elements.length > 0) {
        hasPublishDates = true;

        elements.each((i, el) => {
          const $el = $(el);
          const datetime = $el.attr('datetime') ||
                          $el.attr('content') ||
                          $el.text().trim();

          if (datetime) {
            const parsedDate = this.parseDate(datetime);
            if (parsedDate) {
              postDates.push(parsedDate);
            }
          }
        });
      }
    });

    const authorSelectors = [
      '[class*="author"]',
      '[class*="byline"]',
      '[rel="author"]',
      '[itemprop="author"]',
      'meta[name="author"]'
    ];

    authorSelectors.forEach(selector => {
      if ($(selector).length > 0) {
        hasAuthorInfo = true;
      }
    });

    const postSelectors = [
      'article',
      '[class*="post"]',
      '[class*="entry"]',
      '[itemtype*="BlogPosting"]'
    ];

    postSelectors.forEach(selector => {
      totalPostsFound += $(selector).length;
    });

    totalPostsFound = Math.max(totalPostsFound, postDates.length);

    let latestPostDate = null;
    let postFrequencyDays = null;
    let contentFreshnessScore = 0;

    if (postDates.length > 0) {
      postDates.sort((a, b) => b - a);
      latestPostDate = postDates[0];

      const daysSinceLatest = Math.floor((Date.now() - latestPostDate.getTime()) / (1000 * 60 * 60 * 24));

      if (postDates.length > 1) {
        const dateRangeMs = postDates[0].getTime() - postDates[postDates.length - 1].getTime();
        const dateRangeDays = dateRangeMs / (1000 * 60 * 60 * 24);
        postFrequencyDays = dateRangeDays / (postDates.length - 1);
      }

      if (daysSinceLatest <= 7) {
        contentFreshnessScore = 100;
      } else if (daysSinceLatest <= 30) {
        contentFreshnessScore = 80;
      } else if (daysSinceLatest <= 90) {
        contentFreshnessScore = 60;
      } else if (daysSinceLatest <= 180) {
        contentFreshnessScore = 40;
      } else if (daysSinceLatest <= 365) {
        contentFreshnessScore = 20;
      } else {
        contentFreshnessScore = 10;
      }

      if (postFrequencyDays && postFrequencyDays <= 7) {
        contentFreshnessScore = Math.min(100, contentFreshnessScore + 10);
      }
    }

    console.log(`[CONTENT-ANALYZER] Publishing dates found: ${hasPublishDates ? 'yes' : 'no'}`);
    console.log(`[CONTENT-ANALYZER] Author info found: ${hasAuthorInfo ? 'yes' : 'no'}`);
    console.log(`[CONTENT-ANALYZER] Total posts found: ${totalPostsFound}`);
    if (latestPostDate) {
      const daysOld = Math.floor((Date.now() - latestPostDate.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`[CONTENT-ANALYZER] Latest post: ${daysOld} days old`);
    }
    console.log(`[CONTENT-ANALYZER] Content freshness score: ${contentFreshnessScore}/100`);

    const metrics = {
      hasPublishDates,
      hasAuthorInfo,
      latestPostDate,
      postFrequencyDays,
      totalPostsFound,
      contentFreshnessScore
    };

    let aiAnalysis = null;
    if (this.aiHelper) {
      try {
        console.log('[CONTENT-ANALYZER] Requesting AI analysis for publishing metadata');
        aiAnalysis = await this.aiHelper.analyze({
          type: 'publishing_metadata',
          context: 'Analyzing content freshness, publishing frequency, and author attribution',
          metrics,
          html: htmlContent
        });
        console.log(`[CONTENT-ANALYZER] ✓ Publishing analysis complete - Score: ${aiAnalysis?.score || 'N/A'}`);
      } catch (error) {
        console.error('[CONTENT-ANALYZER] ✗ Publishing AI analysis error:', error.message);
      }
    }

    console.log('[CONTENT-ANALYZER] ✓ Publishing metadata analysis complete');
    return {
      ...metrics,
      aiAnalysis
    };
  }

  parseDate(dateString) {
    try {
      const date = new Date(dateString);

      if (!isNaN(date.getTime()) && date.getFullYear() > 2000 && date.getFullYear() <= new Date().getFullYear()) {
        return date;
      }

      const patterns = [
        /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/,
        /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/,
        /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{1,2}),? (\d{4})/i
      ];

      for (const pattern of patterns) {
        const match = dateString.match(pattern);
        if (match) {
          const testDate = new Date(dateString);
          if (!isNaN(testDate.getTime())) {
            return testDate;
          }
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async checkSafeBrowsing(url) {
    console.log(`[CONTENT-ANALYZER] Starting Safe Browsing check for ${url}`);
    if (!this.safeBrowsingApiKey) {
      console.warn('[CONTENT-ANALYZER] ⚠ Google Safe Browsing API key not configured, skipping check');
      return {
        isSafe: true,
        threats: [],
        skipped: true
      };
    }

    try {
      const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
      console.log('[CONTENT-ANALYZER] Querying Google Safe Browsing API...');

      const requestBody = {
        client: {
          clientId: 'mfa-buster',
          clientVersion: '1.0.0'
        },
        threatInfo: {
          threatTypes: [
            'MALWARE',
            'SOCIAL_ENGINEERING',
            'UNWANTED_SOFTWARE',
            'POTENTIALLY_HARMFUL_APPLICATION'
          ],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [
            { url: normalizedUrl }
          ]
        }
      };

      const response = await fetch(`${this.safeBrowsingApiUrl}?key=${this.safeBrowsingApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        timeout: 10000
      });

      if (!response.ok) {
        console.error(`[CONTENT-ANALYZER] ✗ Safe Browsing API error: ${response.status} ${response.statusText}`);
        return {
          isSafe: true,
          threats: [],
          error: `API error: ${response.status}`
        };
      }

      const data = await response.json();

      if (data.matches && data.matches.length > 0) {
        console.log(`[CONTENT-ANALYZER] ✗ Threats detected: ${data.matches.length} match(es)`);
        const threats = data.matches.map(match => ({
          threatType: match.threatType,
          platformType: match.platformType,
          threatEntryType: match.threatEntryType,
          description: this.getThreatDescription(match.threatType)
        }));

        const riskLevel = this.calculateRiskLevel(threats);
        console.log(`[CONTENT-ANALYZER] Risk level: ${riskLevel}`);
        return {
          isSafe: false,
          threats,
          riskLevel
        };
      }

      console.log('[CONTENT-ANALYZER] ✓ Site is safe - no threats detected');
      return {
        isSafe: true,
        threats: []
      };

    } catch (error) {
      console.error(`[CONTENT-ANALYZER] ✗ Safe Browsing check error: ${error.message}`);
      return {
        isSafe: true,
        threats: [],
        error: error.message
      };
    }
  }

  calculateRiskLevel(threats) {
    const severityMap = {
      'MALWARE': 3,
      'SOCIAL_ENGINEERING': 3,
      'UNWANTED_SOFTWARE': 2,
      'POTENTIALLY_HARMFUL_APPLICATION': 1
    };

    const maxSeverity = Math.max(
      ...threats.map(t => severityMap[t.threatType] || 0)
    );

    if (maxSeverity >= 3) return 'critical';
    if (maxSeverity >= 2) return 'high';
    return 'medium';
  }

  getThreatDescription(threatType) {
    const descriptions = {
      'MALWARE': 'Site contains malware that can harm devices',
      'SOCIAL_ENGINEERING': 'Site attempts to trick users into revealing personal information',
      'UNWANTED_SOFTWARE': 'Site distributes unwanted or deceptive software',
      'POTENTIALLY_HARMFUL_APPLICATION': 'Site hosts potentially harmful applications'
    };

    return descriptions[threatType] || 'Unknown threat detected';
  }

  analyzeCategoryPage(htmlContent, categoryUrl) {
    const $ = load(htmlContent);

    const categoryName = this.extractCategoryName(categoryUrl, $);

    const articleSelectors = [
      'article',
      '[class*="post"]',
      '[class*="entry"]',
      '[itemtype*="BlogPosting"]',
      '[class*="article"]',
      '.blog-item',
      '.news-item'
    ];

    let articleCount = 0;
    const articleLinks = [];

    articleSelectors.forEach(selector => {
      const elements = $(selector);
      if (elements.length > articleCount) {
        articleCount = elements.length;
      }

      elements.each((i, el) => {
        const $el = $(el);
        const link = $el.find('a').first().attr('href');
        if (link && !articleLinks.includes(link)) {
          articleLinks.push(link);
        }
      });
    });

    const allLinks = $('a[href*="blog"], a[href*="article"], a[href*="post"], a[href*="news"]');
    allLinks.each((i, el) => {
      const href = $(el).attr('href');
      if (href && !articleLinks.includes(href)) {
        articleLinks.push(href);
      }
    });

    if (articleLinks.length > articleCount) {
      articleCount = articleLinks.length;
    }

    const hasPublishedArticles = articleCount > 0;
    const isEmpty = !hasPublishedArticles;

    return {
      categoryName,
      articleCount,
      hasPublishedArticles,
      isEmpty,
      articleLinks: articleLinks.slice(0, 10)
    };
  }

  extractCategoryName(categoryUrl, $) {
    try {
      const url = new URL(categoryUrl);
      const pathSegments = url.pathname.split('/').filter(Boolean);

      if (pathSegments.length > 0) {
        return pathSegments[pathSegments.length - 1]
          .replace(/-/g, ' ')
          .replace(/_/g, ' ')
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      }

      const title = $('title').text().trim();
      if (title) {
        return title.split('|')[0].split('-')[0].trim();
      }

      const h1 = $('h1').first().text().trim();
      if (h1) {
        return h1;
      }

      return 'Unknown Category';
    } catch (error) {
      return 'Unknown Category';
    }
  }

  async auditCategories(domain, publisherId = null) {
    console.log(`\n[CATEGORY-AUDIT] Starting category audit for ${domain}`);
    const results = [];

    try {
      const crawlResults = await this.crawler.crawlCategoryPages(domain);
      console.log(`[CATEGORY-AUDIT] Crawled ${crawlResults.length} category URLs`);

      for (const crawlResult of crawlResults) {
        const auditResult = await this.processCategoryResult(
          domain,
          publisherId,
          crawlResult
        );
        results.push(auditResult);
        await this.saveToDatabase(auditResult);
      }

      console.log(`[CATEGORY-AUDIT] Completed audit for ${domain}`);
      return results;
    } catch (error) {
      console.error(`[CATEGORY-AUDIT] Error auditing categories for ${domain}:`, error);
      throw error;
    } finally {
      await this.crawler.close();
    }
  }

  async processCategoryResult(domain, publisherId, crawlResult) {
    const { categoryUrl, success, is_404, htmlContent, error } = crawlResult;

    if (!success || error) {
      return {
        publisher_id: publisherId,
        domain,
        category_url: categoryUrl,
        category_name: null,
        has_published_articles: false,
        article_count: 0,
        is_404: is_404 || false,
        is_empty: false,
        ai_suggested_topics: [],
        ai_analysis: null,
        error_message: error || 'Failed to crawl category page'
      };
    }

    if (is_404) {
      return {
        publisher_id: publisherId,
        domain,
        category_url: categoryUrl,
        category_name: null,
        has_published_articles: false,
        article_count: 0,
        is_404: true,
        is_empty: false,
        ai_suggested_topics: [],
        ai_analysis: { reason: 'Category page not found', recommendation: 'Remove or fix broken link' }
      };
    }

    const categoryAnalysis = this.analyzeCategoryPage(htmlContent, categoryUrl);

    let aiAnalysis = null;
    let aiSuggestedTopics = [];

    if (categoryAnalysis.isEmpty && this.aiHelper) {
      try {
        aiAnalysis = await this.generateAIAnalysis(domain, categoryUrl, categoryAnalysis);
        aiSuggestedTopics = await this.generateContentTopics(domain, categoryAnalysis.categoryName);
      } catch (error) {
        console.error('[CATEGORY-AUDIT] AI generation error:', error);
      }
    }

    return {
      publisher_id: publisherId,
      domain,
      category_url: categoryUrl,
      category_name: categoryAnalysis.categoryName,
      has_published_articles: categoryAnalysis.hasPublishedArticles,
      article_count: categoryAnalysis.articleCount,
      is_404: false,
      is_empty: categoryAnalysis.isEmpty,
      ai_suggested_topics: aiSuggestedTopics,
      ai_analysis: aiAnalysis
    };
  }

  async generateAIAnalysis(domain, categoryUrl, categoryAnalysis) {
    if (!this.aiHelper) {
      return {
        reason: 'Empty category with no published content',
        recommendation: 'Add articles or remove category from navigation'
      };
    }

    try {
      const metrics = {
        category_name: categoryAnalysis.categoryName,
        article_count: categoryAnalysis.articleCount,
        has_articles: categoryAnalysis.hasPublishedArticles,
        is_empty: categoryAnalysis.isEmpty
      };

      const context = `Empty category detected on ${domain} at ${categoryUrl}`;

      const analysis = await this.aiHelper.analyze({
        type: 'category',
        context,
        metrics,
        html: null
      });

      return analysis;
    } catch (error) {
      console.error('[CATEGORY-AUDIT] AI analysis error:', error);
      return {
        reason: 'Empty category with no published content',
        recommendation: 'Add articles or remove category from navigation'
      };
    }
  }

  async generateContentTopics(domain, categoryName) {
    if (!this.aiHelper) {
      return this.generateFallbackTopics(categoryName);
    }

    try {
      const metrics = {
        domain,
        category_name: categoryName
      };

      const context = `Suggest 2 content topics for empty category "${categoryName}" on ${domain}`;

      const topicsAnalysis = await this.aiHelper.analyze({
        type: 'content_suggestions',
        context,
        metrics,
        html: null
      });

      const topics = this.extractTopicsFromAI(topicsAnalysis);
      return topics.slice(0, 2);
    } catch (error) {
      console.error('[CATEGORY-AUDIT] Topic generation error:', error);
      return this.generateFallbackTopics(categoryName);
    }
  }

  extractTopicsFromAI(aiResponse) {
    try {
      const { recommendation } = aiResponse;

      if (!recommendation) {
        return [];
      }

      const topics = recommendation
        .split(/[,;]/)
        .map(topic => topic.trim())
        .filter(topic => topic.length > 3 && topic.length < 100)
        .slice(0, 2);

      return topics;
    } catch (error) {
      return [];
    }
  }

  generateFallbackTopics(categoryName) {
    const topicTemplates = [
      `Introduction to ${categoryName}`,
      `Latest trends in ${categoryName}`,
      `${categoryName} best practices`,
      `Getting started with ${categoryName}`,
      `${categoryName} tips and tricks`
    ];

    return topicTemplates.slice(0, 2);
  }

  async saveToDatabase(auditResult) {
    if (!this.supabase) {
      console.warn('[CATEGORY-AUDIT] Supabase client not available, skipping database save');
      return;
    }

    try {
      const { error } = await this.supabase
        .from('category_audits')
        .insert({
          publisher_id: auditResult.publisher_id,
          domain: auditResult.domain,
          category_url: auditResult.category_url,
          category_name: auditResult.category_name,
          has_published_articles: auditResult.has_published_articles,
          article_count: auditResult.article_count,
          is_404: auditResult.is_404,
          is_empty: auditResult.is_empty,
          ai_suggested_topics: auditResult.ai_suggested_topics,
          ai_analysis: auditResult.ai_analysis,
          error_message: auditResult.error_message,
          crawled_at: new Date().toISOString()
        });

      if (error) {
        console.error('[CATEGORY-AUDIT] Database insert error:', error);
      } else {
        console.log(`[CATEGORY-AUDIT] Saved result for ${auditResult.category_url}`);
      }
    } catch (error) {
      console.error('[CATEGORY-AUDIT] Database save exception:', error);
    }
  }

  async getAuditResults(domain, options = {}) {
    if (!this.supabase) {
      console.warn('[CATEGORY-AUDIT] Supabase client not available');
      return [];
    }

    try {
      let query = this.supabase
        .from('category_audits')
        .select('*')
        .eq('domain', domain)
        .order('crawled_at', { ascending: false });

      if (options.isEmpty !== undefined) {
        query = query.eq('is_empty', options.isEmpty);
      }

      if (options.is404 !== undefined) {
        query = query.eq('is_404', options.is404);
      }

      if (options.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[CATEGORY-AUDIT] Query error:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[CATEGORY-AUDIT] Query exception:', error);
      return [];
    }
  }

  async getEmptyCategories(domain) {
    return this.getAuditResults(domain, { isEmpty: true });
  }

  async get404Categories(domain) {
    return this.getAuditResults(domain, { is404: true });
  }

  async getSummary(domain) {
    try {
      const allResults = await this.getAuditResults(domain);

      const summary = {
        total_categories: allResults.length,
        empty_categories: allResults.filter(r => r.is_empty).length,
        not_found_categories: allResults.filter(r => r.is_404).length,
        active_categories: allResults.filter(r => r.has_published_articles).length,
        total_articles: allResults.reduce((sum, r) => sum + (r.article_count || 0), 0),
        suggested_topics_count: allResults.reduce((sum, r) => sum + (r.ai_suggested_topics?.length || 0), 0)
      };

      return summary;
    } catch (error) {
      console.error('[CATEGORY-AUDIT] Summary error:', error);
      return null;
    }
  }
}
