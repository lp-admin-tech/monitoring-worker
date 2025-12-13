/**
 * Human Behavior Simulator
 * Simulates realistic human interaction patterns
 */

const logger = require('../logger');

class HumanSimulator {
    constructor(client) {
        this.client = client;
        this.Input = client?.Input;
        this.Runtime = client?.Runtime;
        this.DOM = client?.DOM;
    }

    /**
     * Check if browser connection is still valid
     */
    isConnected() {
        return !!(this.client && this.Runtime && this.Input);
    }

    // Bezier curve for easing (standard CSS ease-in-out)
    bezierEase(t) {
        // Approximate cubic-bezier(0.42, 0, 0.58, 1)
        return t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // Random delay with human variance
    async wait(min = 100, max = 500) {
        const delay = min + Math.random() * (max - min);
        await new Promise(r => setTimeout(r, delay));
    }


    // Bezier curve mouse movement (not linear!)
    async moveMouse(startX, startY, endX, endY, steps = 25) {
        for (let i = 0; i <= steps; i++) {
            const t = this.bezierEase(i / steps);

            // Add slight random wobble for realism
            const wobbleX = (Math.random() - 0.5) * 3;
            const wobbleY = (Math.random() - 0.5) * 3;

            const x = startX + (endX - startX) * t + wobbleX;
            const y = startY + (endY - startY) * t + wobbleY;

            await this.Input.dispatchMouseEvent({
                type: 'mouseMoved',
                x: Math.round(x),
                y: Math.round(y)
            });

            await this.wait(8, 25);
        }
    }

    // Human-like click
    async click(x, y) {
        // Move to target first from random nearby position
        const startX = x - 50 + Math.random() * 100;
        const startY = y - 50 + Math.random() * 100;
        await this.moveMouse(startX, startY, x, y);

        // Small pause before click (human reaction time)
        await this.wait(50, 150);

        // Mouse down
        await this.Input.dispatchMouseEvent({
            type: 'mousePressed',
            x,
            y,
            button: 'left',
            clickCount: 1
        });

        // Hold duration (humans don't click instantly)
        await this.wait(50, 120);

        // Mouse up
        await this.Input.dispatchMouseEvent({
            type: 'mouseReleased',
            x,
            y,
            button: 'left',
            clickCount: 1
        });

        await this.wait(100, 300);
    }

    // Click element by selector
    async clickElement(selector) {
        const { result } = await this.Runtime.evaluate({
            expression: `
        (() => {
          const el = document.querySelector('${selector}');
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            visible: rect.width > 0 && rect.height > 0
          };
        })()
      `,
            returnByValue: true
        });

        if (result.value && result.value.visible) {
            await this.click(result.value.x, result.value.y);
            return true;
        }
        return false;
    }

    // Smooth scroll with variance
    async scroll(distance, duration = 2000) {
        const steps = Math.ceil(duration / 50);
        const stepDistance = distance / steps;

        for (let i = 0; i < steps; i++) {
            const t = this.bezierEase(i / steps);
            const scrollAmount = Math.round(stepDistance * (1 + (Math.random() - 0.5) * 0.2));

            await this.Runtime.evaluate({
                expression: `window.scrollBy(0, ${scrollAmount})`
            });

            await this.wait(30, 70);

            // Random pause (reading behavior) - 10% chance
            if (Math.random() < 0.1) {
                await this.wait(500, 2000);
            }
        }
    }

    // Scroll to bottom with random pauses
    async scrollToBottom(options = {}) {
        // Connection check first
        if (!this.isConnected()) {
            logger.warn('[HumanSim] Cannot scroll - not connected');
            return;
        }

        const { pauseChance = 0.15, maxPauseDuration = 3000 } = options;

        let result;
        try {
            const evalResult = await this.Runtime.evaluate({
                expression: `({
            viewportHeight: window.innerHeight,
            totalHeight: document.body.scrollHeight,
            currentScroll: window.scrollY
          })`,
                returnByValue: true
            });
            result = evalResult.result;
        } catch (e) {
            logger.warn('[HumanSim] Failed to get page dimensions:', e.message);
            return;
        }

        // Handle case where browser context is closed or page crashed
        if (!result || !result.value) {
            logger.warn('[HumanSim] Failed to get page dimensions - browser context may be closed');
            return;
        }

        const { viewportHeight = 1080, totalHeight = 0 } = result.value;
        let currentY = result.value.currentScroll || 0;

        logger.info(`[HumanSim] Scrolling page: ${totalHeight}px total, ${viewportHeight}px viewport`);

        while (currentY < totalHeight - viewportHeight) {
            // Scroll one "chunk" (random portion of viewport)
            const scrollAmount = viewportHeight * (0.6 + Math.random() * 0.4);
            await this.scroll(scrollAmount, 1000 + Math.random() * 500);

            currentY += scrollAmount;

            // Random reading pause
            if (Math.random() < pauseChance) {
                const pauseDuration = 500 + Math.random() * maxPauseDuration;
                logger.debug(`[HumanSim] Reading pause: ${Math.round(pauseDuration)}ms`);
                await this.wait(pauseDuration, pauseDuration + 500);
            }

            // Update total height (in case of infinite scroll)
            const { result: updated } = await this.Runtime.evaluate({
                expression: `document.body.scrollHeight`,
                returnByValue: true
            });

            if (updated.value > totalHeight) {
                logger.debug('[HumanSim] Page grew (infinite scroll detected)');
            }
        }

        logger.info('[HumanSim] Reached bottom of page');
    }

    // Full page scroll with callback for each level
    async scrollAndCapture(captureCallback) {
        // Connection check first
        if (!this.isConnected()) {
            logger.warn('[HumanSim] Cannot scroll and capture - not connected');
            return [];
        }

        let result;
        try {
            const evalResult = await this.Runtime.evaluate({
                expression: `({
            viewportHeight: window.innerHeight,
            totalHeight: document.body.scrollHeight,
            currentScroll: window.scrollY
          })`,
                returnByValue: true
            });
            result = evalResult.result;
        } catch (e) {
            logger.warn('[HumanSim] Failed to get page dimensions:', e.message);
            return [];
        }

        // Handle case where browser context is closed or page crashed
        if (!result || !result.value) {
            logger.warn('[HumanSim] Failed to get page dimensions - browser context may be closed');
            return [];
        }

        const { viewportHeight = 1080, totalHeight = 0 } = result.value;
        const levels = [];
        let currentY = 0;
        let levelIndex = 0;

        logger.info(`[HumanSim] Starting scroll capture: ${Math.ceil(totalHeight / viewportHeight)} levels`);

        while (currentY < totalHeight) {
            // Capture current viewport
            if (captureCallback) {
                try {
                    const levelData = await captureCallback(currentY, viewportHeight, levelIndex);
                    levels.push(levelData);
                } catch (err) {
                    logger.warn(`[HumanSim] Capture error at level ${levelIndex}:`, err.message);
                }
            }

            // Scroll one viewport (smaller steps for better lazy loading)
            const scrollAmount = Math.round(viewportHeight * 0.7);
            const scrollDuration = 2000 + Math.random() * 1000;
            await this.scroll(scrollAmount, scrollDuration);
            currentY += scrollAmount;
            levelIndex++;

            // Wait for lazy load (longer wait for ads)
            await this.wait(3000, 5000);

            // Check if page grew
            const { result: updated } = await this.Runtime.evaluate({
                expression: `document.body.scrollHeight`,
                returnByValue: true
            });

            // Safety limit for infinite scroll pages
            if (levelIndex > 20) {
                logger.warn('[HumanSim] Reached scroll limit (20 levels)');
                break;
            }
        }

        return levels;
    }

    // Type text with human timing
    async type(text, selector = null) {
        // Focus element if selector provided
        if (selector) {
            await this.clickElement(selector);
            await this.wait(100, 300);
        }

        for (const char of text) {
            await this.Input.dispatchKeyEvent({
                type: 'keyDown',
                text: char
            });

            // Variable typing speed
            await this.wait(50, 150);

            await this.Input.dispatchKeyEvent({
                type: 'keyUp',
                text: char
            });

            // Occasional longer pause (thinking)
            if (Math.random() < 0.05) {
                await this.wait(200, 500);
            }
        }
    }

    // Random mouse movement (simulates reading/browsing)
    async randomMouseMovement(duration = 5000) {
        const startTime = Date.now();
        let lastX = 500 + Math.random() * 500;
        let lastY = 300 + Math.random() * 300;

        while (Date.now() - startTime < duration) {
            // New random target
            const targetX = Math.max(100, Math.min(1820, lastX + (Math.random() - 0.5) * 400));
            const targetY = Math.max(100, Math.min(980, lastY + (Math.random() - 0.5) * 400));

            await this.moveMouse(lastX, lastY, targetX, targetY, 10 + Math.random() * 10);

            lastX = targetX;
            lastY = targetY;

            // Pause between movements
            await this.wait(500, 2000);
        }
    }

    // Simulate full human browsing session
    async simulateBrowsing(durationMs = 30000) {
        logger.info(`[HumanSim] Starting ${durationMs / 1000}s browsing simulation`);
        const startTime = Date.now();

        // Initial page load wait
        await this.wait(1000, 2000);

        // Random mouse movements to start
        await this.randomMouseMovement(3000);

        // Scroll through page
        await this.scrollToBottom({ pauseChance: 0.2, maxPauseDuration: 2000 });

        // More random movements
        const remainingTime = durationMs - (Date.now() - startTime);
        if (remainingTime > 0) {
            await this.randomMouseMovement(Math.min(remainingTime, 5000));
        }

        logger.info('[HumanSim] Browsing simulation complete');
    }
}

module.exports = HumanSimulator;
