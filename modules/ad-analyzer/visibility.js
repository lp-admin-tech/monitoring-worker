const logger = require('../logger');

class VisibilityChecker {
  constructor(config = {}) {
    this.minVisibilityRatio = config.minVisibilityRatio || 0.5;
    this.viewabilityStandards = {
      display: 0.5,
      video: 0.5,
      native: 0.5,
    };
    this.viewportPadding = config.viewportPadding || 50;
  }

  calculateIntersectionRatio(adElement, viewportWidth, viewportHeight) {
    if (!adElement || !adElement.boundingBox) {
      return 0;
    }

    const box = adElement.boundingBox;
    const viewportBox = {
      top: 0,
      left: 0,
      right: viewportWidth,
      bottom: viewportHeight,
    };

    const intersectionTop = Math.max(box.top, viewportBox.top);
    const intersectionLeft = Math.max(box.left, viewportBox.left);
    const intersectionBottom = Math.min(box.bottom, viewportBox.bottom);
    const intersectionRight = Math.min(box.right, viewportBox.right);

    if (
      intersectionTop >= intersectionBottom ||
      intersectionLeft >= intersectionRight
    ) {
      return 0;
    }

    const intersectionArea =
      (intersectionRight - intersectionLeft) *
      (intersectionBottom - intersectionTop);

    const elementArea =
      (box.right - box.left) * (box.bottom - box.top);

    if (elementArea === 0) return 0;

    return intersectionArea / elementArea;
  }

  determineViewability(adElement, intersectionRatio, zIndex) {
    const isVisible = intersectionRatio >= this.minVisibilityRatio;
    const isAboveTheFold = adElement.boundingBox?.top <= 600;
    const hasValidZIndex = !zIndex || zIndex >= 0;

    return {
      isViewable: isVisible && hasValidZIndex,
      intersectionRatio: parseFloat(intersectionRatio.toFixed(3)),
      isAboveTheFold,
      occluded: !hasValidZIndex,
      visibility: isVisible ? 'visible' : 'offscreen',
    };
  }

  analyzeAdPlacement(adElement, viewport) {
    if (!viewport) {
      viewport = { width: 1920, height: 1080 };
    }

    const intersectionRatio = this.calculateIntersectionRatio(
      adElement,
      viewport.width,
      viewport.height
    );

    const viewability = this.determineViewability(
      adElement,
      intersectionRatio,
      adElement.zIndex
    );

    return {
      id: adElement.id,
      type: adElement.type || 'display',
      position: {
        x: adElement.boundingBox?.left || 0,
        y: adElement.boundingBox?.top || 0,
        width: adElement.boundingBox
          ? adElement.boundingBox.right - adElement.boundingBox.left
          : 0,
        height: adElement.boundingBox
          ? adElement.boundingBox.bottom - adElement.boundingBox.top
          : 0,
      },
      ...viewability,
      iframeDepth: adElement.iframeDepth || 0,
      hiddenByCSS: adElement.display === 'none' || adElement.visibility === 'hidden',
    };
  }

  detectHiddenAds(adElements, viewport) {
    const hidden = [];

    for (const ad of adElements) {
      const analysis = this.analyzeAdPlacement(ad, viewport);

      if (
        !analysis.isViewable ||
        analysis.hiddenByCSS ||
        analysis.iframeDepth > 3
      ) {
        hidden.push({
          ...analysis,
          hiddenReasons: this.getHiddenReasons(analysis, ad),
        });
      }
    }

    return hidden;
  }

  getHiddenReasons(analysis, adElement) {
    const reasons = [];

    if (analysis.intersectionRatio === 0) {
      reasons.push('completely_offscreen');
    } else if (analysis.intersectionRatio < this.minVisibilityRatio) {
      reasons.push('partially_obscured');
    }

    if (analysis.hiddenByCSS) {
      reasons.push('hidden_by_css');
    }

    if (analysis.occluded) {
      reasons.push('negative_z_index');
    }

    if (analysis.iframeDepth > 3) {
      reasons.push('deeply_nested');
    }

    if (!analysis.isAboveTheFold && analysis.intersectionRatio < 0.3) {
      reasons.push('below_the_fold_low_visibility');
    }

    return reasons;
  }

