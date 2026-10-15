const express = require('express');
const { z } = require('zod');
const service = require('./student.service');
const chatService = require('./chat.service');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { requireAttemptOwner } = require('../../middleware/ownership');
const { aiLimiter } = require('../../middleware/rateLimit');
const { ROLES } = require('../../config/constants');
const { asyncHandler } = require('../../utils/http');

const router = express.Router();

const answersSchema = z.object({
  answers: z.array(z.object({ qid: z.string(), response: z.any() })).default([]),
});

const chatSchema = z.object({
  message: z.string().min(1, 'Em hãy nhập câu hỏi cho cô nhé.').max(1000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(1000) }))
    .max(20)
    .optional(),
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
  res.json(await service.getClassLeaderboard(req.user.id, req.query.classId || null));
}));

// AI tutor chat — grounded only on lessons published to this student.
router.post('/chat', aiLimiter, validate(chatSchema), asyncHandler(async (req, res) => {
  res.json(await chatService.chat(req.user.id, { message: req.body.message, history: req.body.history }));
}));

// Lightweight info for the chat UI greeting: who the tutor is + whether the
// student has any assigned lessons yet.
router.get('/chat/info', asyncHandler(async (req, res) => {
  const tutorName = await chatService.resolveTutorName(req.user.id);
  const lessons = await chatService.getStudentLessonDataset(req.user.id);
  res.json({ tutorName, lessonCount: lessons.length });
}));

module.exports = router;
