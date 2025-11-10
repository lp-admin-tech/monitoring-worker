const ContentAnalyzer = require('./index');
const TextUtils = require('./utils');
const persistence = require('./persistence');
const logger = require('../logger');

const MFA_SAMPLES = [
  {
    name: 'AI Generated Clickbait',
    text: 'You won\'t believe what happens next! Breaking news! In conclusion, therefore, moreover, thus this shocking revelation will change everything forever. The reason is that this represents an unprecedented opportunity. Furthermore, as mentioned above, the fact that technology continues to advance means we must adapt accordingly. Doctors hate this one weird trick!',
    expectedFlags: ['ai_generated', 'clickbait_detected'],
  },
  {
    name: 'Low Entropy Template',
    text: 'aaaaaaa bbbbbbb ccccccc ddddddd eeeeeeee ffffffff gggggg hhhhhhhh iiiiii jjjjjj kkkkkk llllll mmmmmmm nnnnnnn ooooooo ppppppp qqqqq rrrrrrr ssssss tttttt',
    expectedFlags: ['ai_generated'],
  },
  {
    name: 'Legitimate Content',
    text: 'According to recent market research, the technology sector continues to show robust growth. Companies like Google, Microsoft, and Apple have reported strong quarterly earnings. The demand for cloud services has increased significantly as businesses digitize their operations. Consumer interest in AI applications remains high, though concerns about privacy persist. Industry analysts predict continued innovation in machine learning and natural language processing.',
    expectedFlags: ['clean'],
  },
  {
    name: 'Stale Content',
    text: 'Published on January 1, 2020. Last updated in 2021. This article discusses trends from the past decade.',
    expectedFlags: ['stale_content'],
  },
  {
    name: 'Very Simple Content',
    text: 'Cat sat mat. Dog ran fast. Sun is hot. Water is wet. Sky is blue.',
    expectedFlags: ['suspiciously_simple_text'],
  },
];

async function testIndividualAnalyzers() {
  logger.info('=== Test 1: Individual Analyzer Functionality ===');

  const testText = 'This is a test article with various metrics to analyze.';
  const results = {};

  const {
    ShannonEntropyCalculator,
    SimHashSimilarityChecker,
    ReadabilityScorer,
    AILikelihoodDetector,
    ClickbaitPatternDetector,
    FreshnessAnalyzer,
  } = require('./index');

  results.entropy = new ShannonEntropyCalculator().analyze(testText);
  results.similarity = new SimHashSimilarityChecker().analyze(testText);
  results.readability = new ReadabilityScorer().analyze(testText);
  results.ai = new AILikelihoodDetector().analyze(testText);
  results.clickbait = new ClickbaitPatternDetector().analyze(testText);
  results.freshness = new FreshnessAnalyzer().analyze(testText);

  let passed = 0;
  let failed = 0;

  for (const [name, result] of Object.entries(results)) {
    const hasError = result.error ? 'FAIL' : 'PASS';
    logger.info(`${name}: ${hasError}`, result);
    hasError === 'PASS' ? passed++ : failed++;
  }

  logger.info(`\nTest Results: ${passed} passed, ${failed} failed`);
  return passed === 6;
}

