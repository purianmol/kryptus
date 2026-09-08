/**
 * Formats a timestamp into a relative human-readable string.
 * e.g. "just now", "5m ago", "Yesterday", "Mon"
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Truncates a string to maxLen characters, appending "…" if needed.
 */
function truncate(str, maxLen = 36) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

export default function ContactList({
  contacts,
  activeContact,
  onlineUsers,
  unreadCounts,
  onSelect,
  conversations,
  currentUserId,
}) {
  if (!contacts || contacts.length === 0) {
    return (
      <div className="no-contacts">
        <p>No friends yet.</p>
        <p style={{ fontSize: '0.8rem', marginTop: '8px' }}>
          Tap ➕ above to search for users and send friend requests!
        </p>
      </div>
    );
  }

  // Build a lookup: contactId → last message in conversation
  const lastMessageMap = {};
  if (conversations) {
    for (const [peerId, msgs] of Object.entries(conversations)) {
      if (msgs && msgs.length > 0) {
        lastMessageMap[peerId] = msgs[msgs.length - 1];
      }
    }
  }

  // Sort: contacts with messages first (newest first), then no-message contacts alphabetically
  const sortedContacts = [...contacts].sort((a, b) => {
    const aMsg = lastMessageMap[a._id];
    const bMsg = lastMessageMap[b._id];

    if (aMsg && bMsg) {
      return new Date(bMsg.timestamp) - new Date(aMsg.timestamp);
    }
    if (aMsg) return -1;
    if (bMsg) return 1;
    return a.username.localeCompare(b.username);
  });

  return (
    <div className="contact-list">
      {sortedContacts.map((contact) => {
        const isOnline = onlineUsers.includes(contact._id);
        const isActive = activeContact?._id === contact._id;
        const unread = unreadCounts[contact._id] || 0;
        const lastMsg = lastMessageMap[contact._id];

        // Build last message preview text
        let previewText = isOnline ? 'Online' : 'Offline';
        if (lastMsg) {
          const isMine = lastMsg.senderId === currentUserId;
          const prefix = isMine ? 'You: ' : '';
          previewText = prefix + truncate(lastMsg.text);
        }

        return (
          <div
            key={contact._id}
            className={`contact-item ${isActive ? 'active' : ''}`}
            onClick={() => onSelect(contact)}
          >
            <div className="contact-avatar">
              {contact.username[0].toUpperCase()}
              <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
            </div>

            <div className="contact-info">
              <div className="contact-name-row">
                <span className="contact-name">{contact.username}</span>
                {lastMsg && (
                  <span className="contact-time">
                    {formatRelativeTime(lastMsg.timestamp)}
                  </span>
                )}
              </div>
              <div className={`contact-preview ${unread > 0 ? 'unread' : ''}`}>
                {previewText}
              </div>
            </div>

            {unread > 0 && (
              <div className="contact-badge">{unread}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
