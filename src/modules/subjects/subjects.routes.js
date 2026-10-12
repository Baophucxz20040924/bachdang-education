const express = require('express');
const { z } = require('zod');
const Subject = require('../../models/Subject');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { ROLES } = require('../../config/constants');
const { asyncHandler } = require('../../utils/http');
const { AppError, messages } = require('../../utils/errors');

const router = express.Router();

const subjectSchema = z.object({
  name: z.string().min(1, 'Vui lòng nhập tên môn học'),
  code: z.string().min(1, 'Vui lòng nhập mã môn học'),
  gradeLevels: z.array(z.number().int().min(1).max(5)).default([]),
  isActive: z.boolean().optional(),
});

const updateSubjectSchema = subjectSchema.partial();

router.use(requireAuth);

// Teachers and admins can read; filter by grade.
router.get('/', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.grade) filter.gradeLevels = Number(req.query.grade);
  const items = await Subject.find(filter).sort({ name: 1 });
  res.json({ items });
}));

router.post('/', requireRole(ROLES.ADMIN), validate(subjectSchema), asyncHandler(async (req, res) => {
  const subject = await Subject.create({ ...req.body, code: req.body.code.toLowerCase() });
  res.status(201).json(subject);
}));

router.patch('/:id', requireRole(ROLES.ADMIN), validate(updateSubjectSchema), asyncHandler(async (req, res) => {
  const subject = await Subject.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!subject) throw new AppError(404, 'NOT_FOUND', messages.NOT_FOUND);
  res.json(subject);
}));

module.exports = router;
