const logger = require('../logger');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables for policy checker DB');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

class PolicyCheckerDB {
  async savePolicyComplianceResult(policyCheckResults, publisherId, siteAuditId, domain = 'unknown') {
    const startTime = Date.now();
    try {
      if (!policyCheckResults || !publisherId) {
        throw new Error('Invalid arguments: policyCheckResults and publisherId are required');
      }

      const complianceData = {
        site_audit_id: siteAuditId || null,
        publisher_id: publisherId,
        domain: domain || 'unknown',
        detected_jurisdiction: policyCheckResults.jurisdiction?.primaryJurisdiction || 'Unknown',
        compliance_level: policyCheckResults.complianceLevel,
        total_policies_checked: policyCheckResults.summary?.totalPolicies || 0,
        compliant_policies: policyCheckResults.summary?.compliantPolicies || 0,
        violating_policies: policyCheckResults.summary?.violatingPolicies || 0,
        total_violations: policyCheckResults.summary?.totalViolations || 0,
        critical_violations: policyCheckResults.summary?.criticalViolations || 0,
        high_violations: policyCheckResults.summary?.highViolations || 0,
        medium_violations: policyCheckResults.summary?.mediumViolations || 0,
        low_violations: policyCheckResults.summary?.lowViolations || 0,
        violations_data: {
          violations: policyCheckResults.violations || [],
          restricted_keywords: policyCheckResults.restrictedKeywords || {},
          categories: policyCheckResults.categories || {},
        },
        policies_status: policyCheckResults.summary?.policyStatus || {},
        timestamp: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('policy_compliance_results')
        .insert(complianceData)
        .select();

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('INSERT', 'policy_compliance_results', 'failure', duration, 1, error, {
          publisherId,
          complianceLevel: policyCheckResults.complianceLevel,
        });
        throw new Error(`Failed to save compliance result: ${error.message}`);
      }

      await this.logDbOperation('INSERT', 'policy_compliance_results', 'success', duration, 1, null, {
        publisherId,
        complianceLevel: policyCheckResults.complianceLevel,
        resultId: data?.[0]?.id,
      });

      logger.info('Policy compliance result saved', {
        publisherId,
        complianceLevel: policyCheckResults.complianceLevel,
        violations: policyCheckResults.summary?.totalViolations,
      });

      return data?.[0];
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('INSERT', 'policy_checker_results', 'failure', duration, 1, err, { publisherId });
      logger.error('Failed to save policy compliance result', {
        publisherId,
        error: err.message,
      });
      throw err;
    }
  }

