const logger = require('./logger');

/**
 * Directory Website Detector
 * Detects if a site is a directory/listing website and identifies its structure
 */

class DirectoryDetector {
    constructor() {
        // Common directory website indicators
        this.directoryIndicators = {
            // WordPress Directory Plugins
            plugins: [
                'business-directory-plugin',
                'geodirectory',
                'directorist',
                'listingpro',
                'listify',
                'hivepress',
                'wpjobboard',
                'wp-job-manager',
                'advanced-classifieds',
            ],

            // Common directory URL patterns
            urlPatterns: [
                '/listing/',
                '/listings/',
                '/directory/',
                '/business/',
                '/businesses/',
                '/company/',
                '/companies/',
                '/location/',
                '/locations/',
                '/category/',
                '/categories/',
                '/place/',
                '/places/',
                '/venue/',
                '/venues/',
                '/service/',
                '/services/',
                '/provider/',
                '/providers/',
            ],

            // Common directory meta tags
            metaTags: [
                'directory',
                'business directory',
                'local directory',
                'listing',
                'business listing',
                'company directory',
            ],

            // Common directory schema types
            schemaTypes: [
                'LocalBusiness',
                'Organization',
                'Place',
                'Service',
                'Product',
                'ItemList',
            ],

            // Common directory CSS classes
            cssClasses: [
                'listing',
                'directory',
                'business-card',
                'company-listing',
                'directory-item',
                'listing-card',
                'business-directory',
            ],
        };
    }

    /**
     * Detect if a page is a directory website
     */
    async detectDirectory(page) {
        try {
            const detection = {
                isDirectory: false,
                confidence: 0,
                indicators: [],
                directoryType: null,
                structure: {},
            };

            // Check for WordPress
            const isWordPress = await this.detectWordPress(page);
            if (isWordPress) {
                detection.indicators.push('WordPress detected');
                detection.confidence += 10;
            }

            // Check for directory plugins
            const pluginDetection = await this.detectDirectoryPlugins(page);
            if (pluginDetection.found) {
                detection.indicators.push(`Directory plugin: ${pluginDetection.plugin}`);
                detection.confidence += 40;
                detection.directoryType = pluginDetection.plugin;
            }

            // Check URL structure
            const urlStructure = await this.analyzeURLStructure(page);
            if (urlStructure.hasDirectoryPatterns) {
                detection.indicators.push('Directory URL patterns found');
                detection.confidence += 20;
                detection.structure.urls = urlStructure.patterns;
            }

            // Check for listing elements
            const listingElements = await this.detectListingElements(page);
            if (listingElements.count > 0) {
                detection.indicators.push(`${listingElements.count} listing elements found`);
                detection.confidence += 15;
                detection.structure.listings = listingElements;
            }

            // Check schema markup
            const schemaDetection = await this.detectDirectorySchema(page);
            if (schemaDetection.found) {
                detection.indicators.push(`Schema types: ${schemaDetection.types.join(', ')}`);
                detection.confidence += 15;
                detection.structure.schema = schemaDetection.types;
            }

            // Determine if it's a directory based on confidence
            detection.isDirectory = detection.confidence >= 30;

            logger.info('Directory detection completed', {
                isDirectory: detection.isDirectory,
                confidence: detection.confidence,
                indicators: detection.indicators,
            });

            return detection;
        } catch (error) {
            logger.error('Error detecting directory website', error);
            return {
                isDirectory: false,
                confidence: 0,
                indicators: [],
                error: error.message,
            };
        }
    }

    /**
     * Detect WordPress
     */
    async detectWordPress(page) {
        try {
            const wpIndicators = await page.evaluate(() => {
                // Check for WordPress meta tags
                const metaGenerator = document.querySelector('meta[name="generator"]');
                if (metaGenerator && metaGenerator.content.toLowerCase().includes('wordpress')) {
                    return true;
                }

                // Check for wp-content in scripts/styles
                const scripts = Array.from(document.querySelectorAll('script[src]'));
                const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));

                const hasWpContent = [...scripts, ...styles].some(el => {
                    const src = el.src || el.href;
                    return src && src.includes('wp-content');
                });

                return hasWpContent;
            });

