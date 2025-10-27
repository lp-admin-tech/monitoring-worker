import { load } from 'cheerio';
import fetch from 'node-fetch';

export class ContentAnalyzer {
  constructor() {
    this.safeBrowsingApiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
    this.safeBrowsingApiUrl = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';
  }

  analyzeContent(htmlContent, links) {
    const $ = load(htmlContent);

    const textContent = $('body').text().trim();
    const contentLength = textContent.length;

    const contentUniqueness = this.calculateUniqueness(textContent);

    const hasPrivacyPolicy = links.some(link =>
      /privacy|policy/i.test(link)
    ) || $('a:contains("Privacy"), a:contains("privacy")').length > 0;

    const hasContactPage = links.some(link =>
      /contact/i.test(link)
    ) || $('a:contains("Contact"), a:contains("contact")').length > 0;

    return {
      contentLength,
      contentUniqueness,
      hasPrivacyPolicy,
      hasContactPage
    };
  }

  calculateUniqueness(text) {
    const words = text.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words);

    if (words.length === 0) return 0;

    return (uniqueWords.size / words.length) * 100;
  }

  analyzeImages(htmlContent) {
    const $ = load(htmlContent);

    const allImages = $('img');
    const totalImages = allImages.length;

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

    const videos = $('video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="dailymotion"]');
    const videosCount = videos.length;

    return {
      totalImages,
      imagesWithAlt,
      hasFeaturedImages,
      optimizedImages,
      videosCount
    };
  }

  analyzePublishingMetadata(htmlContent, links) {
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

    return {
      hasPublishDates,
      hasAuthorInfo,
      latestPostDate,
      postFrequencyDays,
      totalPostsFound,
      contentFreshnessScore
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
    if (!this.safeBrowsingApiKey) {
      console.warn('Google Safe Browsing API key not configured, skipping check');
      return {
        isSafe: true,
        threats: [],
        skipped: true
      };
    }

    try {
      const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;

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
        console.error('Safe Browsing API error:', response.status, response.statusText);
        return {
          isSafe: true,
          threats: [],
          error: `API error: ${response.status}`
        };
      }

      const data = await response.json();

      if (data.matches && data.matches.length > 0) {
        const threats = data.matches.map(match => ({
          threatType: match.threatType,
          platformType: match.platformType,
          threatEntryType: match.threatEntryType,
          description: this.getThreatDescription(match.threatType)
        }));

        return {
          isSafe: false,
          threats,
          riskLevel: this.calculateRiskLevel(threats)
        };
      }

      return {
        isSafe: true,
        threats: []
      };

    } catch (error) {
      console.error('Safe Browsing check error:', error.message);
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
}