async function testTextUtilities() {
  logger.info('\n=== Test 2: Text Utilities ===');

  const testText = 'The quick brown fox jumps over the lazy dog.';
  let passed = 0;
  let failed = 0;

  const tests = [
    { name: 'normalizeText', fn: () => TextUtils.normalizeText(testText).length > 0 },
    { name: 'extractTokens', fn: () => TextUtils.extractTokens(testText).length > 0 },
    { name: 'extractSentences', fn: () => TextUtils.extractSentences(testText).length > 0 },
    { name: 'extractWords', fn: () => TextUtils.extractWords(testText).length > 0 },
    { name: 'calculateMean', fn: () => TextUtils.calculateMean([1, 2, 3]) === 2 },
    { name: 'calculateVariance', fn: () => TextUtils.calculateVariance([1, 2, 3]) > 0 },
    { name: 'countSyllables', fn: () => TextUtils.countSyllables('hello') > 0 },
    { name: 'validateText', fn: () => TextUtils.validateText(testText) === true },
    { name: 'simpleHash', fn: () => TextUtils.simpleHash(testText).length > 0 },
    { name: 'calculateSimilarity', fn: () => TextUtils.calculateSimilarity('test', 'test') === 1 },
  ];

  for (const test of tests) {
    try {
      const result = test.fn();
      logger.info(`${test.name}: ${result ? 'PASS' : 'FAIL'}`);
      result ? passed++ : failed++;
    } catch (error) {
      logger.info(`${test.name}: FAIL - ${error.message}`);
      failed++;
    }
  }

  logger.info(`\nTest Results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

async function testUnifiedAnalyzer() {
  logger.info('\n=== Test 3: Unified Content Analyzer ===');

  const analyzer = new ContentAnalyzer();
  let passed = 0;
  let failed = 0;

  for (const sample of MFA_SAMPLES) {
    try {
      const result = await analyzer.analyzeContent(sample.text, {
        headline: sample.name,
      });

      const flagStatus = result.flagStatus;
      const flagMatches = sample.expectedFlags.some(flag => {
        if (flagStatus === flag) return true;
        if (result.riskAssessment?.detectedRisks?.includes(flag)) return true;
        return false;
      });

      if (flagMatches) {
        logger.info(`${sample.name}: PASS (flagged as ${flagStatus})`);
        passed++;
      } else {
        logger.info(`${sample.name}: FAIL (expected ${sample.expectedFlags.join(' or ')}, got ${flagStatus})`);
        failed++;
      }
    } catch (error) {
      logger.info(`${sample.name}: ERROR - ${error.message}`);
      failed++;
    }
  }

  logger.info(`\nTest Results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

async function testBatchAnalysis() {
  logger.info('\n=== Test 4: Batch Analysis ===');

  const analyzer = new ContentAnalyzer();
  const texts = [
    'First article content here.',
    'Second article content here.',
    'Third article content here.',
  ];

  try {
    const results = [];
    for (const text of texts) {
      const result = await analyzer.analyzeContent(text);
      results.push(result);
    }

    if (results.length === 3) {
      logger.info('Batch Analysis: PASS');
      return true;
    } else {
      logger.info('Batch Analysis: FAIL - incorrect result count');
      return false;
    }
  } catch (error) {
    logger.info(`Batch Analysis: ERROR - ${error.message}`);
    return false;
  }
}

async function testModuleExports() {
  logger.info('\n=== Test 5: Module Exports ===');

  try {
    const module = require('./index');

    const exportTests = [
      'ShannonEntropyCalculator',
      'SimHashSimilarityChecker',
      'ReadabilityScorer',
      'AILikelihoodDetector',
      'ClickbaitPatternDetector',
      'FreshnessAnalyzer',
      'TextUtils',
      'createContentAnalyzer',
      'createEntropyCalculator',
      'createSimilarityChecker',
      'createReadabilityScorer',
      'createAIDetector',
      'createClickbaitDetector',
      'createFreshnessAnalyzer',
    ];

    let passed = 0;
    let failed = 0;

    for (const exportName of exportTests) {
      if (module[exportName]) {
        logger.info(`Export ${exportName}: PASS`);
        passed++;
      } else {
        logger.info(`Export ${exportName}: FAIL`);
        failed++;
      }
    }

    logger.info(`\nTest Results: ${passed} passed, ${failed} failed`);
    return failed === 0;
  } catch (error) {
    logger.info(`Module Exports: ERROR - ${error.message}`);
    return false;
  }
}

async function testComparisonLogic() {
  logger.info('\n=== Test 6: Content Comparison ===');

  const analyzer = new ContentAnalyzer();

  const text1 = 'Original content about technology.';
  const text2 = 'Modified content about technology trends.';

  try {
    const analysis1 = await analyzer.analyzeContent(text1);
    const analysis2 = await analyzer.analyzeContent(text2);

    const comparison = analyzer.compareWithPrevious(analysis2, analysis1);

    if (comparison.changes && comparison.changes.length > 0) {
      logger.info('Comparison Logic: PASS - detected changes');
      logger.info(`Changes detected: ${comparison.changes.join(', ')}`);
      return true;
    } else {
      logger.info('Comparison Logic: FAIL - no changes detected');
      return false;
    }
  } catch (error) {
    logger.info(`Comparison Logic: ERROR - ${error.message}`);
    return false;
  }
}

async function testErrorHandling() {
  logger.info('\n=== Test 7: Error Handling ===');

  const analyzer = new ContentAnalyzer();
  let passed = 0;
  let failed = 0;

  const errorTests = [
    { name: 'null input', input: null, shouldHandle: true },
    { name: 'empty string', input: '', shouldHandle: true },
    { name: 'undefined input', input: undefined, shouldHandle: true },
    { name: 'number input', input: 123, shouldHandle: true },
    { name: 'valid text', input: 'Valid text content', shouldHandle: true },
  ];

  for (const test of errorTests) {
    try {
      const result = await analyzer.analyzeContent(test.input);
      if (test.shouldHandle) {
        logger.info(`Error handling (${test.name}): PASS`);
        passed++;
      } else {
        logger.info(`Error handling (${test.name}): FAIL`);
        failed++;
      }
    } catch (error) {
      logger.info(`Error handling (${test.name}): ${test.shouldHandle ? 'FAIL' : 'PASS'} - ${error.message}`);
      test.shouldHandle ? failed++ : passed++;
    }
  }

  logger.info(`\nTest Results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

async function runAllTests() {
  logger.info('========================================');
  logger.info('Content Analyzer Integration Test Suite');
  logger.info('========================================\n');

  const testResults = [];

  testResults.push({ name: 'Individual Analyzers', passed: await testIndividualAnalyzers() });
  testResults.push({ name: 'Text Utilities', passed: await testTextUtilities() });
  testResults.push({ name: 'Unified Analyzer', passed: await testUnifiedAnalyzer() });
  testResults.push({ name: 'Batch Analysis', passed: await testBatchAnalysis() });
  testResults.push({ name: 'Module Exports', passed: await testModuleExports() });
  testResults.push({ name: 'Comparison Logic', passed: await testComparisonLogic() });
  testResults.push({ name: 'Error Handling', passed: await testErrorHandling() });

  logger.info('\n========================================');
  logger.info('Test Summary');
  logger.info('========================================');

  let totalPassed = 0;
  for (const result of testResults) {
    const status = result.passed ? 'PASS' : 'FAIL';
    logger.info(`${result.name}: ${status}`);
    if (result.passed) totalPassed++;
  }

  logger.info(`\nOverall: ${totalPassed}/${testResults.length} test suites passed`);
  logger.info('========================================\n');

  return totalPassed === testResults.length;
}

if (require.main === module) {
  runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = {
  testIndividualAnalyzers,
  testTextUtilities,
  testUnifiedAnalyzer,
  testBatchAnalysis,
  testModuleExports,
  testComparisonLogic,
  testErrorHandling,
  runAllTests,
};
