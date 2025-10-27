import axios from 'axios';
import fetch from 'node-fetch';
import https from 'https';
import tls from 'tls';

export class TechnicalChecker {
  async checkAdsTxt(domain) {
    try {
      const url = domain.startsWith('http')
        ? `${domain}/ads.txt`
        : `https://${domain}/ads.txt`;

      const response = await axios.get(url, {
        timeout: 10000,
        validateStatus: (status) => status === 200
      });

      return response.data.includes('google.com');
    } catch (error) {
      return false;
    }
  }

  async checkBrokenLinks(domain, links) {
    const internalLinks = links.filter(link =>
      link.includes(domain) || link.startsWith('/')
    ).slice(0, 20);

    let brokenCount = 0;

    for (const link of internalLinks) {
      try {
        const url = link.startsWith('http')
          ? link
          : `https://${domain}${link}`;

        await axios.head(url, { timeout: 5000 });
      } catch (error) {
        brokenCount++;
      }
    }

    return brokenCount;
  }

  calculatePageSpeedScore(loadTime, metrics) {
    let score = 100;

    if (loadTime > 3000) score -= 20;
    if (loadTime > 5000) score -= 20;
    if (loadTime > 8000) score -= 20;

    if (metrics) {
      if (metrics.ScriptDuration > 1000) score -= 10;
      if (metrics.LayoutDuration > 500) score -= 10;
    }

    return Math.max(0, score);
  }

  async checkDomainAge(domain) {
    try {
      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

      const whoisData = await this.getWhoisData(cleanDomain);

      let domainCreatedDate = null;
      let domainAgeDays = null;

      if (whoisData.createdDate) {
        domainCreatedDate = whoisData.createdDate;
        const ageMs = Date.now() - domainCreatedDate.getTime();
        domainAgeDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
      }

      const sslValid = await this.checkSSL(cleanDomain);

      const domainAuthorityScore = this.calculateDomainAuthority(domainAgeDays, sslValid);

      return {
        domainCreatedDate,
        domainAgeDays,
        sslValid,
        domainAuthorityScore
      };
    } catch (error) {
      console.error('Domain age check error:', error.message);
      return {
        domainCreatedDate: null,
        domainAgeDays: null,
        sslValid: false,
        domainAuthorityScore: 0
      };
    }
  }

  async getWhoisData(domain) {
    try {
      const response = await fetch(`https://networkcalc.com/api/dns/whois/${domain}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MFABuster/1.0)'
        }
      });

      if (!response.ok) {
        return { createdDate: null };
      }

      const data = await response.json();

      let createdDate = null;

      if (data.records) {
        const creationKeys = [
          'Creation Date',
          'created',
          'Created Date',
          'Registration Time',
          'Domain Registration Date'
        ];

        for (const key of creationKeys) {
          if (data.records[key]) {
            const dateStr = Array.isArray(data.records[key])
              ? data.records[key][0]
              : data.records[key];

            const parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) {
              createdDate = parsed;
              break;
            }
          }
        }
      }

      return { createdDate };
    } catch (error) {
      console.warn('WHOIS lookup failed, using fallback:', error.message);
      return this.fallbackDomainAge(domain);
    }
  }

  async fallbackDomainAge(domain) {
    try {
      const response = await fetch(`https://archive.org/wayback/available?url=${domain}`, {
        timeout: 10000
      });

      if (!response.ok) {
        return { createdDate: null };
      }

      const data = await response.json();

      if (data.archived_snapshots && data.archived_snapshots.closest) {
        const timestamp = data.archived_snapshots.closest.timestamp;
        const year = parseInt(timestamp.substring(0, 4));
        const month = parseInt(timestamp.substring(4, 6)) - 1;
        const day = parseInt(timestamp.substring(6, 8));

        const createdDate = new Date(year, month, day);
        return { createdDate };
      }

      return { createdDate: null };
    } catch (error) {
      return { createdDate: null };
    }
  }

  async checkSSL(domain) {
    return new Promise((resolve) => {
      const options = {
        host: domain,
        port: 443,
        method: 'GET',
        rejectUnauthorized: false
      };

      const timeout = setTimeout(() => {
        resolve(false);
      }, 5000);

      try {
        const socket = tls.connect(options, () => {
          clearTimeout(timeout);

          const cert = socket.getPeerCertificate();

          if (!cert || Object.keys(cert).length === 0) {
            socket.destroy();
            resolve(false);
            return;
          }

          const now = new Date();
          const validFrom = new Date(cert.valid_from);
          const validTo = new Date(cert.valid_to);

          const isValid = now >= validFrom && now <= validTo;

          socket.destroy();
          resolve(isValid);
        });

        socket.on('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });

        socket.setTimeout(5000, () => {
          socket.destroy();
          clearTimeout(timeout);
          resolve(false);
        });
      } catch (error) {
        clearTimeout(timeout);
        resolve(false);
      }
    });
  }

  calculateDomainAuthority(domainAgeDays, sslValid) {
    let score = 0;

    if (domainAgeDays === null || domainAgeDays === undefined) {
      return 50;
    }

    if (domainAgeDays >= 3650) {
      score += 40;
    } else if (domainAgeDays >= 1825) {
      score += 35;
    } else if (domainAgeDays >= 730) {
      score += 25;
    } else if (domainAgeDays >= 365) {
      score += 15;
    } else if (domainAgeDays >= 180) {
      score += 10;
    } else {
      score += 5;
    }

    if (sslValid) {
      score += 20;
    }

    score += 40;

    return Math.min(100, score);
  }
}