  categorizeByViewability(adElements, viewport) {
    const viewable = [];
    const partiallyViewable = [];
    const notViewable = [];

    for (const ad of adElements) {
      const analysis = this.analyzeAdPlacement(ad, viewport);

      if (analysis.intersectionRatio >= this.minVisibilityRatio) {
        viewable.push(analysis);
      } else if (analysis.intersectionRatio > 0) {
        partiallyViewable.push(analysis);
      } else {
        notViewable.push(analysis);
      }
    }

    return { viewable, partiallyViewable, notViewable };
  }

  calculateViewabilityMetrics(categorized) {
    const total =
      categorized.viewable.length +
      categorized.partiallyViewable.length +
      categorized.notViewable.length;

    if (total === 0) {
      return {
        totalAds: 0,
        viewablePercentage: 0,
        partiallyViewablePercentage: 0,
        notViewablePercentage: 0,
      };
    }

    return {
      totalAds: total,
      viewablePercentage: parseFloat(
        ((categorized.viewable.length / total) * 100).toFixed(2)
      ),
      partiallyViewablePercentage: parseFloat(
        ((categorized.partiallyViewable.length / total) * 100).toFixed(2)
      ),
      notViewablePercentage: parseFloat(
        ((categorized.notViewable.length / total) * 100).toFixed(2)
      ),
      viewableCount: categorized.viewable.length,
      partiallyViewableCount: categorized.partiallyViewable.length,
      notViewableCount: categorized.notViewable.length,
    };
  }

  identifyViewabilityIssues(categorized) {
    const issues = [];

    if (categorized.notViewable.length > 0) {
      issues.push({
        severity: 'high',
        message: `${categorized.notViewable.length} ads are completely hidden and not viewable`,
        count: categorized.notViewable.length,
        ads: categorized.notViewable.map(a => a.id),
      });
    }

    const lowViewability = categorized.partiallyViewable.filter(
      a => a.intersectionRatio < 0.3
    );
    if (lowViewability.length > 0) {
      issues.push({
        severity: 'medium',
        message: `${lowViewability.length} ads have very low viewability (<30%)`,
        count: lowViewability.length,
        ads: lowViewability.map(a => a.id),
      });
    }

    return issues;
  }

  generateReport(crawlData, viewport) {
    try {
      const adElements = crawlData.adElements || [];

      if (adElements.length === 0) {
        return {
          timestamp: new Date().toISOString(),
          summary: {
            totalAds: 0,
            message: 'No ad elements detected',
          },
        };
      }

      const categorized = this.categorizeByViewability(adElements, viewport);
      const metrics = this.calculateViewabilityMetrics(categorized);
      const issues = this.identifyViewabilityIssues(categorized);
      const hidden = this.detectHiddenAds(adElements, viewport);

      return {
        timestamp: new Date().toISOString(),
        metrics,
        categorization: {
          viewable: categorized.viewable.map(a => ({
            id: a.id,
            intersectionRatio: a.intersectionRatio,
          })),
          partiallyViewable: categorized.partiallyViewable.map(a => ({
            id: a.id,
            intersectionRatio: a.intersectionRatio,
          })),
          notViewable: categorized.notViewable.map(a => ({
            id: a.id,
            reason: 'completely_offscreen',
          })),
        },
        hiddenAds: hidden,
        issues,
        summary: {
          complianceStatus: metrics.viewablePercentage >= 50 ? 'compliant' : 'non_compliant',
          recommendedActions:
            metrics.viewablePercentage < 50
              ? ['Improve ad placement visibility', 'Review ad slot positioning']
              : [],
        },
      };
    } catch (error) {
      logger.error('Error generating visibility report', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = VisibilityChecker;
