// ===========================================================================
// Student AI tutor chat service.
//
// Grounds the chatbot ONLY on lessons the teacher PUBLISHED to this student
// (i.e. PUBLISHED sessions targeting one of the student's active classes — the
// same lessons surfaced in /student/history). Answer keys are NEVER sent to the
// model: we pass question prompts only. All strict rules live in chatPrompts.js.
// ===========================================================================

const Session = require('../../models/Session');
const Membership = require('../../models/Membership');
const Class = require('../../models/Class');
const User = require('../../models/User');
const { getProvider } = require('../ai/providerAdapter');
const { buildChatMessages, MAX_MESSAGE_CHARS, DEFAULT_TUTOR_NAME } = require('../ai/chatPrompts');
const { guardReply } = require('../ai/answerGuard');
const { SESSION_STATUS } = require('../../config/constants');
const { AppError } = require('../../utils/errors');

async function studentClassIds(studentId) {
  const memberships = await Membership.find({ student: studentId, active: true });
  return memberships.map((m) => m.class);
}

// Resolve the display name the tutor should use: the name of the teacher who
// manages this student's (primary / first-joined) class. Falls back to the
// default persona name when the student has no class or the class has no teacher.
async function resolveTutorName(studentId) {
  const memberships = await Membership.find({ student: studentId, active: true })
    .sort({ createdAt: 1 })
    .limit(1);
  if (!memberships.length) return DEFAULT_TUTOR_NAME;
  const klass = await Class.findById(memberships[0].class).select('teachers');
  if (!klass || !klass.teachers || !klass.teachers.length) return DEFAULT_TUTOR_NAME;
  const teacher = await User.findById(klass.teachers[0]).select('fullName');
  if (!teacher || !teacher.fullName) return DEFAULT_TUTOR_NAME;
  // Address learners warmly: prefix "Cô/Thầy" is already how Vietnamese pupils
  // address teachers; keep the real full name so it is clearly their teacher.
  return teacher.fullName.trim();
}

// Fetch the lessons available to this student and reduce them to a SAFE shape:
// metadata + question PROMPTS only (no correctIndex/answer/acceptable/etc.).
async function getStudentLessonDataset(studentId) {
  const classIds = await studentClassIds(studentId);
  if (!classIds.length) return [];

  const sessions = await Session.find({
    status: SESSION_STATUS.PUBLISHED,
    targetClasses: { $in: classIds },
  })
    .populate('subject', 'name code')
    .sort({ publishedAt: -1 })
    .limit(30);

  return sessions.map((s) => ({
    title: s.title,
    subjectName: s.subject ? s.subject.name : '',
    gradeLevel: s.gradeLevel,
    topic: s.topic,
    description: s.description,
    objectives: Array.isArray(s.objectives) ? s.objectives : [],
    // CRITICAL: expose only the prompt text — strip every answer-bearing field.
    questions: (s.questions || []).map((q) => ({
      prompt: q.prompt,
      text: q.text || null,
    })),
  }));
}

// Main entry: given the student and their message (+ short history), return the
// tutor's reply. Enforces grounding and the no-direct-answer rule via prompts.
async function chat(studentId, { message, history }) {
  const text = String(message || '').trim();
  if (!text) throw new AppError(400, 'EMPTY_MESSAGE', 'Em hãy nhập câu hỏi cho cô nhé.');
  if (text.length > MAX_MESSAGE_CHARS) {
    throw new AppError(400, 'MESSAGE_TOO_LONG', 'Câu hỏi hơi dài, em rút gọn lại giúp cô nhé.');
  }

  const lessons = await getStudentLessonDataset(studentId);
  const tutorName = await resolveTutorName(studentId);
  const messages = buildChatMessages({
    lessons,
    history: Array.isArray(history) ? history : [],
    message: text,
    tutorName,
  });

  const provider = getProvider();
  if (typeof provider.chat !== 'function') {
    throw new AppError(502, 'AI_FAILED', 'Trợ lý học tập chưa sẵn sàng. Vui lòng thử lại sau.');
  }

  let reply;
  try {
    reply = await provider.chat(messages);
  } catch (err) {
    throw new AppError(502, 'AI_FAILED', 'Cô chưa trả lời được ngay bây giờ. Em thử lại sau một chút nhé! 😊');
  }
  if (!reply || !String(reply).trim()) {
    throw new AppError(502, 'AI_FAILED', 'Cô chưa trả lời được ngay bây giờ. Em thử lại sau một chút nhé! 😊');
  }

  // Safety net: never let a direct answer/result leak through even if the model
  // ignored the prompt and stated it.
  const safeReply = guardReply(text, String(reply).trim());

  return {
    reply: safeReply,
    tutorName,
    lessonCount: lessons.length,
    grounded: lessons.length > 0,
  };
}

module.exports = { chat, getStudentLessonDataset, resolveTutorName };
