const express = require('express');
const { z } = require('zod');
const service = require('./student.service');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { requireAttemptOwner } = require('../../middleware/ownership');
const { ROLES } = require('../../config/constants');
const { asyncHandler } = require('../../utils/http');

const router = express.Router();

const answersSchema = z.object({
  answers: z.array(z.object({ qid: z.string(), response: z.any() })).default([]),
});

router.use(requireAuth, requireRole(ROLES.STUDENT));

router.get('/sessions', asyncHandler(async (req, res) => {
  res.json({ items: await service.listAssigned(req.user.id) });
}));

router.post('/sessions/:id/start', asyncHandler(async (req, res) => {
  res.status(201).json(await service.startAttempt(req.user.id, req.params.id));
}));

router.patch('/attempts/:id/answers', requireAttemptOwner, validate(answersSchema), asyncHandler(async (req, res) => {
  res.json(await service.saveAnswers(req.attemptDoc, req.body.answers));
}));

router.post('/attempts/:id/submit', requireAttemptOwner, asyncHandler(async (req, res) => {
  res.json(await service.submitAttempt(req.attemptDoc));
}));

router.get('/attempts', asyncHandler(async (req, res) => {
  res.json({ items: await service.listMyAttempts(req.user.id) });
}));

router.get('/leaderboard', asyncHandler(async (req, res) => {
  res.json(await service.getClassLeaderboard(req.user.id));
}));

module.exports = router;
