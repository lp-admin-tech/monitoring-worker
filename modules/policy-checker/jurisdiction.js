const logger = require('../logger');

const TLD_JURISDICTION_MAP = {
  '.de': 'EU',
  '.fr': 'EU',
  '.uk': 'EU',
  '.it': 'EU',
  '.es': 'EU',
  '.nl': 'EU',
  '.be': 'EU',
  '.at': 'EU',
  '.ch': 'EU',
  '.se': 'EU',
  '.no': 'EU',
  '.dk': 'EU',
  '.fi': 'EU',
  '.ie': 'EU',
  '.pl': 'EU',
  '.cz': 'EU',
  '.eu': 'EU',
  '.us': 'US',
  '.ca': 'CA',
  '.mx': 'MX',
  '.br': 'BR',
  '.au': 'AU',
  '.jp': 'JP',
  '.cn': 'CN',
  '.in': 'IN',
  '.ru': 'RU',
  '.ae': 'UAE',
  '.sg': 'SG',
  '.hk': 'HK',
};

const LANGUAGE_JURISDICTION_MAP = {
  'de': 'EU',
  'fr': 'EU',
  'it': 'EU',
  'es': 'EU',
  'nl': 'EU',
  'sv': 'EU',
  'da': 'EU',
  'no': 'EU',
  'fi': 'EU',
  'pl': 'EU',
  'cs': 'EU',
  'en': 'US',
  'en-US': 'US',
  'en-GB': 'EU',
  'en-CA': 'CA',
  'en-AU': 'AU',
  'pt': 'BR',
  'pt-BR': 'BR',
  'ja': 'JP',
  'zh': 'CN',
  'ru': 'RU',
  'ar': 'UAE',
};

const CURRENCY_JURISDICTION_MAP = {
  '$': 'US',
  '�': 'EU',
  '�': 'EU',
  '�': 'JP',
  '�': 'IN',
  'USD': 'US',
  'EUR': 'EU',
  'GBP': 'EU',
  'JPY': 'JP',
  'INR': 'IN',
  'AUD': 'AU',
  'CAD': 'CA',
  'BRL': 'BR',
};

const STATE_JURISDICTION_MAP = {
  'CA': 'US_CA',
  'VA': 'US_VA',
  'CO': 'US_CO',
  'CT': 'US_CT',
  'MT': 'US_MT',
  'OR': 'US_OR',
  'UT': 'US_UT',
};

const JURISDICTION_COMPLIANCE_POLICIES = {
  EU: {
    name: 'European Union',
    policies: ['GDPR', 'ePrivacy', 'Digital Services Act'],
    cookieConsent: true,
    privacyByDefault: true,
    dataProcessing: true,
  },
  US: {
    name: 'United States (Federal)',
    policies: ['FTC Act', 'CAN-SPAM', 'Gramm-Leach-Bliley'],
    cookieConsent: false,
    privacyByDefault: false,
    dataProcessing: false,
  },
  US_CA: {
    name: 'California',
    policies: ['CCPA', 'CPRA'],
    cookieConsent: false,
    privacyByDefault: true,
    dataProcessing: true,
  },
  US_VA: {
    name: 'Virginia',
    policies: ['VCDPA'],
    cookieConsent: false,
    privacyByDefault: true,
    dataProcessing: true,
  },
  CA: {
    name: 'Canada',
    policies: ['PIPEDA', 'CASL'],
    cookieConsent: true,
    privacyByDefault: false,
    dataProcessing: true,
  },
  AU: {
    name: 'Australia',
    policies: ['Privacy Act'],
    cookieConsent: true,
    privacyByDefault: false,
    dataProcessing: true,
  },
};

function detectJurisdiction(pageData) {
  const signals = {
    tld: null,
    language: null,
    currency: null,
    geoLocation: null,
    cookieConsent: null,
    privacyIndicators: null,
  };

  signals.tld = detectFromTLD(pageData.url);
  signals.language = detectFromLanguageTags(pageData.html);
  signals.currency = detectFromCurrencyIndicators(pageData.html, pageData.content);
  signals.geoLocation = pageData.geoLocation || null;
  signals.cookieConsent = detectCookieConsent(pageData.html);
  signals.privacyIndicators = detectPrivacyIndicators(pageData.html);

  const detectedJurisdictions = aggregateJurisdictionSignals(signals);

  return {
    primaryJurisdiction: detectedJurisdictions[0] || 'US',
    allJurisdictions: detectedJurisdictions,
    signals,
    confidence: calculateConfidence(detectedJurisdictions, signals),
  };
}

function detectFromTLD(url) {
  if (!url) return null;

  try {
    const domain = new URL(url).hostname;
    const tld = '.' + domain.split('.').pop();

    return TLD_JURISDICTION_MAP[tld.toLowerCase()] || null;
  } catch (error) {
    logger.warn('TLD detection failed', { url, error: error.message });
    return null;
  }
}

