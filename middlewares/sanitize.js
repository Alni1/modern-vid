// Protection against NoSQL injection: request data must not carry MongoDB operators.
// Keys that start with "$" or contain "." are removed from req.body, req.query and req.params,
// so a value such as { "login": { "$ne": null } } can never reach a database query as an operator.

function clean(value, depth = 0) {
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  if (value === null || typeof value !== 'object' || depth > 20) return value;
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) delete value[key];
    else value[key] = clean(value[key], depth + 1);
  }
  return value;
}

function sanitize(req, res, next) {
  for (const part of ['body', 'params']) if (req[part]) clean(req[part]);
  // req.query is a getter in newer Express versions: clean the parsed object in place.
  if (req.query) clean(req.query);
  next();
}

module.exports = { sanitize, clean };
