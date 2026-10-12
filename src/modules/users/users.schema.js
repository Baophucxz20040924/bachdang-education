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

module.exports = { createUserSchema, updateUserSchema };
