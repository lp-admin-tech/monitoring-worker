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

class Logger {
  constructor() {
    this.minLevel = LogLevel.DEBUG;
  }

  setMinLevel(level) {
    this.minLevel = level;
  }

  shouldLog(level) {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
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

  debug(message, context, userId) {
    if (!this.shouldLog(LogLevel.DEBUG)) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.DEBUG,
      message,
      context: context || {},
      userId,
      moduleName: context?.moduleName || 'logger',
    };

    console.debug(`[${entry.timestamp}] ${message}`, context);
    this.persistLog(entry);
  }

  info(message, context, userId) {
    if (!this.shouldLog(LogLevel.INFO)) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      message,
      context: context || {},
      userId,
      moduleName: context?.moduleName || 'logger',
    };

    console.log(`[${entry.timestamp}] ${message}`, context);
    this.persistLog(entry);
  }

  warn(message, context, userId, publisherId) {
    if (!this.shouldLog(LogLevel.WARN)) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.WARN,
      message,
      context: context || {},
      userId,
      publisherId,
      moduleName: context?.moduleName || 'logger',
    };

    console.warn(`[${entry.timestamp}] ${message}`, context);
    this.persistLog(entry);
  }

  error(message, error, context, userId, publisherId) {
    if (!this.shouldLog(LogLevel.ERROR)) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.ERROR,
      message,
      error: error?.message || error?.toString(),
      context: context || {},
      userId,
      publisherId,
      moduleName: context?.moduleName || 'logger',
    };

    console.error(`[${entry.timestamp}] ${message}`, error, context);
    this.persistLog(entry);
  }

  moduleAction(moduleName, action, context, userId, publisherId) {
    const message = `${action}`;
    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      message,
      context: { ...context, moduleName, action },
      userId,
      publisherId,
      moduleName,
    };

    console.log(`[${entry.timestamp}] [${moduleName}] ${message}`, context);
    this.persistLog(entry);
  }
}

module.exports = new Logger();
