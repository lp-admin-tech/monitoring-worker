const ContentAnalyzer = require('./index');
const {
  ShannonEntropyCalculator,
  SimHashSimilarityChecker,
  ReadabilityScorer,
  AILikelihoodDetector,
  ClickbaitPatternDetector,
  FreshnessAnalyzer,
  TextUtils,
} = require('./index');

const logger = require('../logger');

async function exampleUnifiedAnalysis() {
  logger.info('=== Example 1: Unified Content Analysis ===');

  const sampleText = `
    This is a comprehensive article about modern digital marketing strategies.
    The landscape of online advertising has changed significantly over the past decade.
    Therefore, marketers must adapt their approaches accordingly. Furthermore, understanding
    consumer behavior is crucial for success. In conclusion, data-driven strategies yield
    better results than traditional approaches.
  `;

  const analyzer = new ContentAnalyzer();

  const result = await analyzer.analyzeContent(sampleText, {
    headline: 'Modern Digital Marketing Strategies',
  });

  logger.info('Complete Analysis Result:', JSON.stringify(result, null, 2));
  return result;
}

async function exampleIndividualAnalyzers() {
  logger.info('=== Example 2: Individual Analyzer Usage ===');

  const sampleText = 'Check out this shocking trick that doctors hate! You won\'t believe what happens next!!!';

  const entropy = new ShannonEntropyCalculator();
  const similarity = new SimHashSimilarityChecker();
  const readability = new ReadabilityScorer();
  const aiDetector = new AILikelihoodDetector();
  const clickbait = new ClickbaitPatternDetector();
  const freshness = new FreshnessAnalyzer();

  logger.info('Entropy:', entropy.analyze(sampleText));
  logger.info('Similarity:', similarity.analyze(sampleText));
  logger.info('Readability:', readability.analyze(sampleText));
  logger.info('AI Detection:', aiDetector.analyze(sampleText));
  logger.info('Clickbait Detection:', clickbait.analyze(sampleText));
  logger.info('Freshness:', freshness.analyze(sampleText));
}

async function exampleTextUtilities() {
  logger.info('=== Example 3: Text Utilities ===');

  const text = 'The quick brown fox jumps over the lazy dog.';

  logger.info('Normalized:', TextUtils.normalizeText(text));
  logger.info('Tokens:', TextUtils.extractTokens(text));
  logger.info('Sentences:', TextUtils.extractSentences(text));
  logger.info('Word Frequency:', TextUtils.getTopWords(text, 5));
  logger.info('Average Word Length:', TextUtils.calculateAverageWordLength(text));
  logger.info('Character Frequency:', TextUtils.getCharacterFrequency(text, 10));
}

async function exampleBatchAnalysis() {
  logger.info('=== Example 4: Batch Analysis ===');

  const texts = [
    'This is a normal article about technology.',
    'You won\'t believe what happens next... Shocking revelation!!!',
    'Article published on November 2025. Updated recently.',
  ];

  const analyzer = new ContentAnalyzer();

  const results = [];
  for (const text of texts) {
    const result = await analyzer.analyzeContent(text);
    results.push({
      preview: text.substring(0, 50),
      riskLevel: result.riskAssessment?.riskLevel,
      flagStatus: result.flagStatus,
    });
  }

  logger.info('Batch Analysis Results:', JSON.stringify(results, null, 2));
  return results;
}

async function exampleFactoryMethods() {
  logger.info('=== Example 5: Factory Methods ===');

  const { createContentAnalyzer, createEntropyCalculator, createClickbaitDetector } = require('./index');

  const analyzer = createContentAnalyzer();
  const entropy = createEntropyCalculator();
  const clickbait = createClickbaitDetector();

  const text = 'Sample text for analysis.';

  logger.info('Factory Analyzer:', analyzer instanceof ContentAnalyzer);
  logger.info('Factory Entropy:', entropy instanceof ShannonEntropyCalculator);
  logger.info('Factory Clickbait:', clickbait instanceof ClickbaitPatternDetector);
}

async function exampleComparison() {
  logger.info('=== Example 6: Content Comparison ===');

  const analyzer = new ContentAnalyzer();

  const text1 = 'This is the original article about technology trends.';
  const text2 = 'This is the original article about technology trends.';
  const text3 = 'This is a completely different article about something else.';

  const analysis1 = await analyzer.analyzeContent(text1);
  const analysis2 = await analyzer.analyzeContent(text2);
  const analysis3 = await analyzer.analyzeContent(text3);

  const comparison12 = analyzer.compareWithPrevious(analysis2, analysis1);
  const comparison13 = analyzer.compareWithPrevious(analysis3, analysis1);

  logger.info('Comparison (Same Content):', JSON.stringify(comparison12, null, 2));
  logger.info('Comparison (Different Content):', JSON.stringify(comparison13, null, 2));
}

async function exampleStatistics() {
  logger.info('=== Example 7: Statistical Analysis ===');

  const values = [10, 20, 30, 40, 50];

  logger.info('Mean:', TextUtils.calculateMean(values));
  logger.info('Variance:', TextUtils.calculateVariance(values));
  logger.info('Standard Deviation:', TextUtils.calculateStandardDeviation(values));
}

async function examplePatternMatching() {
  logger.info('=== Example 8: Pattern Matching ===');

  const text = 'Breaking news! Shocking discovery! Exclusive information!';
  const patterns = ['breaking', 'shocking', 'exclusive'];

  logger.info('Contains patterns:', TextUtils.containsPattern(text, patterns));
  logger.info('Pattern counts:', {
    breaking: TextUtils.countPatternMatches(text, /breaking/gi),
    shocking: TextUtils.countPatternMatches(text, /shocking/gi),
  });
}

async function runAllExamples() {
  try {
    await exampleUnifiedAnalysis();
    logger.info('\n');
    await exampleIndividualAnalyzers();
    logger.info('\n');
    await exampleTextUtilities();
    logger.info('\n');
    await exampleBatchAnalysis();
    logger.info('\n');
    await exampleFactoryMethods();
    logger.info('\n');
    await exampleComparison();
    logger.info('\n');
    await exampleStatistics();
    logger.info('\n');
    await examplePatternMatching();

    logger.info('\n=== All Examples Complete ===');
  } catch (error) {
    logger.error('Example execution failed:', error);
  }
}

if (require.main === module) {
  runAllExamples();
}

module.exports = {
  exampleUnifiedAnalysis,
  exampleIndividualAnalyzers,
  exampleTextUtilities,
  exampleBatchAnalysis,
  exampleFactoryMethods,
  exampleComparison,
  exampleStatistics,
  examplePatternMatching,
};
