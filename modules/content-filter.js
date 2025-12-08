/**
 * Content Filter Module
 * Inspired by crawl4ai/content_filter_strategy.py
 * Implements BM25 relevance scoring and text density pruning
 */

const logger = require('./logger');

// Stop words for text processing
const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
    'to', 'was', 'were', 'will', 'with', 'the', 'this', 'but', 'they',
    'have', 'had', 'what', 'when', 'where', 'who', 'which', 'why', 'how'
]);

// Tags that indicate important content
const PRIORITY_TAGS = {
    h1: 5.0,
    h2: 4.0,
    h3: 3.0,
    h4: 2.5,
    h5: 2.0,
    h6: 1.5,
    title: 4.0,
    strong: 2.0,
    b: 1.5,
    em: 1.5,
    blockquote: 2.0,
    code: 2.0,
    pre: 1.5,
    th: 1.5,
    article: 1.5,
    main: 1.4,
    section: 1.3,
    p: 1.2,
};

// Tags to exclude
const EXCLUDED_TAGS = new Set([
    'nav', 'footer', 'header', 'aside', 'script', 'style',
    'form', 'iframe', 'noscript', 'svg', 'button', 'input'
]);

// Negative patterns (ads, navigation, etc.)
const NEGATIVE_PATTERNS = /nav|footer|header|sidebar|ads|comment|promo|advert|social|share|cookie|banner|popup|modal/i;

/**
 * Basic BM25 implementation for content relevance scoring
 */
class BM25 {
    constructor(corpus, k1 = 1.5, b = 0.75) {
        this.k1 = k1;
        this.b = b;
        this.corpus = corpus;
        this.docCount = corpus.length;
        this.avgDocLength = this._calculateAvgDocLength();
        this.idf = this._calculateIDF();
    }

    _calculateAvgDocLength() {
        if (this.corpus.length === 0) return 0;
        const totalLength = this.corpus.reduce((sum, doc) => sum + doc.length, 0);
        return totalLength / this.corpus.length;
    }

    _calculateIDF() {
        const idf = {};
        const df = {}; // Document frequency

        for (const doc of this.corpus) {
            const seen = new Set();
            for (const term of doc) {
                if (!seen.has(term)) {
                    df[term] = (df[term] || 0) + 1;
                    seen.add(term);
                }
            }
        }

        for (const term in df) {
            // IDF = log((N - n + 0.5) / (n + 0.5) + 1)
            idf[term] = Math.log((this.docCount - df[term] + 0.5) / (df[term] + 0.5) + 1);
        }

        return idf;
    }

    /**
     * Calculate BM25 scores for all documents against a query
     * @param {string[]} query - Tokenized query
     * @returns {number[]} - Scores for each document
     */
    getScores(query) {
        const scores = [];

        for (let i = 0; i < this.corpus.length; i++) {
            const doc = this.corpus[i];
            const docLength = doc.length;
            let score = 0;

            // Calculate term frequencies in this document
            const tf = {};
            for (const term of doc) {
                tf[term] = (tf[term] || 0) + 1;
            }

            for (const term of query) {
                if (this.idf[term] === undefined) continue;

                const termFreq = tf[term] || 0;
                const numerator = this.idf[term] * termFreq * (this.k1 + 1);
                const denominator = termFreq + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));
                score += numerator / denominator;
            }

            scores.push(score);
        }

        return scores;
    }
}

/**
 * BM25 Content Filter
 * Uses BM25 algorithm to score content relevance
 */
class BM25ContentFilter {
    constructor(options = {}) {
        this.threshold = options.threshold || 1.0;
        this.minWordCount = options.minWordCount || 5;
    }

    /**
     * Tokenize text and remove stop words
     * @param {string} text
     * @returns {string[]}
     */
    tokenize(text) {
        return text
            .toLowerCase()
            .split(/\W+/)
            .filter(word => word.length > 2 && !STOP_WORDS.has(word));
    }

    /**
     * Filter content chunks by BM25 relevance to query
     * @param {Array<{text: string, tag: string}>} chunks - Content chunks
     * @param {string} query - Query to match against
     * @returns {Array<{text: string, tag: string, score: number}>}
     */
    filter(chunks, query) {
        if (!chunks || chunks.length === 0) return [];
        if (!query) return chunks;

        // Tokenize all chunks
        const tokenizedChunks = chunks.map(chunk => this.tokenize(chunk.text));
        const tokenizedQuery = this.tokenize(query);

        if (tokenizedQuery.length === 0) return chunks;

        // Calculate BM25 scores
        const bm25 = new BM25(tokenizedChunks);
        const scores = bm25.getScores(tokenizedQuery);

        // Apply tag weights and filter
        const results = [];
        for (let i = 0; i < chunks.length; i++) {
            const tagWeight = PRIORITY_TAGS[chunks[i].tag] || 1.0;
            const adjustedScore = scores[i] * tagWeight;

            if (adjustedScore >= this.threshold) {
                results.push({
                    ...chunks[i],
                    score: adjustedScore
                });
            }
        }

        // Sort by score descending
        results.sort((a, b) => b.score - a.score);
        return results;
    }
}

