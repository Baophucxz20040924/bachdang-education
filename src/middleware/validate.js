// Runs a Zod schema against req.body (or a chosen source) and replaces it with parsed data.
function validate(schema, source = 'body') {
  return (req, res, next) => {
    try {
      req[source] = schema.parse(req[source]);
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { validate };
