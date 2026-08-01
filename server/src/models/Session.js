const mongoose = require('mongoose');
const { Schema } = mongoose;

const SessionSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  refreshTokenHash: {
    type: String,
    required: true,
  },
  deviceId: {
    type: String,
  },
  userAgent: {
    type: String,
  },
  issuedAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  revoked: {
    type: Boolean,
    default: false,
  },
});

// TTL index — MongoDB automatically purges expired session documents
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Session', SessionSchema);
