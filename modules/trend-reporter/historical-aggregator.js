/**
 * Historical Aggregator Module
 * Aggregates raw audit data into meaningful trends and stats
 */
class HistoricalAggregator {
    /**
     * Aggregate audit data into daily/weekly stats
     * @param {Array} audits - List of audit records
     * @returns {Object} Aggregated stats
     */
    aggregate(audits) {
        if (!audits || audits.length === 0) {
            return {
                totalAudits: 0,
                averageRiskScore: 0,
                averageHealthScore: 0,
                riskTrend: [],
                healthTrend: []
            };
        }

        const totalAudits = audits.length;

        // Calculate averages
        const totalRisk = audits.reduce((sum, a) => sum + (Number(a.risk_score) || 0), 0);
        const totalHealth = audits.reduce((sum, a) => sum + (Number(a.technical_health_score) || 0), 0);

        const averageRiskScore = totalRisk / totalAudits;
        const averageHealthScore = totalHealth / totalAudits;

        // Generate trend series
        const riskTrend = audits.map(a => ({
            date: a.created_at,
            value: Number(a.risk_score) || 0
        }));

        const healthTrend = audits.map(a => ({
            date: a.created_at,
            value: Number(a.technical_health_score) || 0
        }));

        // Calculate volatility (standard deviation of risk score)
        const riskVariance = audits.reduce((sum, a) => sum + Math.pow((Number(a.risk_score) || 0) - averageRiskScore, 2), 0) / totalAudits;
        const riskVolatility = Math.sqrt(riskVariance);

        return {
            periodStart: audits[0].created_at,
            periodEnd: audits[audits.length - 1].created_at,
            totalAudits,
            averageRiskScore: Number(averageRiskScore.toFixed(2)),
            averageHealthScore: Number(averageHealthScore.toFixed(2)),
            riskVolatility: Number(riskVolatility.toFixed(2)),
            riskTrend,
            healthTrend
        };
    }
}

module.exports = new HistoricalAggregator();
