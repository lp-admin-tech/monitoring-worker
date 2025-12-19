/**
 * Table Extractor Module
 * Inspired by crawl4ai/table_extraction.py
 * Detects and extracts data tables (vs layout tables) from HTML
 */

const logger = require('./logger');

/**
 * Default table extraction strategy
 * Uses scoring system to differentiate data tables from layout tables
 */
class TableExtractor {
    constructor(options = {}) {
        this.scoreThreshold = options.scoreThreshold || 7;
        this.minRows = options.minRows || 2;
        this.minCols = options.minCols || 2;
    }

    /**
     * Check if a table element is a data table (not layout)
     * Uses scoring system based on table structure
     * @param {Object} tableInfo - Parsed table information
     * @returns {boolean}
     */
    isDataTable(tableInfo) {
        let score = 0;

        // Check for thead/tbody
        if (tableInfo.hasThead) score += 2;
        if (tableInfo.hasTbody) score += 1;

        // Check for th elements
        if (tableInfo.thCount > 0) {
            score += 2;
            if (tableInfo.hasThead || tableInfo.firstRowHasTh) score += 1;
        }

        // Nested tables (negative indicator)
        if (tableInfo.hasNestedTables) score -= 3;

        // Role attribute
        if (tableInfo.role === 'presentation' || tableInfo.role === 'none') {
            score -= 3;
        }

        // Column consistency
        if (tableInfo.rows.length > 0) {
            const colCounts = tableInfo.rows.map(r => r.length);
            const avgCols = colCounts.reduce((a, b) => a + b, 0) / colCounts.length;
            const variance = colCounts.reduce((sum, c) => sum + Math.pow(c - avgCols, 2), 0) / colCounts.length;
            if (variance < 1) score += 2;
        }

        // Caption and summary
        if (tableInfo.caption) score += 2;
        if (tableInfo.summary) score += 1;

        // Text density
        const totalText = tableInfo.rows.reduce((sum, row) =>
            sum + row.reduce((s, cell) => s + (cell || '').length, 0), 0
        );
        const totalCells = tableInfo.rows.reduce((sum, row) => sum + row.length, 0);
        const textRatio = totalCells > 0 ? totalText / totalCells : 0;

        if (textRatio > 20) score += 3;
        else if (textRatio > 10) score += 2;

        // Size check
        if (tableInfo.rows.length >= 2 && tableInfo.rows[0]?.length >= 2) {
            score += 2;
        }

        return score >= this.scoreThreshold;
    }

    /**
     * Extract structured data from a table
     * This method is designed to work with HTML parsed by cheerio or similar
     * @param {Object} tableData - Raw table data
     * @returns {Object} - Structured table data
     */
    extractTableData(tableData) {
        const { headers = [], rows = [], caption = '', summary = '' } = tableData;

        // Handle colspan by duplicating values
        const processedRows = rows.map(row => {
            const processed = [];
            for (const cell of row) {
                const colspan = cell.colspan || 1;
                for (let i = 0; i < colspan; i++) {
                    processed.push(cell.text || cell);
                }
            }
            return processed;
        });

        // Align rows to have same column count
        const maxCols = Math.max(
            headers.length,
            ...processedRows.map(r => r.length)
        );

        const alignedRows = processedRows.map(row => {
            const aligned = row.slice(0, maxCols);
            while (aligned.length < maxCols) {
                aligned.push('');
            }
            return aligned;
        });

        // Generate default headers if none found
        const finalHeaders = headers.length > 0
            ? headers
            : Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`);

        return {
            headers: finalHeaders,
            rows: alignedRows,
            caption,
            summary,
            metadata: {
                rowCount: alignedRows.length,
                columnCount: maxCols,
                hasHeaders: headers.length > 0,
                hasCaption: !!caption,
                hasSummary: !!summary,
            }
        };
    }

    /**
     * Extract tables from page content using CDP evaluation
     * @param {Function} evaluate - CDP evaluate function
     * @returns {Promise<Array>}
     */
    async extractFromPage(evaluate) {
        const tables = await evaluate(`
      (() => {
        const tables = [];
        const tableElements = document.querySelectorAll('table');
        
        for (const table of tableElements) {
          const tableInfo = {
            hasThead: !!table.querySelector('thead'),
            hasTbody: !!table.querySelector('tbody'),
            thCount: table.querySelectorAll('th').length,
            firstRowHasTh: !!table.querySelector('tr:first-child th'),
            hasNestedTables: table.querySelectorAll('table').length > 0,
            role: table.getAttribute('role') || '',
            caption: table.querySelector('caption')?.textContent?.trim() || '',
            summary: table.getAttribute('summary') || '',
            rows: [],
            headers: [],
          };

          // Extract headers from thead or first row
          const theadRow = table.querySelector('thead tr');
          if (theadRow) {
            tableInfo.headers = Array.from(theadRow.querySelectorAll('th, td')).map(cell => ({
              text: cell.textContent.trim(),
              colspan: parseInt(cell.getAttribute('colspan') || '1')
            }));
          }

          // Extract rows from tbody or all tr
          const tbody = table.querySelector('tbody') || table;
          const rowElements = tbody.querySelectorAll('tr');
          
          for (const row of rowElements) {
            // Skip header rows
            if (row.closest('thead')) continue;
            
            const cells = Array.from(row.querySelectorAll('td, th')).map(cell => ({
              text: cell.textContent.trim(),
              colspan: parseInt(cell.getAttribute('colspan') || '1'),
              rowspan: parseInt(cell.getAttribute('rowspan') || '1'),
            }));
            
            if (cells.length > 0) {
              tableInfo.rows.push(cells);
            }
          }

          tables.push(tableInfo);
        }
        
        return tables;
      })()
    `);

        // Filter to data tables only and extract structured data
        return tables
            .filter(t => this.isDataTable(t))
            .filter(t => t.rows.length >= this.minRows)
            .map(t => this.extractTableData({
                headers: (t.headers || []).map(h => h.text),
                rows: t.rows,
                caption: t.caption,
                summary: t.summary,
            }));
    }

    /**
     * Convert extracted table to markdown format
     * @param {Object} tableData
     * @returns {string}
     */
    toMarkdown(tableData) {
        const { headers, rows } = tableData;

        if (!headers || headers.length === 0) return '';

        let md = '| ' + headers.join(' | ') + ' |\n';
        md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';

        for (const row of rows) {
            md += '| ' + row.join(' | ') + ' |\n';
        }

        return md;
    }

    /**
     * Convert extracted table to CSV format
     * @param {Object} tableData
     * @returns {string}
     */
    toCSV(tableData) {
        const { headers, rows } = tableData;

        const escapeCSV = (val) => {
            if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                return `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        };

        let csv = headers.map(escapeCSV).join(',') + '\n';
        for (const row of rows) {
            csv += row.map(escapeCSV).join(',') + '\n';
        }

        return csv;
    }
}

module.exports = TableExtractor;
