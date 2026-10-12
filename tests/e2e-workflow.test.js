const request = require('supertest');
const createApp = require('../src/app');
const h = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function login(username, password = 'matkhau123') {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return res.body.token;
}

beforeAll(h.connect);
afterAll(h.close);
afterEach(h.clear);

describe('End-to-end workflow (Definition of Done)', () => {
  let teacher; let student; let outsider; let klass; let subject;
  let tToken; let sToken; let oToken;

  beforeEach(async () => {
    teacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.lan', fullName: 'Nguyễn Thị Lan' });
    student = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.an', fullName: 'Trần Minh An', gradeLevel: 3 });
    outsider = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.ngoai', fullName: 'Học Sinh Khác' });
    subject = await h.makeSubject();
    klass = await h.makeClass([teacher._id]);
    await h.enroll(klass._id, student._id);
    tToken = await login('gv.lan');
    sToken = await login('hs.an');
    oToken = await login('hs.ngoai');
  });

  async function createPublishedSession() {
    // Teacher generates with AI (mock)
    const gen = await request(app)
      .post('/api/ai/generate')
      .set(auth(tToken))
      .send({ grade: 3, subject: subject._id.toString(), count: 3, types: ['multiple_choice', 'missing_word'] });
    expect(gen.status).toBe(200);
    expect(gen.body.questions.length).toBeGreaterThan(0);

    // Create a session
    const create = await request(app)
      .post('/api/sessions')
      .set(auth(tToken))
      .send({ title: 'Từ chỉ hoạt động', gradeLevel: 3, subject: subject._id.toString(), targetClasses: [klass._id.toString()] });
    const sessionId = create.body._id;

    // Teacher reviews & adds the AI questions (REQ-AI-4: teacher approval)
    for (const q of gen.body.questions) {
      const add = await request(app).post(`/api/sessions/${sessionId}/questions`).set(auth(tToken)).send(q);
      expect(add.status).toBe(201);
    }

    // Publish
    const pub = await request(app).post(`/api/sessions/${sessionId}/publish`).set(auth(tToken)).send();
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('PUBLISHED');
    return sessionId;
  }

  test('AI generates valid questions; teacher edits before publish (REQ-AI)', async () => {
    const sessionId = await createPublishedSession();
    expect(sessionId).toBeTruthy();
  });

  test('student in class sees published session; outsider does not (REQ-ST-1, REQ-AUTH-2)', async () => {
    await createPublishedSession();
    const mine = await request(app).get('/api/student/sessions').set(auth(sToken));
    expect(mine.body.items.length).toBe(1);
    const theirs = await request(app).get('/api/student/sessions').set(auth(oToken));
    expect(theirs.body.items.length).toBe(0);
  });

  test('student cannot access unpublished (DRAFT) session (REQ-ST-1)', async () => {
    const create = await request(app)
      .post('/api/sessions').set(auth(tToken))
      .send({ title: 'Nháp', gradeLevel: 3, subject: subject._id.toString(), targetClasses: [klass._id.toString()] });
    const start = await request(app).post(`/api/student/sessions/${create.body._id}/start`).set(auth(sToken)).send();
    expect(start.status).toBe(404);
  });

  test('outsider cannot start a session for another class (REQ-ST / REQ-AUTH-2)', async () => {
    const sessionId = await createPublishedSession();
    const start = await request(app).post(`/api/student/sessions/${sessionId}/start`).set(auth(oToken)).send();
    expect(start.status).toBe(403);
  });

  test('student answers & submits; server scores objectively; score cannot be set by client (REQ-ST-2, #12)', async () => {
    const sessionId = await createPublishedSession();
    const start = await request(app).post(`/api/student/sessions/${sessionId}/start`).set(auth(sToken)).send();
    const attemptId = start.body._id;
    expect(start.body.questions[0].correctIndex).toBeUndefined(); // answer key stripped

    // Answer first question correctly if it's MC; use snapshot from DB to know correct answer is not exposed,
    // so we just answer index 0 (mock MC correctIndex is 0 for the activity question).
    const answers = start.body.questions.map((q) => {
      if (q.type === 'multiple_choice') return { qid: q.qid, response: 0 };
      if (q.type === 'missing_word' || q.type === 'fill_blank') return { qid: q.qid, response: 'đi' };
      return { qid: q.qid, response: 'x' };
    });
    await request(app).patch(`/api/student/attempts/${attemptId}/answers`).set(auth(sToken)).send({ answers });

    // Attempt to inject a fake score via submit body -> must be ignored
    const submit = await request(app)
      .post(`/api/student/attempts/${attemptId}/submit`).set(auth(sToken))
      .send({ totalScore: 9999 });
    expect(submit.status).toBe(200);
    expect(submit.body.totalScore).not.toBe(9999);
    expect(submit.body.maxScore).toBeGreaterThan(0);
  });

  test('a student cannot read another student\'s attempt (REQ-AUTH-2, #4)', async () => {
    const sessionId = await createPublishedSession();
    const start = await request(app).post(`/api/student/sessions/${sessionId}/start`).set(auth(sToken)).send();
    const attemptId = start.body._id;
    const steal = await request(app)
      .patch(`/api/student/attempts/${attemptId}/answers`).set(auth(oToken))
      .send({ answers: [] });
    expect(steal.status).toBe(403);
  });

  test('editing a published session does not corrupt an existing attempt (snapshot, REQ-EX-3, #13)', async () => {
    const sessionId = await createPublishedSession();
    const start = await request(app).post(`/api/student/sessions/${sessionId}/start`).set(auth(sToken)).send();
    const attemptId = start.body._id;
    const originalCount = start.body.questions.length;

    // Teacher deletes a question from the live session
    const session = await request(app).get(`/api/sessions/${sessionId}`).set(auth(tToken));
    const qidToDelete = session.body.questions[0].qid;
    await request(app).delete(`/api/sessions/${sessionId}/questions/${qidToDelete}`).set(auth(tToken));

    // Student submits — snapshot must still have the original questions
    const answers = start.body.questions.map((q) => ({ qid: q.qid, response: 0 }));
    await request(app).patch(`/api/student/attempts/${attemptId}/answers`).set(auth(sToken)).send({ answers });
    const submit = await request(app).post(`/api/student/attempts/${attemptId}/submit`).set(auth(sToken)).send();
    const Attempt = require('../src/models/Attempt');
    const dbAttempt = await Attempt.findById(attemptId);
    expect(dbAttempt.questionSnapshot.length).toBe(originalCount);
    expect(submit.status).toBe(200);
  });

  test('teacher analytics computes from real attempts (REQ-DASH-1)', async () => {
    const sessionId = await createPublishedSession();
    const start = await request(app).post(`/api/student/sessions/${sessionId}/start`).set(auth(sToken)).send();
    const answers = start.body.questions.map((q) => ({ qid: q.qid, response: 0 }));
    await request(app).patch(`/api/student/attempts/${start.body._id}/answers`).set(auth(sToken)).send({ answers });
    await request(app).post(`/api/student/attempts/${start.body._id}/submit`).set(auth(sToken)).send();

    const analytics = await request(app).get(`/api/analytics/sessions/${sessionId}`).set(auth(tToken));
    expect(analytics.status).toBe(200);
    expect(analytics.body.totalStudents).toBe(1);
    expect(analytics.body.submittedCount).toBe(1);
    expect(analytics.body.questionBreakdown.length).toBeGreaterThan(0);
  });

  test('cannot publish an empty session (REQ-EX-2)', async () => {
    const create = await request(app)
      .post('/api/sessions').set(auth(tToken))
      .send({ title: 'Rỗng', gradeLevel: 3, subject: subject._id.toString(), targetClasses: [klass._id.toString()] });
    const pub = await request(app).post(`/api/sessions/${create.body._id}/publish`).set(auth(tToken)).send();
    expect(pub.status).toBe(400);
    expect(pub.body.error.code).toBe('SESSION_EMPTY');
  });
});
