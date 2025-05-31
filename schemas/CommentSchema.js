const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const commentSchema = new Schema({
  video: { type: Schema.Types.ObjectId, ref: 'VideoMeta', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, trim: true, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now }
}, {
  timestamps: true, // Automatically adds createdAt and updatedAt
  collection: 'comDB' // Specify collection name
});

module.exports = mongoose.model('Comment', commentSchema);