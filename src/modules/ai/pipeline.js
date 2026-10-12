const { v4: uuidv4 } = require('uuid');
const { getProvider } = require('./providerAdapter');
const { validateQuestion } = require('../sessions/question.schema');
const { normalize } = require('../../utils/grading');
const { AppError, messages } = require('../../utils/errors');

/**
 * Critic pass: flags duplicates and inconsistencies. Does not reject valid
 * questions; returns warnings for the teacher to review.
 */
function critique(questions) {
  const warnings = [];
  const seen = new Map();
  questions.forEach((q, idx) => {
    const key = normalize(q.prompt + (q.text || ''));
    if (seen.has(key)) {
      warnings.push({ index: idx, qid: q.qid, issue: 'Câu hỏi có thể trùng lặp với câu khác.' });
    } else {
      seen.set(key, idx);
    }
    // Multiple choice sanity: options should be distinct
    if (q.type === 'multiple_choice' && q.options) {
      const uniq = new Set(q.options.map(normalize));
      if (uniq.size !== q.options.length) {
        warnings.push({ index: idx, qid: q.qid, issue: 'Các phương án trắc nghiệm bị trùng.' });
      }
    }
  });
  return warnings;
}

/**
 * Full pipeline: provider.generate -> Zod validate each -> attach qid/source -> critic.
 * Returns { questions, warnings }. Throws AppError if the provider fails entirely.
 */
async function generate(ctx) {
  const provider = getProvider();
  let raw;
  try {
    raw = await provider.generateQuestions(ctx);
  } catch (err) {
    throw new AppError(502, 'AI_FAILED', messages.AI_FAILED);
  }
  if (!Array.isArray(raw)) {
    throw new AppError(502, 'AI_FAILED', messages.AI_FAILED);
  }

  const questions = [];
  const warnings = [];
  raw.forEach((item, idx) => {
    const candidate = { ...item, qid: uuidv4(), source: 'ai' };
    const result = validateQuestion(candidate);
    if (result.ok) {
      questions.push({ ...result.data, qid: candidate.qid });
    } else {
      warnings.push({ index: idx, issue: `Câu hỏi bị loại do không hợp lệ: ${result.error}` });
    }
  });

  if (questions.length === 0) {
    throw new AppError(502, 'AI_FAILED', 'AI không tạo được câu hỏi hợp lệ. Vui lòng thử lại.');
  }

  warnings.push(...critique(questions));

  // Attach source references (document + page) when grounding was used.
  if (ctx.sourceReferences && ctx.sourceReferences.length) {
    questions.forEach((q) => { q.sources = ctx.sourceReferences; });
  }
  return { questions, warnings, sources: ctx.sourceReferences || [] };
}

async function regenerateQuestion(ctx) {
  const provider = getProvider();
  let raw;
  try {
    raw = await (provider.regenerateQuestion
      ? provider.regenerateQuestion(ctx)
      : provider.generateQuestions({ ...ctx, count: 1 }).then((a) => a[0]));
  } catch (err) {
    throw new AppError(502, 'AI_FAILED', messages.AI_FAILED);
  }
  const candidate = { ...raw, qid: ctx.qid || uuidv4(), source: 'ai' };
  const result = validateQuestion(candidate);
  if (!result.ok) throw new AppError(502, 'AI_FAILED', `Câu hỏi mới không hợp lệ: ${result.error}`);
  return { ...result.data, qid: candidate.qid };
}

module.exports = { generate, regenerateQuestion, critique };
