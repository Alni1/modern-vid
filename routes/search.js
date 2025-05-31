const express = require('express');
const VideoMeta = require('../schemas/VideoMeta');
const _ = require('lodash');
const optionalVerifyToken = require('../middlewares/optionalVerifyToken'); // Импортируем новый middleware
const router = express.Router();

// GET /search?q=some-tag&category=Education
router.get('/', optionalVerifyToken, async (req, res) => { // Используем optionalVerifyToken
  const query = req.query.q;
  const category = req.query.category;

  let searchConditions = {};

  if (query) {
    searchConditions.$or = [
      { title: new RegExp(_.escapeRegExp(query), 'i') },
      { description: new RegExp(_.escapeRegExp(query), 'i') },
      { tags: { $in: [query] } }
    ];
  }

  if (category) {
    searchConditions.category = category;
  }

  // If no query and no category, maybe return all or an empty set, or handle as an error
  // For now, if both are empty, it will return all videos.
  // If only category is present, it filters by category.
  // If only query is present, it filters by query.
  // If both are present, it filters by both.

  const videos = await VideoMeta.find(searchConditions);

  res.render('search-results', {
    videos,
    query,
    category,
    user: req.user // Pass the user object to the template
  });
});

module.exports = router;
