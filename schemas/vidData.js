
const mongoose = require('mongoose');

const VidDataSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  videoMetaId: { type: mongoose.Schema.Types.ObjectId, ref: 'VideoMeta', required: true },
}, { timestamps: true, collection: 'vidData' });

module.exports = mongoose.model('VidData', VidDataSchema);
