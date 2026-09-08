<p align="center">
  <img src="https://img.shields.io/badge/Node.js-v18+-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/MongoDB-Atlas-47A248?style=flat-square&logo=mongodb&logoColor=white" />
  <img src="https://img.shields.io/badge/Socket.io-4.x-010101?style=flat-square&logo=socket.io&logoColor=white" />
  <img src="https://img.shields.io/badge/Encryption-Curve25519-blueviolet?style=flat-square" />
  <img src="https://img.shields.io/badge/Deployed-Vercel%20%2B%20Render-black?style=flat-square" />
</p>

# 🔐 Kryptus

> A full-stack **end-to-end encrypted** (E2EE) messaging application where the **server never sees plaintext**. All encryption and decryption occurs exclusively on the client using Curve25519 key exchange and XSalsa20-Poly1305 authenticated encryption.

**Live:** [kryptus.vercel.app](https://kryptus.vercel.app)

---

## Table of Contents

- [Why Kryptus?](#why-kryptus)
- [System Architecture](#system-architecture)
- [E2EE Encryption & Decryption — Deep Dive](#e2ee-encryption--decryption--deep-dive)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Data Models](#data-models)
- [API Reference](#api-reference)
- [Socket.io Events](#socketio-events)
- [Security Controls](#security-controls)
- [Getting Started](#getting-started)
- [Deployment](#deployment)
- [License](#license)

---

## Why Kryptus?

Most messaging backends have full access to every message ever sent. **Kryptus inverts that trust model** — the server is a *blind relay* that stores and forwards opaque ciphertext. Even a fully compromised server or database dump reveals **zero** plaintext content.

**Core guarantees:**

| # | Guarantee | How |
|---|-----------|-----|
| 1 | **Confidentiality** — Only sender and recipient can read messages | Curve25519 ECDH + XSalsa20-Poly1305 AEAD |
| 2 | **Integrity** — Tampered ciphertext is rejected | Poly1305 MAC verification on every decrypt |
| 3 | **Real-time delivery** — Messages arrive instantly when online | Socket.io WebSocket transport |
| 4 | **Store-and-forward** — Offline users receive messages on reconnect | MongoDB queue (QUEUED → DELIVERED state) |
| 5 | **Cross-device sync** — Full encrypted history restored on new devices | 365-day TTL index on Messages collection |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (React)                                 │
│  ┌─────────────┐  ┌────────────────┐  ┌────────────────┐                   │
│  │ AuthContext  │  │ CryptoContext  │  │ SocketContext  │                   │
│  │ JWT session  │  │ Key gen/store  │  │ Real-time msg  │                   │
│  │ management   │  │ Encrypt/Decrypt│  │ relay          │                   │
│  └──────┬───────┘  └───────┬────────┘  └───────┬────────┘                   │
│         │                  │                    │                            │
│         │          ┌───────▼────────┐           │                            │
│         │          │  crypto.js     │           │                            │
│         │          │  tweetnacl     │           │                            │
│         │          │  (Curve25519 + │           │                            │
│         │          │   XSalsa20)    │           │                            │
│         │          └────────────────┘           │                            │
└─────────┼──────────────────────────────────────┼────────────────────────────┘
          │ HTTPS (REST)                          │ WSS (Socket.io)
          │                                       │
┌─────────▼───────────────────────────────────────▼──────────────────────────┐
│                           SERVER (Node.js)                                  │
│                                                                             │
│  ┌─────────────────────────────┐    ┌──────────────────────────────────┐   │
│  │     Express REST API        │    │       Socket.io Gateway          │   │
│  │                             │    │                                  │   │
│  │  POST /api/auth/register    │    │  JWT handshake authentication    │   │
│  │  POST /api/auth/login       │    │  Connection registry             │   │
│  │  POST /api/auth/refresh     │    │  (userId → socketId)            │   │
│  │  POST /api/auth/logout      │    │  send_message → relay/queue     │   │
│  │  POST /api/keys/upload      │    │  msg_ack → mark DELIVERED       │   │
│  │  GET  /api/keys/:userId     │    │  Flush QUEUED on reconnect      │   │
│  │  GET  /api/keys/me          │    │  Online/offline broadcast       │   │
│  │  GET  /api/keys/backup      │    │  Typing indicators              │   │
│  │  PATCH /api/keys/backup     │    │                                  │   │
│  │  GET  /api/users/search     │    │  ┌──────────────────────────┐   │   │
│  │  GET  /api/users/friends    │    │  │  Map<userId, socketId>   │   │   │
│  │  GET  /api/users/requests   │    │  │  In-memory connection    │   │   │
│  │  POST /api/users/request/:id│    │  │  registry                │   │   │
│  │  POST /api/users/accept/:id │    │  └──────────────────────────┘   │   │
│  │  DELETE /api/users/request  │    └──────────────────┬───────────────┘   │
│  │  DELETE /api/users/friend   │                        │                   │
│  │  GET  /api/messages/pending │                        │                   │
│  │  GET  /api/messages/history │                        │                   │
│  │  POST /api/messages/ack     │                        │                   │
│  └─────────────┬───────────────┘                        │                   │
│                └──────────────────┬─────────────────────┘                   │
│                                   │                                         │
│                      ┌────────────▼─────────────┐                          │
│                      │       MongoDB             │                          │
│                      │  (Mongoose ODM)           │                          │
│                      │                           │                          │
│                      │  Users        Sessions    │                          │
│                      │  PublicKeys   Messages    │                          │
│                      │  (ciphertext) (ciphertext)│                          │
│                      └───────────────────────────┘                          │
│                                                                             │
│  ⚠️  The server NEVER receives plaintext or private keys.                   │
│      Messages collection contains only opaque ciphertext + IV.             │
│      Encrypted history is retained for 365 days for cross-device sync.     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## E2EE Encryption & Decryption — Deep Dive

### 1. Key Generation (on Registration)

When a user registers, the client generates a **Curve25519 identity key pair** using `tweetnacl`:

```javascript
// crypto.js — Key generation
const keyPair = nacl.box.keyPair();  // 32-byte Curve25519 key pair

return {
  publicKey:  base64(keyPair.publicKey),   // Uploaded to server
  secretKey:  base64(keyPair.secretKey),   // Stays on client ONLY
};
```

The client also generates a **Signed Pre-Key** and **One-Time Pre-Keys** (a batch of 10 ephemeral key pairs for future forward secrecy).

**What gets uploaded to the server:**
```json
{
  "identityKey": "base64(publicKey)",
  "signedPreKey": { "keyId": 1, "publicKey": "...", "signature": "..." },
  "oneTimePreKeys": [{ "keyId": 1, "publicKey": "..." }, ...]
}
```

> **Critical invariant:** Private keys **never** leave the client. The server only stores public keys. Private keys are optionally backed up in the user's password-derived encrypted backup on the server.

### 2. Key Exchange (Diffie-Hellman)

When Alice wants to message Bob, the client performs an **Elliptic Curve Diffie-Hellman (ECDH)** key exchange:

```
Alice's Secret Key (a)  ×  Bob's Public Key (B)  =  Shared Secret (S)
Bob's Secret Key (b)    ×  Alice's Public Key (A) =  Shared Secret (S)  ← SAME VALUE
```

```javascript
// CryptoContext.jsx — Shared secret derivation
const sharedSecret = nacl.box.before(
  decodeBase64(peerPublicKey),    // Bob's public key (fetched from server)
  decodeBase64(mySecretKey)       // Alice's secret key (from localStorage)
);
// Result: 32-byte shared secret, identical on both sides
```

The server sees both public keys but **cannot compute the shared secret** without either private key.

### 3. Message Encryption

With the shared secret derived, every message is encrypted using **XSalsa20-Poly1305** (an AEAD cipher):

```javascript
// crypto.js — Encryption
function encryptMessage(plaintext, sharedSecret) {
  const nonce = nacl.randomBytes(24);               // Random 24-byte nonce
  const messageBytes = decodeUTF8(plaintext);        // Plaintext → bytes
  const ciphertext = nacl.secretbox(                 // XSalsa20-Poly1305
    messageBytes,
    nonce,
    decodeBase64(sharedSecret)
  );
  return {
    ciphertext: base64(ciphertext),                  // Encrypted payload
    iv: base64(nonce),                               // Nonce (public, unique per message)
  };
}
```

**What the server stores:**
```json
{
  "messageId": "uuid-v4",
  "senderId": "ObjectId",
  "recipientId": "ObjectId",
  "ciphertext": "kWeQ3P0f7gZ5a2...",
  "iv": "Rm5kX2FiY2Rl...",
  "status": "QUEUED"
}
```

### 4. Message Decryption

The recipient derives the **same shared secret** (ECDH is symmetric) and decrypts:

```javascript
// crypto.js — Decryption
function decryptMessage(ciphertextB64, ivB64, sharedSecret) {
  const plaintext = nacl.secretbox.open(
    decodeBase64(ciphertextB64),
    decodeBase64(ivB64),
    decodeBase64(sharedSecret)
  );

  if (!plaintext) {
    // Poly1305 MAC verification failed → tampered or wrong key
    return null;
  }
  return encodeUTF8(plaintext);
}
```

**Tamper detection:** If even a single bit of the ciphertext is modified, `secretbox.open()` returns `null`.

### 5. Message Flow

```
  Alice (Client)                    Server                     Bob (Client)
       │                              │                              │
       │  1. Fetch Bob's public key   │                              │
       │────────GET /api/keys/bob────▶│                              │
       │◀──── { identityKey: Bpub } ──│                              │
       │                              │                              │
       │  2. Derive shared secret     │                              │
       │  S = DH(Asec, Bpub)          │                              │
       │                              │                              │
       │  3. Encrypt message          │                              │
       │  {ct, iv} = encrypt(msg, S)  │                              │
       │                              │                              │
       │  4. Send encrypted payload   │                              │
       │──── send_message ───────────▶│                              │
       │   {recipientId, ct, iv}      │  5. Route to Bob             │
       │                              │─── receive_message ─────────▶│
       │                              │   {senderId, ct, iv}         │
       │                              │                              │
       │                              │  6. Bob fetches Alice's key  │
       │                              │◀── GET /api/keys/alice ──────│
       │                              │──── { identityKey: Apub } ──▶│
       │                              │                              │
       │                              │  7. Derive SAME shared secret│
       │                              │     S = DH(Bsec, Apub)      │
       │                              │                              │
       │                              │  8. Decrypt message          │
       │                              │     msg = decrypt(ct, iv, S) │
       │                              │                              │
       │  9. Delivery confirmation    │                              │
       │◀────── msg_delivered ────────│◀──────── msg_ack ───────────│
```

### 6. Safety Number Verification

Users can verify they're talking to the right person by comparing **safety numbers** — a deterministic fingerprint computed from both identity keys:

```javascript
function computeFingerprint(key1, key2) {
  // Sort keys to ensure both sides compute the same fingerprint
  const sorted = [key1, key2].sort(byteComparison);
  const hash = nacl.hash(concat(sorted[0], sorted[1]));  // SHA-512
  return formatAsHexGroups(hash.slice(0, 30));
  // Output: "a1b2c 3d4e5 f6789 0abcd ef123 45678"
}
```

If a man-in-the-middle replaces a public key, the safety numbers will **not match**, alerting users that the channel is compromised.

### 7. Cross-Device Sync & Key Backup

Because Kryptus uses symmetric ECDH, the shared secret between sender and recipient is identical on both sides. This enables history sync:
- The server retains the encrypted ciphertext for **365 days** (TTL-indexed).
- On a new device, the user enters their password to decrypt the encrypted private key backup stored on the server.
- All past messages decrypt using the restored private key — no plaintext is ever sent to the server.

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Runtime** | Node.js 18+ | Event-loop model suits I/O-bound chat workload |
| **API Framework** | Express.js 4.x | Mature REST framework |
| **Real-time Transport** | Socket.io 4.x | WebSocket + fallback, built-in reconnection |
| **Database** | MongoDB + Mongoose 8.x | Flexible schema, high write throughput |
| **Auth** | JWT (access) + opaque refresh token | Short-lived stateless access, revocable sessions |
| **Password Hashing** | Argon2id | Memory-hard, winner of the Password Hashing Competition |
| **Client Crypto** | tweetnacl (Curve25519 + XSalsa20-Poly1305) | Audited, zero-dependency, 7KB AEAD crypto library |
| **Frontend** | React 19 + Vite | Fast HMR, modern build tooling |
| **Styling** | Vanilla CSS (dark mode, glassmorphism) | No framework dependencies, full design control |
| **Deployment** | Vercel (client) + Render (server) + MongoDB Atlas | Scalable, free-tier compatible |

---

## Project Structure

```
kryptus/
├── server/                              # Backend (Node.js + Express + Socket.io)
│   ├── src/
│   │   ├── index.js                     # Server entry — Express + Socket.io init
│   │   ├── config/
│   │   │   └── db.js                    # Mongoose connection with retry logic
│   │   ├── models/
│   │   │   ├── User.js                  # User schema (username, passwordHash, friends)
│   │   │   ├── Session.js               # Refresh token sessions (TTL-indexed)
│   │   │   ├── PublicKeyBundle.js       # Public key bundles (identity + pre-keys)
│   │   │   └── Message.js               # Ciphertext store (QUEUED → DELIVERED)
│   │   ├── routes/
│   │   │   ├── auth.js                  # Register, login, refresh, logout
│   │   │   ├── keys.js                  # Key bundle upload / fetch / backup
│   │   │   ├── messages.js              # Pending fetch, history, ACK
│   │   │   └── users.js                 # User search, friend requests, unfriend
│   │   ├── middleware/
│   │   │   ├── authenticate.js          # JWT verification middleware
│   │   │   └── rateLimit.js             # express-rate-limit configs
│   │   └── socket/
│   │       └── gateway.js               # Socket.io event handlers + connection registry
│   ├── tests/
│   │   ├── auth.test.js                 # Auth endpoint tests
│   │   └── socket.test.js               # Socket integration tests
│   ├── .env.example                     # Environment variable template
│   └── package.json
│
├── client/                              # Frontend (React + Vite)
│   ├── src/
│   │   ├── main.jsx                     # React entry point
│   │   ├── App.jsx                      # Router + provider hierarchy
│   │   ├── index.css                    # Design system (dark mode, glassmorphism)
│   │   ├── context/
│   │   │   ├── AuthContext.jsx          # JWT session management + token refresh
│   │   │   ├── CryptoContext.jsx        # Key lifecycle, encrypt/decrypt, session mgmt
│   │   │   └── SocketContext.jsx        # Socket.io connection, reconnect handling
│   │   ├── services/
│   │   │   ├── api.js                   # REST API client (fetch wrapper + auto-refresh)
│   │   │   └── crypto.js                # tweetnacl crypto primitives (pure functions)
│   │   ├── pages/
│   │   │   ├── Login.jsx                # Login form with glassmorphic design
│   │   │   ├── Register.jsx             # Registration with password strength indicator
│   │   │   └── Chat.jsx                 # Main chat page (sidebar + messages + input)
│   │   └── components/
│   │       ├── ContactList.jsx          # Friend list, recency-sorted, last message preview
│   │       ├── MessageList.jsx          # Signal-style bubbles, delivery ticks, link parsing
│   │       ├── MessageInput.jsx         # Compose area, emoji picker, Enter-to-send
│   │       ├── AddFriendPanel.jsx       # User search + friend request management
│   │       ├── SafetyNumber.jsx         # Fingerprint verification modal
│   │       └── KeyRestoreModal.jsx      # Multi-device key restore flow
│   ├── vercel.json                      # SPA routing rewrites for Vercel deployment
│   ├── vite.config.js
│   ├── index.html
│   └── package.json
│
├── .gitignore
└── README.md
```

---

## Data Models

### User
```javascript
{
  username:     String,    // unique, indexed
  passwordHash: String,    // Argon2id hash — never plaintext
  friends:      [{
    userId:     ObjectId,  // ref → User
    status:     String,    // 'pending' | 'accepted'
    initiator:  Boolean,   // true = I sent the request
  }],
  createdAt:    Date,
  lastSeenAt:   Date,
}
```

### Session
```javascript
{
  userId:           ObjectId,  // ref → User
  refreshTokenHash: String,    // Argon2id hash of the opaque refresh token
  deviceId:         String,    // optional device fingerprint
  issuedAt:         Date,
  expiresAt:        Date,      // TTL-indexed — auto-purges expired sessions
  revoked:          Boolean,
}
```

### PublicKeyBundle
```javascript
{
  userId:       ObjectId,    // unique, ref → User
  identityKey:  String,      // base64 Curve25519 public key
  signedPreKey: {
    keyId:      Number,
    publicKey:  String,
    signature:  String,
  },
  oneTimePreKeys: [{
    keyId:     Number,
    publicKey: String,
    used:      Boolean,      // atomically consumed on fetch
  }],
  encryptedPrivateKeyBackup: {
    ciphertext: String,      // password-encrypted private key backup
    iv:         String,
    salt:       String,
  },
  updatedAt:    Date,
}
```

### Message (Ciphertext Store)
```javascript
{
  messageId:   String,      // client-generated UUID (replay protection)
  senderId:    ObjectId,    // ref → User
  recipientId: ObjectId,    // ref → User
  ciphertext:  String,      // base64 encrypted payload ← SERVER CANNOT READ THIS
  iv:          String,      // base64 nonce (24 bytes, unique per message)
  status:      String,      // 'QUEUED' | 'DELIVERED'
  createdAt:   Date,        // TTL-indexed, expires after 365 days
}
```

---

## API Reference

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/register` | — | Create account, return JWT + refresh token |
| `POST` | `/api/auth/login` | — | Authenticate, return JWT + refresh token |
| `POST` | `/api/auth/refresh` | Refresh token | Rotate access JWT against valid session |
| `POST` | `/api/auth/logout` | JWT | Revoke current session |

### Key Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/keys/upload` | JWT | Publish/replace full public key bundle |
| `GET` | `/api/keys/:userId` | JWT | Fetch a user's key bundle |
| `GET` | `/api/keys/me` | JWT | Fetch own key info + backup status |
| `GET` | `/api/keys/backup` | JWT | Fetch own encrypted private key backup |
| `PATCH` | `/api/keys/backup` | JWT | Upload encrypted private key backup only |

### User Discovery & Friends

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/users/search?q=` | JWT | Search users by username prefix |
| `GET` | `/api/users/friends` | JWT | List accepted friends |
| `GET` | `/api/users/requests` | JWT | List incoming pending friend requests |
| `POST` | `/api/users/request/:targetId` | JWT | Send friend request |
| `POST` | `/api/users/accept/:requesterId` | JWT | Accept a friend request |
| `DELETE` | `/api/users/request/:targetId` | JWT | Reject or cancel a friend request |
| `DELETE` | `/api/users/friend/:friendId` | JWT | Remove an accepted friend (both sides) |

### Messages

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/messages/pending` | JWT | Fetch undelivered queued messages |
| `GET` | `/api/messages/history/:peerId` | JWT | Fetch full conversation history with a peer |
| `POST` | `/api/messages/ack` | JWT | Bulk-acknowledge message receipt |

---

## Socket.io Events

| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------| 
| `auth` (handshake) | Client → Server | `{ token }` | JWT verification before connection |
| `send_message` | Client → Server | `{ recipientId, messageId, ciphertext, iv }` | Submit encrypted message |
| `receive_message` | Server → Client | `{ senderId, messageId, ciphertext, iv, createdAt }` | Deliver to recipient |
| `msg_ack` | Client → Server | `{ messageId }` | Recipient confirms receipt |
| `msg_delivered` | Server → Client | `{ messageId }` | Notify sender of delivery |
| `msg_sent` | Server → Client | `{ messageId }` | Confirm server accepted message |
| `users_online` | Server → Client | `[userId, ...]` | Broadcast current online user list |
| `typing_start` / `typing_stop` | Bidirectional | `{ recipientId }` / `{ userId }` | Real-time typing indicators |
| `error_message` | Server → Client | `{ error }` | Relay error (e.g. duplicate messageId) |

---

## Security Controls

| Control | Implementation |
|---------|---------------|
| **Zero-knowledge storage** | Only ciphertext + IV stored in MongoDB; server cannot decrypt |
| **Password hashing** | Argon2id with auto-generated salt (memory-hard, timing-attack resistant) |
| **Token architecture** | Short-lived JWT (15 min) + revocable refresh token backed by DB session |
| **Replay protection** | Unique `messageId` per message with server-side dedup check |
| **Rate limiting** | Per-IP limits: auth (5/min), key upload (10/min), general API (100/min) |
| **Transport security** | All traffic over WSS/HTTPS in production |
| **CORS** | Strict origin enforcement; disabled in production (same-origin) |
| **Tamper detection** | Poly1305 MAC on every message — any modification causes `secretbox.open()` to return `null` |
| **Safety numbers** | Deterministic SHA-512 fingerprint for MITM detection |
| **Key backup encryption** | Private key backup is AES-GCM encrypted with a key derived from the user's password (PBKDF2) before upload |

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18.0
- **npm** ≥ 9.0
- **MongoDB** — Local instance or [MongoDB Atlas](https://www.mongodb.com/atlas) free tier

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/kryptus.git
cd kryptus

# ── Backend setup ──
cd server
cp .env.example .env        # Fill in MONGO_URI, JWT_SECRET, etc.
npm install

# ── Frontend setup ──
cd ../client
npm install
```

### Running in Development

Open **two terminals**:

```bash
# Terminal 1 — Backend
cd server
npm run dev                 # Nodemon on port 5000

# Terminal 2 — Frontend
cd client
npm run dev                 # Vite dev server on port 5173
```

Open `http://localhost:5173`.

### Environment Variables

**Server (`server/.env`):**
```
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb+srv://...
JWT_SECRET=<64-char random hex>
JWT_EXPIRY=15m
REFRESH_EXPIRY_DAYS=7
CLIENT_URL=http://localhost:5173
```

**Client (`client/.env`):**
```
VITE_API_URL=          # Leave empty in dev (Vite proxy handles it)
                       # Set to your server URL in production
```

### Running in Production

```bash
# 1. Build the frontend
cd client && npm run build       # Outputs to client/dist/

# 2. Start the server
cd ../server
NODE_ENV=production node src/index.js
```

---

## Deployment

Kryptus is split across two platforms:

| Service | Platform | URL |
|---------|----------|-----|
| **Frontend (React)** | Vercel | `kryptus.vercel.app` |
| **Backend (Node.js)** | Render | `your-server.onrender.com` |
| **Database** | MongoDB Atlas | Cloud cluster |

### Client — Vercel

The `client/` directory is deployed to Vercel. The `vercel.json` file configures SPA routing:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

This ensures direct navigation to `/chat` and page refreshes return `index.html` instead of 404.

Set the following environment variable in Vercel dashboard:
```
VITE_API_URL=https://your-server.onrender.com
```

### Server — Render

Set the following environment variables on Render:
```
NODE_ENV=production
PORT=5000
MONGO_URI=mongodb+srv://...
JWT_SECRET=<64-char random hex>
JWT_EXPIRY=15m
REFRESH_EXPIRY_DAYS=7
CLIENT_URL=https://kryptus.vercel.app
```

**Build command:** `npm install`  
**Start command:** `node src/index.js`

### Generate a Secure JWT Secret

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Testing

```bash
# Run backend unit + integration tests
cd server
npm test

# Manual E2EE verification
# 1. Open two browser windows (regular + incognito)
# 2. Register two accounts and send messages
# 3. Open DevTools → Network → WS frames — verify only ciphertext is transmitted
# 4. Open MongoDB Compass → Messages collection — verify all content is opaque ciphertext
# 5. Compare safety numbers on both sides — they should match exactly
```

---

## License

ISC

---

<p align="center">
  <strong>Built with 🔐 by Anmol</strong><br/>
  <em>End-to-end encryption should be the default, not the exception.</em>
</p>
