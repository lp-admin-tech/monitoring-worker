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

  identifyDensityProblems(density, categorized) {
    const problems = [];

    if (density > this.thresholds.warning) {
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
      const problems = this.identifyDensityProblems(density, categorized);

      return {
        timestamp: new Date().toISOString(),
        metrics: {
          totalAds: adElements.length,
          adPixels,
          viewportPixels,
          adDensity: parseFloat(density.toFixed(4)),
          densityPercentage: parseFloat((density * 100).toFixed(2)),
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
            density > this.thresholds.warning
              ? 'critical'
              : density > this.thresholds.acceptable
                ? 'high'
                : 'normal',
          complianceStatus:
            density <= this.thresholds.acceptable ? 'compliant' : 'non_compliant',
          mfaIndicator: categorized.tiny.length > 20,
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
