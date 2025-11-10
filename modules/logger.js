const supabase = require('./supabase-client');

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
    try {
      await supabase.insert('audit_logs', {
        user_id: entry.userId,
        action: entry.level,
        entity_type: entry.moduleName || 'worker',
        timestamp: entry.timestamp,
        details: {
          message: entry.message,
          error: entry.error,
          ...entry.context,
        },
        context: {
          level: entry.level,
          message: entry.message,
          ...entry.context,
        },
      });
    } catch (err) {
      console.error('Failed to persist log:', err);
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
