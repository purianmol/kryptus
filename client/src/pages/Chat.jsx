import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useCrypto } from '../context/CryptoContext';
import { useSocket } from '../context/SocketContext';
import api from '../services/api';
import ContactList from '../components/ContactList';
import MessageList from '../components/MessageList';
import MessageInput from '../components/MessageInput';
import SafetyNumber from '../components/SafetyNumber';
import AddFriendPanel from '../components/AddFriendPanel';
import KeyRestoreModal from '../components/KeyRestoreModal';

// Simple UUID generator
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function Chat() {
  const { user, logout } = useAuth();
  const {
    encrypt, decrypt, establishSession,
    restoreState, restoreError,
    restoreKeysWithPassword, generateNewKeysWithPassword,
    uploadBackupWithPassword, reuploadKeysWithPassword,
  } = useCrypto();
  const { connected, reconnecting, onlineUsers, sendMessage, ackMessage, onMessage, onDelivery, onTyping, emitTyping } = useSocket();

  const [contacts, setContacts] = useState([]);
  const [activeContact, setActiveContact] = useState(null);
  const [conversations, setConversations] = useState({}); // { peerId: [messages] }
  const [unreadCounts, setUnreadCounts] = useState({});
  const [peerTyping, setPeerTyping] = useState({});
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showContactMenu, setShowContactMenu] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [removingFriend, setRemovingFriend] = useState(false);

  // Track whether pending messages were already fetched this session
  const pendingFetchedRef = useRef(false);
  const contactMenuRef = useRef(null);

  // Load friends (contacts)
  const loadContacts = useCallback(async () => {
    try {
      const data = await api.getFriends();
      setContacts(data.users || []);
    } catch (err) {
      console.error('Failed to load friends:', err);
    }
  }, []);

  useEffect(() => {
    loadContacts();
    const interval = setInterval(loadContacts, 30000);
    return () => clearInterval(interval);
  }, [loadContacts]);

  // Load conversations from localStorage
  useEffect(() => {
    if (user) {
      const saved = localStorage.getItem(`conversations_${user._id}`);
      if (saved) {
        try {
          setConversations(JSON.parse(saved));
        } catch { /* ignore */ }
      }
    }
  }, [user]);

  // Save conversations to localStorage when they change
  useEffect(() => {
    if (user && Object.keys(conversations).length > 0) {
      localStorage.setItem(`conversations_${user._id}`, JSON.stringify(conversations));
    }
  }, [conversations, user]);

  // Close contact menu on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (contactMenuRef.current && !contactMenuRef.current.contains(e.target)) {
        setShowContactMenu(false);
      }
    };
    if (showContactMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showContactMenu]);

  // Listen for incoming messages
  useEffect(() => {
    const unsubscribe = onMessage(async (data) => {
      const { senderId, messageId, ciphertext, iv, createdAt } = data;

      // Establish session if needed (for decryption)
      await establishSession(senderId);

      // Decrypt the message
      const plaintext = await decrypt(senderId, ciphertext, iv);

      const message = {
        id: messageId,
        senderId,
        text: plaintext || '🔒 Unable to decrypt',
        timestamp: createdAt || new Date().toISOString(),
        status: 'received',
        failed: !plaintext,
      };

      setConversations((prev) => ({
        ...prev,
        [senderId]: [...(prev[senderId] || []), message],
      }));

      // Update unread count if not in active conversation
      setUnreadCounts((prev) => {
        if (activeContact?._id !== senderId) {
          return { ...prev, [senderId]: (prev[senderId] || 0) + 1 };
        }
        return prev;
      });

      // Acknowledge the message
      ackMessage(messageId);
    });

    return unsubscribe;
  }, [onMessage, decrypt, ackMessage, establishSession, activeContact]);

  // Listen for delivery confirmations
  useEffect(() => {
    const unsubscribe = onDelivery((data) => {
      const { messageId } = data;

      setConversations((prev) => {
        const updated = { ...prev };
        for (const peerId of Object.keys(updated)) {
          updated[peerId] = updated[peerId].map((msg) =>
            msg.id === messageId ? { ...msg, status: 'delivered' } : msg
          );
        }
        return updated;
      });
    });

    return unsubscribe;
  }, [onDelivery]);

  // Listen for typing indicators
  useEffect(() => {
    const unsubscribe = onTyping((data) => {
      const { userId, typing } = data;
      setPeerTyping((prev) => ({ ...prev, [userId]: typing }));

      // Auto-clear typing after 3 seconds
      if (typing) {
        setTimeout(() => {
          setPeerTyping((prev) => ({ ...prev, [userId]: false }));
        }, 3000);
      }
    });

    return unsubscribe;
  }, [onTyping]);

  // Fetch pending messages on first connection (only once per session)
  useEffect(() => {
    if (!connected || pendingFetchedRef.current) return;
    pendingFetchedRef.current = true;

    const fetchPending = async () => {
      try {
        const data = await api.getPendingMessages();
        if (data.messages && data.messages.length > 0) {
          for (const msg of data.messages) {
            await establishSession(msg.senderId);
            const plaintext = await decrypt(msg.senderId, msg.ciphertext, msg.iv);

            setConversations((prev) => ({
              ...prev,
              [msg.senderId]: [
                ...(prev[msg.senderId] || []),
                {
                  id: msg.messageId,
                  senderId: msg.senderId,
                  text: plaintext || '🔒 Unable to decrypt',
                  timestamp: msg.createdAt,
                  status: 'received',
                  failed: !plaintext,
                },
              ],
            }));

            ackMessage(msg.messageId);
          }
        }
      } catch (err) {
        console.error('Failed to fetch pending messages:', err);
      }
    };

    fetchPending();
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Select contact
  const handleSelectContact = useCallback(
    async (contact) => {
      setActiveContact(contact);
      setChatOpen(true);
      setShowContactMenu(false);
      setUnreadCounts((prev) => ({ ...prev, [contact._id]: 0 }));

      // Pre-establish session
      await establishSession(contact._id);

      // Fetch history and merge
      try {
        const data = await api.getConversationHistory(contact._id);
        if (data.messages && data.messages.length > 0) {
          const decryptedMessages = [];

          for (const msg of data.messages) {
            const plaintext = await decrypt(contact._id, msg.ciphertext, msg.iv);

            decryptedMessages.push({
              id: msg.messageId,
              senderId: msg.senderId,
              text: plaintext || '🔒 Unable to decrypt',
              timestamp: msg.createdAt,
              status: msg.senderId === user._id ? 'delivered' : 'received',
              decryptionFailed: !plaintext,
            });
          }

          setConversations((prev) => {
            const existing = prev[contact._id] || [];
            // Merge existing and new, deduplicating by id
            const mergedMap = new Map();
            for (const msg of existing) mergedMap.set(msg.id, msg);
            for (const msg of decryptedMessages) mergedMap.set(msg.id, msg);

            const mergedList = Array.from(mergedMap.values()).sort(
              (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
            );

            return { ...prev, [contact._id]: mergedList };
          });
        }
      } catch (err) {
        console.error('Failed to fetch conversation history:', err);
      }
    },
    [establishSession, decrypt, user._id]
  );

  // Send message
  const handleSendMessage = useCallback(
    async (text) => {
      if (!activeContact || !text.trim()) return;

      const messageId = generateId();

      try {
        const { ciphertext, iv } = await encrypt(activeContact._id, text.trim());
        sendMessage(activeContact._id, messageId, ciphertext, iv);

        const message = {
          id: messageId,
          senderId: user._id,
          text: text.trim(),
          timestamp: new Date().toISOString(),
          status: 'sent',
        };

        setConversations((prev) => ({
          ...prev,
          [activeContact._id]: [...(prev[activeContact._id] || []), message],
        }));
      } catch (err) {
        console.error('Failed to send message:', err);
        setConversations((prev) => ({
          ...prev,
          [activeContact._id]: [
            ...(prev[activeContact._id] || []),
            {
              id: messageId,
              senderId: user._id,
              text: text.trim(),
              timestamp: new Date().toISOString(),
              status: 'failed',
              failed: true,
            },
          ],
        }));
      }
    },
    [activeContact, encrypt, sendMessage, user]
  );

  // Handle typing
  const handleTyping = useCallback(
    (isTyping) => {
      if (activeContact) {
        emitTyping(activeContact._id, isTyping);
      }
    },
    [activeContact, emitTyping]
  );

  // Remove friend
  const handleRemoveFriend = useCallback(async () => {
    if (!activeContact) return;
    const confirmed = window.confirm(
      `Remove ${activeContact.username} as a friend? This will also clear your local chat history with them.`
    );
    if (!confirmed) return;

    setRemovingFriend(true);
    setShowContactMenu(false);
    try {
      await api.removeFriend(activeContact._id);

      // Clear local conversation for this peer
      setConversations((prev) => {
        const updated = { ...prev };
        delete updated[activeContact._id];
        if (user) {
          const saved = JSON.parse(localStorage.getItem(`conversations_${user._id}`) || '{}');
          delete saved[activeContact._id];
          localStorage.setItem(`conversations_${user._id}`, JSON.stringify(saved));
        }
        return updated;
      });

      setActiveContact(null);
      setChatOpen(false);
      await loadContacts();
    } catch (err) {
      console.error('Failed to remove friend:', err);
    } finally {
      setRemovingFriend(false);
    }
  }, [activeContact, loadContacts, user]);

  // Delete chat (local only — clears messages for this peer from state + localStorage)
  const handleDeleteChat = useCallback(() => {
    if (!activeContact) return;
    const confirmed = window.confirm(
      `Delete your local chat history with ${activeContact.username}? Messages can be restored from server history.`
    );
    if (!confirmed) return;

    setShowContactMenu(false);
    setConversations((prev) => {
      const updated = { ...prev };
      delete updated[activeContact._id];
      if (user) {
        const saved = JSON.parse(localStorage.getItem(`conversations_${user._id}`) || '{}');
        delete saved[activeContact._id];
        localStorage.setItem(`conversations_${user._id}`, JSON.stringify(saved));
      }
      return updated;
    });
  }, [activeContact, user]);

  // Logout
  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  const currentMessages = activeContact ? conversations[activeContact._id] || [] : [];
  const isTyping = activeContact && peerTyping[activeContact._id];

  // While keys are being checked or restored, show a loading spinner
  const keysLoading = restoreState === 'checking' || restoreState === 'restoring';

  if (keysLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', flexDirection: 'column', gap: '1rem',
        color: 'var(--text-secondary)',
      }}>
        <div style={{ fontSize: '2rem' }}>🔐</div>
        <p>{restoreState === 'checking' ? 'Checking for key backup…' : 'Restoring encryption keys…'}</p>
      </div>
    );
  }

  if (isLoggingOut) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', flexDirection: 'column', gap: '1rem',
        color: 'var(--text-secondary)',
      }}>
        <div style={{ fontSize: '2rem' }}>🔐</div>
        <p>Signing out securely…</p>
      </div>
    );
  }

  return (
    <div className={`chat-app ${chatOpen ? 'chat-open' : ''}`}>
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-header-top">
            <h2>🔐 Kryptus</h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="icon-btn"
                onClick={() => setShowAddFriend((v) => !v)}
                title="Add friend"
                style={{ fontSize: '1rem' }}
              >
                {showAddFriend ? '✕' : '➕'}
              </button>
              <button className="logout-btn" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>
          <div className="sidebar-user-info">
            <span
              className={`connection-status ${connected ? 'online' : 'offline'}`}
            />
            <span>{user?.username}</span>
            <span>•</span>
            <span>
              {connected ? 'Connected' : reconnecting ? 'Reconnecting…' : 'Connecting…'}
            </span>
          </div>
        </div>

        {showAddFriend ? (
          <AddFriendPanel onFriendAdded={() => { loadContacts(); setShowAddFriend(false); }} />
        ) : (
          <ContactList
            contacts={contacts}
            activeContact={activeContact}
            onlineUsers={onlineUsers}
            unreadCounts={unreadCounts}
            onSelect={handleSelectContact}
            conversations={conversations}
            currentUserId={user?._id}
          />
        )}
      </div>

      {/* Chat Area */}
      <div className="chat-area">
        {activeContact ? (
          <>
            <div className="chat-header">
              <div
                className="contact-avatar"
                style={{ width: 40, height: 40, fontSize: '1rem' }}
              >
                {activeContact.username[0].toUpperCase()}
                <span
                  className={`status-dot ${
                    onlineUsers.includes(activeContact._id) ? 'online' : 'offline'
                  }`}
                />
              </div>
              <div className="chat-header-info">
                <h3>{activeContact.username}</h3>
                <div className={`header-status ${isTyping ? 'typing' : ''}`}>
                  {isTyping
                    ? 'typing...'
                    : onlineUsers.includes(activeContact._id)
                    ? 'Online'
                    : 'Offline'}
                </div>
              </div>
              <div className="header-actions">
                <button
                  className="icon-btn"
                  onClick={() => setShowSafetyNumber(true)}
                  title="Verify safety number"
                >
                  🛡️
                </button>

                {/* ⋮ Context Menu */}
                <div className="contact-menu-wrapper" ref={contactMenuRef}>
                  <button
                    className="icon-btn"
                    onClick={() => setShowContactMenu((v) => !v)}
                    title="More options"
                  >
                    ⋮
                  </button>
                  {showContactMenu && (
                    <div className="contact-dropdown">
                      <button
                        className="contact-dropdown-item"
                        onClick={handleDeleteChat}
                      >
                        🗑️ Delete Chat
                      </button>
                      <button
                        className="contact-dropdown-item danger"
                        onClick={handleRemoveFriend}
                        disabled={removingFriend}
                      >
                        {removingFriend ? '…' : '❌ Remove Friend'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="encryption-badge">
              <span className="lock-icon">🔐</span>
              Messages are end-to-end encrypted. Only you and {activeContact.username} can read them.
            </div>

            <MessageList
              messages={currentMessages}
              currentUserId={user._id}
              isTyping={isTyping}
            />

            <MessageInput
              onSend={handleSendMessage}
              onTyping={handleTyping}
              disabled={!connected}
              reconnecting={reconnecting}
            />
          </>
        ) : (
          <div className="chat-empty">
            <div className="chat-empty-icon">💬</div>
            <h3>Welcome to Kryptus</h3>
            <p>
              Select a contact to start an end-to-end encrypted conversation.
              Your messages are secured with military-grade encryption.
            </p>
          </div>
        )}
      </div>

      {/* Safety Number Modal */}
      {showSafetyNumber && activeContact && (
        <SafetyNumber
          peerId={activeContact._id}
          peerName={activeContact.username}
          onClose={() => setShowSafetyNumber(false)}
        />
      )}

      {/* Key Restore Modal */}
      {['needs_password', 'no_backup', 'needs_backup_upload', 'needs_reupload', 'keys_mismatch_restore'].includes(restoreState) && (
        <KeyRestoreModal
          mode={restoreState}
          onRestore={restoreKeysWithPassword}
          onGenerateNew={generateNewKeysWithPassword}
          onUploadBackup={uploadBackupWithPassword}
          onReupload={reuploadKeysWithPassword}
          isLoading={restoreState === 'restoring'}
          error={restoreError}
        />
      )}
    </div>
  );
}
