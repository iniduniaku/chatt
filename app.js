const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { readJSON, writeJSON, getFilePath } = require('./utils/fileDB');
const authMiddleware = require('./utils/jwtMiddleware');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
// Serve file statis (frontend) dari folder public
app.use(express.static(path.join(__dirname, 'public')));

// Atur root agar buka index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});
// File paths
const USERS_FILE = getFilePath('users');
const MESSAGES_FILE = getFilePath('messages');
const LAST_SEEN_FILE = getFilePath('last_seen');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// Inisialisasi file JSON jika belum ada
[USERS_FILE, MESSAGES_FILE, LAST_SEEN_FILE].forEach(file => {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, file.endsWith('.json') ? '{}' : '[]');
  }
});

// Multer setup untuk upload media
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
const upload = multer({ storage });

app.post('/upload', authMiddleware, upload.single('media'), (req, res) => {
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Auth routes
app.use('/auth', require('./routes/authRoutes'));

// Search user
app.get('/users/search', authMiddleware, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const users = readJSON(USERS_FILE);
  const results = users
    .filter(u => u.username.toLowerCase().includes(q) && u.username !== req.user.username)
    .map(u => ({ id: u.id, username: u.username }));
  res.json(results);
});

// Socket.IO auth
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
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

  socket.on('dm:join', (otherUser, cb) => {
    const roomId = getRoomId(username, otherUser);
    socket.join(roomId);
    const messages = readJSON(MESSAGES_FILE)[roomId] || [];
    cb({ roomId, messages });
  });

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
      readBy: [username],
      deletedFor: []
    };
    messages[roomId].push(message);
    writeJSON(MESSAGES_FILE, messages);

    io.to(roomId).emit('dm:message', message);
    cb({ success: true, message });
  });

  socket.on('dm:delete', ({ roomId, messageId, forEveryone }, cb) => {
    const messages = readJSON(MESSAGES_FILE);
    if (!messages[roomId]) return cb({ success: false, error: 'Room not found' });

    let updated = false;

    messages[roomId] = messages[roomId].map(msg => {
      if (msg.id === messageId) {
        if (forEveryone && msg.from === username) {
          updated = true;
          return null;
        } else {
          if (!msg.deletedFor.includes(username)) {
            msg.deletedFor.push(username);
            updated = true;
          }
        }
      }
      return msg;
    }).filter(Boolean);

    if (updated) {
      writeJSON(MESSAGES_FILE, messages);
      io.to(roomId).emit('dm:delete', { messageId, by: username, forEveryone });
      cb({ success: true });
    } else {
      cb({ success: false, error: 'Message not found or not allowed' });
    }
  });

  // WebRTC signaling for voice & video
  socket.on('call:offer', ({ to, offer }) => {
    io.to(getRoomId(username, to)).emit('call:offer', { from: username, offer });
  });

  socket.on('call:answer', ({ to, answer }) => {
    io.to(getRoomId(username, to)).emit('call:answer', { from: username, answer });
  });

  socket.on('call:candidate', ({ to, candidate }) => {
    io.to(getRoomId(username, to)).emit('call:candidate', { from: username, candidate });
  });

  socket.on('video:offer', ({ to, offer }) => {
    io.to(getRoomId(username, to)).emit('video:offer', { from: username, offer });
  });

  socket.on('video:answer', ({ to, answer }) => {
    io.to(getRoomId(username, to)).emit('video:answer', { from: username, answer });
  });

  socket.on('video:candidate', ({ to, candidate }) => {
    io.to(getRoomId(username, to)).emit('video:candidate', { from: username, candidate });
  });

  socket.on('disconnect', () => {
    const lastSeen = readJSON(LAST_SEEN_FILE);
    lastSeen[username] = Date.now();
    writeJSON(LAST_SEEN_FILE, lastSeen);
  });
});

// ✅ Server listen
const PORT = process.env.PORT || 80;
server.listen(PORT, () => {
  console.log(`✅ Chat server running on http://localhost:${PORT}`);
});
