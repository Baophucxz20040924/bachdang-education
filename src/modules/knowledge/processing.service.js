const crypto = require('crypto');
const mammoth = require('mammoth');
const KnowledgeDocument = require('../../models/KnowledgeDocument');
const DocumentChunk = require('../../models/DocumentChunk');
const storage = require('../../utils/storage');
const { embedTexts } = require('../../utils/embeddings');

const { PROCESSING_STATUS } = KnowledgeDocument;

// pdfjs-dist is ESM-only (top-level await); load it lazily via dynamic import
// from this CommonJS module and cache the module.
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

// --- Heading detection -----------------------------------------------------
// Detect Vietnamese chapter/lesson headings. Numbers may be Arabic (1,2,3) or
// Roman (I, II, III). Returns { chapterNumber, chapterLabel } etc. or null.
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
function parseNum(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (ROMAN[s]) return ROMAN[s];
  return null;
}

const CHAPTER_RE = /^\s*(ch[uư][ơo]ng|phần|chủ\s*đề)\s+([0-9]+|[ivxIVX]+)\s*[:.\-–]?\s*(.*)$/i;
const LESSON_RE = /^\s*(bài|tiết|bài\s*học)\s+([0-9]+|[ivxIVX]+)\s*[:.\-–]?\s*(.*)$/i;

function detectHeading(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.length > 120) return null; // headings are short lines
  const ch = trimmed.match(CHAPTER_RE);
  if (ch) {
    const num = parseNum(ch[2]);
    return { kind: 'chapter', number: num, label: trimmed.replace(/\s+/g, ' ') };
  }
  const le = trimmed.match(LESSON_RE);
  if (le) {
    const num = parseNum(le[2]);
    return { kind: 'lesson', number: num, label: trimmed.replace(/\s+/g, ' ') };
  }
  return null;
}

// --- Chunking with heading propagation -------------------------------------
// Input: array of { page, text }. Output: array of chunks tagged with the most
// recent chapter/lesson heading seen so far, plus page range.
function chunkPages(pages, { size = 700, overlap = 80 } = {}) {
  const chunks = [];
  let current = { chapterNumber: null, chapterLabel: null, lessonNumber: null, lessonLabel: null };

  for (const { page, text } of pages) {
    const cleaned = String(text || '').normalize('NFC').replace(/\r/g, '');
    const lines = cleaned.split('\n');
    let buffer = '';

    const flush = () => {
      const t = buffer.trim();
      if (t.length > 0) {
        chunks.push({ text: t, page, ...current });
      }
      buffer = '';
    };

    for (const line of lines) {
      const heading = detectHeading(line);
      if (heading) {
        // Heading starts a new logical section: flush what we have.
        flush();
        if (heading.kind === 'chapter') {
          current = { chapterNumber: heading.number, chapterLabel: heading.label, lessonNumber: null, lessonLabel: null };
        } else {
          current = { ...current, lessonNumber: heading.number, lessonLabel: heading.label };
        }
        buffer = `${heading.label}\n`;
        continue;
      }
      if ((buffer + line).length > size && buffer.trim()) {
        const tail = buffer.slice(Math.max(0, buffer.length - overlap));
        flush();
        buffer = tail;
      }
      buffer += (buffer ? '\n' : '') + line;
    }
    flush();
  }

  // Hard-split any oversized chunk, preserving tags.
  const final = [];
  for (const c of chunks) {
    const t = c.text.replace(/[ \t]+/g, ' ').trim();
    if (!t) continue;
    if (t.length <= size * 1.6) { final.push({ ...c, text: t }); continue; }
    for (let i = 0; i < t.length; i += size) final.push({ ...c, text: t.slice(i, i + size) });
  }
  return final;
}

// Backward-compatible plain-text chunker (used by older tests/callers).
function chunkText(text, opts) {
  return chunkPages([{ page: 1, text }], opts).map((c) => c.text);
}

function hashChunk(docId, index, text) {
  return crypto.createHash('sha256').update(`${docId}:${index}:${text}`).digest('hex');
}

/**
 * Extract text PER PAGE from a PDF. Pages that are image-only (no extractable
 * text) are SKIPPED, not failed — a book with some scanned pages still indexes
 * its text pages. Only fail if the ENTIRE document has no extractable text.
 * Returns { pages: [{page, text}], pageCount, skippedPages }.
 */
