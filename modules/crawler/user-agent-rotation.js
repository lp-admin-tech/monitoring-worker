const userAgents = [
  {
    agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    type: 'chrome-windows',
    platform: 'windows',
  },
  {
    agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    type: 'firefox-windows',
    platform: 'windows',
  },
  {
    agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    type: 'chrome-mac',
    platform: 'mac',
  },
  {
    agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    type: 'safari-mac',
    platform: 'mac',
  },
  {
    agent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    type: 'chrome-linux',
    platform: 'linux',
  },
  {
    agent: 'Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0',
    type: 'firefox-linux',
    platform: 'linux',
  },
  {
    agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
    type: 'safari-ios',
    platform: 'mobile',
  },
  {
    agent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    type: 'chrome-android',
    platform: 'mobile',
  },
  {
    agent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    type: 'chrome-android-pixel',
    platform: 'mobile',
  }
];

function generateUserAgent(options = {}) {
  const { platform = null, type = null } = options;

  let candidates = userAgents;

  if (platform) {
    candidates = candidates.filter(ua => ua.platform === platform);
  }

  if (type) {
    candidates = candidates.filter(ua => ua.type === type);
  }

  if (candidates.length === 0) {
    candidates = userAgents;
  }

  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  return selected;
}

function getRandomUserAgent() {
  return generateUserAgent().agent;
}

module.exports = {
  generateUserAgent,
  getRandomUserAgent,
  userAgents,
};
