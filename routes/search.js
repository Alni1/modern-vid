const express = require('express');
const VideoMeta = require('../schemas/VideoMeta');
const _ = require('lodash');
const optionalVerifyToken = require('../middlewares/optionalVerifyToken'); 
const router = express.Router();


router.get('/', optionalVerifyToken, async (req, res) => { 
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


  const videos = await VideoMeta.find(searchConditions);

  res.render('search-results', {
    videos,
    query,
    category,
    user: req.user 
  });
});

module.exports = router;