function detectFromLanguageTags(html) {
  if (!html) return null;

  const langMatch = html.match(/<html[^>]*lang=["']([^"']+)["']/i);
  if (langMatch) {
    const lang = langMatch[1].toLowerCase();
    return LANGUAGE_JURISDICTION_MAP[lang] || null;
  }

  const metaLangMatch = html.match(/<meta[^>]*http-equiv=["']content-language["'][^>]*content=["']([^"']+)["']/i);
  if (metaLangMatch) {
    const lang = metaLangMatch[1].toLowerCase();
    return LANGUAGE_JURISDICTION_MAP[lang] || null;
  }

  return null;
}

function detectFromCurrencyIndicators(html, content) {
  if (!html && !content) return null;

  const text = (html + ' ' + content).toLowerCase();
  const currencies = Object.keys(CURRENCY_JURISDICTION_MAP);

  for (const currency of currencies) {
    if (text.includes(currency.toLowerCase())) {
      const jurisdiction = CURRENCY_JURISDICTION_MAP[currency];
      return jurisdiction;
    }
  }

  return null;
}

function detectCookieConsent(html) {
  if (!html) return null;

  const cookiePatterns = [
    /cookie.*consent/i,
    /gdpr.*compliance/i,
    /accept.*cookies/i,
    /cookie.*policy/i,
    /manage.*consent/i,
  ];

  const hasCookieConsent = cookiePatterns.some(pattern => pattern.test(html));

  return hasCookieConsent ? 'detected' : 'not_detected';
}

function detectPrivacyIndicators(html) {
  if (!html) return null;

  const indicators = {
    privacyPolicy: /privacy.*policy/i.test(html),
    termsOfService: /terms.*service|terms.*use/i.test(html),
    dataProcessing: /data.*processing|processing.*agreement/i.test(html),
    ageRestriction: /age.*restrict|18.*years|21.*years/i.test(html),
    gdprNotice: /gdpr|general.*data.*protection/i.test(html),
    ccpaNotice: /ccpa|california.*privacy/i.test(html),
    coppaCompliance: /coppa|children.*privacy|children.*online/i.test(html),
  };

  return indicators;
}

function aggregateJurisdictionSignals(signals) {
  const jurisdictionScores = {};

  const addScore = (jurisdiction, score) => {
    if (jurisdiction) {
      jurisdictionScores[jurisdiction] = (jurisdictionScores[jurisdiction] || 0) + score;
    }
  };

  if (signals.tld) addScore(signals.tld, 3);
  if (signals.language) addScore(signals.language, 2);
  if (signals.currency) addScore(signals.currency, 2);
  if (signals.geoLocation) addScore(signals.geoLocation, 2);

  if (signals.cookieConsent === 'detected') {
    addScore('EU', 1);
  }

  if (signals.privacyIndicators) {
    if (signals.privacyIndicators.gdprNotice) addScore('EU', 1);
    if (signals.privacyIndicators.ccpaNotice) addScore('US_CA', 1);
    if (signals.privacyIndicators.coppaCompliance) addScore('US', 1);
  }

  const sorted = Object.entries(jurisdictionScores)
    .sort((a, b) => b[1] - a[1])
    .map(([jurisdiction]) => jurisdiction);

  return sorted;
}

function calculateConfidence(jurisdictions, signals) {
  let confidenceScore = 0;
  let signalCount = 0;

  if (signals.tld) {
    confidenceScore += 0.3;
    signalCount++;
  }
  if (signals.language) {
    confidenceScore += 0.2;
    signalCount++;
  }
  if (signals.currency) {
    confidenceScore += 0.2;
    signalCount++;
  }
  if (signals.geoLocation) {
    confidenceScore += 0.3;
    signalCount++;
  }

  if (signalCount === 0) return 0;

  return Math.min(1, confidenceScore);
}

function getApplicablePolicies(jurisdiction) {
  return JURISDICTION_COMPLIANCE_POLICIES[jurisdiction] || null;
}

function isJurisdictionRelevant(detectedJurisdiction, targetJurisdiction) {
  if (targetJurisdiction === 'global') return true;
  if (detectedJurisdiction === targetJurisdiction) return true;

  if (targetJurisdiction === 'EU' && detectedJurisdiction.startsWith('EU')) {
    return true;
  }

  if (targetJurisdiction === 'US' && detectedJurisdiction.startsWith('US')) {
    return true;
  }

  return false;
}

function extractStateFromAddress(address) {
  if (!address) return null;

  const stateMatch = address.match(/,\s*([A-Z]{2})\s+\d{5}/);
  if (stateMatch) {
    return STATE_JURISDICTION_MAP[stateMatch[1]] || null;
  }

  return null;
}

module.exports = {
  detectJurisdiction,
  detectFromTLD,
  detectFromLanguageTags,
  detectFromCurrencyIndicators,
  detectCookieConsent,
  detectPrivacyIndicators,
  getApplicablePolicies,
  isJurisdictionRelevant,
  extractStateFromAddress,
  JURISDICTION_COMPLIANCE_POLICIES,
  TLD_JURISDICTION_MAP,
  LANGUAGE_JURISDICTION_MAP,
  CURRENCY_JURISDICTION_MAP,
};
