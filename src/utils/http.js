function getPagination(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function paged(items, total, page, limit) {
  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

// Wrap async route handlers to forward errors to the error middleware.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { getPagination, paged, asyncHandler };
