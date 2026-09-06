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
  encryptPrivateKeys,
  decryptPrivateKeys,
} from '../services/crypto';

const CryptoContext = createContext(null);

/**
 * KEY RESTORE STATES
 *   'idle'                — initial state, no user logged in
 *   'checking'            — fetching key info from server
 *   'needs_password'      — backup found on new device, waiting for password to decrypt
 *   'no_backup'           — no backup on server (old account), must generate fresh keys WITH password
 *   'needs_backup_upload' — keys exist locally but no backup on server; prompt for password to create backup
 *   'needs_reupload'      — local keys don't match server AND no backup; re-upload our keys + create backup
 *   'keys_mismatch_restore' — local keys don't match server BUT backup exists; restore from backup
 *   'restoring'           — decryption / key operation in progress
 *   'done'                — keys are ready
 */

export function CryptoProvider({ children }) {
  const { user, setInitializeKeys } = useAuth();
  const [privateKeys, setPrivateKeys] = useState(null);

  // Key restore UI state
  const [restoreState, setRestoreState] = useState('idle');
  const [restoreError, setRestoreError] = useState(null);

  // In-memory cache of peer public keys (identity key strings fetched from server)
  // NOT persisted to localStorage — fetched fresh per session to avoid stale-key bugs.
  const peerPublicKeysRef = useRef({});

  // Lock to prevent double key generation
  const generatingRef = useRef(false);

  // ── Load / restore private keys when user changes ──
  useEffect(() => {
    peerPublicKeysRef.current = {}; // clear peer cache on user change
    setRestoreError(null);

    if (!user) {
      setPrivateKeys(null);
      setRestoreState('idle');
      return;
    }

    // Fast path: keys already in localStorage for this browser
    const localKeys = loadPrivateKeys(user._id);
    if (localKeys) {
      console.log('[Crypto] Loaded existing keys for', user.username);
      setPrivateKeys(localKeys);
      setRestoreState('done');

      // Background check: verify key consistency and backup status
      api.fetchOwnKeyInfo().then((data) => {
        if (!data) return; // no key bundle on server yet (shouldn't happen, but safe)

        const localPubKey = localKeys.identityKey.publicKey;
        const serverPubKey = data.identityKey;
        const hasBackup = data.hasBackup;

        if (localPubKey === serverPubKey) {
          // Keys match server — check backup status
          if (!hasBackup) {
            console.warn('[Crypto] Keys match server but NO backup exists — prompting for backup upload');
            setRestoreState('needs_backup_upload');
          }
          // else: everything is perfect, stay 'done'
        } else {
          // Keys DON'T match server — another device overwrote them
          console.warn('[Crypto] LOCAL keys do NOT match server! Split-brain detected.');
          if (hasBackup) {
            // Backup exists from the other device — offer to restore
            setRestoreState('keys_mismatch_restore');
          } else {
            // No backup — our local keys are the only copy. Re-upload them.
            setRestoreState('needs_reupload');
          }
        }
      }).catch((err) => {
        console.error('[Crypto] Failed to check key consistency:', err);
        // Don't block the user — keys still work for this browser
      });

      return;
    }

    // No local keys — check if there is a password-encrypted backup on the server.
    // This is the new-device / new-browser path.
    console.log('[Crypto] No local keys — checking server for encrypted backup…');
    setRestoreState('checking');

    api.fetchKeyBackup().then((data) => {
      if (data && data.encryptedPrivateKeyBackup && data.encryptedPrivateKeyBackup.ciphertext) {
        // Backup exists — user must enter their password to decrypt
        setRestoreState('needs_password');
      } else {
        // No backup — must generate fresh keys (old account or first device)
        setRestoreState('no_backup');
      }
    }).catch(() => {
      setRestoreState('no_backup');
    });

  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * restoreKeysWithPassword — called by KeyRestoreModal when user submits password.
   * Fetches the backup, decrypts it, saves to localStorage, and marks state done.
   */
  const restoreKeysWithPassword = useCallback(async (password) => {
    if (!user) return;
    setRestoreState('restoring');
    setRestoreError(null);

    try {
      const data = await api.fetchKeyBackup();
      if (!data || !data.encryptedPrivateKeyBackup) {
        throw new Error('Could not fetch key backup from server.');
      }

      // Decrypt entirely client-side — password never leaves the browser
      const restoredKeys = await decryptPrivateKeys(data.encryptedPrivateKeyBackup, password);

      savePrivateKeys(user._id, restoredKeys);
      setPrivateKeys(restoredKeys);
      setRestoreState('done');
      console.log('[Crypto] Keys restored from encrypted backup for', user.username);
    } catch (err) {
      console.error('[Crypto] Key restore failed:', err);
      // DOMException with name 'OperationError' = wrong password / corrupted ciphertext
      if (err.name === 'OperationError' || err instanceof DOMException) {
        setRestoreError('Incorrect password. Please try again.');
      } else {
        setRestoreError('Failed to restore keys. Please try again.');
      }
      setRestoreState('needs_password');
    }
  }, [user]);

  /**
   * generateNewKeysWithPassword — generates fresh keys AND creates encrypted backup.
   * Replaces the old skipRestoreAndGenerateNewKeys that didn't create a backup.
   * Used from the 'no_backup' flow when there's no existing backup on server.
   *
   * @param {string} password — user's password, used to encrypt the backup
   */
  const generateNewKeysWithPassword = useCallback(async (password) => {
    if (!user) return;
    setRestoreState('restoring');
    setRestoreError(null);
    try {
      await _generateAndUploadKeys(user._id, password);
      setRestoreState('done');
    } catch (err) {
      console.error('[Crypto] Key generation failed:', err);
      setRestoreError('Failed to generate keys. Please try again.');
      setRestoreState('no_backup');
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * uploadBackupWithPassword — encrypts current local private keys and uploads
   * ONLY the backup to the server (doesn't re-upload the full key bundle).
   * Used when keys are in sync with the server but no backup exists.
   *
   * @param {string} password — user's password, used to encrypt the backup
   */
  const uploadBackupWithPassword = useCallback(async (password) => {
    if (!user || !privateKeys) return;
    setRestoreState('restoring');
    setRestoreError(null);
    try {
      const encryptedBackup = await encryptPrivateKeys(privateKeys, password);
      await api.uploadKeyBackup(encryptedBackup);
      setRestoreState('done');
      console.log('[Crypto] Key backup created and uploaded for', user.username);
    } catch (err) {
      console.error('[Crypto] Backup upload failed:', err);
      setRestoreError('Failed to create backup. Please try again.');
      setRestoreState('needs_backup_upload');
    }
  }, [user, privateKeys]);

  /**
   * reuploadKeysWithPassword — re-uploads the FULL key bundle from localStorage
   * to the server AND creates an encrypted backup. Used when another device
   * overwrote our keys on the server and no backup exists.
   *
   * @param {string} password — user's password, used to encrypt the backup
   */
  const reuploadKeysWithPassword = useCallback(async (password) => {
    if (!user || !privateKeys) return;
    setRestoreState('restoring');
    setRestoreError(null);
    try {
      // Encrypt backup
      const encryptedBackup = await encryptPrivateKeys(privateKeys, password);

      // Re-upload full key bundle with the backup
      const publicBundle = {
        identityKey: privateKeys.identityKey.publicKey,
        signedPreKey: {
          keyId: privateKeys.signedPreKey.keyId || 1,
          publicKey: privateKeys.signedPreKey.publicKey,
          signature: privateKeys.signedPreKey.signature || 'migrated',
        },
        oneTimePreKeys: (privateKeys.oneTimePreKeys || []).map((k, i) => ({
          keyId: k.keyId || i + 1,
          publicKey: k.publicKey,
        })),
        encryptedPrivateKeyBackup: encryptedBackup,
      };

      await api.uploadKeys(publicBundle);
      setRestoreState('done');
      console.log('[Crypto] Keys re-uploaded and backup created for', user.username);
    } catch (err) {
      console.error('[Crypto] Key re-upload failed:', err);
      setRestoreError('Failed to re-sync keys. Please try again.');
      setRestoreState('needs_reupload');
    }
  }, [user, privateKeys]);

  /**
   * Internal helper — generates key bundle, uploads public part (+ encrypted backup
   * if password is provided), saves private part to localStorage.
   * Protected by generatingRef to prevent double invocation.
   *
   * @param {string} userId
   * @param {string|null} password — if provided, encrypts and uploads private key backup
   */
  const _generateAndUploadKeys = async (userId, password) => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    try {
      const { publicBundle, privateKeys: newKeys } = generateFullKeyBundle();

      let encryptedPrivateKeyBackup = undefined;
      if (password) {
        try {
          encryptedPrivateKeyBackup = await encryptPrivateKeys(newKeys, password);
        } catch (encErr) {
          // Non-fatal: if encryption fails, we still upload the public bundle
          console.error('[Crypto] Failed to encrypt key backup:', encErr);
        }
      }

      await api.uploadKeys({ ...publicBundle, encryptedPrivateKeyBackup });
      savePrivateKeys(userId, newKeys);
      setPrivateKeys(newKeys);
      console.log('[Crypto] Keys generated and uploaded for userId:', userId,
        encryptedPrivateKeyBackup ? '(with encrypted backup)' : '(no backup)');
    } catch (err) {
      console.error('Key generation/upload failed:', err);
      throw err; // re-throw so caller can handle
    } finally {
      generatingRef.current = false;
    }
  };

  /**
   * initializeKeys — called explicitly after registration with the user's password
   * so we can generate the encrypted backup immediately.
   * Generates, uploads and saves a new key bundle only if none exists.
   *
   * @param {object} activeUser
   * @param {string} password — user's registration password, used for backup encryption
   */
  const initializeKeys = useCallback(
    async (activeUser = user, password = null) => {
      if (!activeUser) return;

      const existing = loadPrivateKeys(activeUser._id);
      if (existing) {
        setPrivateKeys(existing);
        setRestoreState('done');
        return existing;
      }

      setRestoreState('restoring');
      try {
        await _generateAndUploadKeys(activeUser._id, password);
        setRestoreState('done');
      } catch (err) {
        console.error('[Crypto] Failed to initialize keys on registration:', err);
        setRestoreError('Failed to generate keys. Please try again.');
        setRestoreState('no_backup');
      }
    },
    [user] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Wire initializeKeys into AuthContext so register() can call it with the password.
  useEffect(() => {
    if (setInitializeKeys) setInitializeKeys(initializeKeys);
  }, [initializeKeys, setInitializeKeys]);

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
      // Try React state first, then fall back to localStorage
      let keys = privateKeys;
      if (!keys && user) {
        keys = loadPrivateKeys(user._id);
        if (keys) setPrivateKeys(keys);
      }
      if (!keys) return null;

      const peerPubKey = await getPeerPublicKey(peerId);
      if (!peerPubKey) return null;
      return computeFingerprint(keys.identityKey.publicKey, peerPubKey);
    },
    [privateKeys, user, getPeerPublicKey]
  );

  return (
    <CryptoContext.Provider
      value={{
        privateKeys,
        restoreState,
        restoreError,
        initializeKeys,
        restoreKeysWithPassword,
        generateNewKeysWithPassword,
        uploadBackupWithPassword,
        reuploadKeysWithPassword,
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
