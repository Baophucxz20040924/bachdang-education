const express = require('express');
const { z } = require('zod');
const pipeline = require('./pipeline');
const retrieval = require('../knowledge/retrieval.service');
const Subject = require('../../models/Subject');
const AuditLog = require('../../models/AuditLog');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { aiLimiter } = require('../../middleware/rateLimit');
const { ROLES, QUESTION_TYPE_LIST } = require('../../config/constants');
const { asyncHandler } = require('../../utils/http');

const router = express.Router();

const generateSchema = z.object({
  sessionId: z.string().optional(),
  grade: z.number().int().min(1).max(5),
  subject: z.string().optional(),
  topic: z.string().optional(),
  objectives: z.array(z.string()).optional(),
  count: z.number().int().min(1).max(30).default(5),
  types: z.array(z.enum(QUESTION_TYPE_LIST)).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  language: z.string().optional(),
  additionalInstructions: z.string().optional(),
  history: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
  // RAG: optional knowledge documents to ground generation.
  documentIds: z.array(z.string()).optional(),
  requireSources: z.boolean().optional(),
  // Optional explicit chapter/lesson scope (teacher UI). Prompt text also parsed.
  chapter: z.number().int().optional().nullable(),
  lesson: z.number().int().optional().nullable(),
});

const regenSchema = z.object({
  sessionId: z.string().optional(),
  qid: z.string().optional(),
  type: z.enum(QUESTION_TYPE_LIST).optional(),
  instruction: z.string().optional(),
  subject: z.string().optional(),
});

router.use(requireAuth, requireRole(ROLES.TEACHER, ROLES.ADMIN), aiLimiter);

async function resolveSubject(subjectId) {
  if (!subjectId) return { subjectCode: '', subjectName: '' };
  const s = await Subject.findById(subjectId).catch(() => null);
  return { subjectCode: s ? s.code : '', subjectName: s ? s.name : '' };
}

router.post('/generate', validate(generateSchema), asyncHandler(async (req, res) => {
  const subject = await resolveSubject(req.body.subject);

  // RAG: if documents selected, retrieve relevant grounding chunks (authorization enforced).
  let sourceContext = '';
  let sourceReferences = [];
  if (req.body.documentIds && req.body.documentIds.length) {
    const query = [req.body.topic, (req.body.objectives || []).join(' '), req.body.additionalInstructions, subject.subjectName]
      .filter(Boolean).join(' ') || subject.subjectName || 'bài học';
    const { chunks, usedDocumentIds, scope } = await retrieval.retrieve(req.user, {
      query,
      documentIds: req.body.documentIds,
      topK: 8,
      scope: { chapter: req.body.chapter ?? null, lesson: req.body.lesson ?? null },
    });

    if (chunks.length === 0) {
      // Honest no-results fallback — do not pretend a source was used.
      if (req.body.requireSources) {
        const where = scope && (scope.chapter != null || scope.lesson != null)
          ? ` (đã tìm theo ${scope.chapter != null ? `chương ${scope.chapter}` : ''}${scope.lesson != null ? ` bài ${scope.lesson}` : ''})`
          : '';
        return res.status(422).json({
          error: {
            code: 'NO_SOURCE_CONTENT',
            message: `Tài liệu đã chọn không có nội dung phù hợp${where}. Hãy chọn chương/bài khác, tải thêm tài liệu, `
              + 'hoặc tạo bài tập không dùng tài liệu nguồn.',
          },
        });
      }
      // else: proceed ungrounded (teacher allowed it).
    } else {
      sourceContext = chunks.map((c) => {
        const tag = [c.chapterLabel, c.lessonLabel].filter(Boolean).join(' · ');
        return tag ? `[${tag}]\n${c.text}` : c.text;
      }).join('\n---\n');
      // Deduplicate references by document.
      const seen = new Set();
      sourceReferences = chunks.filter((c) => {
        const k = String(c.documentId);
        if (seen.has(k)) return false; seen.add(k); return true;
      }).map((c) => ({
        documentId: c.documentId,
        documentTitle: c.documentTitle,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        chapterLabel: c.chapterLabel,
        lessonLabel: c.lessonLabel,
      }));
      req.body.usedDocumentIds = usedDocumentIds;
    }
  }

  // Note: never send student-identifying info to the provider.
  const result = await pipeline.generate({ ...req.body, ...subject, sourceContext, sourceReferences });
  await AuditLog.create({
    actor: req.user.id,
    action: 'AI_GENERATE',
    meta: { count: result.questions.length, grounded: sourceReferences.length > 0 },
  });
  res.json(result);
}));

router.post('/regenerate-question', validate(regenSchema), asyncHandler(async (req, res) => {
  const subject = await resolveSubject(req.body.subject);
  const question = await pipeline.regenerateQuestion({ ...req.body, ...subject });
  res.json({ question });
}));

module.exports = router;
