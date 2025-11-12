let supabaseClient = null;
const LogQueueManager = require('./log-queue-manager');
const logQueueManager = new LogQueueManager(1000);

function getSupabaseClient() {
  if (supabaseClient === null && supabaseClient !== false) {
    try {
      const { supabaseClient: client } = require('./supabase-client');
      supabaseClient = client;
    } catch (err) {
      supabaseClient = false;
      console.warn('Supabase client not available for logging');
    }
  }
  return supabaseClient || null;
}

const LogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
};

const COLORS = {
  INFO: '\x1b[36m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
  SUCCESS: '\x1b[32m',
  RESET: '\x1b[0m',
};

class Logger {
  constructor() {
    this.minLevel = LogLevel.INFO;
    this.verbosity = process.env.LOG_VERBOSITY || 'minimal';
  }

  setMinLevel(level) {
    this.minLevel = level;
  }

  shouldLog(level) {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  formatContext(context = {}) {
    const { requestId, jobId, publisherId, siteName, domain, module } = context;
    const parts = [];
    if (module) parts.push(module);
    if (requestId) parts.push(`req:${requestId.substring(0, 8)}`);
    if (jobId) parts.push(`job:${jobId.substring(0, 8)}`);
    if (publisherId) parts.push(`pub:${publisherId.substring(0, 8)}`);
    if (siteName) parts.push(`site:${siteName}`);
    if (domain) parts.push(`domain:${domain}`);
    return parts.length > 0 ? `[${parts.join(' | ')}]` : '';
  }

  formatMessage(message, data = {}) {
    if (this.verbosity === 'minimal' && data) {
      const filtered = {};
      for (const [key, value] of Object.entries(data)) {
        if (value !== 0 && value !== false && value !== null && value !== undefined) {
          filtered[key] = value;
        }
      }
      if (Object.keys(filtered).length === 0) return message;
      return `${message} ${JSON.stringify(filtered)}`;
    }
    return data && Object.keys(data).length > 0 ? `${message} ${JSON.stringify(data)}` : message;
  }

  async persistLog(entry) {
    const client = getSupabaseClient();
    if (!client) {
      logQueueManager.addToQueue(entry);
      console.warn('[Logger] Supabase client unavailable. Log queued for later retry.');
      return;
    }

    try {
      const logData = {
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.message,
        context: {
          moduleName: entry.moduleName,
          ...entry.context,
        },
        error: entry.error || null,
        user_id: entry.userId || null,
        publisher_id: entry.publisherId || null,
        action: entry.action || 'log',
        entity_type: entry.entityType || 'worker_process',
      };

      const { error } = await client.from('audit_logs').insert([logData]);

      if (error) {
        logQueueManager.addToQueue(entry);
        console.warn('[Logger] Database error persisting log. Log queued for retry:', error.message);
      }
    } catch (err) {
      logQueueManager.addToQueue(entry);
      console.error('[Logger] Failed to persist log. Log queued for retry:', err.message);
    }
  }

  info(message, context = {}) {
    if (!this.shouldLog(LogLevel.INFO)) return;

    if (this.verbosity === 'minimal') {
      return;
    }

    const contextStr = this.formatContext(context);
    const displayMsg = this.formatMessage(message, context);
    console.log(`${COLORS.INFO}${contextStr} ✓ ${displayMsg}${COLORS.RESET}`);

    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      message,
      context,
      moduleName: context?.module || 'logger',
    };
    this.persistLog(entry);
  }

