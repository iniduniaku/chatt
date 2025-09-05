// app.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const webpush = require('web-push');
const { readJSON, writeJSON, getFilePath } = require('./utils/fileDB');
const authMiddleware = require('./utils/jwtMiddleware');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// ==== File JSON ====
const USERS_FILE = getFilePath('users');
const MESSAGES_FILE = getFilePath('messages');
const LAST_SEEN_FILE = getFilePath('last_seen');
const SUBSCRIBERS_FILE = getFilePath('subscribers');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

const defaults = {
  [USERS_FILE]: [],
  [MESSAGES_FILE]: {},
  [LAST_SEEN_FILE]: {},
  [SUBSCRIBERS_FILE]: {}
};

Object.entries(defaults).forEach(([file, def]) => {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(def, null, 2));
  }
});

// ==== Multer setup ====
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public/uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// ==== Routes ====
app.post('/upload', authMiddleware, upload.single('media'), (req, res) => {
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.use('/auth', require('./routes/authRoutes'));

app.get('/users/search', authMiddleware, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const users = readJSON(USERS_FILE);
  const results = users
    .filter(u => u.username.toLowerCase().includes(q) && u.username !== req.user.username)
    .map(u => ({ id: u.id, username: u.username }));
  res.json(results);
});

// ==== Push Notification ====
webpush.setVapidDetails(
  'mailto:you@example.com',
  process.env.VAPID_PUBLIC_KEY || '',
  process.env.VAPID_PRIVATE_KEY || ''
);

app.post('/subscribe', authMiddleware, (req, res) => {
  const subs = readJSON(SUBSCRIBERS_FILE);
  subs[req.user.username] = req.body;
  writeJSON(SUBSCRIBERS_FILE, subs);
  res.json({ success: true });
});

// ==== Socket.IO ====
function getRoomId(u1, u2) {
  return ['dm', [u1, u2].sort().join('::')].join(':');
}

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const { username } = socket.user;

  // Join DM room
  socket.on('dm:join', (otherUser, cb) => {
    const roomId = getRoomId(username, otherUser);
    socket.join(roomId);
    const messages = readJSON(MESSAGES_FILE)[roomId] || [];
    cb({ roomId, messages });
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
      readBy: [username],
      deletedFor: []
    };
    messages[roomId].push(message);
    writeJSON(MESSAGES_FILE, messages);

    io.to(roomId).emit('dm:message', message);

    // Push notification
    const subs = readJSON(SUBSCRIBERS_FILE);
    const recipientSub = subs[to];
    if (recipientSub) {
      webpush.sendNotification(recipientSub, JSON.stringify({
        title: `Pesan baru dari ${username}`,
        body: text || 'Media diterima'
      }))
      .catch(err => {
        console.error('Push error:', err);
        // Hapus subscription kalau invalid
        delete subs[to];
        writeJSON(SUBSCRIBERS_FILE, subs);
      });
    }

    cb({ success: true, message });
  });

  // Delete message
  socket.on('dm:delete', ({ roomId, messageId, forEveryone }, cb) => {
    const messages = readJSON(MESSAGES_FILE);
    if (!messages[roomId]) return cb({ success: false, error: 'Room not found' });

    let updated = false;

    messages[roomId] = messages[roomId].map(msg => {
      if (msg.id === messageId) {
        if (forEveryone && msg.from === username) {
          updated = true;
          return null; // hapus untuk semua
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
      cb({ success: false, error: 'Message not found' });
    }
  });
});

// ==== Start Server ====
const PORT = process.env.PORT || 80;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
