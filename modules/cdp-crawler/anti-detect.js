/**
 * Anti-Detect Patches
 * Spoofs browser fingerprint to avoid bot detection
 */

const logger = require('../logger');

class AntiDetect {
    constructor(client) {
        this.client = client;
        this.Runtime = client.Runtime;
        this.Emulation = client.Emulation;
    }

    async applyAll(profile = {}) {
        logger.info('[AntiDetect] Applying stealth patches...');

        await this.patchWebdriver();
        await this.patchNavigator(profile);
        await this.patchCanvas();
        await this.patchWebGL(profile);
        await this.patchPlugins();
        await this.patchPermissions();
        await this.patchChrome();

        logger.info('[AntiDetect] All patches applied');
    }

    async patchWebdriver() {
        await this.Runtime.evaluate({
            expression: `
        // Remove webdriver flag
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
          configurable: true
        });
        
        // Remove webdriver from prototype chain
        delete Navigator.prototype.webdriver;
        
        // Override permissions query for webdriver
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
      `
        });
    }

    async patchNavigator(profile) {
        const languages = profile.languages || ['en-US', 'en'];
        const platform = profile.platform || 'Win32';
        const hardwareConcurrency = profile.cores || 8;
        const deviceMemory = profile.memory || 8;
        const maxTouchPoints = profile.isMobile ? 5 : 0;

        await this.Runtime.evaluate({
            expression: `
        Object.defineProperty(navigator, 'languages', {
          get: () => ${JSON.stringify(languages)},
          configurable: true
        });
        
        Object.defineProperty(navigator, 'platform', {
          get: () => '${platform}',
          configurable: true
        });
        
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => ${hardwareConcurrency},
          configurable: true
        });
        
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => ${deviceMemory},
          configurable: true
        });
        
        Object.defineProperty(navigator, 'maxTouchPoints', {
          get: () => ${maxTouchPoints},
          configurable: true
        });
        
        // Connection API
        Object.defineProperty(navigator, 'connection', {
          get: () => ({
            effectiveType: '4g',
            rtt: 50,
            downlink: 10,
            saveData: false
          }),
          configurable: true
        });
      `
        });
    }

    async patchCanvas() {
        await this.Runtime.evaluate({
            expression: `
        // Add subtle noise to canvas fingerprinting
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(type) {
          // Detect fingerprinting attempt (small canvas)
          if (this.width < 300 && this.height < 100) {
            const ctx = this.getContext('2d');
            if (ctx) {
              // Add subtle noise
              const imageData = ctx.getImageData(0, 0, this.width, this.height);
              const pixels = imageData.data;
              for (let i = 0; i < pixels.length; i += 4) {
                // Add tiny random noise to RGB
                pixels[i] = Math.min(255, pixels[i] + (Math.random() * 2 - 1));
                pixels[i + 1] = Math.min(255, pixels[i + 1] + (Math.random() * 2 - 1));
                pixels[i + 2] = Math.min(255, pixels[i + 2] + (Math.random() * 2 - 1));
              }
              ctx.putImageData(imageData, 0, 0);
            }
          }
          return originalToDataURL.apply(this, arguments);
        };
        
        // Also patch getImageData
        const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = function() {
          const imageData = originalGetImageData.apply(this, arguments);
          // Add subtle noise
          for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i] = Math.min(255, imageData.data[i] + (Math.random() * 0.5 - 0.25));
          }
          return imageData;
        };
      `
        });
    }

    async patchWebGL(profile) {
        const vendor = profile.webglVendor || 'Google Inc. (Intel)';
        const renderer = profile.webglRenderer || 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';

        await this.Runtime.evaluate({
            expression: `
        const getParameterProxy = new Proxy(WebGLRenderingContext.prototype.getParameter, {
          apply: function(target, thisArg, args) {
            // UNMASKED_VENDOR_WEBGL
            if (args[0] === 37445) return '${vendor}';
            // UNMASKED_RENDERER_WEBGL
            if (args[0] === 37446) return '${renderer}';
            return Reflect.apply(target, thisArg, args);
          }
        });
        
        WebGLRenderingContext.prototype.getParameter = getParameterProxy;
        
        // Also patch WebGL2
        if (typeof WebGL2RenderingContext !== 'undefined') {
          WebGL2RenderingContext.prototype.getParameter = getParameterProxy;
        }
      `
        });
    }

    async patchPlugins() {
        await this.Runtime.evaluate({
            expression: `
        // Create realistic plugin array
        const mockPlugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
        ];
        
        const pluginArray = {
          length: 3,
          item: (i) => mockPlugins[i],
          namedItem: (name) => mockPlugins.find(p => p.name === name),
          refresh: () => {},
          [Symbol.iterator]: function* () {
            for (let i = 0; i < this.length; i++) yield mockPlugins[i];
          }
        };
        
        // Add index access
        mockPlugins.forEach((plugin, i) => pluginArray[i] = plugin);
        
        Object.defineProperty(navigator, 'plugins', {
          get: () => pluginArray,
          configurable: true
        });
        
        // Mock mimeTypes
        Object.defineProperty(navigator, 'mimeTypes', {
          get: () => ({
            length: 2,
            item: (i) => [
              { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
              { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' }
            ][i]
          }),
          configurable: true
        });
      `
        });
    }

    async patchPermissions() {
        await this.Runtime.evaluate({
            expression: `
        const originalQuery = Permissions.prototype.query;
        Permissions.prototype.query = (parameters) => {
          if (parameters.name === 'notifications') {
            return Promise.resolve({ state: Notification.permission });
          }
          return originalQuery(parameters);
        };
      `
        });
    }

    async patchChrome() {
        await this.Runtime.evaluate({
            expression: `
        // Create window.chrome object
        window.chrome = {
          runtime: {
            connect: () => {},
            sendMessage: () => {},
            onMessage: { addListener: () => {} }
          },
          loadTimes: () => ({
            requestTime: Date.now() / 1000 - Math.random() * 10,
            startLoadTime: Date.now() / 1000 - Math.random() * 5,
            commitLoadTime: Date.now() / 1000 - Math.random() * 3,
            finishDocumentLoadTime: Date.now() / 1000 - Math.random() * 1,
            finishLoadTime: Date.now() / 1000,
            firstPaintTime: Date.now() / 1000 - Math.random() * 0.5,
            firstPaintAfterLoadTime: 0,
            navigationType: 'Other'
          }),
          csi: () => ({
            onloadT: Date.now(),
            pageT: Math.random() * 1000,
            startE: Date.now() - Math.random() * 1000,
            tran: 15
          }),
          app: {
            isInstalled: false,
            InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
            RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
          }
        };
      `
        });
    }
}

module.exports = AntiDetect;
