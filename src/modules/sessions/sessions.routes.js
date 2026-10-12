const express = require('express');
const { z } = require('zod');
const service = require('./sessions.service');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { requireSessionOwner } = require('../../middleware/ownership');
const { ROLES } = require('../../config/constants');
const { asyncHandler } = require('../../utils/http');

const router = express.Router();

const settingsSchema = z.object({
  openAt: z.coerce.date().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  timeLimitMinutes: z.number().int().positive().nullable().optional(),
  maxAttempts: z.number().int().positive().optional(),
  revealPolicy: z.enum(['after_submit', 'after_due', 'manual']).optional(),
}).partial();

const createSchema = z.object({
  title: z.string().min(1, 'Vui lòng nhập tiêu đề'),
  description: z.string().optional(),
  gradeLevel: z.number().int().min(1).max(5),
  subject: z.string().min(1, 'Vui lòng chọn môn học'),
  topic: z.string().optional(),
  objectives: z.array(z.string()).optional(),
  targetClasses: z.array(z.string()).optional(),
  settings: settingsSchema.optional(),
});
const updateSchema = createSchema.partial();
const reorderSchema = z.object({ order: z.array(z.string()) });

router.use(requireAuth, requireRole(ROLES.TEACHER, ROLES.ADMIN));

router.get('/', asyncHandler(async (req, res) => {
  res.json(await service.listSessions(req.user, req.query));
}));

router.post('/', validate(createSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await service.createSession(req.user, req.body));
}));

router.get('/:id', requireSessionOwner, asyncHandler(async (req, res) => {
  res.json(req.sessionDoc);
}));

router.patch('/:id', requireSessionOwner, validate(updateSchema), asyncHandler(async (req, res) => {
  res.json(await service.updateSession(req.sessionDoc, req.body));
}));

router.post('/:id/duplicate', requireSessionOwner, asyncHandler(async (req, res) => {
  res.status(201).json(await service.duplicate(req.sessionDoc, req.user));
}));

// Questions
router.post('/:id/questions', requireSessionOwner, asyncHandler(async (req, res) => {
  res.status(201).json(await service.addQuestion(req.sessionDoc, req.body));
}));
router.patch('/:id/questions/:qid', requireSessionOwner, asyncHandler(async (req, res) => {
  res.json(await service.updateQuestion(req.sessionDoc, req.params.qid, req.body));
}));
router.delete('/:id/questions/:qid', requireSessionOwner, asyncHandler(async (req, res) => {
  res.json(await service.deleteQuestion(req.sessionDoc, req.params.qid));
}));
router.patch('/:id/reorder', requireSessionOwner, validate(reorderSchema), asyncHandler(async (req, res) => {
  res.json(await service.reorderQuestions(req.sessionDoc, req.body.order));
}));

// Lifecycle
router.post('/:id/publish', requireSessionOwner, asyncHandler(async (req, res) => {
  res.json(await service.publish(req.sessionDoc, req.user.id));
}));
router.post('/:id/unpublish', requireSessionOwner, asyncHandler(async (req, res) => {
  res.json(await service.unpublish(req.sessionDoc));
}));
router.post('/:id/archive', requireSessionOwner, asyncHandler(async (req, res) => {
  res.json(await service.archive(req.sessionDoc));
}));

// Preview as student (answer keys stripped)
router.get('/:id/preview', requireSessionOwner, asyncHandler(async (req, res) => {
  res.json(service.toStudentView(req.sessionDoc));
}));

// Delete a session (owner only), including its attempts.
router.delete('/:id', requireSessionOwner, asyncHandler(async (req, res) => {
  res.json(await service.remove(req.sessionDoc, req.user.id));
}));

module.exports = router;
