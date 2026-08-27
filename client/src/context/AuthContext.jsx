import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    // ── One-time cleanup: force fresh start for crypto ──
    // Remove ALL cached crypto state to guarantee localStorage keys match
    // what's on the server. This runs once on mount; after this, keys persist.
    const cleanupDone = localStorage.getItem('_crypto_cleanup_v2');
    if (!cleanupDone) {
      Object.keys(localStorage).forEach((key) => {
        if (
          key.startsWith('shared_') ||
          key.startsWith('conversations_') ||
          key.startsWith('keys_')
        ) {
          localStorage.removeItem(key);
        }
      });
      localStorage.setItem('_crypto_cleanup_v2', '1');
    }

    const token = localStorage.getItem('accessToken');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
        api.accessToken = token;
        api.refreshToken = localStorage.getItem('refreshToken');
      } catch {
        localStorage.clear();
      }
    }
    setLoading(false);
  }, []);

  const register = useCallback(async (username, password) => {
    const { ok, data } = await api.register(username, password);
    if (ok) {
      setUser(data.user);
      localStorage.setItem('user', JSON.stringify(data.user));
    }
    return { ok, data };
  }, []);

  const login = useCallback(async (username, password) => {
    const { ok, data } = await api.login(username, password);
    if (ok) {
      setUser(data.user);
      localStorage.setItem('user', JSON.stringify(data.user));
    }
    return { ok, data };
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    localStorage.removeItem('user');
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
