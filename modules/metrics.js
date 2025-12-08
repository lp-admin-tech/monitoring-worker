/**
 * Simple Prometheus-style metrics collector for the site monitoring worker
 * Provides basic counters, gauges, and histograms for observability
 */

class MetricsCollector {
    constructor() {
        this.metrics = {
            // Counters
            audit_jobs_processed_total: { type: 'counter', value: 0, help: 'Total number of audit jobs processed' },
            audit_jobs_failed_total: { type: 'counter', value: 0, help: 'Total number of audit jobs that failed' },

            // Gauges
            active_audit_jobs: { type: 'gauge', value: 0, help: 'Number of currently active audit jobs' },
            memory_usage_bytes: { type: 'gauge', value: 0, help: 'Current memory usage in bytes' },
            uptime_seconds: { type: 'gauge', value: 0, help: 'Worker uptime in seconds' },

            // Histograms (using buckets for duration)
            audit_job_duration_seconds: {
                type: 'histogram',
                buckets: [10, 30, 60, 120, 300, 600],
                counts: [0, 0, 0, 0, 0, 0, 0], // +1 for +Inf bucket
                sum: 0,
                count: 0,
                help: 'Audit job duration in seconds'
            },
        };

        this.startTime = Date.now();
    }

    // Counter operations
    inc(metricName, value = 1) {
        if (this.metrics[metricName] && this.metrics[metricName].type === 'counter') {
            this.metrics[metricName].value += value;
        }
    }

    // Gauge operations
    set(metricName, value) {
        if (this.metrics[metricName] && this.metrics[metricName].type === 'gauge') {
            this.metrics[metricName].value = value;
        }
    }

    gauge(metricName, value) {
        this.set(metricName, value);
    }

    incGauge(metricName, value = 1) {
        if (this.metrics[metricName] && this.metrics[metricName].type === 'gauge') {
            this.metrics[metricName].value += value;
        }
    }

    decGauge(metricName, value = 1) {
        if (this.metrics[metricName] && this.metrics[metricName].type === 'gauge') {
            this.metrics[metricName].value -= value;
        }
    }

    // Histogram operations
    observe(metricName, value) {
        const metric = this.metrics[metricName];
        if (metric && metric.type === 'histogram') {
            metric.sum += value;
            metric.count += 1;

            // Find the bucket and increment
            for (let i = 0; i < metric.buckets.length; i++) {
                if (value <= metric.buckets[i]) {
                    metric.counts[i] += 1;
                    break;
                }
                if (i === metric.buckets.length - 1) {
                    metric.counts[i + 1] += 1; // +Inf bucket
                }
            }
        }
    }

    // Update memory usage
    updateMemoryUsage() {
        const memUsage = process.memoryUsage();
        this.set('memory_usage_bytes', memUsage.heapUsed);
        this.set('uptime_seconds', Math.round((Date.now() - this.startTime) / 1000));
    }

    // Generate Prometheus-format output
    toPrometheusFormat() {
        this.updateMemoryUsage();

        const lines = [];

        for (const [name, metric] of Object.entries(this.metrics)) {
            // Add help line
            lines.push(`# HELP ${name} ${metric.help}`);
            lines.push(`# TYPE ${name} ${metric.type}`);

            if (metric.type === 'counter' || metric.type === 'gauge') {
                lines.push(`${name} ${metric.value}`);
            } else if (metric.type === 'histogram') {
                // Histogram format
                let cumulative = 0;
                for (let i = 0; i < metric.buckets.length; i++) {
                    cumulative += metric.counts[i];
                    lines.push(`${name}_bucket{le="${metric.buckets[i]}"} ${cumulative}`);
                }
                cumulative += metric.counts[metric.counts.length - 1];
                lines.push(`${name}_bucket{le="+Inf"} ${cumulative}`);
                lines.push(`${name}_sum ${metric.sum}`);
                lines.push(`${name}_count ${metric.count}`);
            }

            lines.push('');
        }

        return lines.join('\n');
    }

    // Get metrics as JSON
    toJSON() {
        this.updateMemoryUsage();
        const result = {};

        for (const [name, metric] of Object.entries(this.metrics)) {
            if (metric.type === 'counter' || metric.type === 'gauge') {
                result[name] = metric.value;
            } else if (metric.type === 'histogram') {
                result[name] = {
                    sum: metric.sum,
                    count: metric.count,
                    buckets: metric.buckets.reduce((acc, bucket, i) => {
                        acc[bucket] = metric.counts[i];
                        return acc;
                    }, {})
                };
            }
        }

        return result;
    }

    // Reset all metrics (useful for testing)
    reset() {
        for (const metric of Object.values(this.metrics)) {
            if (metric.type === 'counter' || metric.type === 'gauge') {
                metric.value = 0;
            } else if (metric.type === 'histogram') {
                metric.sum = 0;
                metric.count = 0;
                metric.counts = metric.counts.map(() => 0);
            }
        }
    }
}

// Singleton instance
const metrics = new MetricsCollector();

module.exports = metrics;
module.exports.MetricsCollector = MetricsCollector;
