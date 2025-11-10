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
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.message,
        context: entry.context,
        error: entry.error,
        user_id: entry.userId,
        publisher_id: entry.publisherId,
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
      context,
      userId,
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
      context,
      userId,
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
      context,
      userId,
      publisherId,
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
      context,
      userId,
      publisherId,
    };

    console.error(`[${entry.timestamp}] ${message}`, error, context);
    this.persistLog(entry);
  }
}

module.exports = new Logger();