async function extractPdf(buffer) {
  const pdfjs = await loadPdfjs();
  const pages = [];
  let pdf;
  try {
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 0,
    }).promise;
  } catch (err) {
    throw new Error(`Tệp PDF bị hỏng, được mã hóa, hoặc không đọc được. (${err.message})`);
  }

  const numPages = pdf.numPages || 0;
  for (let i = 1; i <= numPages; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const page = await pdf.getPage(i);
      // eslint-disable-next-line no-await-in-loop
      const tc = await page.getTextContent();
      // Reconstruct line breaks from vertical position + EOL markers so that
      // chapter/lesson heading detection works on real books.
      let lastY;
      let text = '';
      for (const item of tc.items) {
        const y = item.transform ? item.transform[5] : undefined;
        if (lastY !== undefined && y !== undefined && Math.abs(lastY - y) >= 2) text += '\n';
        text += item.str;
        if (item.hasEOL) text += '\n';
        lastY = y;
      }
      pages.push({ page: i, text });
      page.cleanup();
    } catch (_) {
      // Image-only or unreadable page: record empty so it is skipped, not fatal.
      pages.push({ page: i, text: '' });
    }
  }
  try { await pdf.cleanup(); } catch (_) { /* ignore */ }

  const pageCount = numPages || pages.length;
  // Keep only pages that have real extractable text (skip image-only pages).
  const textPages = pages.filter((p) => (p.text || '').replace(/\s/g, '').length >= 10);
  const skippedPages = Math.max(pages.length - textPages.length, 0);

  const totalChars = textPages.reduce((n, p) => n + p.text.replace(/\s/g, '').length, 0);
  if (textPages.length === 0 || totalChars < 20) {
    throw new Error('PDF không có trang nào chứa văn bản trích xuất được (toàn bộ là ảnh/scan). Cần OCR — tính năng này chưa hỗ trợ.');
  }
  return { pages: textPages, pageCount, skippedPages };
}

/**
 * Extract text from a Word .docx buffer using mammoth. Word has no fixed page
 * boundaries, so the whole document is returned as a single logical "page";
 * chapter/lesson heading detection + chunking still operate on the text.
 * Returns the same shape as extractPdf: { pages, pageCount, skippedPages }.
 */
async function extractDocx(buffer) {
  let text = '';
  try {
    const result = await mammoth.extractRawText({ buffer });
    text = (result && result.value) ? result.value : '';
  } catch (err) {
    throw new Error(`Tệp Word bị hỏng hoặc không đọc được. (${err.message})`);
  }
  text = String(text).normalize('NFC').trim();
  if (text.replace(/\s/g, '').length < 20) {
    throw new Error('Tài liệu Word không có văn bản trích xuất được (có thể chỉ chứa hình ảnh). Cần OCR — tính năng này chưa hỗ trợ.');
  }
  return { pages: [{ page: 1, text }], pageCount: 1, skippedPages: 0 };
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Choose the correct extractor for a stored document based on its mimeType or
 * original filename. Defaults to PDF.
 */
function getExtractor(doc) {
  const name = (doc.originalName || '').toLowerCase();
  const mime = doc.mimeType || '';
  if (mime === DOCX_MIME || name.endsWith('.docx')) return extractDocx;
  return extractPdf;
}

/**
 * Process a document: load file -> extract per page -> chunk with heading tags
 * -> embed -> index. Idempotent on retry. Updates status to ready/failed.
 */
async function processDocument(documentId, options = {}) {
  const doc = await KnowledgeDocument.findById(documentId);
  if (!doc) return;
  if (doc.status === PROCESSING_STATUS.ARCHIVED) return;
  const extract = options.extractor || getExtractor(doc);

  doc.status = PROCESSING_STATUS.PROCESSING;
  doc.error = null;
  await doc.save();

  try {
    const buffer = await storage.read(doc.storageKey);
    const result = await extract(buffer);
    // Support both the new per-page shape and a legacy { text, pageCount } shape.
    let pages;
    let pageCount;
    let skippedPages = 0;
    if (Array.isArray(result.pages)) {
      ({ pages, pageCount, skippedPages = 0 } = result);
    } else {
      pages = [{ page: 1, text: result.text || '' }];
      pageCount = result.pageCount || 1;
    }
    const chunks = chunkPages(pages);
    if (chunks.length === 0) throw new Error('Không tạo được đoạn văn bản nào từ tài liệu.');

    // Remove any prior chunks (retry-safe, avoids duplicates).
    await DocumentChunk.deleteMany({ document: doc._id });

    const { vectors } = await embedTexts(chunks.map((c) => c.text));

    const toInsert = chunks.map((c, index) => ({
      document: doc._id,
      owner: doc.owner,
      school: doc.school,
      chunkIndex: index,
      text: c.text,
      pageStart: c.page,
      pageEnd: c.page,
      chapterNumber: c.chapterNumber,
      chapterLabel: c.chapterLabel,
      lessonNumber: c.lessonNumber,
      lessonLabel: c.lessonLabel,
      gradeLevel: doc.gradeLevel,
      subject: doc.subject,
      embedding: vectors[index] || [],
      contentHash: hashChunk(doc._id.toString(), index, c.text),
    }));

    await DocumentChunk.insertMany(toInsert, { ordered: false }).catch((e) => {
      if (e.code !== 11000) throw e;
    });

    doc.pageCount = pageCount;
    doc.chunkCount = chunks.length;
    doc.skippedPages = skippedPages;
    doc.status = PROCESSING_STATUS.READY;
    doc.processedAt = new Date();
    await doc.save();
  } catch (err) {
    doc.status = PROCESSING_STATUS.FAILED;
    doc.error = err.message.slice(0, 500);
    await doc.save();
  }
}

module.exports = {
  processDocument, chunkText, chunkPages, extractPdf, extractDocx, getExtractor, hashChunk, detectHeading,
};
