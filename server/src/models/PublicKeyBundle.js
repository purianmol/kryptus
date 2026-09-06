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
  // Client-side AES-GCM encrypted private key backup.
  // The server stores ciphertext only — plaintext private keys are NEVER sent.
  // The encryption key is derived from the user's password via PBKDF2 on the client.
  encryptedPrivateKeyBackup: {
    ciphertext: { type: String, default: null }, // base64 AES-GCM ciphertext
    iv: { type: String, default: null },         // base64 AES-GCM nonce (12 bytes)
    salt: { type: String, default: null },        // base64 PBKDF2 salt (16 bytes)
  },
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
