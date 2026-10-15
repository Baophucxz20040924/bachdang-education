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


const Class = require('../src/models/Class');
const Membership = require('../src/models/Membership');

describe('Per-section leaderboard (grade with sections 1/1, 1/2, ...)', () => {
  let s11a; let s11b; let s12a; let s12b; let classId11; let classId12;

  beforeEach(async () => {
    // Grade 1 with two sections: 1/1 and 1/2.
    const c11 = await Class.create({ name: 'Lớp 1/1', gradeLevel: 1 });
    const c12 = await Class.create({ name: 'Lớp 1/2', gradeLevel: 1 });
    classId11 = c11._id.toString();
    classId12 = c12._id.toString();

    s11a = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.11a', fullName: 'An Lớp Một Một', gradeLevel: 1 });
    s11b = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.11b', fullName: 'Bình Lớp Một Một', gradeLevel: 1 });
    s12a = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.12a', fullName: 'Cường Lớp Một Hai', gradeLevel: 1 });
    s12b = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.12b', fullName: 'Dũng Lớp Một Hai', gradeLevel: 1 });

    await Membership.create({ class: c11._id, student: s11a._id });
    await Membership.create({ class: c11._id, student: s11b._id });
    await Membership.create({ class: c12._id, student: s12a._id });
    await Membership.create({ class: c12._id, student: s12b._id });

    // Scores: section 1/1 → An 8, Bình 5 ; section 1/2 → Cường 10, Dũng 3
    await Attempt.create({ session: s11a._id, student: s11a._id, class: c11._id, status: ATTEMPT_STATUS.GRADED, totalScore: 8, maxScore: 10 });
    await Attempt.create({ session: s11a._id, student: s11b._id, class: c11._id, status: ATTEMPT_STATUS.GRADED, totalScore: 5, maxScore: 10 });
    await Attempt.create({ session: s12a._id, student: s12a._id, class: c12._id, status: ATTEMPT_STATUS.GRADED, totalScore: 10, maxScore: 10 });
    await Attempt.create({ session: s12a._id, student: s12b._id, class: c12._id, status: ATTEMPT_STATUS.GRADED, totalScore: 3, maxScore: 10 });
  });

  test('a 1/1 student only sees 1/1 classmates (not 1/2)', async () => {
    const token = await login('hs.11a');
    const res = await request(app).get('/api/student/leaderboard').set(auth(token));
    expect(res.status).toBe(200);
    const names = res.body.byScore.map((i) => i.fullName);
    expect(res.body.byScore.length).toBe(2);
    expect(names).toContain('An Lớp Một Một');
    expect(names).toContain('Bình Lớp Một Một');
    expect(names).not.toContain('Cường Lớp Một Hai');
    expect(names).not.toContain('Dũng Lớp Một Hai');
    // Highest total within 1/1 is An (8).
    expect(res.body.byScore[0].fullName).toBe('An Lớp Một Một');
    expect(res.body.byScore[0].score).toBe(8);
  });

  test('a 1/2 student only sees 1/2 classmates (not 1/1)', async () => {
    const token = await login('hs.12a');
    const res = await request(app).get('/api/student/leaderboard').set(auth(token));
    const names = res.body.byScore.map((i) => i.fullName);
    expect(res.body.byScore.length).toBe(2);
    expect(names).toContain('Cường Lớp Một Hai');
    expect(names).toContain('Dũng Lớp Một Hai');
    expect(names).not.toContain('An Lớp Một Một');
    // Cường has the top score (10) in 1/2 even though 10 > An's 8 in 1/1.
    expect(res.body.byScore[0].fullName).toBe('Cường Lớp Một Hai');
    expect(res.body.byScore[0].score).toBe(10);
  });

  test('response lists all of the student\'s sections and the active classId', async () => {
    const token = await login('hs.11a');
    const res = await request(app).get('/api/student/leaderboard').set(auth(token));
    expect(res.body.classId).toBe(classId11);
    expect(Array.isArray(res.body.classes)).toBe(true);
    // s11a belongs to only section 1/1.
    expect(res.body.classes.map((c) => c.name)).toEqual(['Lớp 1/1']);
    expect(res.body.classes[0].id).toBe(classId11);
    expect(res.body.classes[0].gradeLevel).toBe(1);
  });

  test('a student in TWO sections can switch between them via classId', async () => {
    // Put An (1/1) also into 1/2.
    await Membership.create({ class: classId12, student: s11a._id });
    const token = await login('hs.11a');

    // Default: primary (first-joined) section 1/1.
    const def = await request(app).get('/api/student/leaderboard').set(auth(token));
    expect(def.body.classId).toBe(classId11);
    expect(def.body.classes.map((c) => c.name).sort()).toEqual(['Lớp 1/1', 'Lớp 1/2']);

    // Explicitly request 1/2 → ranked among 1/2 members (now includes An too).
    const other = await request(app)
      .get('/api/student/leaderboard')
      .query({ classId: classId12 })
      .set(auth(token));
    expect(other.body.classId).toBe(classId12);
    const names = other.body.byScore.map((i) => i.fullName);
    expect(names).toContain('Cường Lớp Một Hai');
    expect(names).toContain('An Lớp Một Một');
    expect(names).not.toContain('Bình Lớp Một Một');
  });

  test('an invalid or non-member classId falls back to the primary section', async () => {
    const token = await login('hs.11a');
    const bogus = await request(app)
      .get('/api/student/leaderboard')
      .query({ classId: classId12 }) // s11a is NOT a member of 1/2
      .set(auth(token));
    // Falls back to the student's own section 1/1.
    expect(bogus.body.classId).toBe(classId11);
    expect(bogus.body.byScore.map((i) => i.fullName)).not.toContain('Cường Lớp Một Hai');
  });
});
