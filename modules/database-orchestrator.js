const logger = require('./logger');
const crossModuleAnalyzer = require('./cross-module-analyzer');
const alertManager = require('./alert-engine/alert-manager');

class ModuleDataPersistence {
  constructor(handlers = {}) {
    this.contentAnalyzerDb = handlers.contentAnalyzerDb;
    this.adAnalyzerDb = handlers.adAnalyzerDb;
    this.policyCheckerDb = handlers.policyCheckerDb;
    this.technicalCheckerDb = handlers.technicalCheckerDb;
    this.aiAssistanceDb = handlers.aiAssistanceDb;
    this.crawlerDb = handlers.crawlerDb;
    this.scorerDb = handlers.scorerDb;
    this.logger = handlers.logger || logger;
  }

  async saveAllModuleResults(siteAuditId, publisherId, modules, requestId, pageUrl = null) {
    const orchestrationStartTime = Date.now();
    const results = {
      siteAuditId,
      publisherId,
      requestId,
      startTime: new Date().toISOString(),
      modules: {},
      partialFailures: [],
      summary: {
        totalModules: 0,
        successfulModules: 0,
        failedModules: 0,
        totalDuration: 0,
      },
    };

    const savePromises = [];

    if (modules.adAnalyzer?.data && this.adAnalyzerDb) {
      savePromises.push(
        this.safeModuleSave(
          'adAnalyzer',
          async () => {
            const startTime = Date.now();
            const result = await this.adAnalyzerDb.saveDensityAnalysis(
              publisherId,
              siteAuditId,
              modules.adAnalyzer.data?.densityAnalysis || {}
            );

            const saveResults = { density: result };

            if (modules.adAnalyzer.data?.autoRefreshDetection) {
              try {
                const refreshResult = await this.adAnalyzerDb.saveAutoRefreshDetection(
                  publisherId,
                  siteAuditId,
                  modules.adAnalyzer.data.autoRefreshDetection
                );
                saveResults.autoRefresh = refreshResult;
              } catch (err) {
                this.logger.warn(`[${requestId}] Failed to save auto-refresh detection`, {
                  error: err.message,
                  requestId,
                });
              }
            }

            if (modules.adAnalyzer.data?.visibilityCompliance) {
              try {
                const visibilityResult = await this.adAnalyzerDb.saveVisibilityCompliance(
                  publisherId,
                  siteAuditId,
                  modules.adAnalyzer.data.visibilityCompliance
                );
                saveResults.visibility = visibilityResult;
              } catch (err) {
                this.logger.warn(`[${requestId}] Failed to save visibility compliance`, {
                  error: err.message,
                  requestId,
                });
              }
            }

            if (modules.adAnalyzer.data?.patternData) {
              try {
                const patternResult = await this.adAnalyzerDb.savePatternDetection(
                  publisherId,
                  siteAuditId,
                  modules.adAnalyzer.data.patternData
                );
                saveResults.pattern = patternResult;
              } catch (err) {
                this.logger.warn(`[${requestId}] Failed to save pattern detection`, {
                  error: err.message,
                  requestId,
                });
              }
            }

            if (modules.adAnalyzer.data?.adElements && Array.isArray(modules.adAnalyzer.data.adElements)) {
              try {
                const elementsResult = await this.adAnalyzerDb.saveBatchAdElements(
                  publisherId,
                  siteAuditId,
                  modules.adAnalyzer.data.adElements
                );
                saveResults.elements = elementsResult;
              } catch (err) {
                this.logger.warn(`[${requestId}] Failed to save batch ad elements`, {
                  error: err.message,
                  requestId,
                });
              }
            }

            return {
              success: true,
              data: saveResults,
              duration: Date.now() - startTime,
            };
          },
          requestId
        )
      );
    }

    if (modules.contentAnalyzer?.data && this.contentAnalyzerDb) {
      savePromises.push(
        this.safeModuleSave(
          'contentAnalyzer',
          async () => {
            const startTime = Date.now();
            // Use provided pageUrl or fallback to data.url or 'unknown'
            const targetUrl = pageUrl || modules.contentAnalyzer.data.url || 'unknown';

            const result = await this.contentAnalyzerDb.saveCompleteAnalysis(
              publisherId,
              targetUrl,
              siteAuditId,
              modules.contentAnalyzer.data
            );
            return {
              success: true,
              data: result,
              duration: Date.now() - startTime,
            };
          },
          requestId
        )
      );
    }

    if (modules.policyChecker?.data && this.policyCheckerDb) {
      savePromises.push(
        this.safeModuleSave(
          'policyChecker',
          async () => {
            const startTime = Date.now();
            const result = await this.policyCheckerDb.savePolicyComplianceResult(
              modules.policyChecker.data,
              publisherId,
              siteAuditId,
              pageUrl
            );

            const saveResults = { compliance: result };

            if (modules.policyChecker.data?.violations && Array.isArray(modules.policyChecker.data.violations)) {
              try {
                const violationsResult = await this.policyCheckerDb.saveViolations(
                  modules.policyChecker.data.violations,
                  result?.id,
                  publisherId
                );
                saveResults.violations = violationsResult;
              } catch (err) {
                this.logger.warn(`[${requestId}] Failed to save policy violations`, {
                  error: err.message,
                  requestId,
                });
              }
            }

            return {
              success: true,
              data: saveResults,
              duration: Date.now() - startTime,
            };
          },
          requestId
        )
      );
    }

    if (modules.technicalChecker?.data && this.technicalCheckerDb) {
      savePromises.push(
        this.safeModuleSave(
          'technicalChecker',
          async () => {
            const startTime = Date.now();
            const result = await this.technicalCheckerDb.saveTechnicalCheck(
              publisherId,
              siteAuditId,
              modules.technicalChecker.data
            );

            const saveResults = { check: result };

            if (result?.data?.id) {
              try {
                const historyResult = await this.technicalCheckerDb.trackVersionHistory(
                  publisherId,
                  siteAuditId,
                  modules.technicalChecker.data?.technicalHealthScore || 0,
                  result.data.id
                );
                saveResults.history = historyResult;
              } catch (err) {
                this.logger.warn(`[${requestId}] Failed to track technical check history`, {
                  error: err.message,
                  requestId,
                });
              }
            }

            return {
              success: true,
              data: saveResults,
              duration: Date.now() - startTime,
            };
          },
          requestId
        )
      );
    }

    if (modules.aiAssistance?.data && this.aiAssistanceDb) {
      savePromises.push(
        this.safeModuleSave(
          'aiAssistance',
          async () => {
            const startTime = Date.now();
            const result = await this.aiAssistanceDb.saveLLMResponse(
              siteAuditId,
              publisherId,
              modules.aiAssistance.data.llmResponse || {},
              modules.aiAssistance.data.metadata || {}
            );
            return {
              success: true,
              data: result,
              duration: Date.now() - startTime,
            };
          },
          requestId
        )
      );
    }

    if (modules.crawler?.data && this.crawlerDb) {
      savePromises.push(
        this.safeModuleSave(
          'crawler',
          async () => {
            const startTime = Date.now();
            const result = await this.crawlerDb.saveCrawlData(
              publisherId,
              siteAuditId,
              modules.crawler.data
            );
            return {
              success: true,
              data: result,
              duration: Date.now() - startTime,
            };
          },
          requestId
        )
      );
    }

    if (modules.scorer?.data && this.scorerDb) {
      savePromises.push(
        this.safeModuleSave(
          'scorer',
          async () => {
            const startTime = Date.now();
            const result = await this.scorerDb.saveFullScoreData(
              publisherId,
              siteAuditId,
              modules.scorer.data
            );
            return {
              success: true,
              data: result,
              duration: Date.now() - startTime,
            };
          },
          requestId
        )
      );
    }

    results.summary.totalModules = savePromises.length;

    if (savePromises.length === 0) {
      this.logger.warn(`[${requestId}] No modules with data to persist`, {
        requestId,
        siteAuditId,
      });
      return results;
    }

    const saveResults = await Promise.all(savePromises);

    saveResults.forEach((result) => {
      results.modules[result.moduleName] = {
        success: result.success,
        duration: result.duration,
        error: result.error,
      };

      if (result.success) {
        results.summary.successfulModules++;
      } else {
        results.summary.failedModules++;
        results.partialFailures.push({
          module: result.moduleName,
          error: result.error,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Run Cross-Module Comparison
    // We run this AFTER all individual modules have been saved to ensure the data is available in the DB
    // and to allow the comparison engine to fetch the complete audit state.
    if (results.summary.successfulModules > 0) {
      try {
        this.logger.info(`[${requestId}] Starting cross-module comparison`, { requestId, siteAuditId });
        const comparisonStartTime = Date.now();

        const comparisonResult = await crossModuleAnalyzer.runComparison(siteAuditId, publisherId);

        results.modules['crossModuleComparison'] = {
          success: comparisonResult.success,
          duration: Date.now() - comparisonStartTime,
          error: comparisonResult.error,
          details: comparisonResult.success ? {
            changesDetected: comparisonResult.deltaReport?.changeCount || 0,
            alertsGenerated: comparisonResult.analysisResult?.alerts?.length || 0
          } : null
        };

        if (!comparisonResult.success) {
          this.logger.warn(`[${requestId}] Cross-module comparison failed`, {
            requestId,
            error: comparisonResult.error
          });
          // We don't increment failedModules count here as this is a post-processing step
          // but we do log it as a partial failure
          results.partialFailures.push({
            module: 'crossModuleComparison',
            error: comparisonResult.error,
            timestamp: new Date().toISOString()
          });
        } else {
          this.logger.info(`[${requestId}] Cross-module comparison completed`, {
            requestId,
            changes: comparisonResult.deltaReport?.changeCount,
            alerts: comparisonResult.analysisResult?.alerts?.length
          });

          // Trigger Alert Engine if alerts were generated
          if (comparisonResult.analysisResult?.alerts?.length > 0) {
            this.logger.info(`[${requestId}] Triggering alert engine`, { requestId });
            // We run this asynchronously and don't wait for it to complete the audit response
            // to avoid blocking the worker if email sending is slow.
            alertManager.processPendingAlerts().catch(err => {
              this.logger.error(`[${requestId}] Background alert processing failed`, err);
            });
          }
        }

      } catch (error) {
        this.logger.error(`[${requestId}] Unexpected error in cross-module comparison`, error, {
          requestId,
          siteAuditId
        });
        results.partialFailures.push({
          module: 'crossModuleComparison',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }

    results.summary.totalDuration = Date.now() - orchestrationStartTime;
    results.endTime = new Date().toISOString();

    this.logger.info(`[${requestId}] Module data persistence completed`, {
      requestId,
      siteAuditId,
      successfulModules: results.summary.successfulModules,
      failedModules: results.summary.failedModules,
      totalDuration: results.summary.totalDuration,
      modules: Object.keys(results.modules),
    });

    if (results.partialFailures.length > 0) {
      this.logger.warn(`[${requestId}] Partial failures detected during module persistence`, {
        requestId,
        siteAuditId,
        failures: results.partialFailures,
      });
    }

    return results;
  }

  async safeModuleSave(moduleName, saveOperation, requestId) {
    const moduleStartTime = Date.now();
    try {
      this.logger.info(`[${requestId}] Starting database save for module: ${moduleName}`, {
        module: moduleName,
        requestId,
      });

      const result = await saveOperation();

      const duration = Date.now() - moduleStartTime;
      this.logger.info(`[${requestId}] Successfully saved ${moduleName} data`, {
        module: moduleName,
        duration,
        requestId,
      });

      return {
        moduleName,
        success: true,
        duration,
        error: null,
      };
    } catch (error) {
      const duration = Date.now() - moduleStartTime;
      this.logger.error(`[${requestId}] Failed to save ${moduleName} data`, error, {
        module: moduleName,
        duration,
        error: error.message,
        requestId,
      });

      return {
        moduleName,
        success: false,
        duration,
        error: error.message,
      };
    }
  }

  async verifyAuditPersistence(siteAuditId, expectedModules, requestId) {
    try {
      this.logger.info(`[${requestId}] Verifying audit data persistence`, {
        siteAuditId,
        expectedModules: expectedModules.length,
        requestId,
      });

      const verification = {
        siteAuditId,
        requestId,
        verified: true,
        results: {},
        missingModules: [],
        timestamp: new Date().toISOString(),
      };

      this.logger.info(`[${requestId}] Audit verification completed`, {
        siteAuditId,
        verified: verification.verified,
        requestId,
      });

      return verification;
    } catch (error) {
      this.logger.error(`[${requestId}] Audit verification failed`, error, {
        siteAuditId,
        requestId,
      });

      return {
        siteAuditId,
        requestId,
        verified: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = ModuleDataPersistence;
