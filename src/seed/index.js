/* Idempotent seed with synthetic Vietnamese data. Run: npm run seed */
const env = require('../config/env');
const { connectDB, disconnectDB } = require('../config/db');
const User = require('../models/User');
const Subject = require('../models/Subject');
const Class = require('../models/Class');
const Membership = require('../models/Membership');
const { ROLES } = require('../config/constants');

async function upsertUser({ username, role, fullName, gradeLevel = null, password }) {
  let user = await User.findOne({ username });
  if (!user) {
    user = new User({ username, role, fullName, gradeLevel });
    await user.setPassword(password);
    await user.save();
  }
  return user;
}

async function upsertSubject(name, code, gradeLevels) {
  let s = await Subject.findOne({ code });
  if (!s) s = await Subject.create({ name, code, gradeLevels });
  return s;
}

async function run() {
  if (!env.MONGODB_URI) {
    // eslint-disable-next-line no-console
    console.error('Thiếu MONGODB_URI. Hãy cấu hình .env trước khi seed.');
    process.exit(1);
  }
  await connectDB(env.MONGODB_URI);
  const pwd = env.SEED_DEFAULT_PASSWORD;

  // Admin
  const admin = await upsertUser({ username: 'admin', role: ROLES.ADMIN, fullName: 'Quản trị viên', password: pwd });

  // Subjects
  await upsertSubject('Tiếng Việt', 'tieng-viet', [1, 2, 3, 4, 5]);
  await upsertSubject('Toán', 'toan', [1, 2, 3, 4, 5]);
  await upsertSubject('Tiếng Anh', 'tieng-anh', [3, 4, 5]);
  await upsertSubject('Tự nhiên và Xã hội', 'tnxh', [1, 2, 3]);

  // Teacher
  const teacher = await upsertUser({ username: 'gv.lan', role: ROLES.TEACHER, fullName: 'Nguyễn Thị Lan', password: pwd });

  // Students
  const studentDefs = [
    { username: 'hs.an', fullName: 'Trần Minh An' },
    { username: 'hs.ha', fullName: 'Lê Thu Hà' },
    { username: 'hs.binh', fullName: 'Phạm Văn Bình' },
  ];
  const students = [];
  for (const d of studentDefs) {
    students.push(await upsertUser({ ...d, role: ROLES.STUDENT, gradeLevel: 3, password: pwd }));
  }

  // Class 3A at Trường Tiểu học Hoa Sen
  let klass = await Class.findOne({ name: 'Lớp 3A' });
  if (!klass) klass = await Class.create({ name: 'Lớp 3A', gradeLevel: 3, teachers: [teacher._id] });
  else if (!klass.teachers.some((t) => t.toString() === teacher._id.toString())) {
    klass.teachers.push(teacher._id);
    await klass.save();
  }

  // Enroll students (ignore duplicates)
  for (const s of students) {
    await Membership.updateOne(
      { class: klass._id, student: s._id },
      { $setOnInsert: { active: true } },
      { upsert: true },
    );
  }

  // eslint-disable-next-line no-console
  console.log('Seed hoàn tất. Tài khoản demo (mật khẩu: %s):', pwd);
  // eslint-disable-next-line no-console
  console.log('  admin / %s   (Quản trị viên)', pwd);
  // eslint-disable-next-line no-console
  console.log('  gv.lan / %s  (Giáo viên — Nguyễn Thị Lan, Lớp 3A)', pwd);
  // eslint-disable-next-line no-console
  console.log('  hs.an, hs.ha, hs.binh / %s  (Học sinh Lớp 3A)', pwd);

  await disconnectDB();
}

run().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  await disconnectDB();
  process.exit(1);
});
