const express = require('express');
const multer = require('multer');
const KnowledgeDocument = require('../../models/KnowledgeDocument');
const DocumentChunk = require('../../models/DocumentChunk');
const AuditLog = require('../../models/AuditLog');
const storage = require('../../utils/storage');
const { processDocument } = require('./processing.service');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { ROLES } = require('../../config/constants');
const { asyncHandler, getPagination, paged } = require('../../utils/http');
const { AppError, messages } = require('../../utils/errors');
const env = require('../../config/env');

const { PROCESSING_STATUS } = KnowledgeDocument;
const router = express.Router();

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    const okPdf = /\.pdf$/i.test(name) && file.mimetype === 'application/pdf';
    const okDocx = /\.docx$/i.test(name)
      && (file.mimetype === DOCX_MIME || file.mimetype === 'application/octet-stream' || file.mimetype === 'application/zip');
    if (!okPdf && !okDocx) {
      return cb(new AppError(400, 'VALIDATION', 'Chỉ chấp nhận tệp PDF hoặc Word (.docx).'));
    }
    return cb(null, true);
  },
});

// PDF magic bytes: %PDF- ; DOCX is a ZIP container: starts with "PK".
function looksLikePdf(buffer) {
  return buffer && buffer.length > 4 && buffer.slice(0, 5).toString('latin1') === '%PDF-';
}
function looksLikeDocx(buffer) {
  return buffer && buffer.length > 1 && buffer.slice(0, 2).toString('latin1') === 'PK';
}

// Detect kind from filename + content. Returns { ext, mime } or null if invalid.
function detectKind(file) {
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.pdf') && looksLikePdf(file.buffer)) {
    return { ext: '.pdf', mime: 'application/pdf' };
  }
  if (name.endsWith('.docx') && looksLikeDocx(file.buffer)) {
    return { ext: '.docx', mime: DOCX_MIME };
  }
  return null;
}

router.use(requireAuth, requireRole(ROLES.TEACHER, ROLES.ADMIN));

// Upload a PDF/DOCX -> store privately -> create record -> kick off processing.
router.post('/', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(400, 'VALIDATION', 'Vui lòng chọn tệp PDF hoặc Word (.docx) để tải lên.');
  const kind = detectKind(req.file);
  if (!kind) {
    throw new AppError(400, 'VALIDATION', 'Nội dung tệp không hợp lệ (chỉ chấp nhận PDF hoặc Word .docx).');
  }
  const { title, description, gradeLevel, subject, book, chapter, lesson } = req.body;
  if (!title || !title.trim()) throw new AppError(400, 'VALIDATION', 'Vui lòng nhập tiêu đề tài liệu.');

  const key = storage.generateKey(kind.ext);
  await storage.save(key, req.file.buffer);

  const doc = await KnowledgeDocument.create({
    owner: req.user.id,
    title: title.trim(),
    description: description || '',
    originalName: req.file.originalname,
    storageKey: key,
    mimeType: kind.mime,
    fileSize: req.file.size,
    gradeLevel: gradeLevel ? Number(gradeLevel) : null,
    subject: subject || null,
    book: book || '',
    chapter: chapter || '',
    lesson: lesson || '',
    status: PROCESSING_STATUS.PROCESSING,
  });

  await AuditLog.create({ actor: req.user.id, action: 'KB_UPLOAD', targetType: 'KnowledgeDocument', targetId: doc._id });

  // Process asynchronously (does not block the response / request path).
  setImmediate(() => { processDocument(doc._id).catch(() => {}); });

  res.status(201).json(doc);
}));

// List & filter (only own documents; admin sees all).
router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.user.role !== ROLES.ADMIN) filter.owner = req.user.id;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.grade) filter.gradeLevel = Number(req.query.grade);
  if (req.query.subject) filter.subject = req.query.subject;
  if (req.query.q) filter.title = { $regex: req.query.q, $options: 'i' };
  const [items, total] = await Promise.all([
    KnowledgeDocument.find(filter).populate('subject', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit),
    KnowledgeDocument.countDocuments(filter),
  ]);
  res.json(paged(items, total, page, limit));
}));

// Load + authorize a document for the current user.
async function loadOwned(req) {
  const doc = await KnowledgeDocument.findById(req.params.id);
  if (!doc) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  if (req.user.role !== ROLES.ADMIN && doc.owner.toString() !== req.user.id) {
    throw new AppError(403, 'FORBIDDEN', messages.FORBIDDEN);
  }
  return doc;
}

// Details incl. a small text preview from the first chunks.
router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await loadOwned(req);
  const previewChunks = await DocumentChunk.find({ document: doc._id }).sort({ chunkIndex: 1 }).limit(3).select('text pageStart');
  res.json({ document: doc, preview: previewChunks.map((c) => c.text) });
}));

// Retry processing of a failed/ready document.
router.post('/:id/retry', asyncHandler(async (req, res) => {
  const doc = await loadOwned(req);
  doc.status = PROCESSING_STATUS.PROCESSING;
  doc.error = null;
  await doc.save();
  setImmediate(() => { processDocument(doc._id).catch(() => {}); });
  res.json(doc);
}));

// Delete document + its chunks + stored file (prevents future retrieval).
router.delete('/:id', asyncHandler(async (req, res) => {
  const doc = await loadOwned(req);
  await DocumentChunk.deleteMany({ document: doc._id });
  await storage.remove(doc.storageKey);
  await doc.deleteOne();
  await AuditLog.create({ actor: req.user.id, action: 'KB_DELETE', targetType: 'KnowledgeDocument', targetId: doc._id });
  res.json({ ok: true });
}));

// Multer errors -> Vietnamese messages
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? `Tệp vượt quá giới hạn ${env.MAX_UPLOAD_MB}MB.`
      : 'Tải tệp thất bại.';
    return res.status(400).json({ error: { code: 'UPLOAD', message: msg } });
  }
  return next(err);
});

module.exports = router;
