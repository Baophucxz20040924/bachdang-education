const User = require('../../models/User');
const AuditLog = require('../../models/AuditLog');
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

async function createStudent(data) {
  return createUser({ ...data, role: ROLES.STUDENT });
}

async function listStudents(query) {
  return listUsers({ ...query, role: ROLES.STUDENT });
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

async function updateStudent(id, data) {
  await getStudentOrThrow(id);
  return updateUser(id, data);
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
};
