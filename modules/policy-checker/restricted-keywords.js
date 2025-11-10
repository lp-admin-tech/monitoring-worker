const logger = require('../logger');

const MONETIZATION_ABUSE_KEYWORDS = {
  ad_blocking_tricks: [
    'click ads to support',
    'click ads to view content',
    'disable adblock',
    'disable ad blocker',
    'turn off adblocker',
    'whitelist us',
    'add to whitelist',
    'support us by clicking',
    'support by disabling adblock',
    'please disable your ad blocker',
  ],
  deceptive_cta: [
    'click here to continue',
    'click to view',
    'click for more information',
    'click link above',
    'visit advertiser',
    'sponsored content',
    'advertisement',
    'promoted link',
    'click to unlock',
    'unlock content',
  ],
  fake_system_warnings: [
    'your system is infected',
    'virus detected',
    'security warning',
    'critical alert',
    'system error',
    'update required',
    'urgent action needed',
    'your device is at risk',
    'click to fix',
  ],
};

const PROHIBITED_CONTENT_KEYWORDS = {
  counterfeit: [
    'counterfeit',
    'fake designer',
    'replica',
    'knockoff',
    'imitation',
    'unauthorized reproduction',
    'pirated',
    'bootleg',
  ],
  hacking: [
    'hack account',
    'crack password',
    'brute force',
    'keylogger',
    'malware',
    'trojan',
    'virus distribution',
    'exploit',
    'zero day',
  ],
  financial_fraud: [
    'make money fast',
    'guaranteed income',
    'free money',
    'easy money',
    'earn while you sleep',
    'quick cash',
    'pyramid scheme',
    'multi-level marketing',
    'work from home scam',
  ],
  fake_credentials: [
    'buy diploma',
    'fake degree',
    'diploma mill',
    'buy certificate',
    'fake license',
    'purchased credentials',
    'credential fraud',
  ],
};

const REGULATORY_VIOLATION_KEYWORDS = {
  undisclosed_affiliation: [
    'guaranteed results',
    'not sponsored',
    'not an advertisement',
    'organic content',
    'independent review',
    'unbiased opinion',
  ],
  health_fraud: [
    'cure cancer',
    'miracle cure',
    'proven to work',
    'clinically tested',
    'pharmaceutical grade',
    'FDA approved',
    'doctor recommended',
    'scientifically proven',
  ],
  get_rich_quick: [
    'crypto signals',
    'trading alerts',
    'hot stock tip',
    'penny stock',
    'guaranteed profit',
    'insider trading',
    'stock manipulation',
  ],
};

const GOOGLE_BANNED_KEYWORDS = {
  adult_content: [
    'adult video',
    'xxx',
    'pornography',
    'explicit content',
    'nude images',
    'adult chat',
  ],
  gambling: [
    'online casino',
    'online poker',
    'sports betting',
    'casino games',
    'real money games',
    'online gambling',
  ],
  drugs: [
    'buy cocaine',
    'heroin dealer',
    'buy methamphetamine',
    'drug supplier',
    'narcotics',
  ],
};

const ALL_RESTRICTED_KEYWORDS = {
  ...MONETIZATION_ABUSE_KEYWORDS,
  ...PROHIBITED_CONTENT_KEYWORDS,
  ...REGULATORY_VIOLATION_KEYWORDS,
  ...GOOGLE_BANNED_KEYWORDS,
};

function findRestrictedKeywords(text, category = null) {
  if (!text) return { found: [], violations: [] };

  const textLower = text.toLowerCase();
  const found = [];
  const violations = [];

  const keywordGroups = category ? { [category]: ALL_RESTRICTED_KEYWORDS[category] } : ALL_RESTRICTED_KEYWORDS;

  for (const [categoryName, keywords] of Object.entries(keywordGroups)) {
    if (!Array.isArray(keywords)) continue;

    for (const keyword of keywords) {
      if (textLower.includes(keyword.toLowerCase())) {
        found.push({
          keyword,
          category: categoryName,
          severity: getKeywordSeverity(categoryName),
        });

        violations.push({
          type: 'restricted_keyword',
          keyword,
          category: categoryName,
          severity: getKeywordSeverity(categoryName),
          message: generateViolationMessage(categoryName, keyword),
        });
      }
    }
  }

  return { found, violations };
}