/**
 * Pruning Content Filter
 * Removes low-quality content based on text density metrics
 */
class PruningContentFilter {
    constructor(options = {}) {
        this.threshold = options.threshold || 0.48;
        this.minWordThreshold = options.minWordThreshold || 5;

        // Metric weights
        this.weights = {
            textDensity: options.textDensityWeight || 0.4,
            linkDensity: options.linkDensityWeight || 0.2,
            tagWeight: options.tagWeight || 0.2,
            classIdWeight: options.classIdWeight || 0.1,
            textLength: options.textLengthWeight || 0.1,
        };

        // Tag weights for scoring
        this.tagWeights = {
            div: 0.5,
            p: 1.0,
            article: 1.5,
            section: 1.0,
            span: 0.3,
            li: 0.5,
            ul: 0.5,
            ol: 0.5,
            h1: 1.2,
            h2: 1.1,
            h3: 1.0,
            h4: 0.9,
            h5: 0.8,
            h6: 0.7,
        };
    }

    /**
     * Calculate composite score for a content element
     * @param {Object} metrics
     * @returns {number}
     */
    calculateScore(metrics) {
        const { textLength, tagLength, linkTextLength, tag, classId } = metrics;

        // Word count check
        const wordCount = (metrics.text || '').split(/\s+/).length;
        if (wordCount < this.minWordThreshold) {
            return -1.0; // Guaranteed removal
        }

        let score = 0;
        let totalWeight = 0;

        // Text density
        if (tagLength > 0) {
            const textDensity = textLength / tagLength;
            score += this.weights.textDensity * textDensity;
            totalWeight += this.weights.textDensity;
        }

        // Link density (inverse - high link density is bad)
        if (textLength > 0) {
            const linkDensity = 1 - (linkTextLength / textLength);
            score += this.weights.linkDensity * linkDensity;
            totalWeight += this.weights.linkDensity;
        }

        // Tag weight
        const tagScore = this.tagWeights[tag] || 0.5;
        score += this.weights.tagWeight * tagScore;
        totalWeight += this.weights.tagWeight;

        // Class/ID weight (negative for ads/nav patterns)
        let classIdScore = 0;
        if (classId && NEGATIVE_PATTERNS.test(classId)) {
            classIdScore = -0.5;
        }
        score += this.weights.classIdWeight * Math.max(0, classIdScore);
        totalWeight += this.weights.classIdWeight;

        // Text length bonus
        score += this.weights.textLength * Math.log(textLength + 1);
        totalWeight += this.weights.textLength;

        return totalWeight > 0 ? score / totalWeight : 0;
    }

    /**
     * Filter content chunks by text density pruning
     * @param {Array<Object>} chunks - Content chunks with metrics
     * @returns {Array<Object>}
     */
    filter(chunks) {
        return chunks.filter(chunk => {
            const score = this.calculateScore(chunk);
            return score >= this.threshold;
        });
    }
}

/**
 * Combined Content Filter
 * Chains BM25 and Pruning filters for optimal content extraction
 */
class ContentFilter {
    constructor(options = {}) {
        this.bm25Filter = new BM25ContentFilter(options.bm25 || {});
        this.pruningFilter = new PruningContentFilter(options.pruning || {});
        this.useBM25 = options.useBM25 !== false;
        this.usePruning = options.usePruning !== false;
    }

    /**
     * Apply all enabled filters to content chunks
     * @param {Array<Object>} chunks
     * @param {string} query - Optional query for BM25
     * @returns {Array<Object>}
     */
    filter(chunks, query = null) {
        let result = chunks;

        // Apply pruning first (removes noise)
        if (this.usePruning) {
            result = this.pruningFilter.filter(result);
        }

        // Apply BM25 if query provided
        if (this.useBM25 && query) {
            result = this.bm25Filter.filter(result, query);
        }

        return result;
    }

    /**
     * Extract main content from HTML using combined filtering
     * This is a simplified extraction that works with pre-parsed data
     * @param {Array<{text: string, tag: string, metrics: Object}>} elements
     * @param {string} query
     * @returns {Array<Object>}
     */
    extractMainContent(elements, query = null) {
        // First pass: exclude obviously bad elements
        let filtered = elements.filter(el => {
            // Skip excluded tags
            if (EXCLUDED_TAGS.has(el.tag)) return false;

            // Skip elements with negative class/id patterns
            if (el.classId && NEGATIVE_PATTERNS.test(el.classId)) return false;

            // Skip empty or very short text
            if (!el.text || el.text.trim().length < 10) return false;

            return true;
        });

        // Apply filters
        return this.filter(filtered, query);
    }
}

module.exports = {
    ContentFilter,
    BM25ContentFilter,
    PruningContentFilter,
    BM25,
    PRIORITY_TAGS,
    EXCLUDED_TAGS,
    NEGATIVE_PATTERNS
};