            return wpIndicators;
        } catch (error) {
            return false;
        }
    }

    /**
     * Detect directory plugins
     */
    async detectDirectoryPlugins(page) {
        try {
            const pluginDetection = await page.evaluate((plugins) => {
                const html = document.documentElement.outerHTML;

                for (const plugin of plugins) {
                    if (html.includes(plugin)) {
                        return { found: true, plugin };
                    }
                }

                return { found: false, plugin: null };
            }, this.directoryIndicators.plugins);

            return pluginDetection;
        } catch (error) {
            return { found: false, plugin: null };
        }
    }

    /**
     * Analyze URL structure for directory patterns
     */
    async analyzeURLStructure(page) {
        try {
            const urlAnalysis = await page.evaluate((patterns) => {
                const links = Array.from(document.querySelectorAll('a[href]'));
                const foundPatterns = new Set();

                links.forEach(link => {
                    const href = link.href;
                    patterns.forEach(pattern => {
                        if (href.includes(pattern)) {
                            foundPatterns.add(pattern);
                        }
                    });
                });

                return {
                    hasDirectoryPatterns: foundPatterns.size > 0,
                    patterns: Array.from(foundPatterns),
                    count: foundPatterns.size,
                };
            }, this.directoryIndicators.urlPatterns);

            return urlAnalysis;
        } catch (error) {
            return { hasDirectoryPatterns: false, patterns: [], count: 0 };
        }
    }

    /**
     * Detect listing elements
     */
    async detectListingElements(page) {
        try {
            const listings = await page.evaluate((cssClasses) => {
                const elements = [];

                cssClasses.forEach(className => {
                    const found = document.querySelectorAll(`.${className}`);
                    if (found.length > 0) {
                        elements.push({
                            className,
                            count: found.length,
                        });
                    }
                });

                // Also check for common listing structures
                const listingContainers = document.querySelectorAll('[class*="listing"], [class*="directory"], [class*="business"]');

                return {
                    count: elements.reduce((sum, el) => sum + el.count, 0),
                    types: elements,
                    containers: listingContainers.length,
                };
            }, this.directoryIndicators.cssClasses);

            return listings;
        } catch (error) {
            return { count: 0, types: [], containers: 0 };
        }
    }

    /**
     * Detect directory schema markup
     */
    async detectDirectorySchema(page) {
        try {
            const schemaDetection = await page.evaluate((schemaTypes) => {
                const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                const foundTypes = new Set();

                scripts.forEach(script => {
                    try {
                        const data = JSON.parse(script.textContent);
                        const checkType = (obj) => {
                            if (obj['@type']) {
                                const type = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
                                type.forEach(t => {
                                    if (schemaTypes.includes(t)) {
                                        foundTypes.add(t);
                                    }
                                });
                            }

                            // Check nested objects
                            Object.values(obj).forEach(value => {
                                if (typeof value === 'object' && value !== null) {
                                    checkType(value);
                                }
                            });
                        };

                        checkType(data);
                    } catch (e) {
                        // Invalid JSON, skip
                    }
                });

                return {
                    found: foundTypes.size > 0,
                    types: Array.from(foundTypes),
                };
            }, this.directoryIndicators.schemaTypes);

            return schemaDetection;
        } catch (error) {
            return { found: false, types: [] };
        }
    }

    /**
     * Extract directory-specific data
     */
    async extractDirectoryData(page) {
        try {
            const directoryData = await page.evaluate(() => {
                const data = {
                    listings: [],
                    categories: [],
                    locations: [],
                    filters: [],
                };

                // Extract listings
                const listingElements = document.querySelectorAll('[class*="listing"], [class*="business"], [class*="directory-item"]');
                listingElements.forEach((el, index) => {
                    if (index < 10) { // Limit to first 10
                        const title = el.querySelector('h2, h3, .title, .name')?.textContent?.trim();
                        const description = el.querySelector('.description, .excerpt, p')?.textContent?.trim();
                        const link = el.querySelector('a')?.href;

                        if (title) {
                            data.listings.push({ title, description, link });
                        }
                    }
                });

                // Extract categories
                const categoryLinks = document.querySelectorAll('a[href*="/category/"], a[href*="/categories/"]');
                categoryLinks.forEach((link, index) => {
                    if (index < 20) { // Limit to first 20
                        data.categories.push({
                            name: link.textContent.trim(),
                            url: link.href,
                        });
                    }
                });

                // Extract locations
                const locationLinks = document.querySelectorAll('a[href*="/location/"], a[href*="/locations/"]');
                locationLinks.forEach((link, index) => {
                    if (index < 20) { // Limit to first 20
                        data.locations.push({
                            name: link.textContent.trim(),
                            url: link.href,
                        });
                    }
                });

                return data;
            });

            return directoryData;
        } catch (error) {
            logger.error('Error extracting directory data', error);
            return { listings: [], categories: [], locations: [], filters: [] };
        }
    }
}

module.exports = new DirectoryDetector();
