const rateLimit = require('express-rate-limit');

// Strict rate limit for auth endpoints — prevents brute-force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // max 20 requests per window per IP
  message: { error: 'Too many authentication attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit for key upload — prevents pre-key exhaustion attacks
const keyUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many key upload requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter, keyUploadLimiter, apiLimiter };
