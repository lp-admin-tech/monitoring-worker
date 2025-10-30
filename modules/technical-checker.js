import fetch from 'node-fetch';
import { chromium } from 'playwright';
import { createAIHelper } from './ai-helper.js';

export class TechnicalChecker {
  constructor(supabaseClient = null, geminiApiKey = null) {
    this.aiHelper = supabaseClient && geminiApiKey ? createAIHelper(supabaseClient, geminiApiKey) : null;
  }
  async checkAdsTxt(domain) {
    console.log(`[TECHNICAL-CHECKER] Checking ads.txt for ${domain}`);
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

      if (!response.ok) {
        console.log(`[TECHNICAL-CHECKER] ✗ ads.txt not found (${response.status})`);
        return false;
      }

      const data = await response.text();
      const hasGoogle = data.includes('google.com');
      console.log(`[TECHNICAL-CHECKER] ✓ ads.txt found - Google entry: ${hasGoogle ? 'yes' : 'no'}`);
      return hasGoogle;
    } catch (error) {
      console.error(`[TECHNICAL-CHECKER] ✗ ads.txt check error: ${error.message}`);
      return false;
    }
  }

  async checkBrokenLinks(domain, links) {
    console.log(`[TECHNICAL-CHECKER] Checking broken links for ${domain}`);
    const internalLinks = links.filter(link =>
      link.includes(domain) || link.startsWith('/')
    ).slice(0, 20);

    console.log(`[TECHNICAL-CHECKER] Testing ${internalLinks.length} internal links`);
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
          console.log(`[TECHNICAL-CHECKER] Link returned ${response.status}: ${url}`);
        }
      } catch (error) {
        brokenCount++;
        console.log(`[TECHNICAL-CHECKER] Link error: ${url}`);
      }
    }

    console.log(`[TECHNICAL-CHECKER] ✓ Broken links check complete - ${brokenCount} broken`);
    return brokenCount;
  }

  async calculatePageSpeedScore(loadTime, metrics) {
    console.log('[TECHNICAL-CHECKER] Calculating page speed score');
    let score = 100;

    if (loadTime > 3000) score -= 20;
    if (loadTime > 5000) score -= 20;
    if (loadTime > 8000) score -= 20;

    if (metrics) {
      if (metrics.ScriptDuration > 1000) score -= 10;
      if (metrics.LayoutDuration > 500) score -= 10;
    }

    const speedMetrics = {
      score: Math.max(0, score),
      loadTime,
      scriptDuration: metrics?.ScriptDuration || 0,
      layoutDuration: metrics?.LayoutDuration || 0
    };

    console.log(`[TECHNICAL-CHECKER] Load time: ${loadTime}ms, Score: ${speedMetrics.score}/100`);
    if (metrics) {
      console.log(`[TECHNICAL-CHECKER] Script duration: ${metrics.ScriptDuration}ms, Layout duration: ${metrics.LayoutDuration}ms`);
    }

    let aiAnalysis = null;
    if (this.aiHelper) {
      try {
        console.log('[TECHNICAL-CHECKER] Requesting AI analysis for page speed');
        aiAnalysis = await this.aiHelper.analyze({
          type: 'page_speed',
          context: 'Analyzing page load performance, script execution time, and layout rendering speed',
          metrics: speedMetrics,
          html: null
        });
        console.log(`[TECHNICAL-CHECKER] ✓ Page speed analysis complete - Score: ${aiAnalysis?.score || 'N/A'}`);
      } catch (error) {
        console.error('[TECHNICAL-CHECKER] ✗ AI analysis error:', error.message);
      }
    }

    console.log('[TECHNICAL-CHECKER] ✓ Page speed calculation complete');
    return {
      ...speedMetrics,
      aiAnalysis
    };
  }

  async checkDomainAge(domain, browser = null) {
    console.log(`[TECHNICAL-CHECKER] Checking domain age for ${domain}`);
    try {
      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

      console.log('[TECHNICAL-CHECKER] Fetching WHOIS data...');
      const whoisData = await this.getWhoisData(cleanDomain);

      let domainCreatedDate = null;
      let domainAgeDays = null;

      if (whoisData.createdDate) {
        domainCreatedDate = whoisData.createdDate;
        const ageMs = Date.now() - domainCreatedDate.getTime();
        domainAgeDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        console.log(`[TECHNICAL-CHECKER] Domain created: ${domainCreatedDate.toISOString().split('T')[0]}, Age: ${domainAgeDays} days`);
      }

      console.log('[TECHNICAL-CHECKER] Checking SSL certificate...');
      const sslValid = await this.checkSSL(cleanDomain, browser);
      console.log(`[TECHNICAL-CHECKER] SSL valid: ${sslValid ? 'yes' : 'no'}`);

      const domainAuthorityScore = this.calculateDomainAuthority(domainAgeDays, sslValid);

      const metrics = {
        domainCreatedDate,
        domainAgeDays,
        sslValid,
        domainAuthorityScore
      };

      console.log(`[TECHNICAL-CHECKER] Domain authority score: ${domainAuthorityScore}/100`);

      let aiAnalysis = null;
      if (this.aiHelper) {
        try {
          console.log('[TECHNICAL-CHECKER] Requesting AI analysis for domain authority');
          aiAnalysis = await this.aiHelper.analyze({
            type: 'domain_authority',
            context: 'Evaluating domain age, SSL certificate validity, and overall domain authority score',
            metrics,
            html: null
          });
          console.log(`[TECHNICAL-CHECKER] ✓ Domain authority analysis complete - Score: ${aiAnalysis?.score || 'N/A'}`);
        } catch (error) {
          console.error('[TECHNICAL-CHECKER] ✗ AI analysis error:', error.message);
        }
      }

      console.log('[TECHNICAL-CHECKER] ✓ Domain age check complete');
      return {
        ...metrics,
        aiAnalysis
      };
    } catch (error) {
      console.error(`[TECHNICAL-CHECKER] ✗ Domain age check error: ${error.message}`);
      return {
        domainCreatedDate: null,
        domainAgeDays: null,
        sslValid: false,
        domainAuthorityScore: 0,
        aiAnalysis: null
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

      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const httpsUrl = `https://${cleanDomain}`;

      let sslValid = false;
      let certInfo = null;
      let pageLoadedSuccessfully = false;

      page.on('response', (response) => {
        const securityDetails = response.securityDetails();
        if (securityDetails && !certInfo) {
          certInfo = securityDetails;
        }
      });

      try {
        const response = await page.goto(httpsUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 15000
        });

        pageLoadedSuccessfully = response && response.ok();

        if (certInfo) {
          const now = Date.now();
          const validFrom = certInfo.validFrom() * 1000;
          const validTo = certInfo.validTo() * 1000;

          sslValid = now >= validFrom && now <= validTo;

          console.log(`[SSL-CHECK] Domain: ${domain}, Protocol: ${certInfo.protocol()}, Issuer: ${certInfo.issuer()}, Valid: ${sslValid}`);
        } else if (pageLoadedSuccessfully && page.url().startsWith('https://')) {
          console.log(`[SSL-CHECK] Page loaded via HTTPS for ${domain}, assuming valid SSL`);
          sslValid = true;
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
