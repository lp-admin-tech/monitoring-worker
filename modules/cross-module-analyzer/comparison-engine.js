const db = require('./db');
const deltaDetector = require('./delta-detector');
const patternAnalyzer = require('./pattern-analyzer');
const logger = require('../../modules/logger');

class CrossModuleComparisonEngine {
    /**
     * Orchestrates the comparison process for a completed audit
     * @param {string} currentAuditId - The ID of the newly completed audit
     * @param {string} publisherId - The ID of the publisher
     */
    async runComparison(currentAuditId, publisherId) {
        const requestId = `CMP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        logger.info(`[${requestId}] Starting cross-module comparison for audit ${currentAuditId}`);

        try {
            // 1. Fetch current audit data
            const currentAudit = await db.getAuditData(currentAuditId);
            if (!currentAudit) {
                throw new Error(`Audit ${currentAuditId} not found`);
            }

            // 2. Find previous audit ID
            const previousAuditId = await db.getPreviousAuditId(currentAuditId);
            let previousAudit = null;

            if (previousAuditId) {
                logger.info(`[${requestId}] Found previous audit ${previousAuditId}`);
                previousAudit = await db.getAuditData(previousAuditId);
            } else {
                logger.info(`[${requestId}] No previous audit found. This is the first baseline.`);
            }

            // 3. Detect Deltas
            const deltaReport = deltaDetector.detectDeltas(currentAudit, previousAudit);

            // 4. Fetch Historical Trajectory
            const riskTrajectory = await db.getPublisherRiskTrajectory(publisherId, 90); // 90 days history

            // 5. Analyze Patterns & Generate Alerts
            const analysisResult = patternAnalyzer.analyzePatterns(deltaReport, riskTrajectory);

            // 6. Persist Results
            const comparisonRecord = await db.saveComparisonResults({
                currentAuditId,
                previousAuditId,
                publisherId,
                comparisonData: {
                    deltas: deltaReport,
                    analysis: analysisResult,
                    meta: {
                        processedAt: new Date().toISOString(),
                        version: '1.0'
                    }
                }
            });

            // 7. Persist Alerts
            if (analysisResult.alerts.length > 0) {
                const alertsToSave = analysisResult.alerts.map(alert => ({
                    ...alert,
                    publisherId
                }));
                await db.saveAlerts(alertsToSave);
                logger.info(`[${requestId}] Generated ${alertsToSave.length} alerts`);
            }

            logger.info(`[${requestId}] Comparison completed successfully`, {
                comparisonId: comparisonRecord.id,
                changesDetected: deltaReport.changeCount,
                alertsGenerated: analysisResult.alerts.length
            });

            return {
                success: true,
                comparisonId: comparisonRecord.id,
                deltaReport,
                analysisResult
            };

        } catch (error) {
            logger.error(`[${requestId}] Comparison failed`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new CrossModuleComparisonEngine();
