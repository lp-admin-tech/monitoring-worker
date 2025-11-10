let supabase;
try {
  supabase = require('./supabase-client');
} catch (err) {
  console.warn('Supabase client not available for logging');
  supabase = null;
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
    this.verbosity = process.env.LOG_VERBOSITY || 'normal';
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
    if (!supabase) return;

    try {
      const logData = {
        action: entry.moduleName || 'LOG_ENTRY',
        entity_type: 'SYSTEM_LOG',
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
      };

      supabase.insert('audit_logs', logData).catch(err => {
        console.error('[Logger] Failed to persist log:', err.message);
      });
    } catch (err) {
      console.error('[Logger] Failed to persist log:', err.message);
    }
  }

  info(message, context = {}) {
    if (!this.shouldLog(LogLevel.INFO)) return;

    const contextStr = this.formatContext(context);
    const displayMsg = this.formatMessage(message, this.verbosity === 'minimal' ? {} : context);
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

  findingsReport(findings) {
    if (!this.shouldLog(LogLevel.INFO)) return;

    const formatFindingList = (items) => {
      if (!items || items.length === 0) return '';
      return items.map(item => `      "${item}"`).join(',\n');
    };

    let output = '(system.log){\n';

    for (const [moduleName, data] of Object.entries(findings)) {
      if (moduleName !== 'timestamp' && moduleName !== 'domain' && data && typeof data === 'object') {
        output += `  module(${moduleName}){\n`;

        if (data.issues && data.issues.length > 0) {
          output += '    found(issues:[\n';
          output += formatFindingList(data.issues);
          output += '\n    ])\n';
        }

        if (data.good && data.good.length > 0) {
          output += '    good:[\n';
          output += formatFindingList(data.good);
          output += '\n    ]\n';
        }

        output += '  }\n\n';
      }
    }

    output += '}\n';

    console.log(`${COLORS.INFO}${output}${COLORS.RESET}`);

    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      message: 'Audit findings report',
      context: findings,
      moduleName: 'findings-report',
    };
    this.persistLog(entry);
  }
}

module.exports = new Logger();
