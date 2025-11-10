const { runPolicyCheck, getComplianceSummary, formatComplianceReport } = require('./index');

const mockCrawlData = {
  url: 'https://example.de/article',
  html: `
    <html lang="de">
    <head>
      <meta http-equiv="content-language" content="de">
      <meta name="description" content="Online Casino - Best Casino Sites">
    </head>
    <body>
      <h1>Welcome to Casino</h1>
      <p>Play for real money. Click ads to support us and disable your adblock.</p>
      <p>Best casino sites - earn money fast with our gaming platform.</p>
    </body>
    </html>
  `,
  content: 'Welcome to Casino. Play for real money. Best casino sites available.',
  title: 'Online Casino - Best Casino Sites',
  description: 'Play for real money in our online casino',
  headings: ['Welcome to Casino', 'Best casino sites', 'Real Money Gaming'],
  links: [
    { text: 'Play Now', href: 'https://casino.example.com' },
    { text: 'Click here to continue', href: '#' }
  ],
  images: [],
  metadata: { keywords: 'casino, betting, poker' },
  geoLocation: 'DE',
};

async function runTest() {
  console.log('=== Policy Checker Module Test ===\n');

  const results = await runPolicyCheck(mockCrawlData, 'example.de');

  console.log('Compliance Summary:');
  console.log(JSON.stringify(getComplianceSummary(results), null, 2));

  console.log('\n\nDetailed Report:\n');
  console.log(formatComplianceReport(results));

  console.log('\n\nFull Results Object:');
  console.log(JSON.stringify(results, null, 2));
}

if (require.main === module) {
  runTest().catch(console.error);
}

module.exports = { runTest };
