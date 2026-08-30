export default function ContactList({ contacts, activeContact, onlineUsers, unreadCounts, onSelect }) {
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

  // Sort: online first, then alphabetical
  const sortedContacts = [...contacts].sort((a, b) => {
    const aOnline = onlineUsers.includes(a._id);
    const bOnline = onlineUsers.includes(b._id);
    if (aOnline && !bOnline) return -1;
    if (!aOnline && bOnline) return 1;
    return a.username.localeCompare(b.username);
  });

  return (
    <div className="contact-list">
      {sortedContacts.map((contact) => {
        const isOnline = onlineUsers.includes(contact._id);
        const isActive = activeContact?._id === contact._id;
        const unread = unreadCounts[contact._id] || 0;

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
              <div className="contact-name">{contact.username}</div>
              <div className="contact-status-text">
                {isOnline ? '🟢 Online' : 'Offline'}
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
