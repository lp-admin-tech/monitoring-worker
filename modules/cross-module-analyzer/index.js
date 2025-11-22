const comparisonEngine = require('./comparison-engine');
const db = require('./db');

module.exports = {
    runComparison: comparisonEngine.runComparison.bind(comparisonEngine),
    db
};
