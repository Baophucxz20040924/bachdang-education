const request = require('supertest');
const createApp = require('../src/app');
const h = require('./helpers');
const Class = require('../src/models/Class');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function login(username, password = 'matkhau123') {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return res.body.token;
}

beforeAll(h.connect);
afterAll(h.close);
afterEach(h.clear);

describe('Lessons can only target the teacher\'s assigned classes', () => {
  let teacher; let other; let admin; let subject; let myClass; let foreignClass;
  let tToken;

  beforeEach(async () => {
    teacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.lan' });
    other = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.khac' });
    admin = await h.makeUser(h.ROLES.ADMIN, { username: 'admin' });
    subject = await h.makeSubject();
    myClass = await Class.create({ name: 'Lớp 1/1', gradeLevel: 1, teachers: [teacher._id] });
    foreignClass = await Class.create({ name: 'Lớp 1/2', gradeLevel: 1, teachers: [other._id] });
    tToken = await login('gv.lan');
  });

  test('teacher CAN create a lesson targeting their assigned class', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set(auth(tToken))
      .send({ title: 'Bài của lớp mình', gradeLevel: 1, subject: subject._id.toString(), targetClasses: [myClass._id.toString()] });
    expect(res.status).toBe(201);
    expect(res.body.targetClasses.map(String)).toEqual([myClass._id.toString()]);
  });

  test('teacher CANNOT create a lesson targeting a class they are not assigned to (403)', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set(auth(tToken))
      .send({ title: 'Bài lớp khác', gradeLevel: 1, subject: subject._id.toString(), targetClasses: [foreignClass._id.toString()] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CLASS_NOT_ASSIGNED');
  });

  test('teacher CANNOT update a lesson to target a foreign class (403)', async () => {
    const create = await request(app)
      .post('/api/sessions')
      .set(auth(tToken))
      .send({ title: 'Bài', gradeLevel: 1, subject: subject._id.toString(), targetClasses: [myClass._id.toString()] });
    const id = create.body._id;
    const res = await request(app)
      .patch(`/api/sessions/${id}`)
      .set(auth(tToken))
      .send({ targetClasses: [foreignClass._id.toString()] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CLASS_NOT_ASSIGNED');
  });

  test('teacher CANNOT publish a lesson that targets a foreign class (403)', async () => {
    // Create directly targeting a foreign class is blocked, so simulate a lesson
    // that already targets a foreign class by creating it as the OWNER teacher,
    // then verifying our teacher (not owner) cannot publish via session ownership.
    // Here we instead test: create valid, then (via admin) retarget to foreign,
    // then teacher publish must 403.
    const create = await request(app)
      .post('/api/sessions')
      .set(auth(tToken))
      .send({ title: 'Bài', gradeLevel: 1, subject: subject._id.toString(), targetClasses: [myClass._id.toString()] });
    const id = create.body._id;
    // Add a question so publish passes the "not empty" check.
    await request(app).post(`/api/sessions/${id}/questions`).set(auth(tToken)).send({
      type: 'true_false', prompt: '1 + 1 = 2?', correctValue: true,
    });
    // Admin retargets the lesson to a foreign class (admin may target anything).
    const admZ = await login('admin');
    const retarget = await request(app)
      .patch(`/api/sessions/${id}`)
      .set(auth(admZ))
      .send({ targetClasses: [foreignClass._id.toString()] });
    expect(retarget.status).toBe(200);
    // Now the owning teacher tries to publish → blocked because the target is foreign.
    const pub = await request(app).post(`/api/sessions/${id}/publish`).set(auth(tToken)).send();
    expect(pub.status).toBe(403);
    expect(pub.body.error.code).toBe('CLASS_NOT_ASSIGNED');
  });

  test('admin can create a lesson targeting ANY class', async () => {
    const a = await login('admin');
    const res = await request(app)
      .post('/api/sessions')
      .set(auth(a))
      .send({ title: 'Bài của admin', gradeLevel: 1, subject: subject._id.toString(), targetClasses: [foreignClass._id.toString()] });
    expect(res.status).toBe(201);
  });
});
