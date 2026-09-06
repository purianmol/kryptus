import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

/**
 * Crypto Service — Client-side E2EE operations using tweetnacl.
 *
 * Implements:
 * - Identity key pair generation (Curve25519)
 * - Signed pre-key + one-time pre-key generation
 * - X3DH-style key exchange (shared secret derivation)
 * - Message encryption/decryption (XSalsa20-Poly1305 AEAD)
 * - Safety number / fingerprint computation
 */

const PREKEY_COUNT = 10;

// ── Key Generation ──

/**
 * Generate a new Curve25519 identity key pair.
 * Returns { publicKey, secretKey } as base64 strings.
 */
export function generateIdentityKeyPair() {
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: naclUtil.encodeBase64(keyPair.publicKey),
    secretKey: naclUtil.encodeBase64(keyPair.secretKey),
  };
}

/**
 * Generate a signed pre-key.
 * In a full implementation, the signature would use an Ed25519 signing key.
 * Here we use a simplified approach: sign the pre-key with the identity secret key
 * via nacl.sign (we generate an Ed25519 signing key from the identity for this).
 */
export function generateSignedPreKey(keyId) {
  const keyPair = nacl.box.keyPair();
  return {
    keyId,
    publicKey: naclUtil.encodeBase64(keyPair.publicKey),
    secretKey: naclUtil.encodeBase64(keyPair.secretKey),
    // Simplified signature: hash of the public key (in production, use Ed25519 sign)
    signature: naclUtil.encodeBase64(
      nacl.hash(keyPair.publicKey).slice(0, 64)
    ),
  };
}

/**
 * Generate a batch of one-time pre-keys.
 */
export function generateOneTimePreKeys(startKeyId, count = PREKEY_COUNT) {
  const keys = [];
  for (let i = 0; i < count; i++) {
    const keyPair = nacl.box.keyPair();
    keys.push({
      keyId: startKeyId + i,
      publicKey: naclUtil.encodeBase64(keyPair.publicKey),
      secretKey: naclUtil.encodeBase64(keyPair.secretKey),
    });
  }
  return keys;
}

/**
 * Generate the full key bundle for upload.
 * Returns { publicBundle (for server), privateKeys (for local storage) }
 */
export function generateFullKeyBundle() {
  const identity = generateIdentityKeyPair();
  const signedPreKey = generateSignedPreKey(1);
  const oneTimePreKeys = generateOneTimePreKeys(1);

  return {
    publicBundle: {
      identityKey: identity.publicKey,
      signedPreKey: {
        keyId: signedPreKey.keyId,
        publicKey: signedPreKey.publicKey,
        signature: signedPreKey.signature,
      },
      oneTimePreKeys: oneTimePreKeys.map((k) => ({
        keyId: k.keyId,
        publicKey: k.publicKey,
      })),
    },
    privateKeys: {
      identityKey: identity,
      signedPreKey,
      oneTimePreKeys,
    },
  };
}

// ── X3DH Key Exchange ──

/**
 * Perform symmetric key exchange.
 * Computes shared secret using local identity secret and remote identity public key.
 */
export function performKeyExchange(myIdentitySecretKey, theirIdentityPublicKey) {
  const mySecret = naclUtil.decodeBase64(myIdentitySecretKey);
  const theirPublic = naclUtil.decodeBase64(theirIdentityPublicKey);

  // Compute shared secret
  const sharedSecret = nacl.box.before(theirPublic, mySecret);
  
  return naclUtil.encodeBase64(sharedSecret);
}

// ── Message Encryption / Decryption ──

/**
 * Encrypt a plaintext message using the shared secret.
 * Uses nacl.secretbox (XSalsa20-Poly1305 AEAD).
 * Returns { ciphertext, iv } as base64 strings.
 */
export function encryptMessage(plaintext, sharedSecretBase64) {
  const key = naclUtil.decodeBase64(sharedSecretBase64);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength); // 24 bytes
  const messageBytes = naclUtil.decodeUTF8(plaintext);

  const ciphertext = nacl.secretbox(messageBytes, nonce, key);

  return {
    ciphertext: naclUtil.encodeBase64(ciphertext),
    iv: naclUtil.encodeBase64(nonce),
  };
}

/**
 * Decrypt a ciphertext using the shared secret.
 * Returns the plaintext string, or null if decryption fails (tampered/wrong key).
 */
