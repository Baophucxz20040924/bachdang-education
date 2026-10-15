const request = require('supertest');
const createApp = require('../src/app');
const h = require('./helpers');
const Attempt = require('../src/models/Attempt');
const { ATTEMPT_STATUS } = require('../src/config/constants');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function login(username, password = 'matkhau123') {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return res.body.token;
}

beforeAll(h.connect);
afterAll(h.close);
afterEach(h.clear);

describe('Class leaderboard (GET /api/student/leaderboard)', () => {
  let klass; let an; let binh; let cuong; let outsider;

  beforeEach(async () => {
    an = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.an', fullName: 'Trần Minh An', gradeLevel: 3 });
    binh = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.binh', fullName: 'Lê Thanh Bình', gradeLevel: 3 });
    cuong = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.cuong', fullName: 'Phạm Văn Cường', gradeLevel: 3 });
    outsider = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.ngoai', fullName: 'Học Sinh Khác' });

    klass = await h.makeClass([]);
    await h.enroll(klass._id, an._id);
    await h.enroll(klass._id, binh._id);
    await h.enroll(klass._id, cuong._id);
    // outsider NOT enrolled in this class

    // Scored attempts: Bình 9, An 7 (two attempts 4+3), Cường 0 (none scored)
    await Attempt.create({ session: an._id, student: binh._id, class: klass._id, status: ATTEMPT_STATUS.GRADED, totalScore: 9, maxScore: 10 });
    await Attempt.create({ session: an._id, student: an._id, class: klass._id, status: ATTEMPT_STATUS.GRADED, totalScore: 4, maxScore: 5 });
    await Attempt.create({ session: an._id, student: an._id, class: klass._id, status: ATTEMPT_STATUS.GRADED, totalScore: 3, maxScore: 5 });
    // An in-progress attempt (totalScore null) must NOT count
    await Attempt.create({ session: an._id, student: cuong._id, class: klass._id, status: ATTEMPT_STATUS.IN_PROGRESS, totalScore: null, maxScore: 5 });
    // An attempt by an outsider in another class must NOT appear
    const otherClass = await h.makeClass([]);
    await Attempt.create({ session: an._id, student: outsider._id, class: otherClass._id, status: ATTEMPT_STATUS.GRADED, totalScore: 100, maxScore: 100 });
  });

  test('ranks all classmates by total score, excludes outsiders and unscored attempts', async () => {
    const token = await login('hs.an');
    const res = await request(app).get('/api/student/leaderboard').set(auth(token));
    expect(res.status).toBe(200);

    const names = res.body.items.map((i) => i.fullName);
    // Only the 3 enrolled classmates — outsider excluded
    expect(res.body.items.length).toBe(3);
    expect(names).not.toContain('Học Sinh Khác');

    // Order: Bình (9) > An (7) > Cường (0)
    expect(res.body.items[0].fullName).toBe('Lê Thanh Bình');
    expect(res.body.items[0].score).toBe(9);
    expect(res.body.items[0].rank).toBe(1);

    expect(res.body.items[1].fullName).toBe('Trần Minh An');
    expect(res.body.items[1].score).toBe(7); // 4 + 3, in-progress ignored
    expect(res.body.items[1].rank).toBe(2);
    expect(res.body.items[1].completed).toBe(2);

    expect(res.body.items[2].fullName).toBe('Phạm Văn Cường');
    expect(res.body.items[2].score).toBe(0);
    expect(res.body.items[2].rank).toBe(3);
  });

  test('marks the requesting student with isMe and exposes a first name', async () => {
    const token = await login('hs.an');
    const res = await request(app).get('/api/student/leaderboard').set(auth(token));
    const me = res.body.items.find((i) => i.isMe);
    expect(me).toBeTruthy();
    expect(me.fullName).toBe('Trần Minh An');
    expect(me.firstName).toBe('An');
    // exactly one isMe flag
    expect(res.body.items.filter((i) => i.isMe).length).toBe(1);
  });

  test('equal scores receive the same (dense) rank', async () => {
    // Give Cường the same 9 points as Bình → both rank 1, An rank 3
    await Attempt.create({ session: an._id, student: cuong._id, class: klass._id, status: ATTEMPT_STATUS.GRADED, totalScore: 9, maxScore: 10 });
    const token = await login('hs.an');
    const res = await request(app).get('/api/student/leaderboard').set(auth(token));
    const top = res.body.items.filter((i) => i.score === 9);
    expect(top.length).toBe(2);
    expect(top.every((i) => i.rank === 1)).toBe(true);
    const anRow = res.body.items.find((i) => i.fullName === 'Trần Minh An');
    expect(anRow.rank).toBe(3);
  });

  test('requires authentication', async () => {
    const res = await request(app).get('/api/student/leaderboard');
    expect(res.status).toBe(401);
  });

  test('returns a separate chuyên cần (diligence) ranking by exercises done', async () => {
    // Current fixture finished attempts: Bình 1 (graded), An 2 (graded x2), Cường 0 (in-progress only).
    const token = await login('hs.an');
    const res = await request(app).get('/api/student/leaderboard').set(auth(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.byDiligence)).toBe(true);
    expect(res.body.byDiligence.length).toBe(3);

    const dil = res.body.byDiligence;
    // An did the most exercises (2) -> rank 1 on diligence even though Bình has a higher score.
    expect(dil[0].fullName).toBe('Trần Minh An');
    expect(dil[0].completed).toBe(2);
    expect(dil[0].rank).toBe(1);
    // Bình did 1 -> rank 2.
    expect(dil[1].fullName).toBe('Lê Thanh Bình');
    expect(dil[1].completed).toBe(1);
    expect(dil[1].rank).toBe(2);
    // Cường only has an in-progress attempt -> 0 finished -> rank 3.
    expect(dil[2].fullName).toBe('Phạm Văn Cường');
    expect(dil[2].completed).toBe(0);
    expect(dil[2].rank).toBe(3);
  });

  test('diligence counts submitted & needs_grading attempts (not just graded)', async () => {
    // Give Cường two more finished-but-unscored attempts: he becomes the most diligent.
    await Attempt.create({ session: an._id, student: cuong._id, class: klass._id, status: ATTEMPT_STATUS.SUBMITTED, totalScore: null, maxScore: 5, submittedAt: new Date() });
    await Attempt.create({ session: an._id, student: cuong._id, class: klass._id, status: ATTEMPT_STATUS.NEEDS_GRADING, totalScore: null, maxScore: 5, submittedAt: new Date() });
    const token = await login('hs.an');
    const res = await request(app).get('/api/student/leaderboard').set(auth(token));

    const cuongDil = res.body.byDiligence.find((i) => i.fullName === 'Phạm Văn Cường');
    expect(cuongDil.completed).toBe(2); // the two finished (unscored) attempts count
    // Cường still has score 0 on the score board.
    const cuongScore = res.body.byScore.find((i) => i.fullName === 'Phạm Văn Cường');
    expect(cuongScore.score).toBe(0);
  });

  test('byScore ranking is unchanged and still aliased as items', async () => {
    const token = await login('hs.an');
    const res = await request(app).get('/api/student/leaderboard').set(auth(token));
    expect(res.body.byScore[0].fullName).toBe('Lê Thanh Bình');
    expect(res.body.byScore[0].score).toBe(9);
    // Back-compat alias
    expect(res.body.items[0].fullName).toBe('Lê Thanh Bình');
    expect(res.body.items.length).toBe(res.body.byScore.length);
  });
});
