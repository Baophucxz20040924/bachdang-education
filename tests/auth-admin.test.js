const request = require('supertest');
const createApp = require('../src/app');
const h = require('./helpers');

const app = createApp();

beforeAll(h.connect);
afterAll(h.close);
afterEach(h.clear);

async function token(username, password = 'matkhau123') {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return res.body.token;
}

describe('Auth & Admin (REQ-AUTH, REQ-ADM)', () => {
  test('deactivated account cannot log in (REQ-AUTH-1)', async () => {
    await h.makeUser(h.ROLES.STUDENT, { username: 'hs.deact' });
    // deactivate directly
    const User = require('../src/models/User');
    await User.updateOne({ username: 'hs.deact' }, { isActive: false });
    const res = await request(app).post('/api/auth/login').send({ username: 'hs.deact', password: 'matkhau123' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  test('admin can create teacher/student (REQ-ADM-1) with Vietnamese name persisted (REQ #9)', async () => {
    await h.makeUser(h.ROLES.ADMIN, { username: 'admin' });
    const t = await token('admin');
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${t}`)
      .send({ role: 'teacher', fullName: 'Nguyễn Thị Lan', username: 'gv.lan', password: 'matkhau123' });
    expect(res.status).toBe(201);
    expect(res.body.fullName).toBe('Nguyễn Thị Lan');
    expect(res.body.passwordHash).toBeUndefined();
  });

  test('duplicate enrollment is prevented (REQ-ADM-2)', async () => {
    const admin = await h.makeUser(h.ROLES.ADMIN, { username: 'admin' });
    const student = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.an' });
    const klass = await h.makeClass();
    const t = await token('admin');
    const first = await request(app)
      .post(`/api/classes/${klass._id}/students`)
      .set('Authorization', `Bearer ${t}`)
      .send({ studentId: student._id.toString() });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post(`/api/classes/${klass._id}/students`)
      .set('Authorization', `Bearer ${t}`)
      .send({ studentId: student._id.toString() });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_MEMBERSHIP');
  });

  test('student cannot access admin endpoints (REQ-AUTH-2)', async () => {
    await h.makeUser(h.ROLES.STUDENT, { username: 'hs.an' });
    const t = await token('hs.an');
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(403);
  });
});
