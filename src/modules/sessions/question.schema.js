const { z } = require('zod');
const { QUESTION_TYPES } = require('../../config/constants');

const baseFields = {
  qid: z.string().optional(),
  prompt: z.string().min(1, 'Nội dung câu hỏi không được trống'),
  instruction: z.string().nullable().optional(),
  points: z.number().positive().default(1),
  explanation: z.string().nullable().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).nullable().optional(),
  source: z.enum(['ai', 'manual']).default('manual'),
  // Auto-grading options for text answers (short_answer / fill_blank / missing_word).
  autoGrade: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  ignoreAccents: z.boolean().optional(),
  sources: z.array(z.object({
    documentId: z.any().optional(),
    documentTitle: z.string().optional(),
    pageStart: z.number().nullable().optional(),
    pageEnd: z.number().nullable().optional(),
    chapterLabel: z.string().nullable().optional(),
    lessonLabel: z.string().nullable().optional(),
  })).optional(),
  media: z
    .object({
      imageUrl: z.string().nullable().optional(),
      imageSearchTerms: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
};

const multipleChoice = z.object({
  ...baseFields,
  type: z.literal(QUESTION_TYPES.MULTIPLE_CHOICE),
  options: z.array(z.string().min(1)).min(2, 'Cần ít nhất 2 phương án'),
  correctIndex: z.number().int().min(0),
});

const trueFalse = z.object({
  ...baseFields,
  type: z.literal(QUESTION_TYPES.TRUE_FALSE),
  correctValue: z.boolean(),
});

const fillBlank = z.object({
  ...baseFields,
  type: z.literal(QUESTION_TYPES.FILL_BLANK),
  answer: z.string().min(1, 'Thiếu đáp án'),
  acceptable: z.array(z.string()).default([]),
  wordBank: z.array(z.string()).default([]),
});

const missingWord = z.object({
  ...baseFields,
  type: z.literal(QUESTION_TYPES.MISSING_WORD),
  text: z.string().min(1),
  answer: z.string().min(1, 'Thiếu đáp án'),
  acceptable: z.array(z.string()).default([]),
  wordBank: z.array(z.string()).default([]),
});

const shortAnswer = z.object({
  ...baseFields,
  type: z.literal(QUESTION_TYPES.SHORT_ANSWER),
  expectedAnswer: z.string().min(1, 'Thiếu đáp án mẫu'),
  acceptable: z.array(z.string()).default([]),
});

const matching = z.object({
  ...baseFields,
  type: z.literal(QUESTION_TYPES.MATCHING),
  left: z.array(z.string().min(1)).min(2, 'Cần ít nhất 2 mục bên trái'),
  right: z.array(z.string().min(1)).min(2, 'Cần ít nhất 2 mục bên phải'),
  pairs: z.array(z.tuple([z.number().int(), z.number().int()])).min(1, 'Cần ít nhất 1 cặp nối'),
});

const questionSchema = z.discriminatedUnion('type', [
  multipleChoice,
  trueFalse,
  fillBlank,
  missingWord,
  shortAnswer,
  matching,
]);

// Cross-field checks that cannot live inside a discriminatedUnion member
// (refine would turn the member into ZodEffects and break the union).
function crossFieldError(q) {
  if (q.type === QUESTION_TYPES.MULTIPLE_CHOICE && q.correctIndex >= q.options.length) {
    return 'correctIndex vượt quá số phương án';
  }
  if (q.type === QUESTION_TYPES.MISSING_WORD && !String(q.text || '').includes('___')) {
    return 'Câu điền từ phải chứa chỗ trống ___';
  }
  if (q.type === QUESTION_TYPES.MATCHING) {
    const bad = q.pairs.some(([i, j]) => i < 0 || i >= q.left.length || j < 0 || j >= q.right.length);
    if (bad) return 'Cặp nối tham chiếu chỉ số không hợp lệ';
  }
  return null;
}

/**
 * Validate a single question. Returns { ok, data } or { ok:false, error }.
 */
function validateQuestion(raw) {
  const result = questionSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, error: result.error.errors.map((e) => e.message).join('; ') };
  }
  const crossErr = crossFieldError(result.data);
  if (crossErr) return { ok: false, error: crossErr };
  return { ok: true, data: result.data };
}

module.exports = { questionSchema, validateQuestion };
