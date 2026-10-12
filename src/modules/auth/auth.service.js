const User = require('../../models/User');
const { signToken } = require('../../middleware/auth');
const { AppError, messages } = require('../../utils/errors');

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
  return user.toJSON();
}

module.exports = { login, me };
