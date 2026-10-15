const User = require('../../models/User');
const AuditLog = require('../../models/AuditLog');
const Class = require('../../models/Class');
const Membership = require('../../models/Membership');
const { AppError, messages } = require('../../utils/errors');
const { getPagination, paged } = require('../../utils/http');
const { ROLES } = require('../../config/constants');

async function createUser(data) {
  const existing = await User.findOne({
    $or: [
      { username: data.username.toLowerCase() },
      ...(data.email ? [{ email: data.email.toLowerCase() }] : []),
    ],
  });
  if (existing) throw new AppError(409, 'DUPLICATE_USER', messages.DUPLICATE_USER);

  const user = new User({
    role: data.role,
    fullName: data.fullName,
    username: data.username.toLowerCase(),
    gradeLevel: data.gradeLevel ?? null,
  });
  if (data.email) user.email = data.email.toLowerCase();
  await user.setPassword(data.password);
  await user.save();
  return user.toJSON();
}

async function updateUser(id, data) {
  const user = await User.findById(id);
  if (!user) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  if (data.fullName !== undefined) user.fullName = data.fullName;
  if (data.email !== undefined) {
    if (data.email) user.email = data.email.toLowerCase();
    else user.email = undefined;
  }
  if (data.gradeLevel !== undefined) user.gradeLevel = data.gradeLevel;
  if (data.isActive !== undefined) user.isActive = data.isActive;
  if (data.password) await user.setPassword(data.password);
  await user.save();
  return user.toJSON();
}

async function deactivateUser(id, actorId) {
  const user = await User.findById(id);
  if (!user) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  user.isActive = false;
  await user.save();
  await AuditLog.create({
    actor: actorId,
    action: 'USER_DEACTIVATE',
    targetType: 'User',
    targetId: user._id,
  });
  return user.toJSON();
}

// --- Teacher-scoped student management -------------------------------------
// Teachers may create, list, edit, ban/unban, and delete STUDENT accounts only.

// Sections a teacher may use (own). Admin sees all. Optional grade filter.
async function listTeacherClasses(user, gradeLevel) {
  const filter = { isActive: true };
  if (user.role !== ROLES.ADMIN) filter.teachers = user.id;
  if (gradeLevel != null && gradeLevel !== '') filter.gradeLevel = Number(gradeLevel);
  const classes = await Class.find(filter).select('name gradeLevel').sort({ gradeLevel: 1, name: 1 });
  const ids = classes.map((c) => c._id);
  // Count active students per class in one aggregation.
  const counts = await Membership.aggregate([
    { $match: { class: { $in: ids }, active: true } },
    { $group: { _id: '$class', n: { $sum: 1 } } },
  ]);
  const countByClass = new Map(counts.map((c) => [c._id.toString(), c.n]));
  return classes.map((c) => ({
    id: c._id.toString(),
    name: c.name,
    gradeLevel: c.gradeLevel,
    studentCount: countByClass.get(c._id.toString()) || 0,
  }));
}

// Create a section (1/1, 1/2, ...). The creating teacher becomes an owner so
// they keep access (progress, leaderboard). Admin may create without owning.
async function createTeacherClass(data, actor) {
  const teachers = actor.role === ROLES.TEACHER ? [actor.id] : [];
  const klass = await Class.create({ name: data.name, gradeLevel: data.gradeLevel, teachers });
  return { id: klass._id.toString(), name: klass.name, gradeLevel: klass.gradeLevel };
}

// Delete a class section. Only the owning teacher (or an admin) may delete it.
// Refuses when students are still enrolled so a teacher cannot accidentally
// lose a class full of students — they must move/unenroll students first.
async function deleteTeacherClass(classId, actor) {
  const klass = await Class.findById(classId);
  if (!klass) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy lớp.');
  if (actor.role !== ROLES.ADMIN) {
    const owns = klass.teachers.some((t) => t.toString() === actor.id);
    if (!owns) throw new AppError(403, 'FORBIDDEN', messages.FORBIDDEN);
  }
  const studentCount = await Membership.countDocuments({ class: klass._id, active: true });
  if (studentCount > 0) {
    throw new AppError(
      409,
      'CLASS_NOT_EMPTY',
      `Lớp còn ${studentCount} học sinh. Hãy chuyển học sinh sang lớp khác trước khi xóa.`,
    );
  }
  // Remove any leftover (inactive) memberships, then the class itself.
  await Membership.deleteMany({ class: klass._id });
  await Class.deleteOne({ _id: klass._id });
  return { success: true, id: klass._id.toString() };
}

