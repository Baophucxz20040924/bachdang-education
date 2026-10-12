const Class = require('../models/Class');
const Session = require('../models/Session');
const Attempt = require('../models/Attempt');
const { ROLES } = require('../config/constants');
const { AppError, messages } = require('../utils/errors');
const { asyncHandler } = require('../utils/http');

// Teacher must be assigned to the class; admin has full access. Loads req.classDoc.
const requireClassAccess = asyncHandler(async (req, res, next) => {
  const klass = await Class.findById(req.params.id || req.params.classId);
  if (!klass) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  if (req.user.role !== ROLES.ADMIN) {
    const isAssigned = klass.teachers.some((t) => t.toString() === req.user.id);
    if (!isAssigned) throw new AppError(403, 'FORBIDDEN', messages.FORBIDDEN);
  }
  req.classDoc = klass;
  next();
});

// Teacher must own the session (createdBy); admin has full access. Loads req.sessionDoc.
const requireSessionOwner = asyncHandler(async (req, res, next) => {
  const session = await Session.findById(req.params.id || req.params.sessionId);
  if (!session) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  if (req.user.role !== ROLES.ADMIN && session.createdBy.toString() !== req.user.id) {
    throw new AppError(403, 'FORBIDDEN', messages.FORBIDDEN);
  }
  req.sessionDoc = session;
  next();
});

// Student must own the attempt. Loads req.attemptDoc.
const requireAttemptOwner = asyncHandler(async (req, res, next) => {
  const attempt = await Attempt.findById(req.params.id);
  if (!attempt) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  if (attempt.student.toString() !== req.user.id) {
    throw new AppError(403, 'FORBIDDEN', messages.FORBIDDEN);
  }
  req.attemptDoc = attempt;
  next();
});

module.exports = { requireClassAccess, requireSessionOwner, requireAttemptOwner };
