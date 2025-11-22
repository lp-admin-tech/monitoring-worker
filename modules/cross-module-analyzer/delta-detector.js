/**
 * Delta Detector Module
 * Responsible for calculating differences between two audit states
 */
class DeltaDetector {
    /**
     * Compare two audits and generate a delta report
     * @param {Object} currentAudit 
     * @param {Object} previousAudit 
     * @returns {Object} Delta report
     */
    detectDeltas(currentAudit, previousAudit) {
        if (!previousAudit) {
            return {
                isFirstAudit: true,
                changes: []
            };
        }

        const changes = [];

        // 1. Risk Score Delta
        this.checkRiskScore(currentAudit, previousAudit, changes);

        // 2. Content Analysis Deltas
        if (currentAudit.content_analysis && previousAudit.content_analysis) {
            this.checkContentChanges(currentAudit.content_analysis, previousAudit.content_analysis, changes);
        }

        // 3. Ad Analysis Deltas
        if (currentAudit.ad_analysis && previousAudit.ad_analysis) {
            this.checkAdChanges(currentAudit.ad_analysis, previousAudit.ad_analysis, changes);
        }

        // 4. Technical Check Deltas
        if (currentAudit.technical_check && previousAudit.technical_check) {
            this.checkTechnicalChanges(currentAudit.technical_check, previousAudit.technical_check, changes);
        }

        return {
            isFirstAudit: false,
            auditId: currentAudit.id,
            previousAuditId: previousAudit.id,
            timestamp: new Date().toISOString(),
            changeCount: changes.length,
            changes
        };
    }

    checkRiskScore(current, previous, changes) {
        const currentScore = Number(current.risk_score) || 0;
        const previousScore = Number(previous.risk_score) || 0;
        const diff = currentScore - previousScore;

        if (Math.abs(diff) > 0) {
            changes.push({
                category: 'risk_score',
                type: diff > 0 ? 'increase' : 'decrease',
                metric: 'overall_score',
                oldValue: previousScore,
                newValue: currentScore,
                delta: diff,
                severity: Math.abs(diff) >= 20 ? 'high' : (Math.abs(diff) >= 10 ? 'medium' : 'low')
            });
        }
    }

    checkContentChanges(current, previous, changes) {
        // Check category changes
        if (current.categories && previous.categories) {
            const currentCats = new Set(current.categories.map(c => c.name || c));
            const previousCats = new Set(previous.categories.map(c => c.name || c));

            // New categories
            for (const cat of currentCats) {
                if (!previousCats.has(cat)) {
                    changes.push({
                        category: 'content',
                        type: 'addition',
                        metric: 'category',
                        value: cat,
                        severity: 'medium'
                    });
                }
            }

            // Removed categories
            for (const cat of previousCats) {
                if (!currentCats.has(cat)) {
                    changes.push({
                        category: 'content',
                        type: 'removal',
                        metric: 'category',
                        value: cat,
                        severity: 'low'
                    });
                }
            }
        }

        // Check sentiment shift
        if (current.sentiment && previous.sentiment) {
            if (current.sentiment !== previous.sentiment) {
                changes.push({
                    category: 'content',
                    type: 'change',
                    metric: 'sentiment',
                    oldValue: previous.sentiment,
                    newValue: current.sentiment,
                    severity: 'medium'
                });
            }
        }
    }

    checkAdChanges(current, previous, changes) {
        // Ad Density
        if (current.adDensity && previous.adDensity) {
            const diff = (current.adDensity - previous.adDensity) * 100; // Assuming decimal
            if (Math.abs(diff) > 5) { // 5% change threshold
                changes.push({
                    category: 'ads',
                    type: diff > 0 ? 'increase' : 'decrease',
                    metric: 'ad_density',
                    oldValue: previous.adDensity,
                    newValue: current.adDensity,
                    delta: diff,
                    severity: current.adDensity > 0.3 ? 'high' : 'medium'
                });
            }
        }

        // Auto-refresh detection (boolean flip)
        if (current.autoRefresh !== undefined && previous.autoRefresh !== undefined) {
            if (current.autoRefresh !== previous.autoRefresh) {
                changes.push({
                    category: 'ads',
                    type: current.autoRefresh ? 'enabled' : 'disabled',
                    metric: 'auto_refresh',
                    severity: current.autoRefresh ? 'high' : 'low'
                });
            }
        }
    }

    checkTechnicalChanges(current, previous, changes) {
        // Core Web Vitals or similar metrics if available
        if (current.technicalHealthScore && previous.technicalHealthScore) {
            const diff = current.technicalHealthScore - previous.technicalHealthScore;
            if (Math.abs(diff) >= 10) {
                changes.push({
                    category: 'technical',
                    type: diff < 0 ? 'degradation' : 'improvement',
                    metric: 'health_score',
                    oldValue: previous.technicalHealthScore,
                    newValue: current.technicalHealthScore,
                    delta: diff,
                    severity: diff <= -20 ? 'high' : 'medium'
                });
            }
        }
    }
}

module.exports = new DeltaDetector();
