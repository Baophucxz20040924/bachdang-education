const { v4: uuidv4 } = require('uuid');
const Session = require('../../models/Session');
const Attempt = require('../../models/Attempt');
const { validateQuestion } = require('./question.schema');
const { SESSION_STATUS } = require('../../config/constants');
const { AppError, messages } = require('../../utils/errors');
const { getPagination, paged } = require('../../utils/http');
const AuditLog = require('../../models/AuditLog');

async function listSessions(user, query) {
  const { page, limit, skip } = getPagination(query);
  const filter = { createdBy: user.id };
  if (query.status) filter.status = query.status;
  if (query.subject) filter.subject = query.subject;
  if (query.grade) filter.gradeLevel = Number(query.grade);
  if (query.q) filter.title = { $regex: query.q, $options: 'i' };
  const [items, total] = await Promise.all([
    Session.find(filter).populate('subject', 'name code').sort({ updatedAt: -1 }).skip(skip).limit(limit),
    Session.countDocuments(filter),
  ]);
  return paged(items, total, page, limit);
}

async function createSession(user, data) {
  return Session.create({
    title: data.title,
    description: data.description || '',
    gradeLevel: data.gradeLevel,
    subject: data.subject,
    topic: data.topic || '',
    objectives: data.objectives || [],
    createdBy: user.id,
    status: SESSION_STATUS.DRAFT,
    targetClasses: data.targetClasses || [],
    settings: data.settings || {},
  });
}

async function updateSession(session, data) {
  const editable = ['title', 'description', 'gradeLevel', 'subject', 'topic', 'objectives', 'targetClasses', 'settings'];
  for (const key of editable) {
    if (data[key] !== undefined) session[key] = data[key];
  }
  await session.save();
  return session;
}

function prepareQuestion(raw) {
  const candidate = { ...raw, qid: raw.qid || uuidv4() };
  const result = validateQuestion(candidate);
  if (!result.ok) throw new AppError(400, 'VALIDATION', `Câu hỏi không hợp lệ: ${result.error}`);
  return { ...result.data, qid: candidate.qid };
}

async function addQuestion(session, raw) {
  const q = prepareQuestion(raw);
  session.questions.push(q);
  await session.save();
  return session;
}

async function updateQuestion(session, qid, raw) {
  const idx = session.questions.findIndex((q) => q.qid === qid);
  if (idx === -1) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  const merged = { ...session.questions[idx].toObject(), ...raw, qid, source: 'manual' };
  const q = prepareQuestion(merged);
  session.questions[idx] = q;
  await session.save();
  return session;
}

async function deleteQuestion(session, qid) {
  session.questions = session.questions.filter((q) => q.qid !== qid);
  await session.save();
  return session;
}

async function reorderQuestions(session, order) {
  const map = new Map(session.questions.map((q) => [q.qid, q]));
  const reordered = order.map((qid) => map.get(qid)).filter(Boolean);
  if (reordered.length !== session.questions.length) {
    throw new AppError(400, 'VALIDATION', 'Danh sách sắp xếp không khớp với câu hỏi hiện có.');
  }
  session.questions = reordered;
  await session.save();
  return session;
}

async function publish(session, actorId) {
  const usable = session.questions.filter((q) => validateQuestion(q.toObject ? q.toObject() : q).ok);
  if (usable.length === 0) throw new AppError(400, 'SESSION_EMPTY', messages.SESSION_EMPTY);
  if (!session.targetClasses || session.targetClasses.length === 0) {
    throw new AppError(400, 'SESSION_NO_CLASS', messages.SESSION_NO_CLASS);
  }
  session.status = SESSION_STATUS.PUBLISHED;
  session.publishedAt = new Date();
  await session.save();
  await AuditLog.create({ actor: actorId, action: 'SESSION_PUBLISH', targetType: 'Session', targetId: session._id });
  return session;
}

async function unpublish(session) {
  session.status = SESSION_STATUS.DRAFT;
  session.publishedAt = null;
  await session.save();
  return session;
}

async function archive(session) {
  session.status = SESSION_STATUS.ARCHIVED;
  await session.save();
  return session;
}

async function duplicate(session, user) {
  const copy = session.toObject();
  delete copy._id;
  delete copy.createdAt;
  delete copy.updatedAt;
  copy.title = `${copy.title} (bản sao)`;
  copy.status = SESSION_STATUS.DRAFT;
  copy.publishedAt = null;
  copy.createdBy = user.id;
  return Session.create(copy);
}

// Student-facing view: strip answer keys.
function toStudentView(session) {
  const obj = session.toObject ? session.toObject() : session;
  return {
    _id: obj._id,
    title: obj.title,
    description: obj.description,
    gradeLevel: obj.gradeLevel,
    topic: obj.topic,
    settings: obj.settings,
    questions: obj.questions.map((q) => stripAnswerKey(q)),
  };
}

function stripAnswerKey(q) {
  const {
    correctIndex, correctValue, answer, expectedAnswer, acceptable, pairs, explanation, ...safe
  } = q;
  return safe;
}

async function remove(session, actorId) {
  await Attempt.deleteMany({ session: session._id });
  await session.deleteOne();
  await AuditLog.create({ actor: actorId, action: 'SESSION_DELETE', targetType: 'Session', targetId: session._id });
  return { ok: true };
}

module.exports = {
  listSessions,
  createSession,
  updateSession,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
  publish,
  unpublish,
  archive,
  duplicate,
  remove,
  toStudentView,
  stripAnswerKey,
  prepareQuestion,
};
