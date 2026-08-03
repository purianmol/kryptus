const mongoose = require('mongoose');
const { Schema } = mongoose;

const PublicKeyBundleSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },
  identityKey: {
    type: String,
    required: [true, 'Identity key is required'],
  },
  signedPreKey: {
    keyId: { type: Number, required: true },
    publicKey: { type: String, required: true },
    signature: { type: String, required: true },
  },
  oneTimePreKeys: [{
    keyId: { type: Number, required: true },
    publicKey: { type: String, required: true },
    used: { type: Boolean, default: false },
  }],
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the updatedAt timestamp on every save
PublicKeyBundleSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('PublicKeyBundle', PublicKeyBundleSchema);
