const request = require('supertest');
const createApp = require('../src/app');
const h = require('./helpers');
const Session = require('../src/models/Session');
const Attempt = require('../src/models/Attempt');
const { gradeQuestion, gradeAttempt } = require('../src/utils/grading');
const { validateQuestion } = require('../src/modules/sessions/question.schema');
const { QUESTION_TYPES } = require('../src/config/constants');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const login = async (u, p = 'matkhau123') => (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token;

beforeAll(h.connect);
afterAll(h.close);
afterEach(h.clear);

describe('short_answer auto-grading with accepted answers (unit)', () => {
  const q = {
    type: QUESTION_TYPES.SHORT_ANSWER,
    prompt: 'Thủ đô của Việt Nam là gì?',
    expectedAnswer: 'Hà Nội',
    acceptable: ['Hà Nội', 'thủ đô Hà Nội'],
    points: 2,
  };

  test('exact accepted answer -> correct, auto, no manual', () => {
    const r = gradeQuestion(q, 'Hà Nội');
    expect(r).toMatchObject({ correct: true, earned: 2, needsManual: false });
  });

  test('accent-insensitive match -> correct (friendly for kids)', () => {
    const r = gradeQuestion(q, 'ha noi');
    expect(r.correct).toBe(true);
    expect(r.needsManual).toBe(false);
  });

  test('wrong answer -> scored 0 and NOT sent to manual grading', () => {
    const r = gradeQuestion(q, 'Hải Phòng');
    expect(r.correct).toBe(false);
    expect(r.earned).toBe(0);
    expect(r.needsManual).toBe(false);
  });

  test('expectedAnswer alone (no acceptable list) still auto-grades', () => {
    const r = gradeQuestion({ type: QUESTION_TYPES.SHORT_ANSWER, expectedAnswer: 'cây xanh', points: 1 }, 'Cây Xanh');
    expect(r.correct).toBe(true);
    expect(r.needsManual).toBe(false);
  });

  test('caseSensitive option is respected', () => {
    const cq = { type: QUESTION_TYPES.SHORT_ANSWER, expectedAnswer: 'ABC', acceptable: ['ABC'], caseSensitive: true, ignoreAccents: false, points: 1 };
    expect(gradeQuestion(cq, 'abc').correct).toBe(false);
    expect(gradeQuestion(cq, 'ABC').correct).toBe(true);
  });

  test('no answer key at all -> still manual review (safe default)', () => {
    const r = gradeQuestion({ type: QUESTION_TYPES.SHORT_ANSWER, points: 1 }, 'bất kỳ');
    expect(r.correct).toBeNull();
    expect(r.needsManual).toBe(true);
  });

  test('autoGrade=false forces manual even with a key', () => {
    const r = gradeQuestion({ ...q, autoGrade: false }, 'Hà Nội');
    expect(r.correct).toBeNull();
    expect(r.needsManual).toBe(true);
  });
});

describe('gradeAttempt: a quiz of only auto-gradable short_answers -> graded, not needs_grading', () => {
  test('needsGrading is false when every short_answer has a key', () => {
    const snapshot = [
      { qid: 'q1', type: QUESTION_TYPES.SHORT_ANSWER, expectedAnswer: 'Hà Nội', acceptable: ['Hà Nội'], points: 1 },
      { qid: 'q2', type: QUESTION_TYPES.SHORT_ANSWER, expectedAnswer: '12', acceptable: ['12', 'mười hai'], points: 1 },
    ];
    const answers = [{ qid: 'q1', response: 'ha noi' }, { qid: 'q2', response: 'sai' }];
    const r = gradeAttempt(snapshot, answers);
    expect(r.needsGrading).toBe(false);
    expect(r.autoScore).toBe(1); // q1 correct, q2 wrong but still auto-scored
    expect(r.maxScore).toBe(2);
  });
});

describe('Zod schema accepts acceptable + autoGrade + matching options', () => {
  test('short_answer with acceptable[] + options validates', () => {
    const res = validateQuestion({
      type: QUESTION_TYPES.SHORT_ANSWER,
      prompt: 'x', expectedAnswer: 'a', acceptable: ['a', 'b'],
      autoGrade: true, ignoreAccents: true, caseSensitive: false,
    });
    expect(res.ok).toBe(true);
    expect(res.data.acceptable).toEqual(['a', 'b']);
  });
});

describe('End-to-end: student submits short_answer quiz -> graded immediately', () => {
  test('attempt status is graded (not needs_grading) and score computed server-side', async () => {
    const teacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.ag' });
    const student = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.ag', gradeLevel: 3 });
    const subject = await h.makeSubject();
    const klass = await h.makeClass([teacher._id]);
    await h.enroll(klass._id, student._id);
    const tToken = await login('gv.ag');
    const sToken = await login('hs.ag');

    // Teacher creates a session with an auto-gradable short_answer.
    const create = await request(app).post('/api/sessions').set(auth(tToken)).send({
      title: 'Bài tập trả lời ngắn', gradeLevel: 3, subject: subject._id.toString(), targetClasses: [klass._id.toString()],
    });
    const sid = create.body._id;
    const addRes = await request(app).post(`/api/sessions/${sid}/questions`).set(auth(tToken)).send({
      type: 'short_answer', prompt: 'Thủ đô Việt Nam?', expectedAnswer: 'Hà Nội', acceptable: ['Hà Nội', 'thủ đô Hà Nội'], points: 1,
    });
    expect(addRes.status).toBe(201);
    await request(app).post(`/api/sessions/${sid}/publish`).set(auth(tToken)).send();

    // Student does it and submits.
    const start = await request(app).post(`/api/student/sessions/${sid}/start`).set(auth(sToken)).send();
    const attemptId = start.body._id;
    const qid = start.body.questions[0].qid;
    // Answer key must NOT be exposed to the student.
    expect(start.body.questions[0].acceptable).toBeUndefined();
    expect(start.body.questions[0].expectedAnswer).toBeUndefined();

    await request(app).patch(`/api/student/attempts/${attemptId}/answers`).set(auth(sToken))
      .send({ answers: [{ qid, response: 'ha noi' }] });
    const submit = await request(app).post(`/api/student/attempts/${attemptId}/submit`).set(auth(sToken)).send();

    expect(submit.status).toBe(200);
    expect(submit.body.status).toBe('graded'); // auto-graded, not needs_grading
    expect(submit.body.totalScore).toBe(1);

    const dbAttempt = await Attempt.findById(attemptId);
    expect(dbAttempt.status).toBe('graded');
    expect(dbAttempt.totalScore).toBe(1);
  });

  test('wrong short_answer still auto-grades to 0 (graded, no waiting)', async () => {
    const teacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.ag2' });
    const student = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.ag2', gradeLevel: 3 });
    const subject = await h.makeSubject();
    const klass = await h.makeClass([teacher._id]);
    await h.enroll(klass._id, student._id);
    const tToken = await login('gv.ag2');
    const sToken = await login('hs.ag2');

    const create = await request(app).post('/api/sessions').set(auth(tToken)).send({
      title: 'Bài tập 2', gradeLevel: 3, subject: subject._id.toString(), targetClasses: [klass._id.toString()],
    });
    const sid = create.body._id;
    await request(app).post(`/api/sessions/${sid}/questions`).set(auth(tToken)).send({
      type: 'short_answer', prompt: '2 + 2 = ?', expectedAnswer: '4', acceptable: ['4', 'bốn'], points: 1,
    });
    await request(app).post(`/api/sessions/${sid}/publish`).set(auth(tToken)).send();

    const start = await request(app).post(`/api/student/sessions/${sid}/start`).set(auth(sToken)).send();
    const qid = start.body.questions[0].qid;
    await request(app).patch(`/api/student/attempts/${start.body._id}/answers`).set(auth(sToken))
      .send({ answers: [{ qid, response: '5' }] });
    const submit = await request(app).post(`/api/student/attempts/${start.body._id}/submit`).set(auth(sToken)).send();

    expect(submit.body.status).toBe('graded');
    expect(submit.body.totalScore).toBe(0);
  });
});
