const logger = require('../logger');

const CATEGORY_KEYWORDS = {
  adult: {
    primary: /\b(porn|pornography|adult|xxx|nude|naked|sex|sexual|erotic|sensual|explicit|X-rated|18\+)\b/gi,
    secondary: /\b(cam|webcam|escort|stripper|mistress|dominant|submissive)\b/gi,
    weight: 1.0,
  },
  gambling: {
    primary: /\b(casino|poker|slots|roulette|blackjack|craps|baccarat|bet|betting|wager|gambling|gamble|wagering|sports betting|handicapping)\b/gi,
    secondary: /\b(odds|payout|jackpot|ante|chips|dealer|house edge|roll|spin)\b/gi,
    weight: 0.9,
  },
  violence: {
    primary: /\b(kill|murder|rape|assault|attack|weapon|gun|bomb|explosive|terrorist|terrorism|brutality|gore|blood|violent)\b/gi,
    secondary: /\b(fight|combat|warfare|massacre|slaughter|execution)\b/gi,
    weight: 0.85,
  },
  drugs: {
    primary: /\b(cocaine|heroin|meth|methamphetamine|marijuana|cannabis|weed|psychedelic|opium|fentanyl|xanax|oxycontin)\b/gi,
    secondary: /\b(dealer|pusher|junkie|addiction|rehab|sobriety)\b/gi,
    weight: 0.9,
  },
  weapons: {
    primary: /\b(handgun|rifle|shotgun|pistol|revolver|ak-47|ar-15|sniper|machine gun|explosives|landmine|grenade)\b/gi,
    secondary: /\b(ammunition|ballistic|firing|trigger|barrel|magazine)\b/gi,
    weight: 0.8,
  },
  hate: {
    primary: /\b(racist|racism|Nazi|antisemitic|homophobic|transphobic|discrimination|bigot|slur)\b/gi,
    secondary: /\b(supremacist|extremist|apartheid)\b/gi,
    weight: 0.95,
  },
  education: {
    primary: /\b(course|tutorial|learn|education|university|college|school|academy|training|class|lesson|certification|degree)\b/gi,
    secondary: /\b(student|professor|instructor|curriculum|syllabus|textbook|exam|assignment)\b/gi,
    weight: -0.3,
  },
  health: {
    primary: /\b(medical|healthcare|doctor|hospital|clinic|therapy|treatment|medication|prescription|vaccine|disease|condition)\b/gi,
    secondary: /\b(patient|physician|nurse|surgeon|diagnosis|prognosis)\b/gi,
    weight: -0.2,
  },
  news: {
    primary: /\b(news|breaking|article|report|journalist|editorial|opinion|analysis|investigation|journalist)\b/gi,
    secondary: /\b(headline|byline|correspondent|news agency|news outlet)\b/gi,
    weight: -0.1,
  },
  finance: {
    primary: /\b(stock|investment|trading|portfolio|cryptocurrency|bitcoin|ethereum|forex|forex|cryptocurrency)\b/gi,
    secondary: /\b(market|bullish|bearish|volatility|dividend|yield|bonds)\b/gi,
    weight: 0.1,
  },
  technology: {
    primary: /\b(software|hardware|computer|coding|programming|algorithm|data structure|API|cloud|database)\b/gi,
    secondary: /\b(bug|debug|compile|deploy|framework|library|module)\b/gi,
    weight: -0.1,
  },
};

const CONTENT_INDICATORS = {
  adult: {
    imagePatterns: [/nude|naked|explicit|pornographic/i],
    urlPatterns: [/adult|xxx|porn|sex/i],
    domainPatterns: [/\.xxx|porn|adult/i],
    metaPatterns: [/adult|18\+/i],
  },
  gambling: {
    imagePatterns: [/casino|poker|slots|roulette/i],
    urlPatterns: [/casino|poker|betting|gambl/i],
    domainPatterns: [/casino|gambl|poker|bet/i],
    metaPatterns: [/betting|gambling|odds/i],
  },
  violence: {
    imagePatterns: [/gore|blood|violent|weapon/i],
    urlPatterns: [/violence|weapon|gore/i],
    domainPatterns: [/violence|weapon/i],
    metaPatterns: [/violent|gore/i],
  },
};

function detectCategories(pageData) {
  const categories = [];
  const scores = {};

  const text = extractPageText(pageData);

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = calculateCategoryScore(category, keywords, text, pageData);

    scores[category] = score;

    if (score > 0.5) {
      categories.push({
        name: category,
        confidence: Math.min(1, score),
        score: score,
        evidence: gatherEvidence(category, keywords, text, pageData),
      });
    }
  }

  categories.sort((a, b) => b.confidence - a.confidence);

  return {
    detectedCategories: categories,
    primaryCategory: categories[0] || null,
    scores,
    analysis: generateCategoryAnalysis(categories, pageData),
  };
}