  success(message, context = {}) {
    if (!this.shouldLog(LogLevel.INFO)) return;

    if (this.verbosity === 'minimal') {
      return;
    }

    const contextStr = this.formatContext(context);
    console.log(`${COLORS.SUCCESS}${contextStr} ✓ ${message}${COLORS.RESET}`);

    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      message: `SUCCESS: ${message}`,
      context,
      moduleName: context?.module || 'logger',
    };
    this.persistLog(entry);
  }

  warn(message, context = {}) {
    if (!this.shouldLog(LogLevel.WARN)) return;

    const contextStr = this.formatContext(context);
    console.warn(`${COLORS.WARN}${contextStr} ⚠ ${message}${COLORS.RESET}`);

    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.WARN,
      message,
      context,
      moduleName: context?.module || 'logger',
    };
    this.persistLog(entry);
  }

  error(message, error, context = {}) {
    if (!this.shouldLog(LogLevel.ERROR)) return;

    const contextStr = this.formatContext(context);
    const errorMsg = error?.message || error?.toString() || 'Unknown error';
    console.error(`${COLORS.ERROR}${contextStr} ✗ ${message}: ${errorMsg}${COLORS.RESET}`);

    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.ERROR,
      message,
      error: errorMsg,
      context,
      moduleName: context?.module || 'logger',
    };
    this.persistLog(entry);
  }

  debug(message, context = {}) {
    if (this.verbosity !== 'debug') return;
    const contextStr = this.formatContext(context);
    console.debug(`${contextStr} [DEBUG] ${message}`);
  }

  moduleStart(moduleName, context = {}) {
    this.info(`${moduleName} starting`, { ...context, module: moduleName });
  }

  moduleComplete(moduleName, context = {}) {
    this.success(`${moduleName} completed`, { ...context, module: moduleName });
  }

  moduleFailed(moduleName, error, context = {}) {
    this.error(`${moduleName} failed`, error, { ...context, module: moduleName });
  }

  auditResults(results) {
    if (!this.shouldLog(LogLevel.INFO)) return;

    const formatIssues = (issues) => {
      if (!issues || issues.length === 0) return '';
      return issues.map(issue => `  - ${issue}`).join('\n');
    };

    const formatGood = (good) => {
      if (!good || good.length === 0) return '';
      return good.map(item => `  + ${item}`).join('\n');
    };

    const formatModule = (moduleName, data) => {
      const parts = [`\n  ${moduleName.toUpperCase()}`];

      if (data.issues && data.issues.length > 0) {
        parts.push(`\n    Issues:\n${formatIssues(data.issues)}`);
      }

      if (data.good && data.good.length > 0) {
        parts.push(`\n    Good:\n${formatGood(data.good)}`);
      }

      return parts.join('');
    };

    let output = `${COLORS.INFO}AUDIT RESULTS${COLORS.RESET}\n`;

    for (const [moduleName, data] of Object.entries(results)) {
      if (moduleName !== 'timestamp' && moduleName !== 'domain' && data && typeof data === 'object') {
        output += formatModule(moduleName, data);
      }
    }

    console.log(output);

    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      message: 'Audit results',
      context: results,
      moduleName: 'audit-results',
    };
    this.persistLog(entry);
  }

  auditSummary(domain, findings) {
    if (!this.shouldLog(LogLevel.INFO)) return;

    const lines = [];
    lines.push(`\n${COLORS.INFO}AUDIT SUMMARY - ${domain}${COLORS.RESET}`);
    lines.push('='.repeat(70));

    let totalIssues = 0;
    let totalFindings = 0;

    for (const [moduleName, data] of Object.entries(findings)) {
      if (moduleName !== 'timestamp' && moduleName !== 'domain' && data && typeof data === 'object') {
        const issueCount = data.issues ? data.issues.length : 0;
        const goodCount = data.good ? data.good.length : 0;
        const hasData = data.data && Object.keys(data.data).length > 0;

        totalIssues += issueCount;
        totalFindings += goodCount;

        lines.push(`\n${moduleName.toUpperCase()}`);
        if (data.error) {
          lines.push(`  Status: ERROR - ${data.error}`);
        } else if (hasData || issueCount > 0 || goodCount > 0) {
          lines.push(`  Status: PROCESSED`);
        } else {
          lines.push(`  Status: NO DATA`);
        }

        if (issueCount > 0) {
          lines.push(`  Issues: ${issueCount}`);
        }
        if (goodCount > 0) {
          lines.push(`  Positive Findings: ${goodCount}`);
        }
      }
    }

    lines.push(`\n${'='.repeat(70)}`);
    lines.push(`Total Issues Found: ${totalIssues}`);
    lines.push(`Total Positive Findings: ${totalFindings}`);
    lines.push(`${COLORS.RESET}`);

    console.log(lines.join('\n'));
  }

  detailedModuleLog(moduleName, result, context = {}) {
    if (!this.shouldLog(LogLevel.INFO)) return;

    const timestamp = new Date().toISOString();
    const lines = [];

    lines.push(`\n${COLORS.INFO}[DETAILED ${moduleName.toUpperCase()} REPORT]${COLORS.RESET}`);
    lines.push(`Timestamp: ${timestamp}`);

    if (context.requestId) lines.push(`Request ID: ${context.requestId}`);
    if (context.siteAuditId) lines.push(`Audit ID: ${context.siteAuditId}`);
    if (context.siteName) lines.push(`Site: ${context.siteName}`);

    lines.push('\nEXECUTION STATUS:');
    if (result.success !== undefined) {
      lines.push(`  Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    }
    if (result.error) {
      lines.push(`  Error: ${result.error}`);
    }

    if (result.data) {
      lines.push('\nDATA COLLECTED:');

      const formatValue = (val, indent = 2) => {
        const padding = ' '.repeat(indent);
        if (Array.isArray(val)) {
          return `Array[${val.length}]`;
        } else if (val === null) {
          return 'null';
        } else if (typeof val === 'object') {
          const keys = Object.keys(val).slice(0, 8);
          return `Object { ${keys.join(', ')} ${Object.keys(val).length > 8 ? '...' : ''} }`;
        } else if (typeof val === 'string' && val.length > 100) {
          return `"${val.substring(0, 100)}..."`;
        }
        return JSON.stringify(val);
      };

      if (typeof result.data === 'object') {
        const entries = Object.entries(result.data);
        if (entries.length > 0) {
          entries.forEach(([key, value]) => {
            lines.push(`  ${key}: ${formatValue(value)}`);
          });
        } else {
          lines.push('  No data fields');
        }
      } else {
        lines.push(`  Value: ${formatValue(result.data)}`);
      }
    }

    if (result.issues && Array.isArray(result.issues) && result.issues.length > 0) {
      lines.push(`\nISSUES FOUND (${result.issues.length}):`);
      result.issues.slice(0, 10).forEach((issue, idx) => {
        const issueStr = typeof issue === 'object' ? JSON.stringify(issue) : String(issue);
        lines.push(`  ${idx + 1}. ${issueStr.substring(0, 150)}${issueStr.length > 150 ? '...' : ''}`);
      });
      if (result.issues.length > 10) {
        lines.push(`  ... and ${result.issues.length - 10} more issues`);
      }
    }

    if (result.good && Array.isArray(result.good) && result.good.length > 0) {
      lines.push(`\nPOSITIVE FINDINGS (${result.good.length}):`);
      result.good.slice(0, 10).forEach((item, idx) => {
        const itemStr = typeof item === 'object' ? JSON.stringify(item) : String(item);
        lines.push(`  ${idx + 1}. ${itemStr.substring(0, 150)}${itemStr.length > 150 ? '...' : ''}`);
      });
      if (result.good.length > 10) {
        lines.push(`  ... and ${result.good.length - 10} more findings`);
      }
    }

    lines.push('');
    console.log(lines.join('\n'));

    const entry = {
      timestamp,
      level: LogLevel.INFO,
      message: `Detailed module report: ${moduleName}`,
      context: {
        moduleName,
        ...context,
        resultKeys: result.data ? Object.keys(result.data) : [],
        issueCount: result.issues ? result.issues.length : 0,
        goodCount: result.good ? result.good.length : 0,
      },
    };
    this.persistLog(entry);
  }

  findingsReport(findings) {
    if (!this.shouldLog(LogLevel.INFO)) return;

    const formatModuleData = (moduleName, data) => {
      if (!data) return 'No data';

      if (data.error) return `ERROR: ${data.error}`;

      const lines = [];

      if (data.data) {
        if (typeof data.data === 'object') {
          const dataEntries = Object.entries(data.data).filter(
            ([k, v]) => v !== null && v !== undefined && v !== ''
          );

          if (dataEntries.length > 0) {
            for (const [key, value] of dataEntries) {
              if (Array.isArray(value)) {
                lines.push(`  ${key}: [${value.length} items]`);
                value.slice(0, 3).forEach(item => {
                  if (typeof item === 'object') {
                    lines.push(`    - ${JSON.stringify(item).substring(0, 120)}${JSON.stringify(item).length > 120 ? '...' : ''}`);
                  } else {
                    lines.push(`    - ${item}`);
                  }
                });
                if (value.length > 3) lines.push(`    ... and ${value.length - 3} more`);
              } else if (typeof value === 'object') {
                lines.push(`  ${key}:`);
                const objEntries = Object.entries(value).slice(0, 5);
                objEntries.forEach(([k, v]) => {
                  const valStr = typeof v === 'object' ? JSON.stringify(v).substring(0, 80) : String(v);
                  lines.push(`    ${k}: ${valStr}`);
                });
              } else {
                lines.push(`  ${key}: ${value}`);
              }
            }
          } else {
            lines.push('  No data collected');
          }
        } else {
          lines.push(`  Result: ${data.data}`);
        }
      }

      if (data.issues && Array.isArray(data.issues) && data.issues.length > 0) {
        lines.push(`\n  Issues (${data.issues.length}):`);
        data.issues.slice(0, 5).forEach(issue => {
          const issueStr = typeof issue === 'object' ? JSON.stringify(issue).substring(0, 100) : String(issue);
          lines.push(`    ✗ ${issueStr}`);
        });
        if (data.issues.length > 5) lines.push(`    ... and ${data.issues.length - 5} more issues`);
      }

      if (data.good && Array.isArray(data.good) && data.good.length > 0) {
        lines.push(`\n  Good (${data.good.length}):`);
        data.good.slice(0, 5).forEach(item => {
          const itemStr = typeof item === 'object' ? JSON.stringify(item).substring(0, 100) : String(item);
          lines.push(`    ✓ ${itemStr}`);
        });
        if (data.good.length > 5) lines.push(`    ... and ${data.good.length - 5} more items`);
      }

      return lines.length > 0 ? lines.join('\n') : 'No findings';
    };

    let output = `${COLORS.INFO}AUDIT FINDINGS\n${'='.repeat(70)}\n`;

    for (const [moduleName, data] of Object.entries(findings)) {
      if (moduleName !== 'timestamp' && moduleName !== 'domain' && data && typeof data === 'object') {
        output += `\n[${moduleName.toUpperCase()}]\n`;
        output += formatModuleData(moduleName, data);
        output += '\n';
      }
    }

    output += `${'='.repeat(70)}${COLORS.RESET}\n`;

    console.log(output);

    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      message: 'Audit findings report',
      context: findings,
      moduleName: 'findings-report',
    };
    this.persistLog(entry);
  }

  getQueueManager() {
    return logQueueManager;
  }

  getQueueStats() {
    return logQueueManager.getQueueStats();
  }

  async flushQueue() {
    console.log('[Logger] Flushing queued logs...');
    const stats = logQueueManager.getQueueStats();
    console.log(`[Logger] Queue stats before flush:`, stats);

    await logQueueManager.flush((entry) => {
      const logData = {
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.message,
        context: {
          moduleName: entry.moduleName,
          ...entry.context,
        },
        error: entry.error || null,
        user_id: entry.userId || null,
        publisher_id: entry.publisherId || null,
        action: entry.action || 'log',
        entity_type: entry.entityType || 'worker_process',
      };

      const client = getSupabaseClient();
      if (!client) {
        throw new Error('Supabase client not available for flushing queue');
      }

      return client.from('audit_logs').insert([logData]);
    });

    const finalStats = logQueueManager.getQueueStats();
    console.log('[Logger] Queue stats after flush:', finalStats);
  }
}

module.exports = new Logger();
module.exports.logQueueManager = logQueueManager;
