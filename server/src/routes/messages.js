const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const Message = require('../models/Message');

/**
 * GET /api/messages/pending
 * Fallback fetch of all queued (undelivered) messages for the authenticated user.
 * Used when Socket.io flush on reconnect was missed.
 */
router.get('/pending', authenticate, async (req, res) => {
  try {
    const messages = await Message.find({
      recipientId: req.user.userId,
      status: 'QUEUED',
    })
      .sort({ createdAt: 1 })
      .lean();

    res.json({ messages });
  } catch (error) {
    console.error('Pending messages error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * POST /api/messages/ack
 * Acknowledge receipt of messages (mark as DELIVERED).
 * Accepts an array of messageIds.
 */
router.post('/ack', authenticate, async (req, res) => {
  try {
    const { messageIds } = req.body;

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'messageIds array is required.' });
    }

    await Message.updateMany(
      {
        messageId: { $in: messageIds },
        recipientId: req.user.userId,
        status: 'QUEUED',
      },
      { $set: { status: 'DELIVERED' } }
    );

    res.json({ message: 'Messages acknowledged.' });
  } catch (error) {
    console.error('Message ack error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
