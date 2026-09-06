const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const PublicKeyBundle = require('../models/PublicKeyBundle');

/**
 * POST /api/keys/upload
 * Upload/replace the authenticated user's public key bundle.
 * Client sends: { identityKey, signedPreKey: { keyId, publicKey, signature }, oneTimePreKeys: [{ keyId, publicKey }] }
 */
router.post('/upload', authenticate, async (req, res) => {
  try {
    const { identityKey, signedPreKey, oneTimePreKeys, encryptedPrivateKeyBackup } = req.body;

    if (!identityKey || !signedPreKey || !oneTimePreKeys) {
      return res.status(400).json({
        error: 'identityKey, signedPreKey, and oneTimePreKeys are required.',
      });
    }

    if (!signedPreKey.keyId || !signedPreKey.publicKey || !signedPreKey.signature) {
      return res.status(400).json({
        error: 'signedPreKey must include keyId, publicKey, and signature.',
      });
    }

    if (!Array.isArray(oneTimePreKeys) || oneTimePreKeys.length === 0) {
      return res.status(400).json({
        error: 'oneTimePreKeys must be a non-empty array.',
      });
    }

    // Build the update payload
    const updatePayload = {
      userId: req.user.userId,
      identityKey,
      signedPreKey,
      oneTimePreKeys: oneTimePreKeys.map((k) => ({
        keyId: k.keyId,
        publicKey: k.publicKey,
        used: false,
      })),
      updatedAt: new Date(),
    };

    // Store the encrypted private key backup if provided.
    // Validation: all three fields must be present together.
    if (encryptedPrivateKeyBackup) {
      const { ciphertext, iv, salt } = encryptedPrivateKeyBackup;
      if (!ciphertext || !iv || !salt) {
        return res.status(400).json({
          error: 'encryptedPrivateKeyBackup must include ciphertext, iv, and salt.',
        });
      }
      updatePayload.encryptedPrivateKeyBackup = { ciphertext, iv, salt };
    }

    // Upsert — create or replace the bundle for this user
    const bundle = await PublicKeyBundle.findOneAndUpdate(
      { userId: req.user.userId },
      updatePayload,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      message: 'Key bundle uploaded successfully.',
      availableOneTimeKeys: bundle.oneTimePreKeys.filter((k) => !k.used).length,
    });
  } catch (error) {
    console.error('Key upload error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * GET /api/keys/backup
 * Returns the encrypted private key backup for the authenticated user.
 * Used when logging in from a new device — client decrypts locally with password.
 */
router.get('/backup', authenticate, async (req, res) => {
  try {
    const bundle = await PublicKeyBundle.findOne(
      { userId: req.user.userId },
      { encryptedPrivateKeyBackup: 1 } // projection — return only the backup field
    );

    if (!bundle) {
      return res.status(404).json({ error: 'No key bundle found for this user.' });
    }

    const backup = bundle.encryptedPrivateKeyBackup;
    if (!backup || !backup.ciphertext) {
      // No backup stored yet (user registered before this feature was added)
      return res.status(404).json({ error: 'No encrypted key backup found.' });
    }

    res.json({ encryptedPrivateKeyBackup: backup });
  } catch (error) {
    console.error('Key backup fetch error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * GET /api/keys/:userId
 * Fetch a recipient's public key bundle.
 * Atomically consumes one unused one-time pre-key (marks it as used).
 * This prevents two senders from grabbing the same OTP key — a critical
 * detail for interview discussion.
 */
router.get('/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    // Atomically find one unused one-time pre-key and mark it as used
    const bundle = await PublicKeyBundle.findOneAndUpdate(
      {
        userId,
        'oneTimePreKeys.used': false,
      },
      {
        $set: { 'oneTimePreKeys.$.used': true },
      },
      {
        new: false, // Return the document BEFORE update so we get the key value
      }
    );

    if (!bundle) {
      // Try fetching without a one-time pre-key (they may be exhausted)
      const bundleWithoutOTP = await PublicKeyBundle.findOne({ userId });
      if (!bundleWithoutOTP) {
        return res.status(404).json({ error: 'Key bundle not found for this user.' });
      }

      // Return bundle without one-time pre-key (X3DH still works, just less secure)
      return res.json({
        identityKey: bundleWithoutOTP.identityKey,
        signedPreKey: bundleWithoutOTP.signedPreKey,
        oneTimePreKey: null, // Exhausted
      });
    }

    // Find the one-time pre-key that was consumed (the first unused one)
    const consumedOTP = bundle.oneTimePreKeys.find((k) => !k.used);

    res.json({
      identityKey: bundle.identityKey,
      signedPreKey: bundle.signedPreKey,
      oneTimePreKey: consumedOTP
        ? { keyId: consumedOTP.keyId, publicKey: consumedOTP.publicKey }
        : null,
    });
  } catch (error) {
    console.error('Key fetch error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
