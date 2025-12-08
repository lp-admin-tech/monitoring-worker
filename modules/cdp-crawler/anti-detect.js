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
    await this.patchUserAgentData(profile);
    await this.patchDocumentVisibility(); // NEW: from crawl4ai
    await this.patchCanvas();
    await this.patchWebGL(profile);
    await this.patchPlugins();
    await this.patchPermissions();
    await this.patchChrome();
    await this.patchCloudflareBypass();

    logger.info('[AntiDetect] All patches applied');
  }

  /**
   * Patch userAgentData - modern bot detection uses this
   */
  async patchUserAgentData(profile) {
    const brands = profile.brands || [
      { brand: 'Google Chrome', version: '120' },
      { brand: 'Chromium', version: '120' },
      { brand: 'Not_A Brand', version: '24' }
    ];
    const platform = profile.platform || 'Windows';
    const mobile = profile.isMobile || false;

    await this.Runtime.evaluate({
      expression: `
        // Modern Chrome exposes navigator.userAgentData
        if (!navigator.userAgentData) {
          Object.defineProperty(navigator, 'userAgentData', {
            get: () => ({
              brands: ${JSON.stringify(brands)},
              mobile: ${mobile},
              platform: '${platform}',
              getHighEntropyValues: async (hints) => ({
                brands: ${JSON.stringify(brands)},
                mobile: ${mobile},
                platform: '${platform}',
                platformVersion: '10.0.0',
                architecture: 'x86',
                bitness: '64',
                model: '',
                uaFullVersion: '120.0.6099.109'
              })
            }),
            configurable: true
          });
        }
      `
    });
  }

  /**
   * Cloudflare-specific bypass patches
   */
  async patchCloudflareBypass() {
    await this.Runtime.evaluate({
      expression: `
        // Cloudflare checks for automation via Notification API
        if (typeof Notification === 'undefined') {
          window.Notification = {
            permission: 'default',
            requestPermission: () => Promise.resolve('default')
          };
        }
        
        // Cloudflare checks for browser automation markers
        delete window.callPhantom;
        delete window._phantom;
        delete window.__nightmare;
        delete window.domAutomation;
        delete window.domAutomationController;
        delete window._selenium;
        delete window._Selenium_IDE_Recorder;
        delete window.callSelenium;
        delete window.__webdriver_evaluate;
        delete window.__selenium_unwrapped;
        delete window.__webdriver_script_function;
        delete window.__webdriver_script_func;
        delete window.__webdriver_script_fn;
        delete window.__fxdriver_evaluate;
        delete window.__driver_unwrapped;
        delete window.__webdriver_unwrapped;
        delete window.__driver_evaluate;
        delete window.__selenium_evaluate;
        delete window.__last_wm_id;
        delete document.__webdriver_evaluate;
        delete document.__selenium_evaluate;
        delete document.__webdriver_script_function;
        
        // Override toString for functions to hide modifications
        const origToString = Function.prototype.toString;
        Function.prototype.toString = function() {
          if (this === navigator.permissions.query) {
            return 'function query() { [native code] }';
          }
          return origToString.call(this);
        };
      `
    });
  }

  /**
   * Patch document visibility - makes page appear active/visible
   * From crawl4ai navigator_overrider.js
   */
  async patchDocumentVisibility() {
    await this.Runtime.evaluate({
      expression: `
        // Make document appear visible (not hidden/backgrounded)
        Object.defineProperty(document, 'hidden', {
          get: () => false,
          configurable: true
        });
        
        Object.defineProperty(document, 'visibilityState', {
          get: () => 'visible',
          configurable: true
        });
        
        // Prevent visibility change detection
        const origAddEventListener = document.addEventListener;
        document.addEventListener = function(type, listener, options) {
          if (type === 'visibilitychange') {
            return; // Ignore visibility change listeners
          }
          return origAddEventListener.call(this, type, listener, options);
        };
      `
    });
  }

  /**
   * Remove overlay elements (popups, modals, cookie banners)
   * From crawl4ai remove_overlay_elements.js
   */
  async removeOverlays() {
    await this.Runtime.evaluate({
      expression: `
        (async () => {
          const isVisible = (elem) => {
            const style = window.getComputedStyle(elem);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          };

          // Common selectors for popups and overlays
          const closeSelectors = [
            'button[class*="close" i]',
            'button[class*="dismiss" i]',
            'button[aria-label*="close" i]',
            'a[class*="close" i]',
            'span[class*="close" i]'
          ];

          const overlaySelectors = [
            '[class*="cookie-banner" i]',
            '[class*="cookie-consent" i]',
            '[class*="newsletter" i]',
            '[class*="popup" i]',
            '[class*="modal" i]',
            '[class*="overlay" i]',
            '[role="dialog"]',
            '[role="alertdialog"]'
          ];

          // Try clicking close buttons
          for (const selector of closeSelectors) {
            const buttons = document.querySelectorAll(selector);
            for (const button of buttons) {
              if (isVisible(button)) {
                try {
                  button.click();
                  await new Promise(r => setTimeout(r, 100));
                } catch (e) {}
              }
            }
          }

          // Remove overlay elements
          for (const selector of overlaySelectors) {
            const elements = document.querySelectorAll(selector);
            elements.forEach(elem => {
              if (isVisible(elem)) elem.remove();
            });
          }

          // Remove high z-index fixed/absolute elements that cover screen
          const allElements = document.querySelectorAll('*');
          for (const elem of allElements) {
            const style = window.getComputedStyle(elem);
            const zIndex = parseInt(style.zIndex);
            const position = style.position;
            
            if (
              isVisible(elem) &&
              (zIndex > 999 || position === 'fixed') &&
              (elem.offsetWidth > window.innerWidth * 0.5 ||
               elem.offsetHeight > window.innerHeight * 0.5)
            ) {
              elem.remove();
            }
          }

          // Unlock scrolling
          document.body.style.overflow = 'auto';
          document.body.style.marginRight = '0px';
          document.body.style.paddingRight = '0px';
        })();
      `
    });
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
