const logger = require('../logger');

const GOOGLE_POLICIES = {
  NO_ADULT_CONTENT: {
    id: 'no_adult_content',
    name: 'No Adult Content',
    severity: 'critical',
    jurisdictions: ['global'],
    rules: [
      {
        type: 'keyword',
        pattern: /\b(porn|adult|xxx|nude|sex|erotic|naked)\b/gi,
        threshold: 1,
        context: 'content,metadata',
      },
      {
        type: 'category',
        categories: ['adult'],
        threshold: 0.7,
      },
      {
        type: 'entropy',
        minEntropy: 4.5,
        textLength: 100,
      },
    ],
  },
  NO_GAMBLING: {
    id: 'no_gambling',
    name: 'No Gambling Content',
    severity: 'critical',
    jurisdictions: ['global', 'US', 'EU'],
    rules: [
      {
        type: 'keyword',
        pattern: /\b(bet|casino|poker|slots|roulette|blackjack|sports betting|wager|gambling)\b/gi,
        threshold: 2,
        context: 'content,metadata,links',
      },
      {
        type: 'category',
        categories: ['gambling'],
        threshold: 0.8,
      },
      {
        type: 'restricted_keyword',
        keywords: ['best casino sites', 'free casino', 'play for real money'],
      },
    ],
  },
  NO_MALWARE: {
    id: 'no_malware',
    name: 'No Malware or Unsafe Software',
    severity: 'critical',
    jurisdictions: ['global'],
    rules: [
      {
        type: 'keyword',
        pattern: /\b(crack|keygen|cracked|serial|warez|malware|virus|trojan)\b/gi,
        threshold: 1,
        context: 'content,links,metadata',
      },
      {
        type: 'technical',
        checks: ['suspicious_redirects', 'iframe_injection', 'script_injection'],
      },
    ],
  },
  NO_DECEPTIVE_PRACTICES: {
    id: 'no_deceptive_practices',
    name: 'No Deceptive Practices',
    severity: 'high',
    jurisdictions: ['global'],
    rules: [
      {
        type: 'keyword',
        pattern: /\b(click here to support|earn money fast|guaranteed|secret|work from home|free money)\b/gi,
        threshold: 2,
        context: 'content,links',
      },
      {
        type: 'clickbait',
        detectionMethod: 'entropy_and_credibility',
      },
      {
        type: 'restricted_keyword',
        keywords: ['click ads to support', 'click ads to view content', 'disable adblock'],
      },
    ],
  },
  NO_VIOLENT_CONTENT: {
    id: 'no_violent_content',
    name: 'No Violent or Hateful Content',
    severity: 'high',
    jurisdictions: ['global'],
    rules: [
      {
        type: 'keyword',
        pattern: /\b(kill|murder|rape|hate|racism|terrorism|extremism)\b/gi,
        threshold: 1,
        context: 'content',
      },
      {
        type: 'category',
        categories: ['violent'],
        threshold: 0.75,
      },
    ],
  },
  COPPA_COMPLIANCE: {
    id: 'coppa_compliance',
    name: 'COPPA Compliance (Children\'s Online Privacy)',
    severity: 'critical',
    jurisdictions: ['US'],
    rules: [
      {
        type: 'keyword',
        pattern: /\b(kids|children|kindergarten|elementary|toddler|playhouse)\b/gi,
        threshold: 3,
        context: 'content,metadata',
      },
      {
        type: 'category',
        categories: ['children'],
        threshold: 0.8,
      },
      {
        type: 'technical',
        checks: ['third_party_tracking', 'persistent_identifiers', 'age_verification'],
      },
    ],
  },
};

const CCPA_RULES = {
  GDPR_REQUIREMENTS: {
    id: 'gdpr_compliance',
    name: 'GDPR Compliance',
    severity: 'high',
    jurisdictions: ['EU'],
    rules: [
      {
        type: 'technical',
        checks: ['cookie_consent_banner', 'privacy_policy', 'data_processing_agreement'],
      },
      {
        type: 'content',
        requirements: ['privacy_policy_visible', 'data_collection_disclosed'],
      },
    ],
  },
  CCPA_REQUIREMENTS: {
    id: 'ccpa_compliance',
    name: 'CCPA Compliance (California)',
    severity: 'high',
    jurisdictions: ['US_CA'],
    rules: [
      {
        type: 'technical',
        checks: ['privacy_policy_accessible', 'opt_out_mechanism', 'data_sale_disclosure'],
      },
      {
        type: 'content',
        requirements: ['collection_purposes_disclosed', 'consumer_rights_stated'],
      },
    ],
  },
};

const IAS_STANDARDS = {
  BRAND_SAFETY: {
    id: 'ias_brand_safety',
    name: 'IAS Brand Safety Standards',
    severity: 'high',
    jurisdictions: ['global'],
    rules: [
      {
        type: 'category',
        categories: ['adult', 'gambling', 'violent'],
        threshold: 0.5,
      },
      {
        type: 'keyword',
        pattern: /\b(explicit|rated|adult|gambling|weapons)\b/gi,
        threshold: 1,
        context: 'content',
      },
    ],
  },
  VIEWABILITY: {
    id: 'ias_viewability',
    name: 'IAS Viewability Standards',
    severity: 'medium',
    jurisdictions: ['global'],
    rules: [
      {
        type: 'technical',
        checks: ['viewport_visibility', 'page_load_time', 'ad_placement_visibility'],
      },
    ],
  },
};

const ALL_POLICIES = {
  ...GOOGLE_POLICIES,
  ...CCPA_RULES,
  ...IAS_STANDARDS,
};

