const mongoose = require('mongoose');

// Subscription of a user (subscriber) to a channel (the author's account).
const subscriptionSchema = new mongoose.Schema({
  subscriber: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  channel: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'subscriptions' });

subscriptionSchema.index({ subscriber: 1, channel: 1 }, { unique: true });
subscriptionSchema.index({ channel: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
