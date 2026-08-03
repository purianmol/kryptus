const mongoose = require('mongoose');
const { Schema } = mongoose;

const MessageSchema = new Schema({
  messageId: {
    type: String,
    required: true,
    unique: true,
  },
  senderId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  recipientId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  ciphertext: {
    type: String,
    required: true,
  },
  iv: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['QUEUED', 'DELIVERED'],
    default: 'QUEUED',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Compound index for efficient queued-message queries per recipient
MessageSchema.index({ recipientId: 1, status: 1 });

// Optional: TTL purge delivered messages after 30 days (metadata minimization)
MessageSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: 30 * 24 * 60 * 60, // 30 days
    partialFilterExpression: { status: 'DELIVERED' },
  }
);

module.exports = mongoose.model('Message', MessageSchema);