function scanForViolations(pageData) {
  const violations = [];
  const detailedReport = {
    monetizationAbuse: [],
    prohibitedContent: [],
    regulatoryViolations: [],
    googleBanned: [],
    total: 0,
  };

  const textToScan = [
    pageData.title || '',
    pageData.description || '',
    pageData.content || '',
    pageData.headings?.join(' ') || '',
    pageData.links?.map(l => l.text).join(' ') || '',
  ].join(' ');

  for (const [categoryName, keywords] of Object.entries(MONETIZATION_ABUSE_KEYWORDS)) {
    const result = matchKeywordsInText(textToScan, keywords);
    if (result.matches.length > 0) {
      detailedReport.monetizationAbuse.push({
        subcategory: categoryName,
        keywords: result.matches,
        severity: 'high',
      });
      violations.push(...result.violations);
    }
  }

  for (const [categoryName, keywords] of Object.entries(PROHIBITED_CONTENT_KEYWORDS)) {
    const result = matchKeywordsInText(textToScan, keywords);
    if (result.matches.length > 0) {
      detailedReport.prohibitedContent.push({
        subcategory: categoryName,
        keywords: result.matches,
        severity: 'critical',
      });
      violations.push(...result.violations);
    }
  }

  for (const [categoryName, keywords] of Object.entries(REGULATORY_VIOLATION_KEYWORDS)) {
    const result = matchKeywordsInText(textToScan, keywords);
    if (result.matches.length > 0) {
      detailedReport.regulatoryViolations.push({
        subcategory: categoryName,
        keywords: result.matches,
        severity: 'high',
      });
      violations.push(...result.violations);
    }
  }

  for (const [categoryName, keywords] of Object.entries(GOOGLE_BANNED_KEYWORDS)) {
    const result = matchKeywordsInText(textToScan, keywords);
    if (result.matches.length > 0) {
      detailedReport.googleBanned.push({
        subcategory: categoryName,
        keywords: result.matches,
        severity: 'critical',
      });
      violations.push(...result.violations);
    }
  }

  detailedReport.total = violations.length;
  detailedReport.hasViolations = violations.length > 0;
  detailedReport.violations = violations;

  return detailedReport;
}

function matchKeywordsInText(text, keywords) {
  const textLower = text.toLowerCase();
  const matches = [];
  const violations = [];

  for (const keyword of keywords) {
    if (textLower.includes(keyword.toLowerCase())) {
      matches.push(keyword);

      violations.push({
        keyword,
        context: extractContext(text, keyword, 50),
      });
    }
  }

  return { matches, violations };
}

function extractContext(text, keyword, contextLength = 50) {
  const textLower = text.toLowerCase();
  const index = textLower.indexOf(keyword.toLowerCase());

  if (index === -1) return '';

  const start = Math.max(0, index - contextLength);
  const end = Math.min(text.length, index + keyword.length + contextLength);

  return text.substring(start, end).trim();
}

function getKeywordSeverity(category) {
  const criticalCategories = [
    'hacking',
    'financial_fraud',
    'fake_credentials',
    'health_fraud',
    'get_rich_quick',
    'adult_content',
    'gambling',
    'drugs',
  ];

  return criticalCategories.includes(category) ? 'critical' : 'high';
}

function generateViolationMessage(category, keyword) {
  const messages = {
    ad_blocking_tricks: `Ad blocking evasion detected: "${keyword}"`,
    deceptive_cta: `Deceptive call-to-action detected: "${keyword}"`,
    fake_system_warnings: `Fake system warning detected: "${keyword}"`,
    counterfeit: `Counterfeit product keywords detected: "${keyword}"`,
    hacking: `Hacking-related content detected: "${keyword}"`,
    financial_fraud: `Financial fraud indicators detected: "${keyword}"`,
    fake_credentials: `Credential fraud indicators detected: "${keyword}"`,
    undisclosed_affiliation: `Potentially undisclosed affiliation: "${keyword}"`,
    health_fraud: `Health fraud claim detected: "${keyword}"`,
    get_rich_quick: `Get-rich-quick scheme indicators: "${keyword}"`,
    adult_content: `Adult content violation detected: "${keyword}"`,
    gambling: `Gambling content violation detected: "${keyword}"`,
    drugs: `Drug-related content violation detected: "${keyword}"`,
  };

  return messages[category] || `Policy violation detected: "${keyword}"`;
}

function bulkValidateKeywords(phrases) {
  const results = [];

  for (const phrase of phrases) {
    const violations = findRestrictedKeywords(phrase);

    results.push({
      phrase,
      isViolation: violations.found.length > 0,
      violations: violations.violations,
      severity: violations.found.length > 0 ? violations.found[0].severity : 'none',
    });
  }

  return results;
}

function createCustomKeywordList(keywordGroups) {
  const customList = { ...ALL_RESTRICTED_KEYWORDS };

  for (const [category, keywords] of Object.entries(keywordGroups)) {
    if (Array.isArray(keywords)) {
      customList[category] = [
        ...(customList[category] || []),
        ...keywords,
      ];
    }
  }

  return customList;
}

module.exports = {
  findRestrictedKeywords,
  scanForViolations,
  matchKeywordsInText,
  extractContext,
  bulkValidateKeywords,
  createCustomKeywordList,
  getKeywordSeverity,
  generateViolationMessage,
  MONETIZATION_ABUSE_KEYWORDS,
  PROHIBITED_CONTENT_KEYWORDS,
  REGULATORY_VIOLATION_KEYWORDS,
  GOOGLE_BANNED_KEYWORDS,
  ALL_RESTRICTED_KEYWORDS,
};
