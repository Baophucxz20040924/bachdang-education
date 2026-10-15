const request = require('supertest');
const createApp = require('../src/app');
const h = require('./helpers');
const Class = require('../src/models/Class');
const Session = require('../src/models/Session');
const Attempt = require('../src/models/Attempt');
const Subject = require('../src/models/Subject');
const Membership = require('../src/models/Membership');
const { ATTEMPT_STATUS, SESSION_STATUS } = require('../src/config/constants');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function login(username, password = 'matkhau123') {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return res.body.token;
}

beforeAll(h.connect);
afterAll(h.close);
afterEach(h.clear);

describe('Teacher class progress (/api/analytics/classes)', () => {
  let teacher; let other; let klass; let subject; let s1; let s2; let an; let binh; let cuong;

  beforeEach(async () => {
    teacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.lan' });
    other = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.khac' });
    subject = await Subject.create({ name: 'Toán', code: `t_${Math.random().toString(36).slice(2, 7)}`, gradeLevels: [1] });

    klass = await Class.create({ name: 'Lớp 1/1', gradeLevel: 1, teachers: [teacher._id] });

    an = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.an', fullName: 'Trần Minh An', gradeLevel: 1 });
    binh = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.binh', fullName: 'Lê Thanh Bình', gradeLevel: 1 });
    cuong = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.cuong', fullName: 'Phạm Văn Cường', gradeLevel: 1 });
    await Membership.create({ class: klass._id, student: an._id });
    await Membership.create({ class: klass._id, student: binh._id });
    await Membership.create({ class: klass._id, student: cuong._id });

    // Two published homework sessions assigned to the class.
    s1 = await Session.create({
      title: 'Bài 1', gradeLevel: 1, subject: subject._id, createdBy: teacher._id,
      status: SESSION_STATUS.PUBLISHED, targetClasses: [klass._id],
    });
    s2 = await Session.create({
      title: 'Bài 2', gradeLevel: 1, subject: subject._id, createdBy: teacher._id,
      status: SESSION_STATUS.PUBLISHED, targetClasses: [klass._id],
    });

    // An: finished both (scores 8 and 6) -> 100% completion, 14 pts.
    await Attempt.create({ session: s1._id, student: an._id, class: klass._id, status: ATTEMPT_STATUS.GRADED, totalScore: 8, maxScore: 10, submittedAt: new Date() });
    await Attempt.create({ session: s2._id, student: an._id, class: klass._id, status: ATTEMPT_STATUS.GRADED, totalScore: 6, maxScore: 10, submittedAt: new Date() });
    // Bình: finished one (score 9) -> 50% completion, 9 pts.
    await Attempt.create({ session: s1._id, student: binh._id, class: klass._id, status: ATTEMPT_STATUS.GRADED, totalScore: 9, maxScore: 10, submittedAt: new Date() });
    // Cường: an in-progress attempt (does not count) -> 0% completion, 0 pts.
    await Attempt.create({ session: s1._id, student: cuong._id, class: klass._id, status: ATTEMPT_STATUS.IN_PROGRESS, totalScore: null, maxScore: 10 });
  });

  test('GET /classes lists only the sections the teacher owns', async () => {
    // A class owned by a different teacher must not appear.
    await Class.create({ name: 'Lớp 1/2', gradeLevel: 1, teachers: [other._id] });
    const token = await login('gv.lan');
    const res = await request(app).get('/api/analytics/classes').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.items.map((c) => c.name)).toEqual(['Lớp 1/1']);
    expect(res.body.items[0].gradeLevel).toBe(1);
  });

  test('class progress returns a leaderboard sorted by score', async () => {
    const token = await login('gv.lan');
    const res = await request(app).get(`/api/analytics/classes/${klass._id}/progress`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.className).toBe('Lớp 1/1');
    expect(res.body.totalStudents).toBe(3);
    expect(res.body.totalHomework).toBe(2);

    // byScore: An 14 > Bình 9 > Cường 0
    expect(res.body.byScore[0].fullName).toBe('Trần Minh An');
    expect(res.body.byScore[0].score).toBe(14);
    expect(res.body.byScore[0].rank).toBe(1);
    expect(res.body.byScore[2].fullName).toBe('Phạm Văn Cường');
    expect(res.body.byScore[2].score).toBe(0);
  });

  test('homework completion % (chuyên cần) is computed per student', async () => {
    const token = await login('gv.lan');
    const res = await request(app).get(`/api/analytics/classes/${klass._id}/progress`).set(auth(token));
    const byId = Object.fromEntries(res.body.byScore.map((r) => [r.fullName, r]));
    // An finished 2/2 = 100%
    expect(byId['Trần Minh An'].completed).toBe(2);
    expect(byId['Trần Minh An'].completionRate).toBeCloseTo(1);
    // Bình finished 1/2 = 50%
    expect(byId['Lê Thanh Bình'].completed).toBe(1);
    expect(byId['Lê Thanh Bình'].completionRate).toBeCloseTo(0.5);
    // Cường finished 0/2 = 0% (in-progress does not count)
    expect(byId['Phạm Văn Cường'].completed).toBe(0);
    expect(byId['Phạm Văn Cường'].completionRate).toBe(0);
  });

  test('byDiligence ranks the most-completing student first', async () => {
    const token = await login('gv.lan');
    const res = await request(app).get(`/api/analytics/classes/${klass._id}/progress`).set(auth(token));
    expect(res.body.byDiligence[0].fullName).toBe('Trần Minh An');
    expect(res.body.byDiligence[0].completed).toBe(2);
    expect(res.body.byDiligence[0].rank).toBe(1);
  });

  test('class summary includes average completion rate', async () => {
    const token = await login('gv.lan');
    const res = await request(app).get(`/api/analytics/classes/${klass._id}/progress`).set(auth(token));
    // total finished = 2 + 1 + 0 = 3; possible = 3 students * 2 homework = 6 -> 0.5
    expect(res.body.avgCompletionRate).toBeCloseTo(0.5);
  });

  test('student detail lists per-homework status and overall completion', async () => {
    const token = await login('gv.lan');
    const res = await request(app)
      .get(`/api/analytics/classes/${klass._id}/students/${binh._id}`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.student.fullName).toBe('Lê Thanh Bình');
    expect(res.body.totalHomework).toBe(2);
    expect(res.body.completed).toBe(1);
    expect(res.body.completionRate).toBeCloseTo(0.5);
    expect(res.body.rows).toHaveLength(2);
    const titles = res.body.rows.map((r) => r.title).sort();
    expect(titles).toEqual(['Bài 1', 'Bài 2']);
    const bai1 = res.body.rows.find((r) => r.title === 'Bài 1');
    expect(bai1.finished).toBe(true);
    expect(bai1.totalScore).toBe(9);
    const bai2 = res.body.rows.find((r) => r.title === 'Bài 2');
    expect(bai2.status).toBe('not_started');
    expect(bai2.finished).toBe(false);
  });

  test('a teacher cannot view a class they do not own (403)', async () => {
    const token = await login('gv.khac');
    const res = await request(app).get(`/api/analytics/classes/${klass._id}/progress`).set(auth(token));
    expect(res.status).toBe(403);
  });

  test('unknown class returns 404', async () => {
    const token = await login('gv.lan');
    const bogus = '507f1f77bcf86cd799439011';
    const res = await request(app).get(`/api/analytics/classes/${bogus}/progress`).set(auth(token));
    expect(res.status).toBe(404);
  });

  test('student detail 404s for a student not in the class', async () => {
    const stranger = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.la' });
    const token = await login('gv.lan');
    const res = await request(app)
      .get(`/api/analytics/classes/${klass._id}/students/${stranger._id}`)
      .set(auth(token));
    expect(res.status).toBe(404);
  });

  test('a student cannot access teacher analytics (403)', async () => {
    const token = await login('hs.an');
    const res = await request(app).get('/api/analytics/classes').set(auth(token));
    expect(res.status).toBe(403);
  });
});