function getPoliciesByJurisdiction(jurisdiction) {
  const applicablePolicies = {};

  Object.entries(ALL_POLICIES).forEach(([key, policy]) => {
    if (
      policy.jurisdictions.includes('global') ||
      policy.jurisdictions.includes(jurisdiction)
    ) {
      applicablePolicies[key] = policy;
    }
  });

  return applicablePolicies;
}

function getPolicyById(policyId) {
  return ALL_POLICIES[policyId] || null;
}

function evaluateRule(rule, data) {
  try {
    switch (rule.type) {
      case 'keyword':
        return evaluateKeywordRule(rule, data);
      case 'category':
        return evaluateCategoryRule(rule, data);
      case 'entropy':
        return evaluateEntropyRule(rule, data);
      case 'clickbait':
        return evaluateClickbaitRule(rule, data);
      case 'restricted_keyword':
        return evaluateRestrictedKeywordRule(rule, data);
      case 'technical':
        return evaluateTechnicalRule(rule, data);
      case 'content':
        return evaluateContentRule(rule, data);
      default:
        return { matched: false, confidence: 0 };
    }
  } catch (error) {
    logger.warn('Rule evaluation error', { ruleType: rule.type, error: error.message });
    return { matched: false, confidence: 0, error: error.message };
  }
}

function evaluateKeywordRule(rule, data) {
  const { pattern, threshold, context } = rule;
  const text = extractContextText(data, context);

  if (!text) {
    return { matched: false, confidence: 0 };
  }

  const matches = text.match(pattern) || [];
  const matched = matches.length >= threshold;

  return {
    matched,
    confidence: Math.min(1, matches.length / threshold),
    matchCount: matches.length,
    samples: matches.slice(0, 3),
  };
}

function evaluateCategoryRule(rule, data) {
  const { categories, threshold } = rule;
  const detectedCategories = data.categories || [];

  if (!detectedCategories.length) {
    return { matched: false, confidence: 0 };
  }

  const matchedCategory = detectedCategories.find(
    cat => categories.includes(cat.name) && cat.confidence >= threshold
  );

  return {
    matched: !!matchedCategory,
    confidence: matchedCategory?.confidence || 0,
    category: matchedCategory?.name,
  };
}

function evaluateEntropyRule(rule, data) {
  const { minEntropy, textLength } = rule;
  const text = data.content || '';

  if (text.length < textLength) {
    return { matched: false, confidence: 0 };
  }

  const entropy = calculateEntropy(text);
  const matched = entropy >= minEntropy;

  return {
    matched,
    confidence: entropy / minEntropy,
    entropy: entropy.toFixed(2),
  };
}

function evaluateClickbaitRule(rule, data) {
  const entropy = calculateEntropy(data.title || '');
  const titleLength = data.title?.length || 0;
  const hasCapitalLetters = (data.title?.match(/[A-Z]/g) || []).length > titleLength * 0.4;
  const hasExclamation = (data.title?.match(/!/g) || []).length > 1;

  const clickbaitScore = (entropy / 4.5 + (hasCapitalLetters ? 0.3 : 0) + (hasExclamation ? 0.2 : 0)) / 2;

  return {
    matched: clickbaitScore > 0.6,
    confidence: Math.min(1, clickbaitScore),
    factors: { entropy, capitalLetters: hasCapitalLetters, exclamation: hasExclamation },
  };
}

function evaluateRestrictedKeywordRule(rule, data) {
  const { keywords } = rule;
  const text = (data.content || '' + (data.title || '')).toLowerCase();

  const foundKeywords = keywords.filter(keyword => text.includes(keyword.toLowerCase()));

  return {
    matched: foundKeywords.length > 0,
    confidence: foundKeywords.length / keywords.length,
    foundKeywords,
  };
}

function evaluateTechnicalRule(rule, data) {
  const { checks } = rule;
  const technicalData = data.technical || {};

  const results = checks.map(check => ({
    check,
    detected: technicalData[check] || false,
  }));

  const detectedCount = results.filter(r => r.detected).length;
  const matched = detectedCount > 0;

  return {
    matched,
    confidence: detectedCount / checks.length,
    details: results,
  };
}

function evaluateContentRule(rule, data) {
  const { requirements } = rule;
  const contentData = data.content_metadata || {};

  const results = requirements.map(req => ({
    requirement: req,
    met: contentData[req] || false,
  }));

  const metCount = results.filter(r => r.met).length;
  const matched = metCount === 0;

  return {
    matched,
    confidence: 1 - metCount / requirements.length,
    details: results,
  };
}

function extractContextText(data, context) {
  const parts = context?.split(',') || [];
  let text = '';

  if (parts.includes('content')) {
    text += ' ' + (data.content || '');
  }
  if (parts.includes('metadata')) {
    text += ' ' + (data.title || '') + ' ' + (data.description || '');
  }
  if (parts.includes('links')) {
    text += ' ' + (data.links?.map(l => l.text || l.href).join(' ') || '');
  }

  return text.trim();
}

function calculateEntropy(text) {
  if (!text || text.length === 0) return 0;

  const frequencies = {};
  for (const char of text.toLowerCase()) {
    frequencies[char] = (frequencies[char] || 0) + 1;
  }

  let entropy = 0;
  const len = text.length;

  for (const freq of Object.values(frequencies)) {
    const p = freq / len;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

module.exports = {
  GOOGLE_POLICIES,
  CCPA_RULES,
  IAS_STANDARDS,
  ALL_POLICIES,
  getPoliciesByJurisdiction,
  getPolicyById,
  evaluateRule,
  calculateEntropy,
};
