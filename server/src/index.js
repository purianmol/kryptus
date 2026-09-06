require('dotenv').config();

const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const { initializeGateway } = require('./socket/gateway');
const { authLimiter, keyUploadLimiter, apiLimiter } = require('./middleware/rateLimit');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const keyRoutes = require('./routes/keys');
const messageRoutes = require('./routes/messages');

const app = express();
const server = http.createServer(app);

const isProduction = process.env.NODE_ENV === 'production';

// ── Socket.io setup ──
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ── Middleware ──
app.set('trust proxy', 1); // Trust first proxy for correct IP logging / rate limiting
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// ── API Routes ──
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', apiLimiter, userRoutes);
app.use('/api/keys', apiLimiter, keyRoutes);
app.use('/api/messages', apiLimiter, messageRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Serve React client in production ──
// In production, the built client (vite build) is served as static files
// from ../client/dist. This means a single process serves both API and UI.
// Only enabled if SERVE_CLIENT=true is provided
if (isProduction && process.env.SERVE_CLIENT === 'true') {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));

  // SPA fallback — serve index.html for any non-API route
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    }
  });
}

// ── Global error handler ──
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ── Start server ──
const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();
  initializeGateway(io);

  server.listen(PORT, () => {
    console.log(`\n🔐 Kryptus Server running on port ${PORT}`);
    console.log(`   Mode:      ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    console.log(`   REST API:  http://localhost:${PORT}/api`);
    console.log(`   Socket.io: ws://localhost:${PORT}`);
    if (isProduction) {
      console.log(`   Client:    http://localhost:${PORT}\n`);
    }
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { app, server, io };
