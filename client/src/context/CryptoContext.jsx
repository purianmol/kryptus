import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import api from '../services/api';
import {
  generateFullKeyBundle,
  performKeyExchange,
  encryptMessage,
  decryptMessage,
  computeFingerprint,
  savePrivateKeys,
  loadPrivateKeys,
} from '../services/crypto';

const CryptoContext = createContext(null);

export function CryptoProvider({ children }) {
  const { user } = useAuth();
  const [privateKeys, setPrivateKeys] = useState(null);

  // In-memory cache of peer public keys (identity key strings fetched from server)
  // NOT persisted to localStorage — fetched fresh per session to avoid stale-key bugs.
  const peerPublicKeysRef = useRef({});

  // Lock to prevent double key generation from useEffect + initializeKeys racing
  const generatingRef = useRef(false);

  // ── Load private keys when user changes ──
  useEffect(() => {
    peerPublicKeysRef.current = {}; // clear peer cache on user change

    if (user) {
      const keys = loadPrivateKeys(user._id);
      if (keys) {
        console.log('[Crypto] Loaded existing keys for', user.username);
        setPrivateKeys(keys);
      } else if (!generatingRef.current) {
        // No keys in localStorage — generate + upload fresh keys.
        // This happens on first login or after clearing local storage.
        console.log('[Crypto] No keys found, auto-generating for', user.username);
        _generateAndUploadKeys(user._id);
      }
    } else {
      setPrivateKeys(null);
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Internal helper — generates key bundle, uploads public part, saves private part.
   *  Protected by generatingRef to prevent double invocation. */
  const _generateAndUploadKeys = async (userId) => {
    if (generatingRef.current) return; // already generating
    generatingRef.current = true;
    try {
      const { publicBundle, privateKeys: newKeys } = generateFullKeyBundle();
      await api.uploadKeys(publicBundle);
      savePrivateKeys(userId, newKeys);
      setPrivateKeys(newKeys);
      console.log('[Crypto] Keys generated and uploaded for userId:', userId);
    } catch (err) {
      console.error('Key generation/upload failed:', err);
    } finally {
      generatingRef.current = false;
    }
  };

  /**
   * initializeKeys — called explicitly after registration.
   * Generates, uploads and saves a new key bundle only if none exists.
   */
  const initializeKeys = useCallback(
    async (activeUser = user) => {
      if (!activeUser) return;

      const existing = loadPrivateKeys(activeUser._id);
      if (existing) {
        setPrivateKeys(existing);
        return existing;
      }

      await _generateAndUploadKeys(activeUser._id);
    },
    [user] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /**
   * getPeerPublicKey — fetches (and caches in memory) the peer's identity public key.
   * Always fetches from server on first call per session to avoid stale cache.
   */
  const getPeerPublicKey = useCallback(async (peerId) => {
    if (peerPublicKeysRef.current[peerId]) {
      return peerPublicKeysRef.current[peerId];
    }

    const bundle = await api.fetchKeyBundle(peerId);
    if (!bundle || !bundle.identityKey) {
      console.error('Could not fetch key bundle for peer:', peerId);
      return null;
    }

    peerPublicKeysRef.current[peerId] = bundle.identityKey;
    return bundle.identityKey;
  }, []);

  /**
   * getSharedSecret — derives the Diffie-Hellman shared secret on the fly.
   *
   * WHY NOT CACHE TO LOCALSTORAGE?
   *   If a peer regenerates their keys (e.g., cleared browser / new device),
   *   the server holds the NEW public key but localStorage would hold an old
   *   shared secret derived from the OLD key → decryption fails silently.
   *   By always deriving from (mySecretKey + peerPublicKeyFromServer) we
   *   are guaranteed correctness as long as the server has the peer's current key.
   *
   * PERFORMANCE:
   *   nacl.box.before() completes in <1 ms — no need to persist the result.
   *   The peer public key IS cached in memory (peerPublicKeysRef) so we avoid
   *   redundant network round-trips within a session.
   */
  const getSharedSecret = useCallback(
    async (peerId) => {
      // Try React state first, then fall back to localStorage directly.
      // This prevents a race where decrypt() is called before the useEffect
      // that loads privateKeys into state has finished batching.
      let keys = privateKeys;
      if (!keys && user) {
        keys = loadPrivateKeys(user._id);
        if (keys) setPrivateKeys(keys); // backfill state
      }

      if (!keys) {
        console.error('No private keys available for user:', user?._id);
        return null;
      }

      const peerPubKey = await getPeerPublicKey(peerId);
      if (!peerPubKey) return null;

      // Symmetric ECDH: nacl.box.before(theirPub, mySec) produces the same
      // 32-byte secret on both sides (Diffie-Hellman on Curve25519).
      return performKeyExchange(keys.identityKey.secretKey, peerPubKey);
    },
    [privateKeys, user, getPeerPublicKey]
  );

  /**
   * establishSession — pre-fetches the peer's public key so the first
   * send/receive is instant. Call this when opening a conversation.
   */
  const establishSession = useCallback(
    async (peerId) => {
      await getPeerPublicKey(peerId);
    },
    [getPeerPublicKey]
  );

  /** encrypt — encrypts plaintext for peerId using the derived shared secret */
  const encrypt = useCallback(
    async (peerId, plaintext) => {
      const secret = await getSharedSecret(peerId);
      if (!secret) throw new Error('Could not establish secure session with peer.');
      return encryptMessage(plaintext, secret);
    },
    [getSharedSecret]
  );

  /** decrypt — decrypts ciphertext from peerId using the derived shared secret.
   *  If decryption fails, invalidates the cached peer key and retries once
   *  with a fresh key from the server (handles key rotation gracefully). */
  const decrypt = useCallback(
    async (peerId, ciphertext, iv) => {
      const secret = await getSharedSecret(peerId);
      if (!secret) {
        console.error('No shared secret — cannot decrypt from peer:', peerId);
        return null;
      }

      const result = decryptMessage(ciphertext, iv, secret);
      if (result !== null) return result;

      // Decryption failed — the peer may have rotated keys.
      // Invalidate the cached public key and retry with a fresh one from server.
      console.warn('[Crypto] Decrypt failed, retrying with fresh peer key for:', peerId);
      delete peerPublicKeysRef.current[peerId];

      const freshSecret = await getSharedSecret(peerId);
      if (!freshSecret) return null;

      return decryptMessage(ciphertext, iv, freshSecret);
    },
    [getSharedSecret]
  );

  /**
   * getFingerprint — computes a deterministic "safety number" from both
   * parties' identity public keys. Keys are sorted before hashing so the
   * fingerprint is the same regardless of who initiates.
   */
  const getFingerprint = useCallback(
    async (peerId) => {
      if (!privateKeys) return null;
      const peerPubKey = await getPeerPublicKey(peerId);
      if (!peerPubKey) return null;
      return computeFingerprint(privateKeys.identityKey.publicKey, peerPubKey);
    },
    [privateKeys, getPeerPublicKey]
  );

  return (
    <CryptoContext.Provider
      value={{
        privateKeys,
        initializeKeys,
        establishSession,
        encrypt,
        decrypt,
        getFingerprint,
      }}
    >
      {children}
    </CryptoContext.Provider>
  );
}

export function useCrypto() {
  const context = useContext(CryptoContext);
  if (!context) {
    throw new Error('useCrypto must be used within a CryptoProvider');
  }
  return context;
}
