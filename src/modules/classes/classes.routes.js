const express = require('express');
const { z } = require('zod');
const service = require('./classes.service');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { requireClassAccess } = require('../../middleware/ownership');
const { ROLES } = require('../../config/constants');
const { asyncHandler } = require('../../utils/http');

const router = express.Router();

const createClassSchema = z.object({
  name: z.string().min(1, 'Vui lòng nhập tên lớp'),
  gradeLevel: z.number().int().min(1).max(5),
  teachers: z.array(z.string()).optional(),
});
const updateClassSchema = createClassSchema.partial();
const idBody = (field) => z.object({ [field]: z.string().min(1) });

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  res.json({ items: await service.listClasses(req.user) });
}));

router.post('/', requireRole(ROLES.ADMIN), validate(createClassSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await service.createClass(req.body));
}));

router.patch('/:id', requireRole(ROLES.ADMIN), validate(updateClassSchema), asyncHandler(async (req, res) => {
  res.json(await service.updateClass(req.params.id, req.body));
}));

// Teacher assignment (admin only)
router.post('/:id/teachers', requireRole(ROLES.ADMIN), validate(idBody('teacherId')), requireClassAccess, asyncHandler(async (req, res) => {
  res.json(await service.assignTeacher(req.classDoc, req.body.teacherId));
}));
router.delete('/:id/teachers/:tid', requireRole(ROLES.ADMIN), requireClassAccess, asyncHandler(async (req, res) => {
  res.json(await service.removeTeacher(req.classDoc, req.params.tid));
}));

// Enrollment (admin only)
router.post('/:id/students', requireRole(ROLES.ADMIN), validate(idBody('studentId')), requireClassAccess, asyncHandler(async (req, res) => {
  res.status(201).json(await service.enrollStudent(req.classDoc, req.body.studentId));
}));
router.delete('/:id/students/:sid', requireRole(ROLES.ADMIN), requireClassAccess, asyncHandler(async (req, res) => {
  res.json(await service.unenrollStudent(req.classDoc, req.params.sid));
}));

// List students: admin or assigned teacher
router.get('/:id/students', requireClassAccess, asyncHandler(async (req, res) => {
  res.json({ items: await service.listStudents(req.classDoc) });
}));

module.exports = router;
