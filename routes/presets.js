const express = require('express');
const mongoose = require('mongoose');
const optionalVerifyToken = require('../middlewares/optionalVerifyToken');
const PlayerPreset = require('../schemas/PlayerPreset');
const { sanitizeViewerPreset, sanitizeAuthorTheme } = require('../utils/presetValidation');

const router = express.Router();

/** JSON API: 401 instead of a redirect to the login page. */
function requireUser(req, res, next) {
  optionalVerifyToken(req, res, () => {
    if (!req.user) return res.status(401).json({ error: 'Sign in to save settings' });
    next();
  });
}

/** Loads the default preset of a user for the given scope (null when there is none). */
async function loadPreset(ownerId, scope) {
  const doc = await PlayerPreset.findOne({ owner: ownerId, scope, isDefault: true }).lean();
  return doc ? doc.config : null;
}

async function savePreset(ownerId, scope, config) {
  const doc = await PlayerPreset.findOneAndUpdate(
    { owner: ownerId, scope, isDefault: true },
    { $set: { config } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return doc.config;
}

// ---- viewer settings -------------------------------------------------------

router.get('/me', requireUser, async (req, res) => {
  res.json({ preset: (await loadPreset(req.user._id, 'viewer')) || {} });
});

router.put('/me', requireUser, async (req, res) => {
  try {
    const preset = sanitizeViewerPreset(req.body && req.body.preset);
    res.json({ preset: await savePreset(req.user._id, 'viewer', preset) });
  } catch (err) {
    console.error('Cannot save viewer preset:', err);
    res.status(500).json({ error: 'Cannot save settings' });
  }
});

router.delete('/me', requireUser, async (req, res) => {
  await PlayerPreset.deleteOne({ owner: req.user._id, scope: 'viewer', isDefault: true });
  res.json({ preset: {} });
});

// ---- channel (author) theme ------------------------------------------------

router.get('/channel/:userId', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) return res.status(404).json({ error: 'Channel not found' });
  const config = await loadPreset(req.params.userId, 'author');
  res.json({ theme: (config && config.theme) || null });
});

router.put('/channel', requireUser, async (req, res) => {
  try {
    const theme = sanitizeAuthorTheme(req.body && req.body.theme);
    const config = await savePreset(req.user._id, 'author', Object.keys(theme).length ? { theme } : {});
    res.json({ theme: config.theme || null });
  } catch (err) {
    console.error('Cannot save channel theme:', err);
    res.status(500).json({ error: 'Cannot save the channel theme' });
  }
});

router.delete('/channel', requireUser, async (req, res) => {
  await PlayerPreset.deleteOne({ owner: req.user._id, scope: 'author', isDefault: true });
  res.json({ theme: null });
});

module.exports = router;
module.exports.loadPreset = loadPreset;
