const DocumentChunk = require('../../models/DocumentChunk');
const KnowledgeDocument = require('../../models/KnowledgeDocument');
const { embedTexts, cosineSimilarity } = require('../../utils/embeddings');
const { ROLES } = require('../../config/constants');

const { PROCESSING_STATUS } = KnowledgeDocument;

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
function toNum(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (ROMAN[s]) return ROMAN[s];
  return null;
}

/**
 * Parse references to chapter/lesson from a Vietnamese prompt, e.g.
 *   "tạo bài tập chương 1"            -> { chapter: 1 }
 *   "bài 1 chương 2"                  -> { chapter: 2, lesson: 1 }
 *   "bài 3"                           -> { lesson: 3 }
 */
function parseScope(text) {
  const s = String(text || '').toLowerCase();
  const scope = { chapter: null, lesson: null };
  const ch = s.match(/ch[uư][ơo]ng\s+([0-9]+|[ivx]+)/i);
  if (ch) scope.chapter = toNum(ch[1]);
  const le = s.match(/\bbài\s+([0-9]+|[ivx]+)/i);
  if (le) scope.lesson = toNum(le[1]);
  return scope;
}

async function authorizedDocumentIds(user, requestedIds) {
  const filter = { _id: { $in: requestedIds }, status: PROCESSING_STATUS.READY };
  if (user.role !== ROLES.ADMIN) filter.owner = user.id;
  const docs = await KnowledgeDocument.find(filter).select('_id');
  return docs.map((d) => d._id);
}

/**
 * Retrieve the top-k most relevant chunks. Enforces authorization. If the query
 * (or an explicit scope) references a chapter/lesson, chunks matching that
 * chapter/lesson are preferred: we filter to them when enough exist, otherwise
 * boost their score. Returns { chunks, usedDocumentIds, scope }.
 */
async function retrieve(user, {
  query, documentIds, topK = 6, minScore = 0.03, scope: explicitScope,
}) {
  if (!documentIds || documentIds.length === 0) return { chunks: [], usedDocumentIds: [], scope: {} };
  const allowed = await authorizedDocumentIds(user, documentIds);
  if (allowed.length === 0) return { chunks: [], usedDocumentIds: [], scope: {} };

  const scope = {
    chapter: explicitScope?.chapter ?? null,
    lesson: explicitScope?.lesson ?? null,
  };
  const parsed = parseScope(query);
  if (scope.chapter == null) scope.chapter = parsed.chapter;
  if (scope.lesson == null) scope.lesson = parsed.lesson;

  let chunks = await DocumentChunk.find({ document: { $in: allowed } })
    .populate('document', 'title')
    .limit(5000);
  if (chunks.length === 0) return { chunks: [], usedDocumentIds: [], scope };

  // If a chapter/lesson was requested and matching chunks exist, restrict to them.
  const matchesScope = (c) => {
    if (scope.chapter != null && c.chapterNumber !== scope.chapter) return false;
    if (scope.lesson != null && c.lessonNumber !== scope.lesson) return false;
    return true;
  };
  if (scope.chapter != null || scope.lesson != null) {
    const scoped = chunks.filter(matchesScope);
    if (scoped.length > 0) chunks = scoped;
  }

  const { vectors } = await embedTexts([query || '']);
  const qVec = vectors[0];

  const scored = chunks.map((c) => {
    let score = cosineSimilarity(qVec, c.embedding);
    // Light boost when the chunk matches the requested scope (helps when we did
    // not hard-filter because matches were sparse).
    if ((scope.chapter != null || scope.lesson != null) && matchesScope(c)) score += 0.15;
    return {
      text: c.text,
      documentId: c.document?._id,
      documentTitle: c.document?.title || '',
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
      chapterLabel: c.chapterLabel,
      lessonLabel: c.lessonLabel,
      score,
    };
  });
  scored.sort((a, b) => b.score - a.score);

  const top = scored.filter((s) => s.score >= minScore).slice(0, topK);
  const usedDocumentIds = [...new Set(top.map((t) => String(t.documentId)))];
  return { chunks: top, usedDocumentIds, scope };
}

module.exports = { retrieve, authorizedDocumentIds, parseScope };
