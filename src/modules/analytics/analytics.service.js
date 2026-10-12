const Attempt = require('../../models/Attempt');
const Membership = require('../../models/Membership');
const { gradeAttempt } = require('../../utils/grading');
const { ATTEMPT_STATUS } = require('../../config/constants');
const { AppError, messages } = require('../../utils/errors');

// Aggregate progress for a session from real Attempt records.
async function sessionAnalytics(session) {
  const classIds = session.targetClasses;
  const memberships = await Membership.find({ class: { $in: classIds }, active: true }).populate(
    'student',
    'fullName username',
  );
  const students = memberships.map((m) => m.student).filter(Boolean);

  const attempts = await Attempt.find({ session: session._id });
  const byStudent = new Map(attempts.map((a) => [a.student.toString(), a]));

  const rows = students.map((s) => {
    const a = byStudent.get(s._id.toString());
    return {
      studentId: s._id,
      fullName: s.fullName,
      username: s.username,
      status: a ? a.status : 'not_started',
      totalScore: a ? a.totalScore : null,
      maxScore: a ? a.maxScore : null,
      submittedAt: a ? a.submittedAt : null,
    };
  });

  const submitted = attempts.filter((a) => a.submittedAt);
  const graded = attempts.filter((a) => a.totalScore != null);
  const completionRate = students.length ? submitted.length / students.length : 0;
  const avgScore = graded.length
    ? graded.reduce((sum, a) => sum + a.totalScore, 0) / graded.length
    : null;

  // Per-question correctness across all submitted attempts.
  const questionStats = {};
  for (const a of submitted) {
    const { perQuestion } = gradeAttempt(a.questionSnapshot, a.answers);
    for (const pq of perQuestion) {
      if (!questionStats[pq.qid]) questionStats[pq.qid] = { correct: 0, total: 0 };
      questionStats[pq.qid].total += 1;
      if (pq.correct === true) questionStats[pq.qid].correct += 1;
    }
  }
  const questionBreakdown = session.questions.map((q) => {
    const stat = questionStats[q.qid] || { correct: 0, total: 0 };
    return {
      qid: q.qid,
      prompt: q.prompt,
      type: q.type,
      correctRate: stat.total ? stat.correct / stat.total : null,
      answered: stat.total,
    };
  });

  return {
    totalStudents: students.length,
    submittedCount: submitted.length,
    completionRate,
    avgScore,
    rows,
    questionBreakdown,
  };
}

async function getAttemptDetail(attemptId) {
  const attempt = await Attempt.findById(attemptId).populate('student', 'fullName username');
  if (!attempt) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  const { perQuestion } = gradeAttempt(attempt.questionSnapshot, attempt.answers);
  return { attempt, perQuestion };
}

// Teacher manually grades (e.g. short_answer). manualScore is extra points to add.
async function gradeManually(attemptId, manualScore) {
  const attempt = await Attempt.findById(attemptId);
  if (!attempt) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  attempt.manualScore = manualScore;
  attempt.totalScore = (attempt.autoScore || 0) + manualScore;
  attempt.status = ATTEMPT_STATUS.GRADED;
  attempt.gradedAt = new Date();
  await attempt.save();
  return attempt;
}

module.exports = { sessionAnalytics, getAttemptDetail, gradeManually };