// Verify the actor may enroll into a class, then enroll the student.
// Enrollment is EXCLUSIVE: a student belongs to exactly ONE class at a time.
// Enrolling into a new class removes any other (active or inactive) memberships
// so the student is never left in two classes (e.g. default 2A + new 2/1).
async function enrollIntoClass(classId, studentId, actor) {
  const klass = await Class.findById(classId);
  if (!klass) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy lớp.');
  if (actor.role !== ROLES.ADMIN) {
    const owns = klass.teachers.some((t) => t.toString() === actor.id);
    if (!owns) throw new AppError(403, 'FORBIDDEN', messages.FORBIDDEN);
  }
  // Remove the student from every OTHER class first (exclusive membership).
  await Membership.deleteMany({ student: studentId, class: { $ne: klass._id } });
  // Idempotently ensure membership in the target class and keep it active.
  await Membership.updateOne(
    { class: klass._id, student: studentId },
    { $set: { active: true } },
    { upsert: true },
  );
}

async function createStudent(data, actor) {
  // Validate class ownership BEFORE creating the user so we don't leave an
  // orphan account if the class check fails.
  if (data.classId) {
    const klass = await Class.findById(data.classId);
    if (!klass) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy lớp.');
    if (actor && actor.role !== ROLES.ADMIN) {
      const owns = klass.teachers.some((t) => t.toString() === actor.id);
      if (!owns) throw new AppError(403, 'FORBIDDEN', messages.FORBIDDEN);
    }
  }
  const created = await createUser({ ...data, role: ROLES.STUDENT });
  if (data.classId) await enrollIntoClass(data.classId, created._id, actor);
  return created;
}

async function listStudents(query) {
  const result = await listUsers({ ...query, role: ROLES.STUDENT });
  // Attach each student's current section(s) so the UI can show/edit it.
  const ids = result.items.map((u) => u._id);
  const memberships = await Membership.find({ student: { $in: ids }, active: true })
    .populate('class', 'name gradeLevel');
  const byStudent = new Map();
  for (const m of memberships) {
    if (!m.class) continue;
    const sid = m.student.toString();
    if (!byStudent.has(sid)) byStudent.set(sid, []);
    byStudent.get(sid).push({ id: m.class._id.toString(), name: m.class.name, gradeLevel: m.class.gradeLevel });
  }
  result.items = result.items.map((u) => ({
    ...u,
    classes: byStudent.get(u._id.toString()) || [],
  }));
  return result;
}

// Ensure the target exists AND is a student. Teachers must never touch
// teacher/admin accounts through these endpoints.
async function getStudentOrThrow(id) {
  const user = await User.findById(id);
  if (!user || user.role !== ROLES.STUDENT) {
    throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  }
  return user;
}

async function updateStudent(id, data, actor) {
  await getStudentOrThrow(id);
  // Optionally move/enroll the student into a section.
  if (data.classId) await enrollIntoClass(data.classId, id, actor);
  // Don't pass classId through to the generic user updater.
  const rest = { ...data };
  delete rest.classId;
  return updateUser(id, rest);
}

// Ban = deactivate (cannot log in). Unban = reactivate.
async function setStudentActive(id, isActive, actorId) {
  await getStudentOrThrow(id);
  if (isActive) {
    const user = await User.findById(id);
    user.isActive = true;
    await user.save();
    await AuditLog.create({
      actor: actorId,
      action: 'USER_REACTIVATE',
      targetType: 'User',
      targetId: user._id,
    });
    return user.toJSON();
  }
  return deactivateUser(id, actorId);
}

async function deleteStudent(id, actorId) {
  const user = await getStudentOrThrow(id);
  await User.deleteOne({ _id: user._id });
  await AuditLog.create({
    actor: actorId,
    action: 'USER_DELETE',
    targetType: 'User',
    targetId: user._id,
  });
  return { success: true, id: String(user._id) };
}

async function listUsers(query) {
  const { page, limit, skip } = getPagination(query);
  const filter = {};
  if (query.role) filter.role = query.role;
  if (query.q) {
    filter.$or = [
      { fullName: { $regex: query.q, $options: 'i' } },
      { username: { $regex: query.q, $options: 'i' } },
    ];
  }
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  return paged(items.map((u) => u.toJSON()), total, page, limit);
}

module.exports = {
  createUser,
  updateUser,
  deactivateUser,
  listUsers,
  createStudent,
  listStudents,
  updateStudent,
  setStudentActive,
  deleteStudent,
  listTeacherClasses,
  createTeacherClass,
  deleteTeacherClass,
};