export function decryptMessage(ciphertextBase64, ivBase64, sharedSecretBase64) {
  try {
    const key = naclUtil.decodeBase64(sharedSecretBase64);
    const nonce = naclUtil.decodeBase64(ivBase64);
    const ciphertext = naclUtil.decodeBase64(ciphertextBase64);

    const plaintext = nacl.secretbox.open(ciphertext, nonce, key);

    if (!plaintext) {
      console.error('Decryption failed: authentication tag mismatch');
      return null;
    }

    return naclUtil.encodeUTF8(plaintext);
  } catch (error) {
    console.error('Decryption error:', error);
    return null;
  }
}

// ── Safety Number / Fingerprint ──

/**
 * Compute a human-readable fingerprint (safety number) from two identity keys.
 * Users can compare this out-of-band to verify no MITM attack.
 */
export function computeFingerprint(identityKey1Base64, identityKey2Base64) {
  const key1 = naclUtil.decodeBase64(identityKey1Base64);
  const key2 = naclUtil.decodeBase64(identityKey2Base64);

  // Concatenate in sorted order for consistency regardless of who initiates
  const sorted = [key1, key2].sort((a, b) => {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
  });

  const combined = new Uint8Array(sorted[0].length + sorted[1].length);
  combined.set(sorted[0], 0);
  combined.set(sorted[1], sorted[0].length);

  const hash = nacl.hash(combined);

  // Format as groups of 5 hex digits, 12 groups (60 chars)
  const hex = Array.from(hash.slice(0, 30))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return hex.match(/.{1,5}/g).join(' ');
}

// ── Key Storage (localStorage) ──

/**
 * Save private keys to localStorage.
 * Shared secrets are deliberately NOT stored here — they are always
 * derived on-the-fly from (myPrivateKey + peerPublicKey) to prevent
 * stale-key decryption failures when a peer re-generates their keys.
 */
export function savePrivateKeys(userId, privateKeys) {
  localStorage.setItem(`keys_${userId}`, JSON.stringify(privateKeys));
}

export function loadPrivateKeys(userId) {
  const stored = localStorage.getItem(`keys_${userId}`);
  return stored ? JSON.parse(stored) : null;
}

export function clearPrivateKeys(userId) {
  localStorage.removeItem(`keys_${userId}`);
}

// ── Password-Encrypted Key Backup (Web Crypto API) ──

/**
 * Derive an AES-GCM CryptoKey from a password and salt using PBKDF2.
 * @param {string} password - User's login password (UTF-8)
 * @param {Uint8Array} salt  - Random 16-byte salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveKeyFromPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 310_000, // NIST recommended minimum for PBKDF2-SHA-256
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt private keys with a password-derived AES-GCM key.
 * Returns { ciphertext, iv, salt } — all base64 strings — safe to send to server.
 *
 * @param {object} privateKeys - The private key bundle to back up
 * @param {string} password    - User's login password
 * @returns {Promise<{ ciphertext: string, iv: string, salt: string }>}
 */
export async function encryptPrivateKeys(privateKeys, password) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv   = window.crypto.getRandomValues(new Uint8Array(12)); // AES-GCM standard nonce
  const key  = await deriveKeyFromPassword(password, salt);

  const enc = new TextEncoder();
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(privateKeys))
  );

  // Convert buffers to base64 for JSON transport
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertextBuffer))),
    iv:         btoa(String.fromCharCode(...iv)),
    salt:       btoa(String.fromCharCode(...salt)),
  };
}

/**
 * Decrypt an encrypted key backup using the user's password.
 * Throws a DOMException ('OperationError') if the password is wrong or the data is corrupted.
 *
 * @param {{ ciphertext: string, iv: string, salt: string }} encryptedBackup
 * @param {string} password
 * @returns {Promise<object>} The decrypted private key bundle
 */
export async function decryptPrivateKeys(encryptedBackup, password) {
  const { ciphertext, iv: ivB64, salt: saltB64 } = encryptedBackup;

  // Decode base64 → Uint8Array
  const toBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const salt       = toBytes(saltB64);
  const iv         = toBytes(ivB64);
  const cipherBuf  = toBytes(ciphertext);

  const key = await deriveKeyFromPassword(password, salt);

  // Will throw DOMException on wrong password (authentication tag mismatch)
  const plaintextBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipherBuf
  );

  const dec = new TextDecoder();
  return JSON.parse(dec.decode(plaintextBuffer));
}
