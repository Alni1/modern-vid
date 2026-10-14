// Routes that work for guests and signed-in users alike: req.user is set when signed in (see utils/auth.js).
module.exports = require('../utils/auth').optionalAuth;
