const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Subject = require('../src/models/Subject');
const Class = require('../src/models/Class');
const Membership = require('../src/models/Membership');
const { ROLES } = require('../src/config/constants');

let mongod;

async function connect() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}

async function clear() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

async function close() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

async function makeUser(role, overrides = {}) {
  const u = new User({
    role,
    username: overrides.username || `${role}_${Math.random().toString(36).slice(2, 8)}`,
    fullName: overrides.fullName || 'Người Dùng',
    gradeLevel: overrides.gradeLevel || null,
  });
  await u.setPassword(overrides.password || 'matkhau123');
  await u.save();
  return u;
}

async function makeSubject() {
  return Subject.create({ name: 'Tiếng Việt', code: `tv_${Math.random().toString(36).slice(2, 7)}`, gradeLevels: [3] });
}

async function makeClass(teacherIds = []) {
  return Class.create({ name: 'Lớp 3A', gradeLevel: 3, teachers: teacherIds });
}

async function enroll(classId, studentId) {
  return Membership.create({ class: classId, student: studentId });
}

module.exports = { connect, clear, close, makeUser, makeSubject, makeClass, enroll, ROLES };
