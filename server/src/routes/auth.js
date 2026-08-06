const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');
const crypto = require('crypto');
const User = require('../models/User');
const Session = require('../models/Session');

/**
 * Generate JWT access token (short-lived, stateless)
 */
function generateAccessToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '15m' }
  );
}

/**
 * Generate opaque refresh token + create Session in DB
 */
async function createSession(user, userAgent) {
  const refreshToken = crypto.randomBytes(64).toString('hex');
  const refreshTokenHash = crypto
    .createHash('sha256')
    .update(refreshToken)
    .digest('hex');

  const expiresAt = new Date();
  const days = parseInt(process.env.REFRESH_EXPIRY_DAYS) || 7;
  expiresAt.setDate(expiresAt.getDate() + days);

  await Session.create({
    userId: user._id,
    refreshTokenHash,
    userAgent: userAgent || 'unknown',
    expiresAt,
  });

  return refreshToken;
}

/**
 * POST /api/auth/register
 * Create account, return access JWT + refresh token
 */
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    // Check if username already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ error: 'Username already taken.' });
    }

    // Hash password with Argon2id (OWASP recommended)
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MB
      timeCost: 3,
      parallelism: 4,
    });

    const user = await User.create({ username, passwordHash });

    const accessToken = generateAccessToken(user);
    const refreshToken = await createSession(user, req.headers['user-agent']);

    res.status(201).json({
      message: 'Registration successful.',
      user: user.toJSON(),
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * POST /api/auth/login
 * Authenticate, return access JWT + refresh token
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // Update last seen
    user.lastSeenAt = new Date();
    await user.save();

    const accessToken = generateAccessToken(user);
    const refreshToken = await createSession(user, req.headers['user-agent']);

    res.json({
      message: 'Login successful.',
      user: user.toJSON(),
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * POST /api/auth/refresh
 * Rotate access JWT against a valid Session
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required.' });
    }

    const refreshTokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    const session = await Session.findOne({
      refreshTokenHash,
      revoked: false,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired refresh token.' });
    }

    const user = await User.findById(session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }

    const accessToken = generateAccessToken(user);

    res.json({
      accessToken,
      user: user.toJSON(),
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * POST /api/auth/logout
 * Revoke the current Session
 */
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required.' });
    }

    const refreshTokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    const session = await Session.findOneAndUpdate(
      { refreshTokenHash },
      { revoked: true }
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    res.json({ message: 'Logged out successfully.' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
