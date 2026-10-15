const { z } = require('zod');
const { ROLES } = require('../../config/constants');

const createUserSchema = z.object({
  role: z.enum([ROLES.TEACHER, ROLES.STUDENT, ROLES.ADMIN]),
  fullName: z.string().min(1, 'Vui lòng nhập họ tên'),
  username: z.string().min(3, 'Tên đăng nhập tối thiểu 3 ký tự'),
  email: z.string().email('Email không hợp lệ').optional().nullable(),
  password: z.string().min(6, 'Mật khẩu tối thiểu 6 ký tự'),
  gradeLevel: z.number().int().min(1).max(5).optional().nullable(),
});

const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.string().email().optional().nullable(),
  password: z.string().min(6).optional(),
  gradeLevel: z.number().int().min(1).max(5).optional().nullable(),
  isActive: z.boolean().optional(),
});

// Teacher-scoped: a teacher may only create STUDENT accounts. The `role` is
// forced to STUDENT server-side, so it is intentionally not part of this schema.
// Students do not have an email address.
const createStudentSchema = z.object({
  fullName: z.string().min(1, 'Vui lòng nhập họ tên'),
  username: z.string().min(3, 'Tên đăng nhập tối thiểu 3 ký tự'),
  password: z.string().min(6, 'Mật khẩu tối thiểu 6 ký tự'),
  gradeLevel: z.number().int().min(1).max(5).optional().nullable(),
});

// Teacher-scoped update: a teacher may edit a student's name, grade, password,
// and active status. No role or email changes.
const updateStudentSchema = z.object({
  fullName: z.string().min(1).optional(),
  password: z.string().min(6).optional(),
  gradeLevel: z.number().int().min(1).max(5).optional().nullable(),
  isActive: z.boolean().optional(),
});

module.exports = {
  createUserSchema,
  updateUserSchema,
  createStudentSchema,
  updateStudentSchema,
};
