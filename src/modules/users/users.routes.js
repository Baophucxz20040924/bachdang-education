const express = require('express');
const service = require('./users.service');
const {
  createUserSchema,
  updateUserSchema,
  createStudentSchema,
  updateStudentSchema,
  createTeacherClassSchema,
} = require('./users.schema');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { ROLES } = require('../../config/constants');
const { asyncHandler } = require('../../utils/http');

const router = express.Router();

// ---------------------------------------------------------------------------
// Teacher-scoped student management: /api/users/students
// Teachers (and admins) can create, list, edit, ban/unban, and delete STUDENT
// accounts only. These routes are declared BEFORE the admin-only guard below so
// they use their own, broader role check.
// ---------------------------------------------------------------------------
const teacherGuard = [requireAuth, requireRole(ROLES.TEACHER, ROLES.ADMIN)];

// Teacher-usable class sections (for the section selector + inline create).
router.get('/classes', teacherGuard, asyncHandler(async (req, res) => {
  res.json({ items: await service.listTeacherClasses(req.user, req.query.gradeLevel) });
}));

router.post(
  '/classes',
  teacherGuard,
  validate(createTeacherClassSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.createTeacherClass(req.body, req.user));
  }),
);

router.get('/students', teacherGuard, asyncHandler(async (req, res) => {
  res.json(await service.listStudents(req.query));
}));

router.post(
  '/students',
  teacherGuard,
  validate(createStudentSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.createStudent(req.body, req.user));
  }),
);

router.patch(
  '/students/:id',
  teacherGuard,
  validate(updateStudentSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.updateStudent(req.params.id, req.body, req.user));
  }),
);

// Ban (deactivate) or unban (reactivate) a student.
router.post('/students/:id/ban', teacherGuard, asyncHandler(async (req, res) => {
  res.json(await service.setStudentActive(req.params.id, false, req.user.id));
}));

router.post('/students/:id/unban', teacherGuard, asyncHandler(async (req, res) => {
  res.json(await service.setStudentActive(req.params.id, true, req.user.id));
}));

router.delete('/students/:id', teacherGuard, asyncHandler(async (req, res) => {
  res.json(await service.deleteStudent(req.params.id, req.user.id));
}));

// ---------------------------------------------------------------------------
// Admin-only user management (all roles): /api/users
// ---------------------------------------------------------------------------
router.use(requireAuth, requireRole(ROLES.ADMIN));

router.get('/', asyncHandler(async (req, res) => {
  res.json(await service.listUsers(req.query));
}));

router.post('/', validate(createUserSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await service.createUser(req.body));
}));

router.patch('/:id', validate(updateUserSchema), asyncHandler(async (req, res) => {
  res.json(await service.updateUser(req.params.id, req.body));
}));

router.post('/:id/deactivate', asyncHandler(async (req, res) => {
  res.json(await service.deactivateUser(req.params.id, req.user.id));
}));

module.exports = router;
