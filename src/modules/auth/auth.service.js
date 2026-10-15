const User = require('../../models/User');
const Membership = require('../../models/Membership');
const Class = require('../../models/Class');
const { signToken } = require('../../middleware/auth');
const { AppError, messages } = require('../../utils/errors');
const { ROLES } = require('../../config/constants');

async function login(username, password) {
  const user = await User.findOne({ username: String(username).toLowerCase() });
  if (!user) throw new AppError(401, 'INVALID_CREDENTIALS', messages.INVALID_CREDENTIALS);
  if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', messages.ACCOUNT_DISABLED);
  const ok = await user.verifyPassword(password);
  if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', messages.INVALID_CREDENTIALS);
  const token = signToken(user);
  return { token, user: user.toJSON() };
}

async function me(userId) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  const profile = user.toJSON();
  // Attach the student's class section(s) (e.g. "Lớp 3/1") so the UI can show
  // the specific section instead of just the grade number.
  if (user.role === ROLES.STUDENT) {
    const memberships = await Membership.find({ student: user._id, active: true }).sort({ createdAt: 1 });
    const classIds = memberships.map((m) => m.class);
    const classes = await Class.find({ _id: { $in: classIds } }).select('name gradeLevel');
    const byId = new Map(classes.map((c) => [c._id.toString(), c]));
    profile.classes = classIds
      .map((id) => {
        const c = byId.get(id.toString());
        return c ? { id: c._id.toString(), name: c.name, gradeLevel: c.gradeLevel } : null;
      })
      .filter(Boolean);
  }
  return profile;
}

// Any authenticated user may change their OWN password. Requires the current
// password to be correct (defense against hijacked sessions / shoulder-surfing).
async function changePassword(userId, currentPassword, newPassword) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  const ok = await user.verifyPassword(currentPassword);
  if (!ok) throw new AppError(400, 'WRONG_PASSWORD', 'Mật khẩu hiện tại không đúng.');
  await user.setPassword(newPassword);
  await user.save();
  return { success: true };
}

module.exports = { login, me, changePassword };
