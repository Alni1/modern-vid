const express = require('express');
const router = express.Router();

// Accounts are deleted only by their owner from the profile page (POST /userprofile/deleteUser,
// which checks the session). There is intentionally no unauthenticated delete endpoint here.
router.get('/', function (req, res) {
  res.redirect('/userprofile');
});

module.exports = router;
