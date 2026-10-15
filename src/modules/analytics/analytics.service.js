const Attempt = require('../../models/Attempt');
const Membership = require('../../models/Membership');
const Class = require('../../models/Class');
const Session = require('../../models/Session');
const User = require('../../models/User');
const { gradeAttempt } = require('../../utils/grading');
const { ATTEMPT_STATUS, SESSION_STATUS, ROLES } = require('../../config/constants');
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

// ---------------------------------------------------------------------------
// Class-level progress (teacher view): per section (e.g. 1/1, 1/2) show a
// leaderboard (by score + by diligence) and each student's homework
// completion % ("chuyên cần"), plus a drill-down to one student's detail.
// ---------------------------------------------------------------------------

const FINISHED = [ATTEMPT_STATUS.SUBMITTED, ATTEMPT_STATUS.NEEDS_GRADING, ATTEMPT_STATUS.GRADED];

// Sections a teacher can see (for the section selector). Admin sees all.
async function listTeacherClasses(user) {
  const filter = { isActive: true };
  if (user.role !== ROLES.ADMIN) filter.teachers = user.id;
  const classes = await Class.find(filter).select('name gradeLevel').sort({ gradeLevel: 1, name: 1 });
  return classes.map((c) => ({ id: c._id.toString(), name: c.name, gradeLevel: c.gradeLevel }));
}

function denseRank(sorted, valueKey) {
  let rank = 0;
  let prev = null;
  sorted.forEach((row, i) => {
    const v = row[valueKey];
    if (i === 0 || v !== prev) { rank = i + 1; prev = v; }
    row.rank = rank;
  });
  return sorted;
}

// Full progress for ONE class section.
async function classProgress(klass) {
  const classId = klass._id;

  // Students enrolled in this section.
  const memberships = await Membership.find({ class: classId, active: true }).populate(
    'student',
    'fullName username gradeLevel isActive',
  );
  const students = memberships.map((m) => m.student).filter(Boolean);
  const studentIds = students.map((s) => s._id.toString());

  // Homework = published sessions assigned to this section.
  const sessions = await Session.find({
    status: SESSION_STATUS.PUBLISHED,
    targetClasses: classId,
  }).select('_id title');
  const totalHomework = sessions.length;
  const sessionIds = sessions.map((s) => s._id);

  // All attempts by these students for this class's homework.
  const attempts = await Attempt.find({
    student: { $in: studentIds },
    class: classId,
    session: { $in: sessionIds },
  }).select('student session status totalScore maxScore submittedAt');

  // Aggregate per student.
  const agg = new Map();
  studentIds.forEach((sid) => agg.set(sid, {
    score: 0, maxScore: 0, finished: new Set(), lastActiveAt: 0,
  }));
  for (const a of attempts) {
    const sid = a.student.toString();
    const row = agg.get(sid);
    if (!row) continue;
    if (FINISHED.includes(a.status)) {
      row.finished.add(a.session.toString());
      const ts = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
      if (ts > row.lastActiveAt) row.lastActiveAt = ts;
    }
    if (a.totalScore != null) {
      row.score += a.totalScore;
      row.maxScore += a.maxScore || 0;
    }
  }

  const base = students.map((s) => {
    const sid = s._id.toString();
    const row = agg.get(sid);
    const completed = row.finished.size;
    const first = (s.fullName || '').trim().split(/\s+/).slice(-1)[0] || s.fullName;
    return {
      studentId: sid,
      fullName: s.fullName,
      firstName: first,
      username: s.username,
      gradeLevel: s.gradeLevel,
      isActive: s.isActive,
      score: row.score,
      maxScore: row.maxScore,
      completed,
      totalHomework,
      // Homework completion % ("chuyên cần"): finished / assigned.
      completionRate: totalHomework ? completed / totalHomework : 0,
      lastActiveAt: row.lastActiveAt || null,
    };
  });

  const byScore = base
    .map((r) => ({ ...r }))
    .sort((a, b) => b.score - a.score || b.completed - a.completed || a.fullName.localeCompare(b.fullName, 'vi'));
  denseRank(byScore, 'score');

  const byDiligence = base
    .map((r) => ({ ...r }))
    .sort((a, b) => b.completed - a.completed
      || (b.lastActiveAt || 0) - (a.lastActiveAt || 0)
      || b.score - a.score
      || a.fullName.localeCompare(b.fullName, 'vi'));
  denseRank(byDiligence, 'completed');

  // Class summary.
  const totalCompleted = base.reduce((sum, r) => sum + r.completed, 0);
  const possible = base.length * totalHomework;
  const avgCompletionRate = possible ? totalCompleted / possible : 0;
  const scoredStudents = base.filter((r) => r.maxScore > 0);
  const avgScorePct = scoredStudents.length
    ? scoredStudents.reduce((sum, r) => sum + r.score / r.maxScore, 0) / scoredStudents.length
    : null;

  return {
    classId: classId.toString(),
    className: klass.name,
    gradeLevel: klass.gradeLevel,
    totalStudents: base.length,
    totalHomework,
    avgCompletionRate,
    avgScorePct,
    byScore,
    byDiligence,
  };
}

// Drill-down: one student's per-homework breakdown within a section.
async function classStudentDetail(klass, studentId) {
  const classId = klass._id;

  const membership = await Membership.findOne({ class: classId, student: studentId, active: true });
  if (!membership) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);

  const student = await User.findById(studentId).select('fullName username gradeLevel isActive');
  if (!student) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);

  const sessions = await Session.find({
    status: SESSION_STATUS.PUBLISHED,
    targetClasses: classId,
  }).select('_id title dueAt settings').sort({ createdAt: -1 });

  const attempts = await Attempt.find({
    student: studentId,
    class: classId,
    session: { $in: sessions.map((s) => s._id) },
  }).select('session status totalScore maxScore submittedAt');
  const bySession = new Map(attempts.map((a) => [a.session.toString(), a]));

  const rows = sessions.map((s) => {
    const a = bySession.get(s._id.toString());
    const finished = a ? FINISHED.includes(a.status) : false;
    return {
      sessionId: s._id.toString(),
      title: s.title,
      status: a ? a.status : 'not_started',
      finished,
      totalScore: a ? a.totalScore : null,
      maxScore: a ? a.maxScore : null,
      submittedAt: a ? a.submittedAt : null,
      attemptId: a ? a._id.toString() : null,
    };
  });

  const completed = rows.filter((r) => r.finished).length;
  const totalHomework = sessions.length;
  const scored = rows.filter((r) => r.totalScore != null);
  const totalScore = scored.reduce((sum, r) => sum + r.totalScore, 0);
  const totalMax = scored.reduce((sum, r) => sum + (r.maxScore || 0), 0);

  return {
    student: {
      studentId: student._id.toString(),
      fullName: student.fullName,
      username: student.username,
      gradeLevel: student.gradeLevel,
      isActive: student.isActive,
    },
    className: klass.name,
    totalHomework,
    completed,
    completionRate: totalHomework ? completed / totalHomework : 0,
    totalScore,
    totalMax,
    scorePct: totalMax ? totalScore / totalMax : null,
    rows,
  };
}

module.exports = {
  sessionAnalytics,
  getAttemptDetail,
  gradeManually,
  listTeacherClasses,
  classProgress,
  classStudentDetail,
};
