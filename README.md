<p align="center">
  <img src="https://img.shields.io/badge/Node.js-v18+-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/MongoDB-Atlas-47A248?style=flat-square&logo=mongodb&logoColor=white" />
  <img src="https://img.shields.io/badge/Socket.io-4.x-010101?style=flat-square&logo=socket.io&logoColor=white" />
  <img src="https://img.shields.io/badge/Encryption-Curve25519-blueviolet?style=flat-square" />
</p>

# 🔐 Kryptus

> A full-stack **end-to-end encrypted** (E2EE) messaging application where the **server never sees plaintext**. All encryption and decryption occurs exclusively on the client using Curve25519 key exchange and XSalsa20-Poly1305 authenticated encryption.

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
- [Demo Walkthrough](#demo-walkthrough)
- [Future Roadmap](#future-roadmap)
- [License](#license)

---

## Why Kryptus?

Most messaging backends have full access to every message ever sent. **Kryptus inverts that trust model** — the server is a *blind relay* that stores and forwards opaque ciphertext. Even a compromised server or database dump reveals **zero** plaintext content.

**Core guarantees:**

| # | Guarantee | How |
|---|-----------|-----|
| 1 | **Confidentiality** — Only sender and recipient can read messages | Curve25519 ECDH + XSalsa20-Poly1305 AEAD |
| 2 | **Integrity** — Tampered ciphertext is rejected | Poly1305 MAC verification on every decrypt |
| 3 | **Real-time delivery** — Messages arrive instantly when online | Socket.io WebSocket transport |
| 4 | **Store-and-forward + Sync** | Offline users receive messages, full history syncs to new devices | MongoDB history storage |
| 5 | **Explicit Retention Policy** | E2EE contents are secure, but encrypted metadata is kept for 1 year | 365-day TTL index on Messages |

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (React)                                  │
│  ┌─────────────┐  ┌────────────────┐  ┌────────────────┐                    │
│  │ AuthContext  │  │ CryptoContext  │  │ SocketContext  │                    │
│  │ JWT session  │  │ Key gen/store  │  │ Real-time msg  │                    │
│  │ management   │  │ Encrypt/Decrypt│  │ relay          │                    │
│  └──────┬───────┘  └───────┬────────┘  └───────┬────────┘                    │
│         │                  │                    │                             │
│         │          ┌───────▼────────┐           │                             │
│         │          │  crypto.js     │           │                             │
│         │          │  tweetnacl     │           │                             │
│         │          │  (Curve25519 + │           │                             │
│         │          │   XSalsa20)    │           │                             │
│         │          └────────────────┘           │                             │
└─────────┼──────────────────────────────────────┼─────────────────────────────┘
          │ HTTPS (REST)                          │ WSS (Socket.io)
          │                                       │
┌─────────▼───────────────────────────────────────▼─────────────────────────────┐
│                           SERVER (Node.js)                                    │
│                                                                               │
│  ┌───────────────────────────┐    ┌──────────────────────────────────────┐    │
│  │     Express REST API      │    │       Socket.io Gateway              │    │
│  │                           │    │                                      │    │
│  │  POST /api/auth/register  │    │  JWT handshake authentication       │    │
│  │  POST /api/auth/login     │    │  Connection registry (userId→sid)   │    │
│  │  POST /api/auth/refresh   │    │  send_message → relay/queue         │    │
│  │  POST /api/auth/logout    │    │  msg_ack → mark DELIVERED           │    │
│  │  POST /api/keys/upload    │    │  Flush QUEUED on reconnect          │    │
│  │  GET  /api/keys/:userId   │    │  Online/offline broadcast           │    │
│  │  GET  /api/users/search   │    │  Typing indicators                  │    │
│  │  GET  /api/users/friends  │    │                                      │    │
│  │  POST /api/users/request  │    │  ┌──────────────────────────────┐   │    │
│  │  GET  /api/messages/pend  │    │  │  Map<userId, socketId>       │   │    │
│  │                           │    │  │  In-memory connection reg.   │   │    │
│  └───────────┬───────────────┘    │  └──────────────────────────────┘   │    │
│              │                    └──────────────────┬───────────────────┘    │
│              │                                       │                        │
│              └───────────────────┬───────────────────┘                        │
│                                  │                                            │
│                      ┌───────────▼──────────────┐                             │
│                      │       MongoDB             │                             │
│                      │  (Mongoose ODM)           │                             │
│                      │                           │                             │
│                      │  Users        Sessions    │                             │
│                      │  PublicKeys   Messages    │                             │
│                      │  (ciphertext) (ciphertext)│                             │
│                      └───────────────────────────┘                             │
│                                                                               │
│  ⚠️  The server NEVER receives plaintext or private keys.                     │
│      Messages collection contains only opaque ciphertext + IV.               │
│      Encrypted history is retained for 365 days to allow cross-device sync.  │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## E2EE Encryption & Decryption — Deep Dive

This section explains **exactly** how Kryptus achieves end-to-end encryption, from key generation through message delivery. The server is provably unable to read any message.

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

The client also generates:
- **Signed Pre-Key** — A secondary Curve25519 key pair (for future X3DH support)
- **One-Time Pre-Keys** — A batch of 10 ephemeral key pairs (for forward secrecy)

**What gets uploaded to the server:**
```json
{
  "identityKey": "base64(publicKey)",
  "signedPreKey": { "keyId": 1, "publicKey": "...", "signature": "..." },
  "oneTimePreKeys": [{ "keyId": 1, "publicKey": "..." }, ...]
}
```

**What stays on the client (localStorage):**
```json
{
  "identityKey": { "publicKey": "...", "secretKey": "..." },
  "signedPreKey": { "keyId": 1, "publicKey": "...", "secretKey": "..." },
  "oneTimePreKeys": [{ "keyId": 1, "publicKey": "...", "secretKey": "..." }, ...]
}
```

> **Critical invariant:** Private keys **never** leave the client. The server only stores public keys.

### 2. Key Exchange (Diffie-Hellman)

When Alice wants to message Bob, the client performs an **Elliptic Curve Diffie-Hellman (ECDH)** key exchange to derive a shared secret:

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

**Why this works:** The Diffie-Hellman property of Curve25519 guarantees that `a × B = b × A` (scalar multiplication is commutative). The server sees both public keys but **cannot compute the shared secret** without either private key.

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

**What the server sees / stores:**
```json
{
  "messageId": "uuid-v4",
  "senderId": "ObjectId",
  "recipientId": "ObjectId",
  "ciphertext": "kWeQ3P0f7gZ5a2...",       ← Opaque encrypted blob
  "iv": "Rm5kX2FiY2Rl...",                 ← Nonce (safe to be public)
  "status": "QUEUED"
}
```

> The server **cannot distinguish** a "Hello" message from a 500-word essay — it sees only random-looking bytes.

### 4. Multi-Device Sync & Retention Policy

Because Kryptus uses **Diffie-Hellman Key Exchange**, the shared secret between sender and recipient is identical. This enables a powerful feature: **Multi-Device History Sync**.
- The server permanently stores the encrypted ciphertext for **365 days**.
- When you log into a new device (and restore your private keys with your password), the app fetches your entire encrypted chat history.
- Both sent and received messages decrypt perfectly using the identical shared secret.
- **Privacy Trade-off:** While your message *contents* are perfectly protected by E2EE, the server retains *metadata* (who you messaged, when, and how much ciphertext) for a year. This is a standard trade-off to provide a seamless modern chat experience across devices.

### 5. Message Decryption

The recipient derives the **same shared secret** (ECDH is symmetric) and decrypts:

```javascript
// crypto.js — Decryption
function decryptMessage(ciphertextB64, ivB64, sharedSecret) {
  const plaintext = nacl.secretbox.open(
    decodeBase64(ciphertextB64),          // Ciphertext bytes
    decodeBase64(ivB64),                  // Nonce
    decodeBase64(sharedSecret)            // Same 32-byte shared secret
  );

  if (!plaintext) {
    // Poly1305 MAC verification failed → tampered or wrong key
    return null;
  }
  return encodeUTF8(plaintext);
}
```

**Tamper detection:** If even a single bit of the ciphertext is modified, `secretbox.open()` returns `null` — the Poly1305 MAC ensures integrity.

### 6. Message Flow Diagram

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

### 7. Safety Number Verification

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

If a man-in-the-middle replaces a public key, the safety numbers will **not match**, and users will know the channel is compromised.

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Runtime** | Node.js 18+ | Event-loop model suits I/O-bound chat workload |
| **API Framework** | Express.js 4.x | Mature REST framework for auth/keys/history endpoints |
| **Real-time Transport** | Socket.io 4.x | WebSocket + fallback, built-in heartbeats & reconnection |
| **Database** | MongoDB + Mongoose 8.x | Flexible schema, high write throughput for message storage |
| **Auth** | JWT (access) + opaque refresh token | Short-lived stateless access, revocable session-backed refresh |
| **Password Hashing** | Argon2id | Memory-hard, winner of the Password Hashing Competition |
| **Client Crypto** | tweetnacl (Curve25519 + XSalsa20-Poly1305) | Audited, zero-dependency, 7KB AEAD crypto library |
| **Frontend** | React 19 + Vite 8 | Fast HMR, modern build tooling, concurrent features |
| **Styling** | Vanilla CSS (dark mode, glassmorphism) | No framework dependencies, full design control |

---

## Project Structure

```
kryptus/
├── server/                              # Backend (Node.js + Express + Socket.io)
│   ├── src/
│   │   ├── index.js                     # Server entry — Express + Socket.io + static serve
│   │   ├── config/
│   │   │   └── db.js                    # Mongoose connection with retry logic
│   │   ├── models/
│   │   │   ├── User.js                  # User schema (username, passwordHash, friends)
│   │   │   ├── Session.js               # Refresh token sessions (TTL-indexed)
│   │   │   ├── PublicKeyBundle.js        # Public key bundles (identity + pre-keys)
│   │   │   └── Message.js               # Ciphertext store (QUEUED → DELIVERED)
│   │   ├── routes/
│   │   │   ├── auth.js                  # Register, login, refresh, logout
│   │   │   ├── keys.js                  # Key bundle upload / fetch
│   │   │   ├── messages.js              # Pending message fetch + ACK
│   │   │   └── users.js                 # User search, friend requests, friends list
│   │   ├── middleware/
│   │   │   ├── authenticate.js          # JWT verification middleware
│   │   │   └── rateLimit.js             # express-rate-limit configs
│   │   └── socket/
│   │       └── gateway.js               # Socket.io event handlers + connection registry
│   ├── tests/
│   │   ├── auth.test.js                 # Auth endpoint tests
│   │   └── socket.test.js               # Socket integration tests
│   ├── .env.example                     # Environment template
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
│   │   │   └── SocketContext.jsx        # Socket.io connection, event listeners
│   │   ├── services/
│   │   │   ├── api.js                   # REST API client (fetch wrapper + auto-refresh)
│   │   │   └── crypto.js               # tweetnacl crypto operations (pure functions)
│   │   ├── pages/
│   │   │   ├── Login.jsx                # Login form with glassmorphic design
│   │   │   ├── Register.jsx             # Registration with password strength indicator
│   │   │   └── Chat.jsx                 # Main chat page (sidebar + messages + input)
│   │   └── components/
│   │       ├── ContactList.jsx          # Friend list with online/offline status dots
│   │       ├── MessageList.jsx          # Signal-style message bubbles with delivery ticks
│   │       ├── MessageInput.jsx         # Compose area with Enter-to-send
│   │       ├── AddFriendPanel.jsx       # User search + friend request management
│   │       └── SafetyNumber.jsx         # Fingerprint verification modal
│   ├── vite.config.js
│   ├── index.html
│   └── package.json
│
├── E2EE_Chat_App_Spec_Sheet.md          # Technical specification document
├── Component_Specs.md                   # Component spec & implementation plan
├── Interview_Defense_Guide.md           # Interview Q&A preparation
├── .gitignore
└── README.md                            # ← You are here
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
    initiator:  Boolean,   // who sent the request
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
    signature:  String,      // hash-based signature (Ed25519 in production)
  },
  oneTimePreKeys: [{
    keyId:     Number,
    publicKey: String,
    used:      Boolean,      // atomically consumed on fetch
  }],
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
  createdAt:   Date,
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
| `POST` | `/api/keys/upload` | JWT | Publish/replace public key bundle |
| `GET` | `/api/keys/:userId` | JWT | Fetch user's key bundle (consumes a one-time pre-key) |

### User Discovery & Friends

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/users/search?q=` | JWT | Search users by username |
| `GET` | `/api/users/friends` | JWT | List accepted friends |
| `GET` | `/api/users/requests` | JWT | List pending incoming friend requests |
| `POST` | `/api/users/request/:targetId` | JWT | Send friend request |
| `POST` | `/api/users/accept/:requesterId` | JWT | Accept friend request |
| `DELETE` | `/api/users/request/:targetId` | JWT | Reject/cancel friend request |

### Messages

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/messages/pending` | JWT | Fetch queued (undelivered) messages |

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
| `users_online` | Server → Client | `[userId, ...]` | Broadcast online user list |
| `typing_start` / `typing_stop` | Bidirectional | `{ recipientId }` / `{ userId }` | Real-time typing indicators |

---

## Security Controls

| Control | Implementation |
|---------|---------------|
| **Zero-knowledge storage** | Only ciphertext + IV stored in MongoDB; server cannot decrypt |
| **Password hashing** | Argon2id with auto-generated salt (memory-hard, timing-attack resistant) |
| **Token architecture** | Short-lived JWT (15min) + revocable refresh session |
| **Replay protection** | Unique `messageId` per message with server-side dedup |
| **Rate limiting** | Per-IP limits on auth (5/min), key upload (10/min), API (100/min) |
| **Transport security** | All traffic over WSS/HTTPS in production |
| **CORS** | Strict origin enforcement, disabled in production (same-origin) |
| **Tamper detection** | Poly1305 MAC on every message — modified ciphertext is rejected |
| **Safety numbers** | Deterministic fingerprint comparison for MITM detection |

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
cp .env.example .env            # Edit .env with your MongoDB URI + JWT secret
npm install

# ── Frontend setup ──
cd ../client
npm install
```

### Running in Development

Open **two terminals**:

```bash
# Terminal 1 — Start the backend
cd server
npm run dev                     # Starts on port 5000 with nodemon hot-reload

# Terminal 2 — Start the frontend
cd client
npm run dev                     # Starts Vite dev server on port 5173
```

Open `http://localhost:5173` in your browser.

### Running in Production

```bash
# 1. Build the React frontend
cd client
npm run build                   # Outputs to client/dist/

# 2. Start the production server
cd ../server
NODE_ENV=production node src/index.js
```

The server serves both the API and the built React app from a single process on port 5000.

---

## Deployment

### Deploy to Render / Railway / Fly.io

1. **Set environment variables** on your hosting platform:
   ```
   NODE_ENV=production
   PORT=5000
   MONGO_URI=mongodb+srv://...
   JWT_SECRET=<64-char random hex>
   JWT_EXPIRY=15m
   REFRESH_EXPIRY_DAYS=7
   ```

2. **Build command:** `cd client && npm install && npm run build && cd ../server && npm install`

3. **Start command:** `cd server && node src/index.js`

4. The server auto-detects `NODE_ENV=production` and:
   - Serves the React build from `client/dist/`
   - Disables CORS (same-origin)
   - Handles SPA routing (serves `index.html` for all non-API routes)

### Generate a Secure JWT Secret

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Demo Walkthrough

> This is how you can demonstrate Kryptus in an interview:

1. **Open two browser windows** — regular + incognito (so they have separate `localStorage`)
2. **Register "Alice"** in Window 1, **Register "Bob"** in Window 2
3. In Alice's window, click ➕ → search "Bob" → click **Add** → Bob accepts the request in his window
4. **Alice sends "Hello Bob!"** — show it appears instantly in Bob's window with ✓✓ delivery ticks
5. **Open DevTools → Network tab** — show the WebSocket frame contains only `ciphertext` + `iv`, **never plaintext**
6. **Open MongoDB Compass** — show the Messages collection contains only opaque ciphertext
7. **Close Bob's window** → Alice sends "Are you there?" → **Reopen Bob's window** → message appears (store-and-forward)
8. **Click the 🛡️ shield icon** → show matching safety numbers on both sides
9. Walk through the architecture diagram from this README

---

## Future Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| Phase 1 | Core E2EE messaging, auth, key exchange | ✅ Complete |
| Phase 1 | Friend request system | ✅ Complete |
| Phase 1 | Cross-device history sync (1-year retention) | ✅ Complete |
| Phase 1 | Safety number verification | ✅ Complete |
| Phase 2 | Redis Pub/Sub for multi-instance Socket.io | 🔲 Planned |
| Phase 3 | Group chat (Sender Keys protocol) | 🔲 Planned |
| Phase 3 | Push notifications for offline mobile clients | 🔲 Planned |
| Phase 3 | Double Ratchet (Signal Protocol) for forward secrecy | 🔲 Planned |

---

## Testing

```bash
# Run backend unit + integration tests
cd server
npm test

# Manual E2EE verification
# 1. Open MongoDB Compass → inspect Messages collection
# 2. Verify all message content is opaque ciphertext (not plaintext)
# 3. Compare safety numbers between two users — they should match
```

---

## License

ISC

---

<p align="center">
  <strong>Built with 🔐 by Anmol</strong><br/>
  <em>End-to-end encryption should be the default, not the exception.</em>
</p>
