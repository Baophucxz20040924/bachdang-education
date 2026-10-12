const Class = require('../../models/Class');
const Membership = require('../../models/Membership');
const User = require('../../models/User');
const { ROLES } = require('../../config/constants');
const { AppError, messages } = require('../../utils/errors');

async function listClasses(user) {
  const filter = {};
  if (user.role === ROLES.TEACHER) filter.teachers = user.id;
  const items = await Class.find(filter).populate('teachers', 'fullName username').sort({ name: 1 });
  return items;
}

async function createClass(data) {
  return Class.create({ name: data.name, gradeLevel: data.gradeLevel, teachers: data.teachers || [] });
}

async function updateClass(id, data) {
  const klass = await Class.findByIdAndUpdate(id, data, { new: true });
  if (!klass) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  return klass;
}

async function assignTeacher(klass, teacherId) {
  const teacher = await User.findOne({ _id: teacherId, role: ROLES.TEACHER });
  if (!teacher) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy giáo viên.');
  if (!klass.teachers.some((t) => t.toString() === teacherId)) {
    klass.teachers.push(teacherId);
    await klass.save();
  }
  return klass;
}

async function removeTeacher(klass, teacherId) {
  klass.teachers = klass.teachers.filter((t) => t.toString() !== teacherId);
  await klass.save();
  return klass;
}

async function enrollStudent(klass, studentId) {
  const student = await User.findOne({ _id: studentId, role: ROLES.STUDENT });
  if (!student) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy học sinh.');
  try {
    const membership = await Membership.create({ class: klass._id, student: studentId });
    return membership;
  } catch (err) {
    if (err.code === 11000) throw new AppError(409, 'DUPLICATE_MEMBERSHIP', messages.DUPLICATE_MEMBERSHIP);
    throw err;
  }
}

async function unenrollStudent(klass, studentId) {
  await Membership.deleteOne({ class: klass._id, student: studentId });
  return { ok: true };
}

async function listStudents(klass) {
  const memberships = await Membership.find({ class: klass._id, active: true }).populate(
    'student',
    'fullName username gradeLevel isActive',
  );
  return memberships.map((m) => m.student).filter(Boolean);
}

module.exports = {
  listClasses,
  createClass,
  updateClass,
  assignTeacher,
  removeTeacher,
  enrollStudent,
  unenrollStudent,
  listStudents,
};
