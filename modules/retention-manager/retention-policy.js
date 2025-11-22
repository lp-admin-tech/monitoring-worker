/**
 * Retention Policy Configuration
 * Defines how long different types of data should be kept
 */
const RETENTION_POLICIES = {
    RAW_AUDIT_DATA: {
        days: 365, // 1 year
        description: 'Full raw audit data including HTML snapshots and large JSON blobs'
    },
    DAILY_AGGREGATES: {
        days: 730, // 2 years
        description: 'Daily summary statistics'
    },
    ALERTS: {
        days: 1095, // 3 years
        description: 'Alert history and notifications'
    },
    LOGS: {
        days: 90, // 3 months
        description: 'System operation logs'
    }
};

module.exports = RETENTION_POLICIES;
