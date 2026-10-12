const { ZodError } = require('zod');
const { AppError, messages } = require('../utils/errors');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Zod validation errors -> 400 with Vietnamese message
  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({ path: e.path.join('.'), message: e.message }));
    return res.status(400).json({
      error: { code: 'VALIDATION', message: messages.VALIDATION, details },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
  }

  // Mongo duplicate key
  if (err && err.code === 11000) {
    return res.status(409).json({
      error: { code: 'DUPLICATE', message: 'Dữ liệu bị trùng.', keyValue: err.keyValue },
    });
  }

  // Mongoose validation
  if (err && err.name === 'ValidationError') {
    return res.status(400).json({
      error: { code: 'VALIDATION', message: messages.VALIDATION, details: err.message },
    });
  }

  // eslint-disable-next-line no-console
  if (process.env.NODE_ENV !== 'test') console.error(err);
  return res.status(500).json({
    error: { code: 'INTERNAL', message: 'Đã xảy ra lỗi hệ thống.' },
  });
}

function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy đường dẫn.' } });
}

module.exports = { errorHandler, notFound };
