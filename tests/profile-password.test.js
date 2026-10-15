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

describe('Profile (GET /auth/me) and self password change (POST /auth/change-password)', () => {
  beforeEach(async () => {
    await h.makeUser(h.ROLES.TEACHER, { username: 'gv.lan', fullName: 'Nguyễn Thị Lan' });
    await h.makeUser(h.ROLES.STUDENT, { username: 'hs.an', fullName: 'Trần Minh An', gradeLevel: 3 });
  });

  test('any authenticated user can view their own profile (no password hash)', async () => {
    const sToken = await login('hs.an');
    const res = await request(app).get('/api/auth/me').set(auth(sToken));
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('hs.an');
    expect(res.body.user.fullName).toBe('Trần Minh An');
    expect(res.body.user.role).toBe('student');
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  test('viewing profile requires authentication (401)', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('student profile includes their class section(s) (name like "Lớp 3/1")', async () => {
    const student = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.sec', fullName: 'Phạm Thu' });
    const Class = require('../src/models/Class');
    const Membership = require('../src/models/Membership');
    const klass = await Class.create({ name: 'Lớp 3/1', gradeLevel: 3, teachers: [] });
    await Membership.create({ class: klass._id, student: student._id });
    const sToken = await login('hs.sec');
    const res = await request(app).get('/api/auth/me').set(auth(sToken));
    expect(res.status).toBe(200);
    expect(res.body.user.classes).toEqual([
      { id: klass._id.toString(), name: 'Lớp 3/1', gradeLevel: 3 },
    ]);
  });

  test('teacher can change their own password (correct current password)', async () => {
    const tToken = await login('gv.lan');
    const res = await request(app)
      .post('/api/auth/change-password')
      .set(auth(tToken))
      .send({ currentPassword: 'matkhau123', newPassword: 'moi123456' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Old password no longer works; new one does.
    const oldLogin = await request(app).post('/api/auth/login').send({ username: 'gv.lan', password: 'matkhau123' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/auth/login').send({ username: 'gv.lan', password: 'moi123456' });
    expect(newLogin.status).toBe(200);
  });

  test('student can change their own password', async () => {
    const sToken = await login('hs.an');
    const res = await request(app)
      .post('/api/auth/change-password')
      .set(auth(sToken))
      .send({ currentPassword: 'matkhau123', newPassword: 'embe123456' });
    expect(res.status).toBe(200);
    const newLogin = await request(app).post('/api/auth/login').send({ username: 'hs.an', password: 'embe123456' });
    expect(newLogin.status).toBe(200);
  });

  test('wrong current password is rejected (400 WRONG_PASSWORD)', async () => {
    const sToken = await login('hs.an');
    const res = await request(app)
      .post('/api/auth/change-password')
      .set(auth(sToken))
      .send({ currentPassword: 'saibetoe', newPassword: 'moi123456' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WRONG_PASSWORD');
    // Original password still works (unchanged).
    const stillOk = await request(app).post('/api/auth/login').send({ username: 'hs.an', password: 'matkhau123' });
    expect(stillOk.status).toBe(200);
  });

  test('new password shorter than 6 chars is rejected (400 VALIDATION)', async () => {
    const sToken = await login('hs.an');
    const res = await request(app)
      .post('/api/auth/change-password')
      .set(auth(sToken))
      .send({ currentPassword: 'matkhau123', newPassword: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  test('changing password requires authentication (401)', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'matkhau123', newPassword: 'moi123456' });
    expect(res.status).toBe(401);
  });
});
