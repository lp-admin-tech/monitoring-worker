const logger = require('../logger');

class HARRecorder {
  constructor() {
    this.entries = [];
    this.startTime = Date.now();
  }

  addRequest(request) {
    this.entries.push({
      type: 'request',
      timestamp: Date.now(),
      method: request.method(),
      url: request.url(),
      headers: request.allHeaders(),
      postData: request.postDataJSON(),
    });
  }

  addResponse(response, request) {
    this.entries.push({
      type: 'response',
      timestamp: Date.now(),
      url: response.url(),
      status: response.status(),
      statusText: response.statusText(),
      headers: response.allHeaders(),
      fromCache: response.fromCache(),
      fromServiceWorker: response.fromServiceWorker(),
    });
  }

  getHAR() {
    return {
      log: {
        version: '1.2.0',
        creator: {
          name: 'site-monitoring-crawler',
          version: '1.0.0',
        },
        entries: this.entries,
        totalTime: Date.now() - this.startTime,
      },
    };
  }
}

function setupNetworkLogging(page) {
  const harRecorder = new HARRecorder();

  page.on('request', (request) => {
    try {
      harRecorder.addRequest(request);
    } catch (error) {
      logger.debug('Failed to record request', { error });
    }
  });

  page.on('response', (response) => {
    try {
      const request = response.request();
      harRecorder.addResponse(response, request);
    } catch (error) {
      logger.debug('Failed to record response', { error });
    }
  });

  return harRecorder;
}

module.exports = {
  setupNetworkLogging,
  HARRecorder,
};
