const Session = require('../../models/Session');
const Attempt = require('../../models/Attempt');
const Membership = require('../../models/Membership');
const { SESSION_STATUS, ATTEMPT_STATUS, REVEAL_POLICY } = require('../../config/constants');
const { gradeAttempt, attemptStatusAfterGrade } = require('../../utils/grading');
const { stripAnswerKey } = require('../sessions/sessions.service');
const { AppError, messages } = require('../../utils/errors');

async function studentClassIds(studentId) {
  const memberships = await Membership.find({ student: studentId, active: true });
  return memberships.map((m) => m.class);
}

// Only PUBLISHED sessions assigned to the student's classes and within availability window.
async function listAssigned(studentId) {
  const classIds = await studentClassIds(studentId);
  const now = new Date();
  const sessions = await Session.find({
    status: SESSION_STATUS.PUBLISHED,
    targetClasses: { $in: classIds },
  })
    .populate('subject', 'name code')
    .sort({ publishedAt: -1 });

  const available = sessions.filter((s) => {
    const openOk = !s.settings.openAt || s.settings.openAt <= now;
    const dueOk = !s.settings.dueAt || s.settings.dueAt >= now;
    return openOk && dueOk;
  });

  // Attach student's attempt status for each.
  const attempts = await Attempt.find({ student: studentId, session: { $in: available.map((s) => s._id) } });
  const bySession = new Map(attempts.map((a) => [a.session.toString(), a]));

  return available.map((s) => {
    const a = bySession.get(s._id.toString());
    return {
      _id: s._id,
      title: s.title,
      description: s.description,
      subject: s.subject,
      gradeLevel: s.gradeLevel,
      topic: s.topic,
      dueAt: s.settings.dueAt,
      questionCount: s.questions.length,
      attemptStatus: a ? a.status : 'not_started',
      attemptId: a ? a._id : null,
    };
  });
}

async function assertAssigned(studentId, session) {
  const classIds = (await studentClassIds(studentId)).map((c) => c.toString());
  const assigned = session.targetClasses.some((c) => classIds.includes(c.toString()));
  if (!assigned) throw new AppError(403, 'FORBIDDEN', messages.FORBIDDEN);
  return classIds;
}

async function startAttempt(studentId, sessionId) {
  const session = await Session.findById(sessionId);
  if (!session || session.status !== SESSION_STATUS.PUBLISHED) {
    throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  }
  const classIds = await assertAssigned(studentId, session);

  // Resume in-progress attempt if present.
  const existing = await Attempt.findOne({ student: studentId, session: sessionId, status: ATTEMPT_STATUS.IN_PROGRESS });
  if (existing) return toClientAttempt(existing);

  const priorCount = await Attempt.countDocuments({ student: studentId, session: sessionId });
  if (priorCount >= (session.settings.maxAttempts || 1)) {
    throw new AppError(403, 'MAX_ATTEMPTS', messages.MAX_ATTEMPTS);
  }

  // Snapshot questions (with answer keys) so later edits don't corrupt this attempt.
  const snapshot = session.questions.map((q) => (q.toObject ? q.toObject() : q));
  const maxScore = snapshot.reduce((sum, q) => sum + (q.points || 1), 0);

  const attempt = await Attempt.create({
    session: sessionId,
    student: studentId,
    class: session.targetClasses.find((c) => classIds.includes(c.toString())) || session.targetClasses[0],
    questionSnapshot: snapshot,
    maxScore,
    attemptNumber: priorCount + 1,
  });
  return toClientAttempt(attempt);
}

async function saveAnswers(attempt, answers) {
  if (attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) {
    throw new AppError(409, 'ALREADY_SUBMITTED', messages.ALREADY_SUBMITTED);
  }
  attempt.answers = answers;
  await attempt.save();
  return { ok: true };
}

async function submitAttempt(attempt) {
  if (attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) {
    throw new AppError(409, 'ALREADY_SUBMITTED', messages.ALREADY_SUBMITTED);
  }
  // Server-side scoring from snapshot. Ignores any client-supplied score.
  const { autoScore, maxScore, needsGrading } = gradeAttempt(attempt.questionSnapshot, attempt.answers);
  attempt.autoScore = autoScore;
  attempt.maxScore = maxScore;
  attempt.status = attemptStatusAfterGrade(needsGrading);
  attempt.submittedAt = new Date();
  if (!needsGrading) {
    attempt.totalScore = autoScore;
    attempt.gradedAt = new Date();
  }
  await attempt.save();
  return buildResult(attempt);
}

async function listMyAttempts(studentId) {
  const attempts = await Attempt.find({ student: studentId })
    .populate({ path: 'session', select: 'title subject gradeLevel settings' })
    .sort({ updatedAt: -1 });
  return attempts.map((a) => ({
    _id: a._id,
    session: a.session,
    status: a.status,
    totalScore: a.totalScore,
    maxScore: a.maxScore,
    submittedAt: a.submittedAt,
  }));
}

// Client view of an in-progress attempt: strip answer keys from snapshot.
function toClientAttempt(attempt) {
  return {
    _id: attempt._id,
    session: attempt.session,
    status: attempt.status,
    questions: attempt.questionSnapshot.map((q) => stripAnswerKey(q)),
    answers: attempt.answers,
    maxScore: attempt.maxScore,
  };
}

// Result respects revealPolicy (REQ-ST-3).
async function buildResult(attempt) {
  const session = await Session.findById(attempt.session);
  const policy = session ? session.settings.revealPolicy : REVEAL_POLICY.AFTER_SUBMIT;
  const now = new Date();
  let reveal = false;
  if (policy === REVEAL_POLICY.AFTER_SUBMIT) reveal = true;
  else if (policy === REVEAL_POLICY.AFTER_DUE) reveal = session.settings.dueAt && session.settings.dueAt <= now;

  const base = {
    attemptId: attempt._id,
    status: attempt.status,
    autoScore: attempt.autoScore,
    totalScore: attempt.totalScore,
    maxScore: attempt.maxScore,
  };
  if (reveal) {
    const { perQuestion } = gradeAttempt(attempt.questionSnapshot, attempt.answers);
    base.detail = attempt.questionSnapshot.map((q, i) => ({
      qid: q.qid,
      prompt: q.prompt,
      correct: perQuestion[i].correct,
      explanation: q.explanation || null,
    }));
  }
  return base;
}

module.exports = { listAssigned, startAttempt, saveAnswers, submitAttempt, listMyAttempts, buildResult };
