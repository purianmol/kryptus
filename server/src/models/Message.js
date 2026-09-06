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

// Compound index for efficient history queries between two users
MessageSchema.index({ senderId: 1, recipientId: 1, createdAt: 1 });

// Explicit Retention Policy: 
// E2EE protects message contents, but the server retains the encrypted ciphertext (metadata)
// for 365 days to allow cross-device sync. After 1 year, messages are automatically deleted.
MessageSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 365 * 24 * 60 * 60 } // 365 days
);

module.exports = mongoose.model('Message', MessageSchema);
