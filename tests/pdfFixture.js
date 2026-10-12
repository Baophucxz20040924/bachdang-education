const PDFDocument = require('pdfkit');

// A minimal valid 1x1 JPEG so we can embed real image XObjects into test PDFs.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof'
  + 'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB'
  + 'AAAAAAAAAAAAAAAAAAAAC//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==',
  'base64',
);

// Generate a valid single-page text PDF.
function makePdfBuffer(text = 'Mặt trời mọc ở phía đông. Học sinh đi học mỗi ngày.') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(14).text(text, { width: 500 });
    doc.end();
  });
}

/**
 * Generate a multi-page PDF where some pages contain images.
 * `pages` is an array of { text?, image? }. When image=true the page embeds a
 * JPEG (and may be image-only when no text is given).
 */
function makeMixedPdf(pages) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    pages.forEach((p, i) => {
      if (i > 0) doc.addPage();
      if (p.text) doc.fontSize(14).text(p.text, { width: 500 });
      if (p.image) { try { doc.image(TINY_JPEG, 100, 300, { width: 120 }); } catch (_) { /* ignore */ } }
    });
    doc.end();
  });
}

// Build a valid minimal .docx (OOXML) containing the given paragraphs, for tests.
// A .docx is a ZIP with [Content_Types].xml, _rels, and word/document.xml.
async function makeDocxBuffer(paragraphs = ['Mặt trời mọc ở phía đông.']) {
  // eslint-disable-next-line global-require
  const JSZip = require('jszip');
  const zip = new JSZip();
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`)
    .join('');

  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>');
  zip.folder('_rels').file('.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>');
  zip.folder('word').file('document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${body}</w:body></w:document>`);

  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = { makePdfBuffer, makeMixedPdf, makeDocxBuffer, TINY_JPEG };