  async saveViolations(violations, complianceResultId, publisherId) {
    const startTime = Date.now();
    try {
      if (!violations || !Array.isArray(violations) || violations.length === 0) {
        logger.debug('No violations to save');
        return [];
      }

      if (!publisherId) {
        throw new Error('publisherId is required for saving violations');
      }

      const violationRecords = violations.map(violation => ({
        compliance_result_id: complianceResultId || null,
        policy_id: violation.policy || 'unknown',
        policy_name: violation.policyName || violation.policy,
        policy_type: violation.type || 'compliance_violation',
        category: this.getCategoryFromViolation(violation),
        violation_text: violation.evaluation?.foundKeywords?.join(', ') || violation.evaluation?.category || 'Policy violation detected',
        severity: violation.severity || 'medium',
        jurisdiction: 'global',
        evidence: JSON.stringify({
          rule: violation.rule,
          evaluation: violation.evaluation,
          is_critical: violation.severity === 'critical',
        }),
      }));

      const { data, error } = await supabase
        .from('policy_violations')
        .insert(violationRecords)
        .select();

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('INSERT', 'policy_violations', 'failure', duration, violations.length, error, {
          publisherId,
          violationCount: violations.length,
        });
        throw new Error(`Failed to save violations: ${error.message}`);
      }

      await this.logDbOperation('INSERT', 'policy_violations', 'success', duration, violations.length, null, {
        publisherId,
        violationCount: violations.length,
        criticalCount: violations.filter(v => v.severity === 'critical').length,
      });

      logger.info('Policy violations saved', {
        publisherId,
        total: violations.length,
        critical: violations.filter(v => v.severity === 'critical').length,
      });

      return data || [];
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('INSERT', 'policy_violations', 'failure', duration, violations?.length || 0, err, { publisherId });
      logger.error('Failed to save violations', {
        publisherId,
        violationCount: violations?.length,
        error: err.message,
      });
      throw err;
    }
  }

  async saveRestrictedKeywordMatches(keywordResults, complianceResultId, publisherId, domain) {
    const startTime = Date.now();
    try {
      if (!keywordResults || !publisherId) {
        logger.debug('No keyword results or missing publisherId');
        return [];
      }

      const keywordMatches = [];
      const violations = keywordResults.violations || [];

      for (const violation of violations) {
        keywordMatches.push({
          compliance_result_id: complianceResultId || null,
          policy_id: `keyword_${violation.category}`,
          policy_name: `Restricted Keyword: ${violation.category}`,
          policy_type: 'restricted_keyword',
          category: violation.category,
          violation_text: violation.keyword,
          severity: violation.severity || 'high',
          jurisdiction: 'global',
          evidence: JSON.stringify({
            keyword: violation.keyword,
            severity: violation.severity,
            message: violation.message,
          }),
        });
      }

      if (keywordMatches.length === 0) {
        logger.debug('No keyword violations to save');
        return [];
      }

      const { data, error } = await supabase
        .from('policy_violations')
        .insert(keywordMatches)
        .select();

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('INSERT', 'policy_violations', 'failure', duration, keywordMatches.length, error, {
          publisherId,
          domain,
          type: 'keyword_matches',
        });
        throw new Error(`Failed to save keyword matches: ${error.message}`);
      }

      await this.logDbOperation('INSERT', 'policy_violations', 'success', duration, keywordMatches.length, null, {
        publisherId,
        domain,
        type: 'keyword_matches',
        keywordCount: keywordMatches.length,
      });

      logger.info('Restricted keyword matches saved', {
        publisherId,
        domain,
        total: keywordMatches.length,
      });

      return data || [];
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('INSERT', 'policy_violations', 'failure', duration, 0, err, {
        publisherId,
        domain,
        type: 'keyword_matches',
      });
      logger.error('Failed to save keyword matches', {
        publisherId,
        domain,
        error: err.message,
      });
      throw err;
    }
  }

  async saveCategoryDetection(categoryResults, complianceResultId, publisherId, domain) {
    const startTime = Date.now();
    try {
      if (!categoryResults || !publisherId) {
        logger.debug('No category results or missing publisherId');
        return null;
      }

      const categoryData = {
        compliance_result_id: complianceResultId || null,
        policy_id: `category_${categoryResults.analysis?.riskLevel || 'unknown'}`,
        policy_name: `Content Category: ${categoryResults.analysis?.riskLevel || 'Unknown'}`,
        policy_type: 'content_category',
        category: categoryResults.analysis?.riskLevel || 'unknown',
        violation_text: `Risk Level: ${categoryResults.analysis?.riskLevel || 'Unknown'}. Categories: ${(categoryResults.analysis?.sensitiveCategories || []).join(', ')}`,
        severity: this.mapRiskLevelToSeverity(categoryResults.analysis?.riskLevel),
        jurisdiction: 'global',
        evidence: JSON.stringify({
          riskLevel: categoryResults.analysis?.riskLevel,
          sensitiveCategories: categoryResults.analysis?.sensitiveCategories,
          patterns: categoryResults.patterns,
          analysis: categoryResults.analysis,
        }),
      };

      const { data, error } = await supabase
        .from('policy_violations')
        .insert(categoryData)
        .select();

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('INSERT', 'policy_violations', 'failure', duration, 1, error, {
          publisherId,
          domain,
          type: 'category_detection',
        });
        throw new Error(`Failed to save category detection: ${error.message}`);
      }

      await this.logDbOperation('INSERT', 'policy_violations', 'success', duration, 1, null, {
        publisherId,
        domain,
        type: 'category_detection',
        riskLevel: categoryResults.analysis?.riskLevel,
      });

      logger.info('Category detection saved', {
        publisherId,
        domain,
        riskLevel: categoryResults.analysis?.riskLevel,
      });

      return data?.[0];
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('INSERT', 'policy_violations', 'failure', duration, 1, err, {
        publisherId,
        domain,
        type: 'category_detection',
      });
      logger.error('Failed to save category detection', {
        publisherId,
        domain,
        error: err.message,
      });
      throw err;
    }
  }

  async createComplianceHistoryEntry(publisherId, domain, previousLevel, newLevel, previousCount, newCount, changeReason) {
    const startTime = Date.now();
    try {
      if (!publisherId || !newLevel) {
        throw new Error('publisherId and newLevel are required');
      }

      if (previousLevel === newLevel && previousCount === newCount) {
        logger.debug('No compliance changes to record');
        return null;
      }

      const historyEntry = {
        publisher_id: publisherId,
        url: domain || 'unknown',
        jurisdiction: 'global',
        compliance_score: this.complianceLevelToScore(newLevel),
        status: newLevel,
        action: `Changed from ${previousLevel || 'unknown'} to ${newLevel}`,
        details: {
          previousLevel,
          newLevel,
          previousViolationCount: previousCount || 0,
          newViolationCount: newCount || 0,
          changeReason: changeReason || {},
          timestamp: new Date().toISOString(),
        },
        user_id: null,
      };

      const { data, error } = await supabase
        .from('compliance_history')
        .insert(historyEntry)
        .select();

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('INSERT', 'compliance_history', 'failure', duration, 1, error, {
          publisherId,
          previousLevel,
          newLevel,
        });
        throw new Error(`Failed to create compliance history: ${error.message}`);
      }

      await this.logDbOperation('INSERT', 'compliance_history', 'success', duration, 1, null, {
        publisherId,
        transition: `${previousLevel} -> ${newLevel}`,
      });

      logger.info('Compliance history entry created', {
        publisherId,
        domain,
        transition: `${previousLevel} -> ${newLevel}`,
      });

      return data?.[0];
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('INSERT', 'compliance_history', 'failure', duration, 1, err, {
        publisherId,
        previousLevel,
        newLevel,
      });
      logger.error('Failed to create compliance history', {
        publisherId,
        domain,
        error: err.message,
      });
      throw err;
    }
  }

  async queryViolationTrends(publisherId, limit = 30) {
    const startTime = Date.now();
    try {
      if (!publisherId) {
        throw new Error('publisherId is required');
      }

      const { data, error } = await supabase
        .from('policy_violations')
        .select('severity, policy_type, category, created_at')
        .eq('compliance_result_id', publisherId)
        .order('created_at', { ascending: false })
        .limit(limit);

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('SELECT', 'policy_violations', 'failure', duration, 0, error, { publisherId });
        throw new Error(`Failed to query violation trends: ${error.message}`);
      }

      const trends = {
        total: data?.length || 0,
        bySeverity: {},
        byCategory: {},
        byType: {},
      };

      if (data && data.length > 0) {
        data.forEach(violation => {
          trends.bySeverity[violation.severity] = (trends.bySeverity[violation.severity] || 0) + 1;
          trends.byCategory[violation.category] = (trends.byCategory[violation.category] || 0) + 1;
          trends.byType[violation.policy_type] = (trends.byType[violation.policy_type] || 0) + 1;
        });
      }

      await this.logDbOperation('SELECT', 'policy_violations', 'success', duration, data?.length || 0, null, {
        publisherId,
        recordCount: data?.length,
      });

      logger.debug('Violation trends queried', {
        publisherId,
        total: trends.total,
      });

      return trends;
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', 'policy_violations', 'failure', duration, 0, err, { publisherId });
      logger.error('Failed to query violation trends', {
        publisherId,
        error: err.message,
      });
      throw err;
    }
  }

  async queryComplianceHistory(publisherId, limit = 50) {
    const startTime = Date.now();
    try {
      if (!publisherId) {
        throw new Error('publisherId is required');
      }

      const { data, error } = await supabase
        .from('compliance_history')
        .select('*')
        .eq('publisher_id', publisherId)
        .order('created_at', { ascending: false })
        .limit(limit);

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('SELECT', 'compliance_history', 'failure', duration, 0, error, { publisherId });
        throw new Error(`Failed to query compliance history: ${error.message}`);
      }

      await this.logDbOperation('SELECT', 'compliance_history', 'success', duration, data?.length || 0, null, {
        publisherId,
        recordCount: data?.length,
      });

      logger.debug('Compliance history queried', {
        publisherId,
        records: data?.length,
      });

      return data || [];
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', 'compliance_history', 'failure', duration, 0, err, { publisherId });
      logger.error('Failed to query compliance history', {
        publisherId,
        error: err.message,
      });
      throw err;
    }
  }

  async queryLatestComplianceStatus(publisherId) {
    const startTime = Date.now();
    try {
      if (!publisherId) {
        throw new Error('publisherId is required');
      }

      const { data, error } = await supabase
        .from('policy_compliance_results')
        .select('*')
        .eq('publisher_id', publisherId)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('SELECT', 'policy_compliance_results', 'failure', duration, 0, error, { publisherId });
        throw new Error(`Failed to query compliance status: ${error.message}`);
      }

      await this.logDbOperation('SELECT', 'policy_compliance_results', 'success', duration, data ? 1 : 0, null, {
        publisherId,
        found: !!data,
      });

      logger.debug('Latest compliance status retrieved', {
        publisherId,
        complianceLevel: data?.compliance_level,
      });

      return data;
    } catch (err) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', 'policy_checker_results', 'failure', duration, 0, err, { publisherId });
      logger.error('Failed to query latest compliance status', {
        publisherId,
        error: err.message,
      });
      throw err;
    }
  }

  async logDbOperation(operation, table, status, duration, recordCount, error, details) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level: status === 'success' ? 'INFO' : 'ERROR',
        operation,
        table_name: table,
        status,
        message: `${status === 'success' ? 'Successfully' : 'Failed to'} ${operation.toLowerCase()} ${recordCount || 0} record(s) in ${table}`,
        details: details || {},
        error_message: error?.message || null,
        duration_ms: duration,
        record_count: recordCount || 0,
        created_at: new Date().toISOString(),
      };

      await supabase
        .from('db_operation_logs')
        .insert(logEntry);

      if (status === 'success') {
        logger.debug(`[DB_LOG] ${operation} ${table}: ${recordCount} record(s) in ${duration}ms`, {
          table,
          operation,
          duration,
        });
      } else {
        logger.warn(`[DB_LOG] ${operation} ${table} FAILED: ${error?.message || 'Unknown error'}`, {
          table,
          operation,
          error: error?.message,
        });
      }
    } catch (err) {
      logger.error(`[DB_LOG] Failed to log database operation: ${err.message}`, {
        originalError: error?.message,
        operation,
        table,
      });
    }
  }

  getCategoryFromViolation(violation) {
    if (violation.type === 'restricted_keyword_violation') {
      return 'restricted_keyword';
    }
    if (violation.type === 'category_violation') {
      return 'content_category';
    }
    return violation.category || 'unknown';
  }

  mapRiskLevelToSeverity(riskLevel) {
    const mapping = {
      critical: 'critical',
      high: 'high',
      medium: 'medium',
      low: 'low',
    };
    return mapping[riskLevel?.toLowerCase()] || 'medium';
  }

  complianceLevelToScore(complianceLevel) {
    const mapping = {
      compliant: 100,
      warning: 70,
      non_compliant: 0,
    };
    return mapping[complianceLevel?.toLowerCase()] || 50;
  }
}

module.exports = new PolicyCheckerDB();
