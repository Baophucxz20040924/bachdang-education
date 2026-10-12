const { QUESTION_TYPES, ATTEMPT_STATUS } = require('../config/constants');

// Normalize text for lenient comparison (trim, lowercase, collapse spaces).
function normalize(str) {
  return String(str == null ? '' : str)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Remove Vietnamese diacritics (and combining marks) for accent-insensitive match.
function stripAccents(str) {
  return String(str == null ? '' : str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

// Build the comparison key for a text answer according to the question's
// matching options. ignoreAccents defaults to true (friendly for Vietnamese
// primary students); caseSensitive defaults to false.
function answerKey(str, opts = {}) {
  let s = String(str == null ? '' : str).trim().replace(/\s+/g, ' ');
  if (!opts.caseSensitive) s = s.toLowerCase();
  if (opts.ignoreAccents !== false) s = stripAccents(s);
  return s;
}

// Does a student's text response match any accepted answer?
function textMatches(response, accepted, opts) {
  const target = answerKey(response, opts);
  if (!target) return false;
  return accepted
    .filter((a) => a != null && String(a).trim() !== '')
    .some((a) => answerKey(a, opts) === target);
}

/**
 * Grade a single question against a student's response.
 * Returns { correct: boolean|null, earned: number, max: number, needsManual: boolean }.
 * correct === null means it cannot be auto-graded (short_answer with no answer key).
 */
function gradeQuestion(question, response) {
  const max = question.points || 1;
  const result = { correct: false, earned: 0, max, needsManual: false };
  const matchOpts = {
    caseSensitive: !!question.caseSensitive,
    ignoreAccents: question.ignoreAccents !== false,
  };

  switch (question.type) {
    case QUESTION_TYPES.MULTIPLE_CHOICE: {
      result.correct = Number(response) === Number(question.correctIndex);
      break;
    }
    case QUESTION_TYPES.TRUE_FALSE: {
      result.correct = Boolean(response) === Boolean(question.correctValue);
      break;
    }
    case QUESTION_TYPES.FILL_BLANK:
    case QUESTION_TYPES.MISSING_WORD: {
      const accepted = [question.answer, ...(question.acceptable || [])];
      result.correct = textMatches(response, accepted, matchOpts);
      break;
    }
    case QUESTION_TYPES.MATCHING: {
      // response expected as array of [i,j] pairs; compare as sets.
      const key = new Set((question.pairs || []).map((p) => `${p[0]}-${p[1]}`));
      const given = Array.isArray(response) ? response : [];
      const givenSet = new Set(given.map((p) => `${p[0]}-${p[1]}`));
      result.correct = key.size === givenSet.size && [...key].every((k) => givenSet.has(k));
      break;
    }
    case QUESTION_TYPES.SHORT_ANSWER: {
      // Accepted answers = explicit acceptable[] plus expectedAnswer (teacher's
      // model answer counts as a correct case). When ANY accepted answer exists,
      // auto-grade fully: a non-match is simply wrong (0 điểm), NOT sent to a
      // teacher. Manual review only when the teacher left no answer key at all.
      const accepted = [question.expectedAnswer, ...(question.acceptable || [])]
        .filter((a) => a != null && String(a).trim() !== '');
      const hasKey = accepted.length > 0;
      // autoGrade defaults to true when a key exists; teacher may force manual.
      const auto = hasKey && question.autoGrade !== false;
      if (auto) {
        result.correct = textMatches(response, accepted, matchOpts);
      } else {
        result.correct = null;
        result.needsManual = true;
      }
      break;
    }
    default:
      result.correct = null;
      result.needsManual = true;
  }

  if (result.correct === true) result.earned = max;
  return result;
}

/**
 * Grade an entire attempt using its questionSnapshot and answers.
 * Returns { autoScore, maxScore, needsGrading, perQuestion:[{qid, correct, earned, max, needsManual}] }.
 */
function gradeAttempt(questionSnapshot, answers) {
  const answerMap = new Map((answers || []).map((a) => [a.qid, a.response]));
  let autoScore = 0;
  let maxScore = 0;
  let needsGrading = false;
  const perQuestion = [];

  for (const q of questionSnapshot) {
    const res = gradeQuestion(q, answerMap.get(q.qid));
    maxScore += res.max;
    if (res.correct === true) autoScore += res.earned;
    if (res.needsManual || res.correct === null) needsGrading = true;
    perQuestion.push({ qid: q.qid, ...res });
  }

  return { autoScore, maxScore, needsGrading, perQuestion };
}

function attemptStatusAfterGrade(needsGrading) {
  return needsGrading ? ATTEMPT_STATUS.NEEDS_GRADING : ATTEMPT_STATUS.GRADED;
}

module.exports = {
  gradeQuestion, gradeAttempt, attemptStatusAfterGrade, normalize, stripAccents, answerKey,
};
