const logger = require('../logger');

const CHEAP_HOSTING_INDICATORS = {
  asns: [
    16276,
    12389,
    34011,
    206092,
    203281,
    201814,
    394465,
    210663,
  ],
  providers: [
    'digitalocean',
    'linode',
    'vultr',
    'amazon',
    'ovh',
    'hetzner',
    'alibaba',
    'upcloud',
  ],
};

const HIGH_REPUTATION_REGISTRARS = [
  'verisign',
  'godaddy',
  'networksolutions',
  'tucows',
  'name.com',
  'gandi',
  'namecheap',
  'enom',
];

function calculateDomainAge(registrationDate) {
  if (!registrationDate) return null;

  const regDate = new Date(registrationDate);
  const now = new Date();
  const ageMs = now - regDate;
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  const ageYears = Math.floor(ageDays / 365);

  return {
    days: ageDays,
    years: ageYears,
    registeredDate: registrationDate,
  };
}

function validateDomainAge(ageData) {
  if (!ageData) {
    return {
      valid: false,
      riskLevel: 'high',
      reason: 'Domain age could not be determined',
    };
  }

  if (ageData.days < 0) {
    return {
      valid: false,
      riskLevel: 'critical',
      reason: 'Domain registration date is in the future',
    };
  }

  if (ageData.days < 30) {
    return {
      valid: true,
      riskLevel: 'critical',
      reason: 'Domain is brand new (< 30 days)',
      score: 20,
    };
  }

  if (ageData.days < 180) {
    return {
      valid: true,
      riskLevel: 'high',
      reason: 'Domain is very young (< 6 months)',
      score: 40,
    };
  }

  if (ageData.days < 365) {
    return {
      valid: true,
      riskLevel: 'medium',
      reason: 'Domain is young (< 1 year)',
      score: 60,
    };
  }

  if (ageData.days < 1825) {
    return {
      valid: true,
      riskLevel: 'low',
      reason: 'Domain is established',
      score: 85,
    };
  }

  return {
    valid: true,
    riskLevel: 'very-low',
    reason: 'Domain is well-established',
    score: 100,
  };
}

function analyzeASNReputation(asn) {
  if (!asn) {
    return {
      reputation: 'unknown',
      riskLevel: 'medium',
      score: 50,
    };
  }

  const asnNum = parseInt(asn);

  if (CHEAP_HOSTING_INDICATORS.asns.includes(asnNum)) {
    return {
      reputation: 'low-quality-host',
      riskLevel: 'medium',
      score: 40,
      asn: asn,
    };
  }

  return {
    reputation: 'standard',
    riskLevel: 'low',
    score: 80,
    asn: asn,
  };
}

function analyzeHostingProvider(hostingProvider) {
  if (!hostingProvider) {
    return {
      quality: 'unknown',
      riskLevel: 'medium',
      score: 50,
    };
  }

  const providerLower = hostingProvider.toLowerCase();

  for (const cheapProvider of CHEAP_HOSTING_INDICATORS.providers) {
    if (providerLower.includes(cheapProvider)) {
      return {
        quality: 'low-cost-provider',
        riskLevel: 'medium',
        score: 45,
        provider: hostingProvider,
      };
    }
  }

  return {
    quality: 'premium',
    riskLevel: 'low',
    score: 85,
    provider: hostingProvider,
  };
}

function analyzeRegistrar(registrar) {
  if (!registrar) {
    return {
      reputation: 'unknown',
      score: 50,
    };
  }

  const registrarLower = registrar.toLowerCase();

  for (const reputable of HIGH_REPUTATION_REGISTRARS) {
    if (registrarLower.includes(reputable)) {
      return {
        reputation: 'high-reputation',
        score: 90,
        registrar: registrar,
      };
    }
  }

  return {
    reputation: 'standard',
    score: 70,
    registrar: registrar,
  };
}

function aggregateDomainScore(ageValidation, asnReputation, hostingQuality, registrarRep) {
  const scores = [
    ageValidation.score || 0,
    asnReputation.score || 0,
    hostingQuality.score || 0,
    registrarRep.score || 0,
  ];

  const averageScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  const riskFlags = [];

  if (ageValidation.riskLevel === 'critical') riskFlags.push('brand-new-domain');
  if (ageValidation.riskLevel === 'high') riskFlags.push('very-young-domain');
  if (asnReputation.riskLevel === 'medium') riskFlags.push('low-quality-asn');
  if (hostingQuality.riskLevel === 'medium') riskFlags.push('low-cost-hosting');

  return {
    score: averageScore,
    riskFlags: riskFlags,
    severity: riskFlags.length > 2 ? 'high' : riskFlags.length > 0 ? 'medium' : 'low',
  };
}

async function checkDomainIntelligence(domain, domainData = {}) {
  try {
    if (!domain) {
      return {
        domain: null,
        error: 'No domain provided',
        score: 0,
        riskFlags: ['invalid-domain'],
      };
    }

    const ageData = calculateDomainAge(domainData.registrationDate);
    const ageValidation = validateDomainAge(ageData);

    const asnReputation = analyzeASNReputation(domainData.asn);
    const hostingQuality = analyzeHostingProvider(domainData.hostingProvider);
    const registrarRep = analyzeRegistrar(domainData.registrar);

    const aggregated = aggregateDomainScore(
      ageValidation,
      asnReputation,
      hostingQuality,
      registrarRep
    );

    return {
      domain: domain,
      domainAge: ageData,
      ageValidation: ageValidation,
      asn: {
        asn: domainData.asn,
        reputation: asnReputation.reputation,
        riskLevel: asnReputation.riskLevel,
      },
      hosting: {
        provider: domainData.hostingProvider,
        quality: hostingQuality.quality,
        riskLevel: hostingQuality.riskLevel,
      },
      registrar: {
        name: domainData.registrar,
        reputation: registrarRep.reputation,
      },
      score: aggregated.score,
      riskFlags: aggregated.riskFlags,
      severity: aggregated.severity,
    };
  } catch (error) {
    logger.error('Domain intelligence check failed', error, { domain });
    return {
      domain: domain,
      error: error.message,
      score: 0,
      riskFlags: ['analysis-failed'],
    };
  }
}

module.exports = {
  checkDomainIntelligence,
  calculateDomainAge,
  validateDomainAge,
  analyzeASNReputation,
  analyzeHostingProvider,
  analyzeRegistrar,
  aggregateDomainScore,
};
