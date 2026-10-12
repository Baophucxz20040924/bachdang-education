const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { AppError, messages } = require('../utils/errors');

function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES },
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError(401, 'UNAUTHORIZED', messages.UNAUTHORIZED));
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch (err) {
    return next(new AppError(401, 'UNAUTHORIZED', messages.UNAUTHORIZED));
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError(401, 'UNAUTHORIZED', messages.UNAUTHORIZED));
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, 'FORBIDDEN', messages.FORBIDDEN));
    }
    return next();
  };
}

module.exports = { signToken, requireAuth, requireRole };
