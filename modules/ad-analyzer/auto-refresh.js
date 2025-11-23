const logger = require('../logger');

class AutoRefreshDetector {
  constructor(config = {}) {
    this.refreshThreshold = config.refreshThreshold || 15000;
    this.minSequentialCalls = config.minSequentialCalls || 2;
  }

  groupRequestsBySlot(networkRequests) {
    const slotGroups = new Map();

    for (const request of networkRequests) {
      if (!request.url || !request.timestamp) continue;

      const slotId = this.extractSlotIdentifier(request.url);
      if (!slotId) continue;

      if (!slotGroups.has(slotId)) {
        slotGroups.set(slotId, []);
      }
      slotGroups.get(slotId).push(request);
    }

    return slotGroups;
  }

  extractSlotIdentifier(url) {
    const patterns = [
      /slot[_=]?(\d+)/i,
      /adslot[_=]?(\w+)/i,
      /div[_=]?(\w+)/i,
      /placement[_=]?(\w+)/i,
      /(?:^|[/?&])(\d{15,})/,
      /\/ads?\/(\w+)/i,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1] || match[0];
    }

    return null;
  }

  detectSequentialCalls(slotRequests) {
    if (!Array.isArray(slotRequests) || slotRequests.length < this.minSequentialCalls) {
      return [];
    }

    const calls = slotRequests
      .filter(r => r.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);

    const sequential = [];

    for (let i = 1; i < calls.length; i++) {
      const timeDiff = calls[i].timestamp - calls[i - 1].timestamp;
      if (timeDiff > 0 && timeDiff <= this.refreshThreshold) {
        sequential.push({
          callIndex: i,
          timeSincePrevious: timeDiff,
          url: calls[i].url,
          previousUrl: calls[i - 1].url,
        });
      }
    }

    return sequential;
  }

  analyzeRefreshPatterns(mutationLog) {
    const adRefreshEvents = [];

    if (!Array.isArray(mutationLog)) {
      return adRefreshEvents;
    }

    for (const event of mutationLog) {
      if (!event.timestamp || !event.type) continue;

      if (
        event.type === 'ADDED' &&
        (event.target?.includes('ad') || event.target?.includes('slot'))
      ) {
        adRefreshEvents.push({
          type: 'AD_ADDED',
          timestamp: event.timestamp,
          selector: event.target,
        });
      }

      if (event.type === 'REMOVED' && event.target?.includes('ad')) {
        adRefreshEvents.push({
          type: 'AD_REMOVED',
          timestamp: event.timestamp,
          selector: event.target,
        });
      }
    }

    return this.groupEventsByTimeWindow(adRefreshEvents);
  }

  groupEventsByTimeWindow(events, windowSize = 5000) {
    if (events.length === 0) return [];

    const windows = [];
    let currentWindow = [events[0]];
    let windowStart = events[0].timestamp;

    for (let i = 1; i < events.length; i++) {
      const timeSinceWindowStart = events[i].timestamp - windowStart;

      if (timeSinceWindowStart <= windowSize) {
        currentWindow.push(events[i]);
      } else {
        if (currentWindow.length > 0) {
          windows.push({
            startTime: windowStart,
            endTime: currentWindow[currentWindow.length - 1].timestamp,
            eventCount: currentWindow.length,
            events: currentWindow,
          });
        }
        currentWindow = [events[i]];
        windowStart = events[i].timestamp;
      }
    }

    if (currentWindow.length > 0) {
      windows.push({
        startTime: windowStart,
        endTime: currentWindow[currentWindow.length - 1].timestamp,
        eventCount: currentWindow.length,
        events: currentWindow,
      });
    }

    return windows;
  }

  calculateRefreshRate(sequentialCalls) {
    if (sequentialCalls.length < 2) return 0;

    const intervals = [];
    for (let i = 1; i < sequentialCalls.length; i++) {
      const timeDiff =
        sequentialCalls[i].callIndex - sequentialCalls[i - 1].callIndex;
      intervals.push(timeDiff);
    }

    const avgInterval =
      intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return 1000 / avgInterval;
  }

  identifyRefreshPatterns(networkRequests, mutationLog) {
    const patterns = [];

    const slotGroups = this.groupRequestsBySlot(networkRequests);

    for (const [slotId, requests] of slotGroups.entries()) {
      const sequential = this.detectSequentialCalls(requests);
      if (sequential.length >= 2) {
        const refreshRate = this.calculateRefreshRate(sequential);
        patterns.push({
          slotId,
          detectionMethod: 'network_requests',
          refreshRate: parseFloat(refreshRate.toFixed(2)),
          sequentialCalls: sequential.length + 1,
          averageInterval: sequential.reduce((sum, s) => sum + s.timeSincePrevious, 0) / sequential.length,
          isAutoRefresh: true,
        });
      }
    }

    const mutationPatterns = this.analyzeRefreshPatterns(mutationLog);
    for (const window of mutationPatterns) {
      if (window.eventCount >= 3) {
        patterns.push({
          timeWindow: {
            start: window.startTime,
            end: window.endTime,
            duration: window.endTime - window.startTime,
          },
          detectionMethod: 'dom_mutation',
          eventCount: window.eventCount,
          isAutoRefresh: true,
        });
      }
    }

    return patterns;
  }

  generateReport(crawlData) {
    try {
      const networkRequests = (crawlData.har?.log?.entries || []).map(e => ({
        url: e.request.url,
        method: e.request.method,
        timestamp: new Date(e.startedDateTime).getTime(),
      }));

      const refreshPatterns = this.identifyRefreshPatterns(
        networkRequests,
        crawlData.mutationLog || []
      );

      return {
        timestamp: new Date().toISOString(),
        refreshPatterns,
        summary: {
          totalPatterns: refreshPatterns.length,
          autoRefreshDetected: refreshPatterns.length > 0,
          averageRefreshRate:
            refreshPatterns.length > 0
              ? (
                refreshPatterns.reduce((sum, p) => sum + (p.refreshRate || 0), 0) /
                refreshPatterns.length
              ).toFixed(2)
              : 0,
          criticalRefreshCount: refreshPatterns.filter(
            p => p.averageInterval < 30000 // Industry standard: < 30s is critical MFA
          ).length,
          warningRefreshCount: refreshPatterns.filter(
            p => p.averageInterval >= 30000 && p.averageInterval < 60000
          ).length,
        },
      };
    } catch (error) {
      logger.error('Error generating auto-refresh report', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = AutoRefreshDetector;
