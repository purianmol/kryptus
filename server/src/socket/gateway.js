const jwt = require('jsonwebtoken');
const Message = require('../models/Message');
const User = require('../models/User');

/**
 * Socket.io Gateway
 *
 * Responsibilities:
 * - JWT authentication on handshake
 * - userId <-> socketId connection registry
 * - Real-time message routing (online relay or offline persist)
 * - Flush queued messages on reconnect
 * - Broadcast online/offline user status
 */

// In-memory connection registry: Map<userId, socketId>
const connectionRegistry = new Map();

/**
 * Get array of currently online user IDs
 */
function getOnlineUsers() {
  return Array.from(connectionRegistry.keys());
}

/**
 * Initialize Socket.io gateway on the given io instance
 */
function initializeGateway(io) {
  // ── Authentication middleware ──
  // Verify JWT before allowing WebSocket connection
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error('Authentication required.'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.username = decoded.username;
      next();
    } catch (error) {
      return next(new Error('Invalid or expired token.'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId, username } = socket;
    console.log(`🟢 Connected: ${username} (${userId})`);

    // ── Register connection ──
    connectionRegistry.set(userId, socket.id);

    // Update last seen
    await User.findByIdAndUpdate(userId, { lastSeenAt: new Date() }).catch(() => {});

    // Broadcast updated online users to all clients
    io.emit('users_online', getOnlineUsers());

    // ── Flush queued messages on connect ──
    try {
      const queuedMessages = await Message.find({
        recipientId: userId,
        status: 'QUEUED',
      }).sort({ createdAt: 1 }).lean();

      if (queuedMessages.length > 0) {
        for (const msg of queuedMessages) {
          socket.emit('receive_message', {
            senderId: msg.senderId.toString(),
            messageId: msg.messageId,
            ciphertext: msg.ciphertext,
            iv: msg.iv,
            createdAt: msg.createdAt,
          });
        }
        console.log(`📨 Flushed ${queuedMessages.length} queued messages to ${username}`);
      }
    } catch (error) {
      console.error('Flush error:', error);
    }

    // ── send_message handler ──
    socket.on('send_message', async (data) => {
      try {
        const { recipientId, messageId, ciphertext, iv } = data;

        if (!recipientId || !messageId || !ciphertext || !iv) {
          return socket.emit('error_message', {
            error: 'Missing required fields: recipientId, messageId, ciphertext, iv',
          });
        }

        // Check for duplicate messageId (replay protection)
        const existing = await Message.findOne({ messageId });
        if (existing) {
          return socket.emit('error_message', {
            error: 'Duplicate messageId. Message already processed.',
            messageId,
          });
        }

        const recipientSocketId = connectionRegistry.get(recipientId);

        if (recipientSocketId) {
          // ── Recipient ONLINE → relay in real-time ──
          io.to(recipientSocketId).emit('receive_message', {
            senderId: userId,
            messageId,
            ciphertext,
            iv,
            createdAt: new Date(),
          });

          // Also persist to DB (for history and reliability)
          await Message.create({
            messageId,
            senderId: userId,
            recipientId,
            ciphertext,
            iv,
            status: 'QUEUED', // Will be marked DELIVERED when recipient ACKs
          });

          console.log(`💬 ${username} → ${recipientId} (online relay)`);
        } else {
          // ── Recipient OFFLINE → store for later ──
          await Message.create({
            messageId,
            senderId: userId,
            recipientId,
            ciphertext,
            iv,
            status: 'QUEUED',
          });

          console.log(`📦 ${username} → ${recipientId} (queued for offline)`);
        }

        // Confirm to sender that message was accepted
        socket.emit('msg_sent', { messageId });
      } catch (error) {
        console.error('send_message error:', error);
        socket.emit('error_message', { error: 'Failed to send message.' });
      }
    });

    // ── msg_ack handler ──
    // Recipient confirms they received and decrypted a message
    socket.on('msg_ack', async (data) => {
      try {
        const { messageId } = data;

        if (!messageId) return;

        const message = await Message.findOneAndUpdate(
          { messageId, recipientId: userId, status: 'QUEUED' },
          { status: 'DELIVERED' },
          { new: true }
        );

        if (message) {
          // Notify sender that the message was delivered
          const senderSocketId = connectionRegistry.get(message.senderId.toString());
          if (senderSocketId) {
            io.to(senderSocketId).emit('msg_delivered', { messageId });
          }
        }
      } catch (error) {
        console.error('msg_ack error:', error);
      }
    });

    // ── typing indicators ──
    socket.on('typing_start', (data) => {
      const { recipientId } = data;
      const recipientSocketId = connectionRegistry.get(recipientId);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('typing_start', { userId });
      }
    });

    socket.on('typing_stop', (data) => {
      const { recipientId } = data;
      const recipientSocketId = connectionRegistry.get(recipientId);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('typing_stop', { userId });
      }
    });

    // ── disconnect handler ──
    socket.on('disconnect', async () => {
      console.log(`🔴 Disconnected: ${username} (${userId})`);

      connectionRegistry.delete(userId);

      // Update last seen
      await User.findByIdAndUpdate(userId, { lastSeenAt: new Date() }).catch(() => {});

      // Broadcast updated online users
      io.emit('users_online', getOnlineUsers());
    });
  });
}

module.exports = { initializeGateway, getOnlineUsers };
