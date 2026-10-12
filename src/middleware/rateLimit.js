const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.' } },
});

// Stricter limiter for AI generation endpoints, keyed per user when available.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? req.user.id : req.ip),
  message: { error: { code: 'RATE_LIMIT', message: 'Bạn tạo bài tập quá nhanh. Vui lòng thử lại sau.' } },
});

module.exports = { generalLimiter, aiLimiter };
