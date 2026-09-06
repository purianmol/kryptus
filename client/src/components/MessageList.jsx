import { useEffect, useRef } from 'react';

export default function MessageList({ messages, currentUserId, isTyping }) {
  const endRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'sent':
        return <span className="message-status">✓</span>;
      case 'delivered':
        return <span className="message-status delivered">✓✓</span>;
      case 'failed':
        return <span className="message-status" style={{ color: 'var(--accent-red)' }}>✗</span>;
      default:
        return null;
    }
  };

  // Group messages by date
  const groupedMessages = [];
  let lastDate = null;

  messages.forEach((msg) => {
    const msgDate = new Date(msg.timestamp).toLocaleDateString();
    if (msgDate !== lastDate) {
      groupedMessages.push({ type: 'date', date: msgDate });
      lastDate = msgDate;
    }
    groupedMessages.push({ type: 'message', ...msg });
  });

  return (
    <div className="message-list">
      {groupedMessages.length === 0 && (
        <div className="chat-empty" style={{ opacity: 0.5 }}>
          <p>No messages yet. Send the first encrypted message! 🔐</p>
        </div>
      )}

      {groupedMessages.map((item, index) => {
        if (item.type === 'date') {
          return (
            <div key={`date-${index}`} className="message-date-divider">
              <span>{item.date}</span>
            </div>
          );
        }

        const isSent = item.senderId === currentUserId;

        if (item.failed && isSent) {
          return (
            <div key={item.id} className="message-failed">
              ⚠️ Failed to send: {item.text}
            </div>
          );
        }

        return (
          <div
            key={item.id}
            className={`message-bubble ${isSent ? 'sent' : 'received'} ${item.decryptionFailed ? 'decryption-failed' : ''}`}
          >
            <div>{item.text}</div>
            <div className="message-meta">
              <span>{formatTime(item.timestamp)}</span>
              {isSent && getStatusIcon(item.status)}
            </div>
          </div>
        );
      })}

      {isTyping && (
        <div className="typing-indicator">
          <div className="dot" />
          <div className="dot" />
          <div className="dot" />
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
