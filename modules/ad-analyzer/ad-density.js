const logger = require('../logger');

class AdDensityCalculator {
  constructor(config = {}) {
    this.thresholds = {
      excellent: 0.1,
      good: 0.2,
      acceptable: 0.3,
      warning: 0.4,
      critical: 1.0,
    };
    this.adDensityThreshold = config.adDensityThreshold || 0.3;
  }

  calculateAdPixels(adElements) {
    if (!Array.isArray(adElements) || adElements.length === 0) {
      return 0;
    }

    let totalAdPixels = 0;

    for (const ad of adElements) {
      if (!ad.boundingBox) continue;

      const width = ad.boundingBox.right - ad.boundingBox.left;
      const height = ad.boundingBox.bottom - ad.boundingBox.top;
      const pixels = Math.max(0, width * height);

      totalAdPixels += pixels;
    }

    return totalAdPixels;
  }

  calculateViewportPixels(viewport) {
    if (!viewport || !viewport.width || !viewport.height) {
      return 1920 * 1080;
    }
    return viewport.width * viewport.height;
  }

  calculateDensityRatio(adPixels, viewportPixels) {
    if (viewportPixels === 0) return 0;
    return adPixels / viewportPixels;
  }

  benchmarkDensity(density) {
    if (density <= this.thresholds.excellent) {
      return { level: 'excellent', score: 95 };
    }
    if (density <= this.thresholds.good) {
      return { level: 'good', score: 80 };
    }
    if (density <= this.thresholds.acceptable) {
      return { level: 'acceptable', score: 65 };
    }
    if (density <= this.thresholds.warning) {
      return { level: 'warning', score: 40 };
    }
    return { level: 'critical', score: 10 };
  }

  categorizeAdsBySize(adElements) {
    const sizes = {
      large: [],
      medium: [],
      small: [],
      tiny: [],
    };

    for (const ad of adElements) {
      if (!ad.boundingBox) continue;

      const width = ad.boundingBox.right - ad.boundingBox.left;
      const height = ad.boundingBox.bottom - ad.boundingBox.top;
      const pixels = width * height;

      if (pixels >= 300 * 600) {
        sizes.large.push({ ...ad, pixels });
      } else if (pixels >= 300 * 250) {
        sizes.medium.push({ ...ad, pixels });
      } else if (pixels >= 120 * 600) {
        sizes.small.push({ ...ad, pixels });
      } else {
        sizes.tiny.push({ ...ad, pixels });
      }
    }

    return sizes;
  }

  analyzeDistribution(adElements, viewport) {
    const above = { ads: [], pixels: 0 };
    const below = { ads: [], pixels: 0 };

    const foldLine = viewport?.height || 800;

    for (const ad of adElements) {
      if (!ad.boundingBox) continue;

      const adMidpoint = (ad.boundingBox.top + ad.boundingBox.bottom) / 2;
      const pixels = Math.max(
        0,
        (ad.boundingBox.right - ad.boundingBox.left) *
        (ad.boundingBox.bottom - ad.boundingBox.top)
      );

      if (adMidpoint < foldLine) {
        above.ads.push(ad);
        above.pixels += pixels;
      } else {
        below.ads.push(ad);
        below.pixels += pixels;
      }
    }

    return {
      aboveTheFold: above,
      belowTheFold: below,
      densityAboveTheFold: this.calculateDensityRatio(
        above.pixels,
        (viewport?.width || 1920) * foldLine
      ),
      densityBelowTheFold: this.calculateDensityRatio(
        below.pixels,
        (viewport?.width || 1920) * (viewport?.height - foldLine || 280)
      ),
    };
  }

  calculateCumulativeDensity(adElements, viewport) {
    const sortedByY = adElements
      .filter(a => a.boundingBox)
      .sort((a, b) => a.boundingBox.top - b.boundingBox.top);

    const cumulative = [];
    let totalAdPixels = 0;

    for (const ad of sortedByY) {
      const pixels = Math.max(
        0,
        (ad.boundingBox.right - ad.boundingBox.left) *
        (ad.boundingBox.bottom - ad.boundingBox.top)
      );
      totalAdPixels += pixels;

      const density = this.calculateDensityRatio(
        totalAdPixels,
        this.calculateViewportPixels(viewport)
      );

      cumulative.push({
        adIndex: cumulative.length,
        cumulativePixels: totalAdPixels,
        density: parseFloat(density.toFixed(4)),
        threshold: density > this.adDensityThreshold ? 'exceeded' : 'acceptable',
      });
    }

    return cumulative;
  }

  detectAdStacking(adElements) {
    const stackedAds = [];
    const adsWithBox = adElements.filter(a => a.boundingBox);

    for (let i = 0; i < adsWithBox.length; i++) {
      for (let j = i + 1; j < adsWithBox.length; j++) {
        const ad1 = adsWithBox[i];
        const ad2 = adsWithBox[j];

        const x_overlap = Math.max(0, Math.min(ad1.boundingBox.right, ad2.boundingBox.right) - Math.max(ad1.boundingBox.left, ad2.boundingBox.left));
        const y_overlap = Math.max(0, Math.min(ad1.boundingBox.bottom, ad2.boundingBox.bottom) - Math.max(ad1.boundingBox.top, ad2.boundingBox.top));
        const overlapArea = x_overlap * y_overlap;

        if (overlapArea > 0) {
          const area1 = (ad1.boundingBox.right - ad1.boundingBox.left) * (ad1.boundingBox.bottom - ad1.boundingBox.top);
          const area2 = (ad2.boundingBox.right - ad2.boundingBox.left) * (ad2.boundingBox.bottom - ad2.boundingBox.top);

          // If overlap is significant (> 50% of smaller ad), flag it
          const minArea = Math.min(area1, area2);
          if (overlapArea / minArea > 0.5) {
            stackedAds.push({
              ad1: ad1.id || 'unknown',
              ad2: ad2.id || 'unknown',
              overlapPercentage: (overlapArea / minArea * 100).toFixed(1)
            });
          }
        }
      }
    }
    return stackedAds;
  }

