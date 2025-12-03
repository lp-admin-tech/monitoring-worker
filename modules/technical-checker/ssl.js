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
  return new Promise((resolve) => {
    const timeoutHandle = setTimeout(() => {
      logger.warn('SSL validation timeout', { domain });
      resolve({
        valid: false,
        error: 'SSL validation timeout',
        daysToExpiry: 0,
        chainValid: false,
        issuer: 'Unknown',
        issuerReputation: 0,
        riskScore: 100,
      });
    }, timeout);

    try {
      const options = {
        host: domain,
        port: 443,
        servername: domain,
        rejectUnauthorized: true,
      };

      const socket = tls.connect(options);

      socket.on('secureConnect', () => {
        clearTimeout(timeoutHandle);

        try {
          const authorized = socket.authorized;
          const authorizationError = socket.authorizationError;
          const cert = socket.getPeerCertificate(false);
          
          if (!cert || Object.keys(cert).length === 0) {
            socket.destroy();
            return resolve({
              valid: false,
              error: 'No certificate returned',
              daysToExpiry: 0,
              chainValid: false,
              issuer: 'Unknown',
              issuerReputation: 0,
              riskScore: 100,
            });
          }

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
          const startDate = new Date(cert.valid_from);
          const daysToExpiry = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));

          const isExpired = daysToExpiry < 0;
          const isNotYetValid = now < startDate;
          const chainValid = authorized && !authorizationError;
          const issuerRep = ISSUER_REPUTATION[issuer] || 0.65;

          const certValid = !isExpired && !isNotYetValid && chainValid;

          let riskScore = 0;
          if (isExpired) {
            riskScore = 100;
          } else if (isNotYetValid) {
            riskScore = 100;
          } else {
            if (daysToExpiry < 7) riskScore += 40;
            else if (daysToExpiry < 30) riskScore += 20;
            else if (daysToExpiry < 90) riskScore += 5;

            if (!chainValid) riskScore += 35;
            if (issuerRep < 0.7) riskScore += 15;
          }

          socket.destroy();

          logger.info('SSL validation completed', {
            domain,
            valid: certValid,
            authorized,
            authorizationError: authorizationError || null,
            daysToExpiry,
            isExpired,
            issuer,
            chainValid
          });

          resolve({
            valid: certValid,
            daysToExpiry: Math.max(0, daysToExpiry),
            expiryDate: cert.valid_to,
            chainValid: chainValid,
            issuer: issuer,
            issuerReputation: issuerRep,
            subject: cert.subject?.CN || 'Unknown',
            riskScore: Math.min(100, riskScore),
            warnings: generateSSLWarnings(daysToExpiry, !chainValid, issuerRep, isExpired),
            isExpired,
            isNotYetValid,
            authorized,
            authorizationError: authorizationError || null,
          });
        } catch (error) {
          socket.destroy();
          logger.warn('SSL certificate parsing failed', { domain, error: error.message });
          resolve({
            valid: false,
            error: error.message,
            daysToExpiry: 0,
            chainValid: false,
            issuer: 'Unknown',
            issuerReputation: 0,
            riskScore: 100,
          });
        }
      });

      socket.on('error', (error) => {
        clearTimeout(timeoutHandle);
        logger.warn('SSL connection error', { domain, error: error.message });
        
        const isCertError = error.message.includes('certificate') || 
                           error.code === 'CERT_HAS_EXPIRED' ||
                           error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
                           error.code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
                           error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT';
        
        resolve({
          valid: false,
          error: error.message,
          errorCode: error.code || null,
          daysToExpiry: 0,
          chainValid: false,
          issuer: 'Unknown',
          issuerReputation: 0,
          riskScore: 100,
          isCertificateError: isCertError,
        });
      });

      socket.on('timeout', () => {
        clearTimeout(timeoutHandle);
        socket.destroy();
        logger.warn('SSL socket timeout', { domain });
        resolve({
          valid: false,
          error: 'SSL connection timeout',
          daysToExpiry: 0,
          chainValid: false,
          issuer: 'Unknown',
          issuerReputation: 0,
          riskScore: 100,
        });
      });

      socket.setTimeout(timeout);
    } catch (error) {
      clearTimeout(timeoutHandle);
      logger.warn('SSL validation failed', { domain, error: error.message });
      resolve({
        valid: false,
        error: error.message,
        daysToExpiry: 0,
        chainValid: false,
        issuer: 'Unknown',
        issuerReputation: 0,
        riskScore: 100,
      });
    }
  });
}

function generateSSLWarnings(daysToExpiry, chainInvalid, issuerReputation, isExpired = false) {
  const warnings = [];

  if (isExpired) {
    warnings.push('Certificate has expired');
  } else if (daysToExpiry < 7) {
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
