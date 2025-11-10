const tls = require('node:tls');
const logger = require('../logger');

const ISSUER_REPUTATION = {
  'Let\'s Encrypt': 0.95,
  'DigiCert': 0.98,
  'Sectigo': 0.95,
  'GoDaddy': 0.85,
  'Comodo': 0.90,
  'GlobalSign': 0.95,
  'VeriSign': 0.98,
  'Entrust': 0.92,
};

async function validateSSL(domain, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new Error(`SSL validation timeout for ${domain}`));
    }, timeout);

    try {
      const options = {
        hostname: domain,
        port: 443,
        method: 'HEAD',
        rejectUnauthorized: true,
      };

      const req = tls.connect(options, (socket) => {
        clearTimeout(timeoutHandle);

        try {
          const cert = socket.getPeerCertificate(false);
          const issuer = cert.issuer?.O || 'Unknown';

          if (!cert.valid_from || !cert.valid_to) {
            socket.destroy();
            return resolve({
              valid: false,
              error: 'Certificate dates missing',
              daysToExpiry: 0,
              chainValid: false,
              issuer: issuer,
              issuerReputation: ISSUER_REPUTATION[issuer] || 0.5,
              riskScore: 100,
            });
          }

          const now = new Date();
          const expiryDate = new Date(cert.valid_to);
          const daysToExpiry = Math.max(
            0,
            Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24))
          );

          const chainValid = validateCertificateChain(socket);
          const issuerRep = ISSUER_REPUTATION[issuer] || 0.65;

          let riskScore = 0;
          if (daysToExpiry < 7) riskScore += 40;
          else if (daysToExpiry < 30) riskScore += 20;
          else if (daysToExpiry < 90) riskScore += 5;

          if (!chainValid) riskScore += 35;
          if (issuerRep < 0.7) riskScore += 15;

          socket.destroy();

          resolve({
            valid: true,
            daysToExpiry: daysToExpiry,
            expiryDate: cert.valid_to,
            chainValid: chainValid,
            issuer: issuer,
            issuerReputation: issuerRep,
            subject: cert.subject?.CN || 'Unknown',
            riskScore: Math.min(100, riskScore),
            warnings: generateSSLWarnings(daysToExpiry, !chainValid, issuerRep),
          });
        } catch (error) {
          socket.destroy();
          reject(error);
        }
      });

      req.on('error', (error) => {
        clearTimeout(timeoutHandle);
        resolve({
          valid: false,
          error: error.message,
          daysToExpiry: 0,
          chainValid: false,
          issuer: 'Unknown',
          issuerReputation: 0,
          riskScore: 100,
        });
      });

      req.on('timeout', () => {
        clearTimeout(timeoutHandle);
        req.destroy();
        reject(new Error('SSL connection timeout'));
      });
    } catch (error) {
      clearTimeout(timeoutHandle);
      reject(error);
    }
  });
}

function validateCertificateChain(socket) {
  try {
    const cert = socket.getPeerCertificate(true);
    if (!cert || !cert.issuer) return false;

    let current = cert;
    let depth = 0;
    const maxDepth = 5;

    while (current && depth < maxDepth) {
      if (!current.issuer) return depth > 0;
      current = current.issuerCertificate;
      depth++;
    }

    return depth > 0;
  } catch (error) {
    logger.warn('Failed to validate certificate chain', { error: error.message });
    return false;
  }
}

function generateSSLWarnings(daysToExpiry, chainInvalid, issuerReputation) {
  const warnings = [];

  if (daysToExpiry < 7) {
    warnings.push('Certificate expires within 7 days');
  } else if (daysToExpiry < 30) {
    warnings.push('Certificate expires within 30 days');
  }

  if (chainInvalid) {
    warnings.push('Certificate chain validation failed');
  }

  if (issuerReputation < 0.7) {
    warnings.push('Issuer has low reputation');
  }

  return warnings;
}

module.exports = {
  validateSSL,
};
