/**
 * Example: Integrating Directory Detection into Crawler
 * 
 * This shows how to use the directory detector in your crawl workflow
 */

const crawler = require('./modules/crawler');
const directoryDetector = require('./modules/directory-detector');
const logger = require('./modules/logger');

async function crawlWithDirectoryDetection(publisher, options = {}) {
    try {
        // Initialize crawler
        await crawler.initialize();

        // Create a page for detection
        const page = await crawler.browser.newPage();
        await page.goto(publisher.site_url, { waitUntil: 'networkidle' });

        // Detect if it's a directory website
        const detection = await directoryDetector.detectDirectory(page);

        logger.info('Directory detection completed', {
            publisherId: publisher.id,
            isDirectory: detection.isDirectory,
            confidence: detection.confidence,
            type: detection.directoryType
        });

        // If it's a directory, extract directory-specific data
        let directoryData = null;
        if (detection.isDirectory) {
            directoryData = await directoryDetector.extractDirectoryData(page);

            logger.info('Directory data extracted', {
                listingsFound: directoryData.listings.length,
                categoriesFound: directoryData.categories.length,
                locationsFound: directoryData.locations.length
            });
        }

        await page.close();

        // Perform regular crawl with directory context
        const crawlOptions = {
            ...options,
            isDirectory: detection.isDirectory,
            directoryType: detection.directoryType,
        };

        const crawlResults = await crawler.crawlPublisherSubdirectories(publisher, crawlOptions);

        // Enhance results with directory detection
        return {
            ...crawlResults,
            directoryDetection: detection,
            directoryData: directoryData,
        };

    } catch (error) {
        logger.error('Error in directory-aware crawl', error);
        throw error;
    } finally {
        await crawler.close();
    }
}

// Example usage
async function example() {
    const publisher = {
        id: 'pub-123',
        site_name: 'NYC Business Directory',
        site_url: 'https://example.com',
        subdirectories: []
    };

    const results = await crawlWithDirectoryDetection(publisher);

    console.log('Crawl Results:', {
        isDirectory: results.directoryDetection.isDirectory,
        confidence: results.directoryDetection.confidence,
        type: results.directoryDetection.directoryType,
        listingsFound: results.directoryData?.listings.length || 0,
        categoriesFound: results.directoryData?.categories.length || 0,
    });
}

module.exports = { crawlWithDirectoryDetection };