function calculateCategoryScore(category, keywords, text, pageData) {
  let score = 0;

  const primaryMatches = (text.match(keywords.primary) || []).length;
  const secondaryMatches = (text.match(keywords.secondary) || []).length;

  score += primaryMatches * 0.4;
  score += secondaryMatches * 0.1;

  const indicatorMatches = countContentIndicators(category, pageData);
  score += indicatorMatches * 0.2;

  const categoryWeight = keywords.weight || 0;
  if (categoryWeight < 0) {
    score = Math.max(0, score + categoryWeight);
  }

  const textLength = text.length || 1;
  const relativeScore = score / (textLength / 1000);

  return Math.min(5, relativeScore);
}

function extractPageText(pageData) {
  const parts = [];

  if (pageData.title) parts.push(pageData.title);
  if (pageData.description) parts.push(pageData.description);
  if (pageData.content) parts.push(pageData.content);
  if (pageData.headings) {
    if (Array.isArray(pageData.headings)) {
      parts.push(pageData.headings.join(' '));
    }
  }
  if (pageData.metadata) {
    if (typeof pageData.metadata === 'string') {
      parts.push(pageData.metadata);
    } else if (pageData.metadata.keywords) {
      parts.push(pageData.metadata.keywords);
    }
  }

  return parts.join(' ').toLowerCase();
}

function countContentIndicators(category, pageData) {
  const indicators = CONTENT_INDICATORS[category];
  if (!indicators) return 0;

  let count = 0;

  if (indicators.urlPatterns && pageData.url) {
    count += indicators.urlPatterns.filter(p => p.test(pageData.url)).length;
  }

  if (indicators.domainPatterns && pageData.url) {
    try {
      const domain = new URL(pageData.url).hostname;
      count += indicators.domainPatterns.filter(p => p.test(domain)).length;
    } catch (e) {}
  }

  if (indicators.metaPatterns) {
    const metaText = (pageData.title || '') + (pageData.description || '');
    count += indicators.metaPatterns.filter(p => p.test(metaText)).length;
  }

  if (indicators.imagePatterns && pageData.images) {
    if (Array.isArray(pageData.images)) {
      count += pageData.images.filter(img => {
        const alt = img.alt || '';
        const src = img.src || '';
        return indicators.imagePatterns.some(p => p.test(alt) || p.test(src));
      }).length;
    }
  }

  return Math.min(5, count);
}

function gatherEvidence(category, keywords, text, pageData) {
  const evidence = {
    keywordMatches: [],
    indicators: [],
    sources: [],
  };

  const primaryMatches = text.match(keywords.primary) || [];
  const uniquePrimary = [...new Set(primaryMatches)].slice(0, 5);
  evidence.keywordMatches.push(...uniquePrimary);

  if (CONTENT_INDICATORS[category]) {
    const indicators = CONTENT_INDICATORS[category];

    if (indicators.urlPatterns && pageData.url) {
      const matched = indicators.urlPatterns.find(p => p.test(pageData.url));
      if (matched) {
        evidence.indicators.push(`URL contains category keywords: ${pageData.url}`);
        evidence.sources.push('url');
      }
    }

    if (indicators.domainPatterns && pageData.url) {
      try {
        const domain = new URL(pageData.url).hostname;
        const matched = indicators.domainPatterns.find(p => p.test(domain));
        if (matched) {
          evidence.indicators.push(`Domain matches category pattern: ${domain}`);
          evidence.sources.push('domain');
        }
      } catch (e) {}
    }

    if (indicators.metaPatterns) {
      const metaText = (pageData.title || '') + (pageData.description || '');
      const matched = indicators.metaPatterns.find(p => p.test(metaText));
      if (matched) {
        evidence.indicators.push('Category keywords found in title/description');
        evidence.sources.push('metadata');
      }
    }
  }

  return evidence;
}

function generateCategoryAnalysis(categories, pageData) {
  const analysis = {
    hasSensitiveContent: false,
    sensitiveCategories: [],
    riskLevel: 'low',
    summary: '',
  };

  const sensitiveCategories = ['adult', 'gambling', 'violence', 'drugs', 'hate', 'weapons'];

  const detected = categories.filter(c => sensitiveCategories.includes(c.name) && c.confidence > 0.6);

  if (detected.length > 0) {
    analysis.hasSensitiveContent = true;
    analysis.sensitiveCategories = detected.map(c => c.name);

    const avgConfidence = detected.reduce((sum, c) => sum + c.confidence, 0) / detected.length;

    if (avgConfidence > 0.8 || detected.length > 1) {
      analysis.riskLevel = 'high';
    } else if (avgConfidence > 0.65) {
      analysis.riskLevel = 'medium';
    } else {
      analysis.riskLevel = 'low';
    }
  }

  if (categories.length === 0) {
    analysis.summary = 'No sensitive categories detected';
  } else if (categories[0].confidence > 0.8) {
    analysis.summary = `Strong indicators of ${categories[0].name} content`;
  } else if (categories[0].confidence > 0.6) {
    analysis.summary = `Moderate indicators of ${categories[0].name} content`;
  } else {
    analysis.summary = `Weak indicators of ${categories[0].name} content`;
  }

  return analysis;
}

function classifyContent(pageData) {
  return detectCategories(pageData);
}

module.exports = {
  detectCategories,
  classifyContent,
  calculateCategoryScore,
  extractPageText,
  gatherEvidence,
  generateCategoryAnalysis,
  CATEGORY_KEYWORDS,
  CONTENT_INDICATORS,
};
