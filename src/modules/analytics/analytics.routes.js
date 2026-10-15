const express = require('express');
const { z } = require('zod');
const service = require('./analytics.service');
const Attempt = require('../../models/Attempt');
const Session = require('../../models/Session');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { requireSessionOwner, requireClassAccess } = require('../../middleware/ownership');
const { ROLES } = require('../../config/constants');
const { asyncHandler } = require('../../utils/http');
const { AppError, messages } = require('../../utils/errors');

const router = express.Router();

router.use(requireAuth, requireRole(ROLES.TEACHER, ROLES.ADMIN));

// --- Class-level progress (per section: 1/1, 1/2, ...) ---------------------

// List the sections the teacher can view (for the section selector).
router.get('/classes', asyncHandler(async (req, res) => {
  res.json({ items: await service.listTeacherClasses(req.user) });
}));

// Leaderboard + homework completion % for one section. requireClassAccess
// loads req.classDoc from :classId and enforces teacher ownership.
router.get('/classes/:classId/progress', requireClassAccess, asyncHandler(async (req, res) => {
  res.json(await service.classProgress(req.classDoc));
}));

// Drill-down to one student's homework detail within the section.
router.get(
  '/classes/:classId/students/:studentId',
  requireClassAccess,
  asyncHandler(async (req, res) => {
    res.json(await service.classStudentDetail(req.classDoc, req.params.studentId));
  }),
);

// Teacher must own the session (requireSessionOwner uses :id).
router.get('/sessions/:id', requireSessionOwner, asyncHandler(async (req, res) => {
  res.json(await service.sessionAnalytics(req.sessionDoc));
}));

// Ensure the teacher owns the session that this attempt belongs to.
async function assertAttemptSessionOwner(req) {
  const attempt = await Attempt.findById(req.params.id);
  if (!attempt) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  const session = await Session.findById(attempt.session);
  if (!session) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  if (req.user.role !== ROLES.ADMIN && session.createdBy.toString() !== req.user.id) {
    throw new AppError(403, 'FORBIDDEN', messages.FORBIDDEN);
  }
  return attempt;
}

router.get('/attempts/:id', asyncHandler(async (req, res) => {
  await assertAttemptSessionOwner(req);
  res.json(await service.getAttemptDetail(req.params.id));
}));

const gradeSchema = z.object({ manualScore: z.number().min(0) });
router.post('/attempts/:id/grade', validate(gradeSchema), asyncHandler(async (req, res) => {
  await assertAttemptSessionOwner(req);
  res.json(await service.gradeManually(req.params.id, req.body.manualScore));
}));

module.exports = router;
