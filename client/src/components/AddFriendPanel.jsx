import { useState, useEffect } from 'react';
import api from '../services/api';

export default function AddFriendPanel({ onFriendAdded }) {
  const [tab, setTab] = useState('search'); // 'search' | 'requests'
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Search users with debounce
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.searchUsers(query.trim());
        console.log('[AddFriend] Search results for', query, ':', data);
        setResults(data.users || []);
      } catch (err) {
        console.error('[AddFriend] Search error:', err);
        setResults([]);
      }
      setLoading(false);
    }, 300);

    return () => {
      clearTimeout(timer);
      setLoading(false);
    };
  }, [query]);

  // Load incoming requests when switching to that tab (and on mount)
  useEffect(() => {
    loadRequests();
  }, [tab]);

  const loadRequests = async () => {
    try {
      const data = await api.getFriendRequests();
      console.log('[AddFriend] Pending requests:', data);
      setRequests(data.requests || []);
    } catch (err) {
      console.error('[AddFriend] Requests error:', err);
    }
  };

  const sendRequest = async (userId) => {
    setMessage('');
    try {
      const data = await api.sendFriendRequest(userId);
      setMessage(data.message || data.error || 'Done');
      // Remove the user from search results so they can't be re-added
      setResults((prev) => prev.filter((u) => u._id !== userId));
    } catch (err) {
      console.error('[AddFriend] Send request error:', err);
      setMessage('Failed to send request.');
    }
  };

  const acceptRequest = async (requesterId) => {
    try {
      await api.acceptFriendRequest(requesterId);
      setRequests((prev) => prev.filter((r) => r._id !== requesterId));
      // Reload friends list + close the panel
      onFriendAdded?.();
    } catch (err) {
      console.error('[AddFriend] Accept error:', err);
    }
  };

  const rejectRequest = async (requesterId) => {
    try {
      await api.rejectFriendRequest(requesterId);
      setRequests((prev) => prev.filter((r) => r._id !== requesterId));
    } catch (err) {
      console.error('[AddFriend] Reject error:', err);
    }
  };

  return (
    <div className="add-friend-panel">
      <div className="add-friend-tabs">
        <button
          className={`add-friend-tab ${tab === 'search' ? 'active' : ''}`}
          onClick={() => setTab('search')}
        >
          🔍 Search
        </button>
        <button
          className={`add-friend-tab ${tab === 'requests' ? 'active' : ''}`}
          onClick={() => { setTab('requests'); loadRequests(); }}
        >
          📩 Requests{' '}
          {requests.length > 0 && (
            <span className="req-badge">{requests.length}</span>
          )}
        </button>
      </div>

      {tab === 'search' && (
        <div className="add-friend-search">
          <input
            type="text"
            placeholder="Search by username..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="add-friend-input"
            autoFocus
          />
          {message && <div className="add-friend-msg">{message}</div>}
          {loading && <div className="add-friend-loading">Searching...</div>}
          <div className="add-friend-results">
            {results.map((user) => (
              <div key={user._id} className="add-friend-result-item">
                <div
                  className="contact-avatar"
                  style={{ width: 32, height: 32, fontSize: '0.8rem' }}
                >
                  {user.username[0].toUpperCase()}
                </div>
                <span className="add-friend-username">{user.username}</span>
                <button
                  className="btn-send-request"
                  onClick={() => sendRequest(user._id)}
                >
                  Add
                </button>
              </div>
            ))}
            {!loading && query.trim() && results.length === 0 && (
              <div className="add-friend-empty">No users found.</div>
            )}
          </div>
        </div>
      )}

      {tab === 'requests' && (
        <div className="add-friend-requests">
          {requests.length === 0 ? (
            <div className="add-friend-empty">No pending requests.</div>
          ) : (
            requests.map((req) => (
              <div key={req._id} className="request-item">
                <div
                  className="contact-avatar"
                  style={{ width: 32, height: 32, fontSize: '0.8rem' }}
                >
                  {req.username[0].toUpperCase()}
                </div>
                <span className="request-username">{req.username}</span>
                <div className="request-actions">
                  <button
                    className="btn-accept"
                    onClick={() => acceptRequest(req._id)}
                  >
                    ✓
                  </button>
                  <button
                    className="btn-reject"
                    onClick={() => rejectRequest(req._id)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
