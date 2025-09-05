// server-1on1.js
// Express + Socket.IO private chat server with signup/login (no default users)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const LAST_SEEN_FILE = path.join(DATA_DIR, 'last_seen.json');

if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '{}');
if (!fs.existsSync(LAST_SEEN_FILE)) fs.writeFileSync(LAST_SEEN_FILE, '{}');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public/uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Auth middleware
function authMiddleware(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: 'No token' });
  const token = auth.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Signup
app.post('/auth/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  const users = readJSON(USERS_FILE);
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'User exists' });
  }

  const hashed = await bcrypt.hash(password, 10);
  const user = { id: Date.now().toString(), username, password: hashed };
  users.push(user);
  writeJSON(USERS_FILE, users);

  res.json({ success: true });
});

// Login
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.username === username);
  if (!user) return res.status(400).json({ error: 'User not found' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

// Search user
app.get('/users/search', authMiddleware, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const users = readJSON(USERS_FILE);
  const results = users
    .filter(u => u.username.toLowerCase().includes(q) && u.username !== req.user.username)
    .map(u => ({ id: u.id, username: u.username }));
  res.json(results);
});

// Upload media
app.post('/upload', authMiddleware, upload.single('media'), (req, res) => {
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Socket.IO auth
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('No token'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

function getRoomId(u1, u2) {
  return ['dm', [u1, u2].sort().join('::')].join(':');
}

io.on('connection', (socket) => {
  const { username } = socket.user;
  console.log(`${username} connected`);

  // Join DM
  socket.on('dm:join', (otherUser, cb) => {
    const roomId = getRoomId(username, otherUser);
    socket.join(roomId);
    const messages = readJSON(MESSAGES_FILE)[roomId] || [];
    cb({ roomId, messages });
  });

  // Leave DM
  socket.on('dm:leave', (otherUser) => {
    const roomId = getRoomId(username, otherUser);
    socket.leave(roomId);
  });

  // Send message
  socket.on('dm:message', ({ to, text, media }, cb) => {
    const roomId = getRoomId(username, to);
    const messages = readJSON(MESSAGES_FILE);
    if (!messages[roomId]) messages[roomId] = [];

    const message = {
      id: Date.now().toString(),
      from: username,
      to,
      text,
      media,
      timestamp: Date.now(),
      readBy: [username]
    };
    messages[roomId].push(message);
    writeJSON(MESSAGES_FILE, messages);

    io.to(roomId).emit('dm:message', message);
    if (cb) cb({ success: true, message });
  });

  // Typing
  socket.on('dm:typing', ({ to, typing }) => {
    const roomId = getRoomId(username, to);
    socket.to(roomId).emit('dm:typing', { from: username, typing });
  });

  // Read receipts
  socket.on('dm:read', ({ roomId, messageIds }) => {
    const messages = readJSON(MESSAGES_FILE);
    if (!messages[roomId]) return;

    messages[roomId] = messages[roomId].map(m => {
      if (messageIds.includes(m.id) && !m.readBy.includes(username)) {
        m.readBy.push(username);
      }
      return m;
    });
    writeJSON(MESSAGES_FILE, messages);
    io.to(roomId).emit('dm:read', { user: username, messageIds });
  });

  socket.on('disconnect', () => {
    console.log(`${username} disconnected`);
    const lastSeen = readJSON(LAST_SEEN_FILE);
    lastSeen[username] = Date.now();
    writeJSON(LAST_SEEN_FILE, lastSeen);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
