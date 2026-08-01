const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserSchema = new Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [30, 'Username must be at most 30 characters'],
    index: true,
  },
  passwordHash: {
    type: String,
    required: [true, 'Password hash is required'],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastSeenAt: {
    type: Date,
  },
  // Friend requests: { userId, status: 'pending' | 'accepted' }
  friends: [
    {
      userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      status: { type: String, enum: ['pending', 'accepted'], default: 'pending' },
      initiator: { type: Boolean, default: false }, // true = I sent the request
    },
  ],
});

// Never return passwordHash in queries by default
UserSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.passwordHash;
  delete user.__v;
  return user;
};

module.exports = mongoose.model('User', UserSchema);
