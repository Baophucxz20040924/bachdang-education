const request = require('supertest');
const createApp = require('../src/app');
const User = require('../src/models/User');
const h = require('./helpers');

const app = createApp();

beforeAll(h.connect);
afterAll(h.close);
afterEach(h.clear);

async function token(username, password = 'matkhau123') {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return res.body.token;
}

describe('Teacher-scoped student management (/api/users/students)', () => {
  test('teacher can create a student account (role forced to student, no email)', async () => {
    await h.makeUser(h.ROLES.TEACHER, { username: 'gv.lan' });
    const t = await token('gv.lan');
    const res = await request(app)
      .post('/api/users/students')
      .set('Authorization', `Bearer ${t}`)
      .send({ fullName: 'Trần Văn An', username: 'hs.an', password: 'matkhau123', gradeLevel: 3 });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('student');
    expect(res.body.fullName).toBe('Trần Văn An');
    expect(res.body.gradeLevel).toBe(3);
    expect(res.body.email).toBeUndefined();
    expect(res.body.passwordHash).toBeUndefined();
  });

  test('created student can log in with the chosen password', async () => {
    await h.makeUser(h.ROLES.TEACHER, { username: 'gv.lan' });
    const t = await token('gv.lan');
    await request(app)
      .post('/api/users/students')
      .set('Authorization', `Bearer ${t}`)
      .send({ fullName: 'Lê Thị Hà', username: 'hs.ha', password: 'hocsinh123', gradeLevel: 2 });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'hs.ha', password: 'hocsinh123' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
    expect(login.body.user.role).toBe('student');
  });

  test('teacher can list only student accounts', async () => {
    await h.makeUser(h.ROLES.TEACHER, { username: 'gv.lan' });
    await h.makeUser(h.ROLES.STUDENT, { username: 'hs.an' });
    await h.makeUser(h.ROLES.STUDENT, { username: 'hs.ha' });
    await h.makeUser(h.ROLES.ADMIN, { username: 'admin' });
    const t = await token('gv.lan');
    const res = await request(app).get('/api/users/students').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(200);
    expect(res.body.items.every((u) => u.role === 'student')).toBe(true);
    expect(res.body.items).toHaveLength(2);
  });

  test('teacher can ban (deactivate) and unban a student', async () => {
    await h.makeUser(h.ROLES.TEACHER, { username: 'gv.lan' });
    const student = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.an' });
    const t = await token('gv.lan');

    const ban = await request(app)
      .post(`/api/users/students/${student._id}/ban`)
      .set('Authorization', `Bearer ${t}`);
    expect(ban.status).toBe(200);
    expect(ban.body.isActive).toBe(false);

    // Banned student cannot log in.
    const denied = await request(app)
      .post('/api/auth/login')
      .send({ username: 'hs.an', password: 'matkhau123' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('ACCOUNT_DISABLED');

    const unban = await request(app)
      .post(`/api/users/students/${student._id}/unban`)
      .set('Authorization', `Bearer ${t}`);
    expect(unban.status).toBe(200);
    expect(unban.body.isActive).toBe(true);

    const ok = await request(app)
      .post('/api/auth/login')
      .send({ username: 'hs.an', password: 'matkhau123' });
    expect(ok.status).toBe(200);
  });

  test('teacher can delete a student', async () => {
    await h.makeUser(h.ROLES.TEACHER, { username: 'gv.lan' });
    const student = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.an' });
    const t = await token('gv.lan');
    const res = await request(app)
      .delete(`/api/users/students/${student._id}`)
      .set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const gone = await User.findById(student._id);
    expect(gone).toBeNull();
  });

  test('teacher can update a student name, grade and password', async () => {
    await h.makeUser(h.ROLES.TEACHER, { username: 'gv.lan' });
    const student = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.an' });
    const t = await token('gv.lan');
    const res = await request(app)
      .patch(`/api/users/students/${student._id}`)
      .set('Authorization', `Bearer ${t}`)
      .send({ fullName: 'Trần Văn An B', gradeLevel: 4, password: 'newpass123' });
    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('Trần Văn An B');
    expect(res.body.gradeLevel).toBe(4);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'hs.an', password: 'newpass123' });
    expect(login.status).toBe(200);
  });

  test('teacher CANNOT target a teacher/admin account via student endpoints', async () => {
    await h.makeUser(h.ROLES.TEACHER, { username: 'gv.lan' });
    const otherTeacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.minh' });
    const admin = await h.makeUser(h.ROLES.ADMIN, { username: 'admin' });
    const t = await token('gv.lan');

    const banTeacher = await request(app)
      .post(`/api/users/students/${otherTeacher._id}/ban`)
      .set('Authorization', `Bearer ${t}`);
    expect(banTeacher.status).toBe(404);

    const delAdmin = await request(app)
      .delete(`/api/users/students/${admin._id}`)
      .set('Authorization', `Bearer ${t}`);
    expect(delAdmin.status).toBe(404);
  });

  test('a student CANNOT access teacher student-management endpoints', async () => {
    await h.makeUser(h.ROLES.STUDENT, { username: 'hs.an' });
    const t = await token('hs.an');
    const list = await request(app).get('/api/users/students').set('Authorization', `Bearer ${t}`);
    expect(list.status).toBe(403);
    const create = await request(app)
      .post('/api/users/students')
      .set('Authorization', `Bearer ${t}`)
      .send({ fullName: 'X', username: 'hs.x', password: 'matkhau123' });
    expect(create.status).toBe(403);
  });

  test('unauthenticated requests are rejected', async () => {
    const res = await request(app).get('/api/users/students');
    expect(res.status).toBe(401);
  });
});
