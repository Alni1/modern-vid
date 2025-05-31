const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  level: { type: String, default: 'INFO' }, // INFO, ERROR and other log levels
  message: String,
  meta: Object // additional metadata, e.g. userId, requestId, etc.
}, {
  collection: 'logDB'
});

const Log = mongoose.model('Log', logSchema);

module.exports = Log;
