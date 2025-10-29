import fetch from 'node-fetch';
import { chromium } from 'playwright';

export class TechnicalChecker {
  async checkAdsTxt(domain) {
    try {
      const url = domain.startsWith('http')
        ? `${domain}/ads.txt`
        : `https://${domain}/ads.txt`;

      const response = await fetch(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) return false;

      const data = await response.text();
      return data.includes('google.com');
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

        const response = await fetch(url, {
          method: 'HEAD',
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        if (!response.ok) {
          brokenCount++;
        }
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

  async checkDomainAge(domain, browser = null) {
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

      const sslValid = await this.checkSSL(cleanDomain, browser);

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

  async checkSSL(domain, browser = null) {
    let context = null;
    let page = null;
    const shouldCloseBrowser = !browser;

    try {
      if (!browser) {
        browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
      }

      context = await browser.newContext({
        ignoreHTTPSErrors: false,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      });

      page = await context.newPage();

      const url = domain.startsWith('http') ? domain : `https://${domain}`;

      let sslValid = false;
      let certInfo = null;

      page.on('response', (response) => {
        if (response.url() === url) {
          const securityDetails = response.securityDetails();
          if (securityDetails) {
            certInfo = securityDetails;
          }
        }
      });

      try {
        await page.goto(url, {
          waitUntil: 'commit',
          timeout: 10000
        });

        if (certInfo) {
          const now = Date.now();
          const validFrom = certInfo.validFrom() * 1000;
          const validTo = certInfo.validTo() * 1000;

          sslValid = now >= validFrom && now <= validTo;

          console.log(`[SSL-CHECK] Domain: ${domain}, Protocol: ${certInfo.protocol()}, Issuer: ${certInfo.issuer()}, Valid: ${sslValid}`);
        } else {
          console.log(`[SSL-CHECK] No SSL certificate info found for domain: ${domain} (might be HTTP)`);
          sslValid = false;
        }
      } catch (sslError) {
        if (sslError.message.includes('SSL') ||
            sslError.message.includes('ERR_CERT') ||
            sslError.message.includes('net::ERR_SSL') ||
            sslError.message.includes('SSL handshake failed') ||
            sslError.message.includes('certificate')) {
          console.log(`[SSL-ERROR] SSL invalid or handshake failed for ${domain}: ${sslError.message}`);
          sslValid = false;
        } else {
          throw sslError;
        }
      }

      await page.close();
      await context.close();
      if (shouldCloseBrowser && browser) {
        await browser.close();
      }

      return sslValid;
    } catch (error) {
      console.log(`[SSL-CHECK] Browser check error for domain ${domain}:`, error.message);

      if (page) {
        try {
          await page.close();
        } catch (e) {}
      }

      if (context) {
        try {
          await context.close();
        } catch (e) {}
      }

      if (shouldCloseBrowser && browser) {
        try {
          await browser.close();
        } catch (e) {}
      }

      return false;
    }
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
