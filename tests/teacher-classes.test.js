const request = require('supertest');
const createApp = require('../src/app');
const h = require('./helpers');
const Class = require('../src/models/Class');
const Membership = require('../src/models/Membership');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function login(username, password = 'matkhau123') {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return res.body.token;
}

beforeAll(h.connect);
afterAll(h.close);
afterEach(h.clear);

describe('Teacher class sections + student enrollment (/api/users/classes, students classId)', () => {
  let teacher; let other;

  beforeEach(async () => {
    teacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.lan' });
    other = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.khac' });
  });

  test('teacher can create a class section (1/1) and becomes its owner', async () => {
    const t = await login('gv.lan');
    const res = await request(app)
      .post('/api/users/classes')
      .set(auth(t))
      .send({ name: 'Lớp 1/1', gradeLevel: 1 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Lớp 1/1');
    expect(res.body.gradeLevel).toBe(1);
    // Teacher recorded as owner.
    const klass = await Class.findById(res.body.id);
    expect(klass.teachers.map((x) => x.toString())).toContain(teacher._id.toString());
  });

  test('GET /classes lists only the teacher\'s sections, filterable by grade', async () => {
    const t = await login('gv.lan');
    await Class.create({ name: 'Lớp 1/1', gradeLevel: 1, teachers: [teacher._id] });
    await Class.create({ name: 'Lớp 2/1', gradeLevel: 2, teachers: [teacher._id] });
    await Class.create({ name: 'Lớp 1/2', gradeLevel: 1, teachers: [other._id] }); // not owned

    const all = await request(app).get('/api/users/classes').set(auth(t));
    expect(all.status).toBe(200);
    expect(all.body.items.map((c) => c.name).sort()).toEqual(['Lớp 1/1', 'Lớp 2/1']);

    const grade1 = await request(app).get('/api/users/classes').query({ gradeLevel: 1 }).set(auth(t));
    expect(grade1.body.items.map((c) => c.name)).toEqual(['Lớp 1/1']);
  });

  test('creating a student with classId enrolls them into that section', async () => {
    const t = await login('gv.lan');
    const klass = await Class.create({ name: 'Lớp 1/1', gradeLevel: 1, teachers: [teacher._id] });
    const res = await request(app)
      .post('/api/users/students')
      .set(auth(t))
      .send({ fullName: 'Trần Minh An', username: 'hs.an', password: 'matkhau123', gradeLevel: 1, classId: klass._id.toString() });
    expect(res.status).toBe(201);
    const studentId = res.body._id;
    const membership = await Membership.findOne({ class: klass._id, student: studentId });
    expect(membership).toBeTruthy();
    expect(membership.active).toBe(true);
  });

  test('creating a student WITHOUT classId still works (no membership)', async () => {
    const t = await login('gv.lan');
    const res = await request(app)
      .post('/api/users/students')
      .set(auth(t))
      .send({ fullName: 'Lê Thanh Bình', username: 'hs.binh', password: 'matkhau123', gradeLevel: 1 });
    expect(res.status).toBe(201);
    const count = await Membership.countDocuments({ student: res.body._id });
    expect(count).toBe(0);
  });

  test('teacher CANNOT enroll into a class they do not own (403), and no orphan user is created', async () => {
    const t = await login('gv.lan');
    const foreign = await Class.create({ name: 'Lớp 1/9', gradeLevel: 1, teachers: [other._id] });
    const res = await request(app)
      .post('/api/users/students')
      .set(auth(t))
      .send({ fullName: 'X', username: 'hs.x', password: 'matkhau123', gradeLevel: 1, classId: foreign._id.toString() });
    expect(res.status).toBe(403);
    // The class check runs before user creation → no orphan account.
    const User = require('../src/models/User');
    expect(await User.findOne({ username: 'hs.x' })).toBeNull();
  });

  test('creating a student with an unknown classId returns 404', async () => {
    const t = await login('gv.lan');
    const res = await request(app)
      .post('/api/users/students')
      .set(auth(t))
      .send({ fullName: 'Y', username: 'hs.y', password: 'matkhau123', gradeLevel: 1, classId: '507f1f77bcf86cd799439011' });
    expect(res.status).toBe(404);
  });

  test('updating a student with classId enrolls/moves them', async () => {
    const t = await login('gv.lan');
    const klass = await Class.create({ name: 'Lớp 1/1', gradeLevel: 1, teachers: [teacher._id] });
    const student = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.move' });
    const res = await request(app)
      .patch(`/api/users/students/${student._id}`)
      .set(auth(t))
      .send({ fullName: 'Đã Chuyển Lớp', classId: klass._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('Đã Chuyển Lớp');
    const membership = await Membership.findOne({ class: klass._id, student: student._id });
    expect(membership).toBeTruthy();
  });

  test('listing students includes their current section(s)', async () => {
    const t = await login('gv.lan');
    const klass = await Class.create({ name: 'Lớp 1/1', gradeLevel: 1, teachers: [teacher._id] });
    const student = await h.makeUser(h.ROLES.STUDENT, { username: 'hs.an', fullName: 'Trần Minh An' });
    await Membership.create({ class: klass._id, student: student._id });
    const res = await request(app).get('/api/users/students').set(auth(t));
    expect(res.status).toBe(200);
    const row = res.body.items.find((u) => u.username === 'hs.an');
    expect(row.classes).toEqual([{ id: klass._id.toString(), name: 'Lớp 1/1', gradeLevel: 1 }]);
  });

  test('a student cannot create classes or list them (403)', async () => {
    await h.makeUser(h.ROLES.STUDENT, { username: 'hs.z' });
    const t = await login('hs.z');
    const list = await request(app).get('/api/users/classes').set(auth(t));
    expect(list.status).toBe(403);
    const create = await request(app).post('/api/users/classes').set(auth(t)).send({ name: 'x', gradeLevel: 1 });
    expect(create.status).toBe(403);
  });
});
