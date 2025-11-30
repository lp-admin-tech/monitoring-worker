const logger = require('../logger');

/**
 * Validates URLs to prevent SSRF attacks
 * Blocks access to:
 * - localhost/127.0.0.1
 * - Private IP ranges (10.x, 172.16-31.x, 192.168.x)
 * - Cloud metadata endpoints
 * - Link-local addresses
 */

const BLOCKED_HOSTS = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254', // AWS/GCP metadata
    'metadata.google.internal', // GCP
    '::1', // IPv6 localhost
];

const BLOCKED_IP_PATTERNS = [
    /^10\./,                    // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
    /^192\.168\./,              // 192.168.0.0/16
    /^169\.254\./,              // 169.254.0.0/16 (link-local)
    /^fe80:/i,                  // IPv6 link-local
    /^fc00:/i,                  // IPv6 private
];

function isPrivateIP(hostname) {
    // Check exact matches
    if (BLOCKED_HOSTS.includes(hostname.toLowerCase())) {
        return true;
    }

    // Check IP patterns
    return BLOCKED_IP_PATTERNS.some(pattern => pattern.test(hostname));
}

function validateUrl(url) {
    try {
        const parsed = new URL(url);

        // Only allow HTTP/HTTPS
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error(`Invalid protocol: ${parsed.protocol}. Only HTTP/HTTPS are allowed.`);
        }

        // Block private IPs and internal hosts
        if (isPrivateIP(parsed.hostname)) {
            throw new Error(`Access to internal/private networks is blocked: ${parsed.hostname}`);
        }

        // Additional validation: URL must have a valid hostname
        if (!parsed.hostname || parsed.hostname.length === 0) {
            throw new Error('URL must have a valid hostname');
        }

        return {
            isValid: true,
            url: parsed.href,
            hostname: parsed.hostname
        };
    } catch (error) {
        return {
            isValid: false,
            error: error.message
        };
    }
}

module.exports = {
    validateUrl,
    isPrivateIP
};
