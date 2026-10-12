// Standalone runner: node scripts/extract-pdf.js <path-to-pdf>
// Prints JSON { pages, pageCount, skippedPages } or { error }. Used by tests to
// exercise the REAL pdfjs-dist extractor without Jest transpiling dynamic import().
const fs = require('fs');
const { extractPdf } = require('../src/modules/knowledge/processing.service');

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('usage: extract-pdf.js <file>'); process.exit(2); }
  const buf = fs.readFileSync(file);
  try {
    const r = await extractPdf(buf);
    process.stdout.write(JSON.stringify({
      pageCount: r.pageCount,
      skippedPages: r.skippedPages,
      textPageCount: r.pages.length,
      text: r.pages.map((p) => p.text).join('\n').slice(0, 2000),
    }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: e.message }));
  }
}

main();
