const User = require('../../models/User');
const Session = require('../../models/Session');
const Attempt = require('../../models/Attempt');
const Membership = require('../../models/Membership');
const Class = require('../../models/Class');
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

// Assigns dense ranks to an already-sorted list using the given numeric key.
// Equal values share the same rank (1,1,3,...). Mutates each row's `rank`.
function assignDenseRanks(list, key) {
  let rank = 0;
  let prev = null;
  list.forEach((it, idx) => {
    if (it[key] !== prev) {
      rank = idx + 1;
      prev = it[key];
    }
    it.rank = rank;
  });
  return list;
}

// Class leaderboard. Returns TWO rankings over classmates in a SINGLE class
// section (e.g. 1/1, 1/2, ...):
//   • byScore     — total earned points across graded attempts (achievement)
//   • byDiligence — number of exercises the student has done (chuyên cần / effort)
//
// A grade can have many sections, so a student may belong to several classes.
// The board is always scoped to exactly ONE section:
//   • `classId` (optional) picks the section to show. The student must be a
//     member of it; otherwise it is ignored and the primary section is used.
//   • When omitted, the student's primary (first-joined) section is used.
// The response also lists every section the student belongs to (`classes`) so
// the UI can offer a section selector, plus the resolved `classId`.
// REQ-ST (results/leaderboard).
async function getClassLeaderboard(studentId, requestedClassId = null) {
  // Sections the student belongs to, oldest first (primary = first joined).
  const myMemberships = await Membership.find({ student: studentId, active: true }).sort({ createdAt: 1 });
  const myClassIds = myMemberships.map((m) => m.class.toString());

  const empty = { items: [], byScore: [], byDiligence: [], count: 0, classId: null, classes: [] };
  if (!myClassIds.length) return empty;

  // Section metadata for the selector (name like "Lớp 1/1").
  const classDocs = await Class.find({ _id: { $in: myClassIds } }).select('name gradeLevel');
  const classById = new Map(classDocs.map((c) => [c._id.toString(), c]));
  const classes = myClassIds
    .map((id) => {
      const c = classById.get(id);
      return c ? { id, name: c.name, gradeLevel: c.gradeLevel } : null;
    })
    .filter(Boolean);

  // Resolve which single section to rank. Honour a valid requested section,
  // otherwise fall back to the primary (first-joined) one.
  const requested = requestedClassId != null ? String(requestedClassId) : null;
  const classId = requested && myClassIds.includes(requested) ? requested : myClassIds[0];
  const classIds = [classId];

  // All active members of THIS section (the classmates to rank).
  const memberships = await Membership.find({ class: classId, active: true });
  const studentIds = [...new Set(memberships.map((m) => m.student.toString()))];

  const users = await User.find({ _id: { $in: studentIds }, isActive: true }).select('fullName gradeLevel');
  const userById = new Map(users.map((u) => [u._id.toString(), u]));

  // Pull every finished attempt for these classmates. "Finished" = submitted,
  // needs grading, or graded — i.e. the student actually did the exercise.
  // Score only counts scored attempts; diligence counts all finished ones.
  const finishedStatuses = [ATTEMPT_STATUS.SUBMITTED, ATTEMPT_STATUS.NEEDS_GRADING, ATTEMPT_STATUS.GRADED];
  const attempts = await Attempt.find({
    student: { $in: studentIds },
    class: { $in: classIds },
    status: { $in: finishedStatuses },
  }).select('student totalScore maxScore submittedAt');

  // Aggregate per student.
  const agg = new Map();
  for (const sid of studentIds) {
    agg.set(sid, { score: 0, max: 0, scored: 0, diligence: 0, lastActiveAt: 0 });
  }
  for (const a of attempts) {
    const sid = a.student.toString();
    const row = agg.get(sid);
    if (!row) continue;
    // Diligence: every finished exercise counts as effort.
    row.diligence += 1;
    const ts = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
    if (ts > row.lastActiveAt) row.lastActiveAt = ts;
    // Score: only attempts that have an actual numeric score.
    if (a.totalScore != null) {
      row.score += a.totalScore;
      row.max += a.maxScore || 0;
      row.scored += 1;
    }
  }

  const base = studentIds
    .map((sid) => {
      const u = userById.get(sid);
      if (!u) return null;
      const row = agg.get(sid);
      const first = (u.fullName || '').trim().split(/\s+/).slice(-1)[0] || u.fullName;
      return {
        studentId: sid,
        fullName: u.fullName,
        firstName: first,
        gradeLevel: u.gradeLevel,
        score: row.score,
        maxScore: row.max,
        completed: row.diligence,
        lastActiveAt: row.lastActiveAt || null,
        isMe: sid === studentId.toString(),
      };
    })
    .filter(Boolean);

  // Ranking 1 — achievement: highest total score first, tie-break by more
  // exercises completed, then name.
  const byScore = base
    .map((r) => ({ ...r }))
    .sort((a, b) => b.score - a.score || b.completed - a.completed || a.fullName.localeCompare(b.fullName, 'vi'));
  assignDenseRanks(byScore, 'score');

  // Ranking 2 — chuyên cần (diligence): most exercises done first, tie-break by
  // more recent activity, then higher score, then name.
  const byDiligence = base
    .map((r) => ({ ...r }))
    .sort((a, b) => b.completed - a.completed
      || (b.lastActiveAt || 0) - (a.lastActiveAt || 0)
      || b.score - a.score
      || a.fullName.localeCompare(b.fullName, 'vi'));
  assignDenseRanks(byDiligence, 'completed');

  // `items` kept as an alias of byScore for backward compatibility.
  return { items: byScore, byScore, byDiligence, count: base.length, classId, classes };
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

module.exports = { listAssigned, startAttempt, saveAnswers, submitAttempt, listMyAttempts, getClassLeaderboard, buildResult };
