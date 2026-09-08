import { useState, useRef, useCallback, useEffect } from 'react';

// Curated emoji set grouped by category
const EMOJI_GROUPS = [
  { label: 'Smileys', emojis: ['😀','😂','😍','🥺','😎','🤔','😅','🥹','😭','😤','🤯','😇','🤗','🫡','😴','🤩','😬','🙃','😏','😒'] },
  { label: 'Gestures', emojis: ['👍','👎','👋','🤝','🙏','👏','🤜','✌️','🤞','💪','🫶','❤️','🔥','⭐','💯','✅','❌','🎉','🎊','💡'] },
  { label: 'Objects', emojis: ['📱','💻','🔐','🛡️','📨','📦','🗑️','🔑','🔒','💬','📞','🎵','🎮','☕','🍕','🚀','🌍','💰','📊','🧠'] },
];

export default function MessageInput({ onSend, onTyping, disabled, reconnecting }) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiTab, setEmojiTab] = useState(0);
  const typingTimeoutRef = useRef(null);
  const textareaRef = useRef(null);
  const emojiPickerRef = useRef(null);

  // Close emoji picker on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) {
        setShowEmoji(false);
      }
    };
    if (showEmoji) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmoji]);

  const insertEmoji = useCallback((emoji) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setText((prev) => prev + emoji);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = text.slice(0, start) + emoji + text.slice(end);
    setText(newText);
    // Restore cursor position after emoji
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  }, [text]);

  const handleChange = (e) => {
    setText(e.target.value);

    // Auto-resize textarea
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }

    // Emit typing indicator
    if (onTyping) {
      onTyping(true);
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        onTyping(false);
      }, 2000);
    }
  };

  const handleSend = useCallback(() => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
    setShowEmoji(false);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Stop typing indicator
    if (onTyping) {
      clearTimeout(typingTimeoutRef.current);
      onTyping(false);
    }
  }, [text, disabled, onSend, onTyping]);

  const handleKeyDown = (e) => {
    // Enter sends, Shift+Enter adds newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const placeholderText = reconnecting
    ? 'Reconnecting…'
    : disabled
    ? 'Connecting…'
    : 'Type an encrypted message…';

  return (
    <div className="message-input-container">
      {/* Emoji Picker */}
      {showEmoji && (
        <div className="emoji-picker" ref={emojiPickerRef}>
          <div className="emoji-tabs">
            {EMOJI_GROUPS.map((g, i) => (
              <button
                key={g.label}
                className={`emoji-tab ${emojiTab === i ? 'active' : ''}`}
                onClick={() => setEmojiTab(i)}
              >
                {g.label}
              </button>
            ))}
          </div>
          <div className="emoji-grid">
            {EMOJI_GROUPS[emojiTab].emojis.map((emoji) => (
              <button
                key={emoji}
                className="emoji-btn"
                onClick={() => insertEmoji(emoji)}
                title={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="message-input-wrapper">
        <button
          className="emoji-toggle-btn"
          onClick={() => setShowEmoji((v) => !v)}
          title="Pick emoji"
          type="button"
          disabled={disabled}
        >
          😊
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholderText}
          disabled={disabled}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          title="Send message"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
