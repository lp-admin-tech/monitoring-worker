/**
 * Pattern Analyzer Module
 * Identifies concerning trends and generates alerts based on comparison data
 */
class PatternAnalyzer {
    /**
     * Analyze deltas and historical data to identify patterns and risks
     * @param {Object} deltaReport 
     * @param {Array} riskTrajectory 
     * @returns {Object} Analysis result containing alerts and insights
     */
    analyzePatterns(deltaReport, riskTrajectory) {
        const alerts = [];
        const insights = [];

        // 1. Analyze immediate deltas
        if (!deltaReport.isFirstAudit) {
            this.analyzeDeltas(deltaReport.changes, alerts);
        }

        // 2. Analyze historical trajectory
        if (riskTrajectory && riskTrajectory.length >= 3) {
            this.analyzeTrajectory(riskTrajectory, alerts, insights);
        }

        return {
            alerts,
            insights,
            riskLevel: this.calculateAggregateRisk(alerts)
        };
    }

    analyzeDeltas(changes, alerts) {
        // Group changes by severity
        const highSeverityChanges = changes.filter(c => c.severity === 'high' || c.severity === 'critical');

        // Alert on sudden risk spikes
        const riskSpike = changes.find(c => c.category === 'risk_score' && c.delta > 15);
        if (riskSpike) {
            alerts.push({
                type: 'RISK_SPIKE',
                severity: 'high',
                message: `Sudden increase in risk score (+${riskSpike.delta.toFixed(1)}) detected.`,
                metadata: { change: riskSpike }
            });
        }

        // Alert on ad density violations
        const adDensitySpike = changes.find(c => c.category === 'ads' && c.metric === 'ad_density' && c.newValue > 0.35);
        if (adDensitySpike) {
            alerts.push({
                type: 'AD_DENSITY_VIOLATION',
                severity: 'high',
                message: `Ad density has exceeded acceptable limits (${(adDensitySpike.newValue * 100).toFixed(1)}%).`,
                metadata: { change: adDensitySpike }
            });
        }

        // Alert on multiple negative changes
        if (highSeverityChanges.length >= 3) {
            alerts.push({
                type: 'MULTIPLE_DEGRADATIONS',
                severity: 'medium',
                message: `Multiple high-severity changes detected in a single audit.`,
                metadata: { count: highSeverityChanges.length, changes: highSeverityChanges }
            });
        }
    }

    analyzeTrajectory(trajectory, alerts, insights) {
        // Sort by date ascending
        const sorted = [...trajectory].sort((a, b) => new Date(a.audit_date) - new Date(b.audit_date));
        const recent = sorted.slice(-5); // Last 5 points

        // Check for consistent degradation (increasing risk)
        let increasingTrend = true;
        for (let i = 1; i < recent.length; i++) {
            if (Number(recent[i].risk_score) <= Number(recent[i - 1].risk_score)) {
                increasingTrend = false;
                break;
            }
        }

        if (increasingTrend && recent.length >= 3) {
            const first = Number(recent[0].risk_score);
            const last = Number(recent[recent.length - 1].risk_score);

            alerts.push({
                type: 'NEGATIVE_TREND',
                severity: 'medium',
                message: `Consistent increase in risk score observed over the last ${recent.length} audits.`,
                metadata: { startScore: first, endScore: last, trend: 'increasing' }
            });
        }

        // Volatility check
        const scores = recent.map(r => Number(r.risk_score));
        const variance = this.calculateVariance(scores);

        if (variance > 100) { // Threshold for high volatility
            insights.push({
                type: 'VOLATILITY',
                message: 'Risk score is showing high volatility.',
                metadata: { variance }
            });
        }
    }

    calculateAggregateRisk(alerts) {
        if (alerts.some(a => a.severity === 'critical')) return 'critical';
        if (alerts.some(a => a.severity === 'high')) return 'high';
        if (alerts.length > 2) return 'medium';
        return 'low';
    }

    calculateVariance(array) {
        const mean = array.reduce((a, b) => a + b, 0) / array.length;
        return array.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / array.length;
    }
}

module.exports = new PatternAnalyzer();
