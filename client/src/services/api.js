const API_BASE = import.meta.env.VITE_API_URL 
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

/**
 * Wrapper around fetch for REST API calls.
 * Automatically attaches JWT, handles JSON, and manages token refresh.
 */
class ApiService {
  constructor() {
    this.accessToken = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
  }

  setTokens(accessToken, refreshToken) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    if (accessToken) localStorage.setItem('accessToken', accessToken);
    else localStorage.removeItem('accessToken');
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
    else localStorage.removeItem('refreshToken');
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }

  async request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    let response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    // If 401 and we have a refresh token, try to refresh
    if (response.status === 401 && this.refreshToken) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        response = await fetch(`${API_BASE}${path}`, {
          ...options,
          headers,
        });
      }
    }

    return response;
  }

  async tryRefresh() {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });

      if (!response.ok) {
        this.clearTokens();
        return false;
      }

      const data = await response.json();
      this.accessToken = data.accessToken;
      localStorage.setItem('accessToken', data.accessToken);
      return true;
    } catch {
      this.clearTokens();
      return false;
    }
  }

  // ── Auth endpoints ──

  async register(username, password) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (res.ok) {
      this.setTokens(data.accessToken, data.refreshToken);
    }
    return { ok: res.ok, data };
  }

  async login(username, password) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (res.ok) {
      this.setTokens(data.accessToken, data.refreshToken);
    }
    return { ok: res.ok, data };
  }

  async logout() {
    await this.request('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: this.refreshToken }),
    });
    this.clearTokens();
  }

  // ── User endpoints ──

  async getFriends() {
    const res = await this.request('/users/friends');
    return res.json();
  }

  async searchUsers(query) {
    const res = await this.request(`/users/search?q=${encodeURIComponent(query)}`);
    return res.json();
  }

  async getFriendRequests() {
    const res = await this.request('/users/requests');
    return res.json();
  }

  async sendFriendRequest(targetUserId) {
    const res = await this.request(`/users/request/${targetUserId}`, { method: 'POST' });
    return res.json();
  }

  async acceptFriendRequest(requesterId) {
    const res = await this.request(`/users/accept/${requesterId}`, { method: 'POST' });
    return res.json();
  }

  async rejectFriendRequest(targetUserId) {
    const res = await this.request(`/users/request/${targetUserId}`, { method: 'DELETE' });
    return res.json();
  }

  // ── Key endpoints ──

  async uploadKeys(bundle) {
    const res = await this.request('/keys/upload', {
      method: 'POST',
      body: JSON.stringify(bundle), // bundle may include encryptedPrivateKeyBackup
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to upload keys');
    return data;
  }

  async fetchKeyBundle(userId) {
    const res = await this.request(`/keys/${userId}`);
    return res.json();
  }

  /**
   * Fetch the current user's encrypted private key backup from the server.
   * Returns { encryptedPrivateKeyBackup: { ciphertext, iv, salt } } or throws.
   */
  async fetchKeyBackup() {
    const res = await this.request('/keys/backup');
    if (!res.ok) return null;
    return res.json();
  }

  /**
   * Fetch the authenticated user's own identity key and backup status.
   * Used to detect key mismatches and missing backups.
   */
  async fetchOwnKeyInfo() {
    const res = await this.request('/keys/me');
    if (!res.ok) return null;
    return res.json();
  }

  /**
   * Upload ONLY the encrypted private key backup (without re-uploading the full bundle).
   * Used when an existing browser retroactively creates a backup.
   */
  async uploadKeyBackup(encryptedPrivateKeyBackup) {
    const res = await this.request('/keys/backup', {
      method: 'PATCH',
      body: JSON.stringify({ encryptedPrivateKeyBackup }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to upload key backup');
    return data;
  }

  // ── Message endpoints ──

  async getPendingMessages() {
    const res = await this.request('/messages/pending');
    return res.json();
  }

  async getConversationHistory(peerId) {
    const res = await this.request(`/messages/history/${peerId}`);
    return res.json();
  }

  async ackMessages(messageIds) {
    const res = await this.request('/messages/ack', {
      method: 'POST',
      body: JSON.stringify({ messageIds }),
    });
    return res.json();
  }
}

// Singleton instance
const api = new ApiService();
export default api;
