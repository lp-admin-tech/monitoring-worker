/**
 * Export Formatter Module
 * Formats aggregated data into CSV or JSON
 */
class ExportFormatter {
    /**
     * Format data as JSON
     * @param {Object} data 
     * @returns {string} JSON string
     */
    formatJSON(data) {
        return JSON.stringify(data, null, 2);
    }

    /**
     * Format data as CSV
     * @param {Object} aggregatedData 
     * @param {Array} rawAudits 
     * @returns {string} CSV string
     */
    formatCSV(aggregatedData, rawAudits) {
        const headers = ['Date', 'Audit ID', 'Risk Score', 'Health Score', 'Ad Density', 'Status'];
        const rows = rawAudits.map(audit => [
            new Date(audit.created_at).toISOString(),
            audit.id,
            audit.risk_score || 0,
            audit.technical_health_score || 0,
            audit.ad_density || 0,
            audit.audit_status
        ]);

        // Add summary at the top
        const summary = [
            ['Summary Report'],
            ['Period Start', aggregatedData.periodStart],
            ['Period End', aggregatedData.periodEnd],
            ['Average Risk Score', aggregatedData.averageRiskScore],
            ['Total Audits', aggregatedData.totalAudits],
            [] // Empty line
        ];

        const csvContent = [
            ...summary.map(row => row.join(',')),
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        return csvContent;
    }
}

module.exports = new ExportFormatter();
