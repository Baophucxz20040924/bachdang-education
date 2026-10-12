const express = require('express');
const service = require('./users.service');
const { createUserSchema, updateUserSchema } = require('./users.schema');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { ROLES } = require('../../config/constants');
const { asyncHandler } = require('../../utils/http');

const router = express.Router();

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
