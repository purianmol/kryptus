import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Ref to hold the initializeKeys function from CryptoContext.
  // We use a ref (injected by CryptoProvider via setInitializeKeys) to break
  // the circular dependency: AuthContext can't import CryptoContext directly.
  const initializeKeysRef = useRef(null);

  /** Called by CryptoProvider on mount to wire up the key init callback. */
  const setInitializeKeys = useCallback((fn) => {
    initializeKeysRef.current = fn;
  }, []);

  // Check for existing session on mount
  useEffect(() => {
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
      // Generate keys immediately after registration, using the password for backup encryption
      if (initializeKeysRef.current) {
        await initializeKeysRef.current(data.user, password);
      }
    }
    return { ok, data };
  }, []);

  const login = useCallback(async (username, password) => {
    const { ok, data } = await api.login(username, password);
    if (ok) {
      setUser(data.user);
      localStorage.setItem('user', JSON.stringify(data.user));
      // NOTE: Key restore on new device is handled by CryptoContext automatically.
      // The password is stored in memory here and passed through restoreKeysWithPassword
      // only when the user explicitly submits the KeyRestoreModal.
    }
    return { ok: ok, data, password }; // return password so Login page can forward it
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    localStorage.removeItem('user');
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, register, login, logout, setInitializeKeys }}>
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
