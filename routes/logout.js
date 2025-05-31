const express = require('express');
const router = express.Router();

router.post('/', (req, res) => {
  // Clear JWT cookie to logout
  res.clearCookie('token');
  res.redirect('/');
});

module.exports = router;