  identifyDensityProblems(density, categorized, stickyDensity = 0, stackedAds = []) {
    const problems = [];

    if (density > 0.3) {
      problems.push({
        severity: 'critical',
        message: `Ad density of ${(density * 100).toFixed(1)}% exceeds MFA threshold (30%)`,
        recommendation: 'Drastically reduce ad coverage to avoid MFA classification',
      });
    } else if (density > this.thresholds.warning) {
      problems.push({
        severity: 'critical',
        message: `Ad density of ${(density * 100).toFixed(1)}% exceeds critical threshold (${(this.thresholds.warning * 100).toFixed(1)}%)`,
        recommendation: 'Reduce number or size of ads on page',
      });
    } else if (density > this.thresholds.acceptable) {
      problems.push({
        severity: 'high',
        message: `Ad density of ${(density * 100).toFixed(1)}% exceeds acceptable threshold (${(this.thresholds.acceptable * 100).toFixed(1)}%)`,
        recommendation: 'Consider repositioning or sizing ads',
      });
    }

    if (stickyDensity > 0.3) {
      problems.push({
        severity: 'critical',
        message: `Sticky ad density of ${(stickyDensity * 100).toFixed(1)}% exceeds MFA threshold (30%)`,
        recommendation: 'Remove intrusive sticky ads that cover >30% of the screen',
      });
    }

    if (stackedAds.length > 0) {
      problems.push({
        severity: 'critical',
        message: `Detected ${stackedAds.length} instances of ad stacking (overlapping ads)`,
        recommendation: 'Remove overlapping ad slots to prevent ad stacking/pixel stuffing fraud',
      });
    }

    if (categorized.large.length > 4) {
      problems.push({
        severity: 'medium',
        message: `${categorized.large.length} large ad units detected, potentially impacting user experience`,
        recommendation: 'Review large ad placement and necessity',
      });
    }

    if (categorized.tiny.length > 20) {
      problems.push({
        severity: 'high',
        message: `${categorized.tiny.length} tiny ads detected, potential MFA indicator`,
        recommendation: 'Audit ad placement legitimacy',
      });
    }

    return problems;
  }

  generateReport(crawlData, viewport) {
    try {
      const adElements = crawlData.adElements || [];

      if (adElements.length === 0) {
        return {
          timestamp: new Date().toISOString(),
          summary: {
            totalAds: 0,
            adDensity: 0,
            densityLevel: 'no_ads_detected',
          },
        };
      }

      const adPixels = this.calculateAdPixels(adElements);
      const viewportPixels = this.calculateViewportPixels(viewport);
      const density = this.calculateDensityRatio(adPixels, viewportPixels);
      const benchmark = this.benchmarkDensity(density);
      const categorized = this.categorizeAdsBySize(adElements);
      const distribution = this.analyzeDistribution(adElements, viewport);
      const cumulative = this.calculateCumulativeDensity(adElements, viewport);

      // Sticky Ad Analysis
      const stickyAds = adElements.filter(ad => ad.visibility?.isSticky);
      const stickyAdPixels = this.calculateAdPixels(stickyAds);
      const stickyDensity = this.calculateDensityRatio(stickyAdPixels, viewportPixels);

      const stackedAds = this.detectAdStacking(adElements);

      const problems = this.identifyDensityProblems(density, categorized, stickyDensity, stackedAds);

      return {
        timestamp: new Date().toISOString(),
        metrics: {
          totalAds: adElements.length,
          adPixels,
          viewportPixels,
          adDensity: parseFloat(density.toFixed(4)),
          densityPercentage: parseFloat((density * 100).toFixed(2)),
          stickyAdDensity: parseFloat(stickyDensity.toFixed(4)),
          stickyAdCount: stickyAds.length,
          benchmark,
        },
        sizeDistribution: {
          large: {
            count: categorized.large.length,
            totalPixels: categorized.large.reduce((sum, a) => sum + a.pixels, 0),
          },
          medium: {
            count: categorized.medium.length,
            totalPixels: categorized.medium.reduce((sum, a) => sum + a.pixels, 0),
          },
          small: {
            count: categorized.small.length,
            totalPixels: categorized.small.reduce((sum, a) => sum + a.pixels, 0),
          },
          tiny: {
            count: categorized.tiny.length,
            totalPixels: categorized.tiny.reduce((sum, a) => sum + a.pixels, 0),
          },
        },
        positioning: {
          aboveTheFold: {
            count: distribution.aboveTheFold.ads.length,
            pixels: distribution.aboveTheFold.pixels,
            density: parseFloat(distribution.densityAboveTheFold.toFixed(4)),
          },
          belowTheFold: {
            count: distribution.belowTheFold.ads.length,
            pixels: distribution.belowTheFold.pixels,
            density: parseFloat(distribution.densityBelowTheFold.toFixed(4)),
          },
        },
        cumulativeDensity: cumulative,
        problems,
        summary: {
          riskLevel:
            density > 0.3 // Industry standard MFA threshold
              ? 'critical'
              : density > this.thresholds.warning
                ? 'critical'
                : density > this.thresholds.acceptable
                  ? 'high'
                  : 'normal',
          complianceStatus:
            density <= this.thresholds.acceptable ? 'compliant' : 'non_compliant',
          mfaIndicator: density > 0.3 || stickyDensity > 0.3 || categorized.tiny.length > 20,
        },
      };
    } catch (error) {
      logger.error('Error generating ad density report', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = AdDensityCalculator;
