const express = require('express');
const { loginSchema } = require('./auth.schema');
const service = require('./auth.service');
const { validate } = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const { asyncHandler } = require('../../utils/http');

const router = express.Router();

router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const result = await service.login(username, password);
    res.json(result);
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await service.me(req.user.id);
    res.json({ user });
  }),
);

module.exports = router;
