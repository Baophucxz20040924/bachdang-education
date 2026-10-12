const User = require('../../models/User');
const AuditLog = require('../../models/AuditLog');
const { AppError, messages } = require('../../utils/errors');
const { getPagination, paged } = require('../../utils/http');

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

module.exports = { createUser, updateUser, deactivateUser, listUsers };
