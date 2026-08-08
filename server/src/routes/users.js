const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const User = require('../models/User');

/**
 * GET /api/users/search?q=<username>
 * Search for users by username prefix (for sending friend requests).
 */
router.get('/search', authenticate, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 1) {
      return res.json({ users: [] });
    }

    // Escape special regex chars to prevent injection / crashes
    const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const users = await User.find(
      {
        _id: { $ne: req.user.userId },
        username: { $regex: escaped, $options: 'i' },
      },
      'username createdAt'
    )
      .limit(10)
      .sort({ username: 1 });

    res.json({ users });
  } catch (error) {
    console.error('User search error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * GET /api/users/friends
 * Returns the current user's accepted friends (contacts).
 */
router.get('/friends', authenticate, async (req, res) => {
  try {
    const me = await User.findById(req.user.userId).populate(
      'friends.userId',
      'username lastSeenAt createdAt'
    );

    if (!me) return res.status(404).json({ error: 'User not found.' });

    const friends = me.friends
      .filter((f) => f.status === 'accepted' && f.userId)
      .map((f) => {
        const u = f.userId;
        return typeof u.toObject === 'function' ? u.toObject() : u;
      });

    res.json({ users: friends });
  } catch (error) {
    console.error('Friends list error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * GET /api/users/requests
 * Returns incoming pending friend requests.
 */
router.get('/requests', authenticate, async (req, res) => {
  try {
    const me = await User.findById(req.user.userId).populate(
      'friends.userId',
      'username createdAt'
    );

    if (!me) return res.status(404).json({ error: 'User not found.' });

    // Incoming requests: status=pending AND initiator=false (they sent to me)
    const incoming = me.friends
      .filter((f) => f.status === 'pending' && !f.initiator)
      .map((f) => ({
        _id: f.userId._id || f.userId,
        username: f.userId.username,
        createdAt: f.userId.createdAt,
        friendEntryId: f._id,
      }));

    res.json({ requests: incoming });
  } catch (error) {
    console.error('Requests list error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * POST /api/users/request/:targetUserId
 * Send a friend request to another user.
 */
router.post('/request/:targetUserId', authenticate, async (req, res) => {
  try {
    const senderId = req.user.userId;
    const { targetUserId } = req.params;

    if (senderId === targetUserId) {
      return res.status(400).json({ error: 'Cannot send friend request to yourself.' });
    }

    const [sender, target] = await Promise.all([
      User.findById(senderId),
      User.findById(targetUserId),
    ]);

    if (!target) return res.status(404).json({ error: 'User not found.' });

    // Check if already friends or request already sent
    const alreadyExists = sender.friends.some(
      (f) => f.userId.toString() === targetUserId
    );
    if (alreadyExists) {
      return res.status(409).json({ error: 'Friend request already sent or already friends.' });
    }

    // Add to sender's friends list as initiator+pending
    sender.friends.push({ userId: targetUserId, status: 'pending', initiator: true });
    await sender.save();

    // Add to target's friends list as non-initiator+pending
    target.friends.push({ userId: senderId, status: 'pending', initiator: false });
    await target.save();

    res.json({ message: 'Friend request sent.' });
  } catch (error) {
    console.error('Send request error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * POST /api/users/accept/:requesterId
 * Accept a pending friend request from requesterId.
 */
router.post('/accept/:requesterId', authenticate, async (req, res) => {
  try {
    const myId = req.user.userId;
    const { requesterId } = req.params;

    const [me, requester] = await Promise.all([
      User.findById(myId),
      User.findById(requesterId),
    ]);

    if (!requester) return res.status(404).json({ error: 'User not found.' });

    // Update status on both sides
    const myEntry = me.friends.find((f) => f.userId.toString() === requesterId);
    const theirEntry = requester.friends.find((f) => f.userId.toString() === myId);

    if (!myEntry || myEntry.status !== 'pending') {
      return res.status(404).json({ error: 'Friend request not found.' });
    }

    myEntry.status = 'accepted';
    if (theirEntry) theirEntry.status = 'accepted';

    await Promise.all([me.save(), requester.save()]);

    res.json({ message: 'Friend request accepted.' });
  } catch (error) {
    console.error('Accept request error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * DELETE /api/users/request/:targetUserId
 * Reject or cancel a friend request.
 */
router.delete('/request/:targetUserId', authenticate, async (req, res) => {
  try {
    const myId = req.user.userId;
    const { targetUserId } = req.params;

    const [me, other] = await Promise.all([
      User.findById(myId),
      User.findById(targetUserId),
    ]);

    if (me) {
      me.friends = me.friends.filter((f) => f.userId.toString() !== targetUserId);
      await me.save();
    }
    if (other) {
      other.friends = other.friends.filter((f) => f.userId.toString() !== myId);
      await other.save();
    }

    res.json({ message: 'Request removed.' });
  } catch (error) {
    console.error('Remove request error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
