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
const io = new Server(server, { 
  cors: { 
    origin: '*',
    methods: ['GET', 'POST']
  } 
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// File paths
const USERS_FILE = getFilePath('users');
const MESSAGES_FILE = getFilePath('messages');
const LAST_SEEN_FILE = getFilePath('last_seen');
const CHAT_ROOMS_FILE = getFilePath('chat_rooms');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// Initialize JSON files
console.log('Initializing database files...');
if (!fs.existsSync(USERS_FILE)) {
  writeJSON(USERS_FILE, []);
  console.log('✅ Users file created');
}
if (!fs.existsSync(MESSAGES_FILE)) {
  writeJSON(MESSAGES_FILE, {});
  console.log('✅ Messages file created');
}
if (!fs.existsSync(LAST_SEEN_FILE)) {
  writeJSON(LAST_SEEN_FILE, {});
  console.log('✅ Last seen file created');
}
if (!fs.existsSync(CHAT_ROOMS_FILE)) {
  writeJSON(CHAT_ROOMS_FILE, {});
  console.log('✅ Chat rooms file created');
}

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  // Allow images, videos, and audio files
  const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|mp3|wav|ogg|webm/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only images, videos, and audio files are allowed!'));
  }
};

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: fileFilter
});

// File upload endpoint
app.post('/upload', authMiddleware, upload.single('media'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    console.log(`✅ File uploaded: ${fileUrl}`);
    
    res.json({ 
      url: fileUrl,
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Auth routes
app.use('/auth', require('./routes/authRoutes'));

// User search endpoint
app.get('/users/search', authMiddleware, (req, res) => {
  try {
    const query = (req.query.q || '').toLowerCase().trim();
    
    if (query.length < 1) {
      return res.json([]);
    }

    const users = readJSON(USERS_FILE);
    const results = users
      .filter(user => 
        user.username.toLowerCase().includes(query) && 
        user.username !== req.user.username
      )
      .map(user => ({
        id: user.id,
        username: user.username
      }))
      .slice(0, 10); // Limit results

    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get user's chat list
app.get('/chats', authMiddleware, (req, res) => {
  try {
    const username = req.user.username;
    const messages = readJSON(MESSAGES_FILE);
    const lastSeen = readJSON(LAST_SEEN_FILE);
    
    const chatList = {};
    
    // Find all rooms user is part of
    Object.keys(messages).forEach(roomId => {
      if (roomId.includes(username)) {
        const roomMessages = messages[roomId];
        if (roomMessages && roomMessages.length > 0) {
          const lastMessage = roomMessages[roomMessages.length - 1];
          const otherUser = roomId.replace('dm:', '').split('::').find(u => u !== username);
          
          if (otherUser) {
            chatList[otherUser] = {
              lastMessage: lastMessage.text || 'Media',
              timestamp: lastMessage.timestamp,
              unread: 0 // Can be calculated based on readBy
            };
          }
        }
      }
    });
    
    res.json(chatList);
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Failed to get chats' });
  }
});

// Socket.IO authentication middleware
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('No token provided'));
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    console.log(`✅ User ${decoded.username} connected`);
    next();
  } catch (error) {
    console.error('Socket auth error:', error);
    next(new Error('Invalid token'));
  }
});

// Utility function to generate room ID
function getRoomId(user1, user2) {
  const sortedUsers = [user1, user2].sort();
  return `dm:${sortedUsers.join('::')}`;
}

// Active users tracking
const activeUsers = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
  const { username, id } = socket.user;
  
  // Track active user
  activeUsers.set(username, {
    socketId: socket.id,
    lastSeen: Date.now(),
    status: 'online'
  });

  // Broadcast user online status
  socket.broadcast.emit('user:status', {
    username: username,
    status: 'online',
    lastSeen: Date.now()
  });

  // Handle joining DM room
  socket.on('dm:join', (otherUser, callback) => {
    try {
      const roomId = getRoomId(username, otherUser);
      socket.join(roomId);
      
      const messages = readJSON(MESSAGES_FILE);
      const roomMessages = messages[roomId] || [];
      
      // Filter out deleted messages for this user
      const filteredMessages = roomMessages.filter(msg => 
        !msg.deletedFor || !msg.deletedFor.includes(username)
      );
      
      console.log(`✅ ${username} joined room: ${roomId}`);
      
      if (callback) {
        callback({ 
          success: true,
          roomId: roomId, 
          messages: filteredMessages 
        });
      }
    } catch (error) {
      console.error('Join room error:', error);
      if (callback) {
        callback({ success: false, error: 'Failed to join room' });
      }
    }
  });

  // Handle sending messages
  socket.on('dm:message', (messageData, callback) => {
    try {
      const { to, text, media } = messageData;
      
      if (!to || (!text && !media)) {
        if (callback) callback({ success: false, error: 'Invalid message data' });
        return;
      }

      const roomId = getRoomId(username, to);
      const messages = readJSON(MESSAGES_FILE);
      
      if (!messages[roomId]) {
        messages[roomId] = [];
      }

      const message = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        from: username,
        to: to,
        text: text || '',
        media: media || null,
        timestamp: Date.now(),
        readBy: [username],
        deletedFor: []
      };

      messages[roomId].push(message);
      writeJSON(MESSAGES_FILE, messages);

      // Emit to all users in the room
      io.to(roomId).emit('dm:message', message);
      
      // Notify the recipient if they're online
      const recipientUser = activeUsers.get(to);
      if (recipientUser) {
        io.to(recipientUser.socketId).emit('notification:message', {
          from: username,
          message: text || 'Media',
          timestamp: message.timestamp
        });
      }

      console.log(`✅ Message sent from ${username} to ${to}`);
      
      if (callback) {
        callback({ success: true, message });
      }
    } catch (error) {
      console.error('Send message error:', error);
      if (callback) {
        callback({ success: false, error: 'Failed to send message' });
      }
    }
  });

  // Handle message deletion
  socket.on('dm:delete', (deleteData, callback) => {
    try {
      const { roomId, messageId, forEveryone } = deleteData;
      const messages = readJSON(MESSAGES_FILE);
      
      if (!messages[roomId]) {
        if (callback) callback({ success: false, error: 'Room not found' });
        return;
      }

      let messageFound = false;
      let messageIndex = -1;

      messages[roomId].forEach((msg, index) => {
        if (msg.id === messageId) {
          messageFound = true;
          messageIndex = index;
          
          if (forEveryone && msg.from === username) {
            // Delete for everyone - remove the message completely
            messages[roomId].splice(index, 1);
          } else {
            // Delete for me only
            if (!msg.deletedFor) msg.deletedFor = [];
            if (!msg.deletedFor.includes(username)) {
              msg.deletedFor.push(username);
            }
          }
        }
      });

      if (messageFound) {
        writeJSON(MESSAGES_FILE, messages);
        
        // Notify all users in the room
        io.to(roomId).emit('dm:delete', {
          messageId: messageId,
          by: username,
          forEveryone: forEveryone
        });

        console.log(`✅ Message ${messageId} deleted by ${username}`);
        
        if (callback) {
          callback({ success: true });
        }
      } else {
        if (callback) {
          callback({ success: false, error: 'Message not found' });
        }
      }
    } catch (error) {
      console.error('Delete message error:', error);
      if (callback) {
        callback({ success: false, error: 'Failed to delete message' });
      }
    }
  });

  // Handle typing indicators
  socket.on('typing:start', (data) => {
    const roomId = getRoomId(username, data.to);
    socket.to(roomId).emit('typing:start', { from: username });
  });

  socket.on('typing:stop', (data) => {
    const roomId = getRoomId(username, data.to);
    socket.to(roomId).emit('typing:stop', { from: username });
  });

  // WebRTC signaling for voice calls
  socket.on('call:offer', (data) => {
    const { to, offer } = data;
    const recipientUser = activeUsers.get(to);
    
    if (recipientUser) {
      io.to(recipientUser.socketId).emit('call:offer', {
        from: username,
        offer: offer
      });
      console.log(`📞 Voice call offer from ${username} to ${to}`);
    }
  });

  socket.on('call:answer', (data) => {
    const { to, answer } = data;
    const recipientUser = activeUsers.get(to);
    
    if (recipientUser) {
      io.to(recipientUser.socketId).emit('call:answer', {
        from: username,
        answer: answer
      });
      console.log(`📞 Voice call answered by ${username} to ${to}`);
    }
  });

  socket.on('call:candidate', (data) => {
    const { to, candidate } = data;
    const recipientUser = activeUsers.get(to);
    
    if (recipientUser) {
      io.to(recipientUser.socketId).emit('call:candidate', {
        from: username,
        candidate: candidate
      });
    }
  });

  socket.on('call:end', (data) => {
    const { to } = data;
    const recipientUser = activeUsers.get(to);
    
    if (recipientUser) {
      io.to(recipientUser.socketId).emit('call:end', {
        from: username
      });
      console.log(`📞 Call ended by ${username}`);
    }
  });

  // WebRTC signaling for video calls
  socket.on('video:offer', (data) => {
    const { to, offer } = data;
    const recipientUser = activeUsers.get(to);
    
    if (recipientUser) {
      io.to(recipientUser.socketId).emit('video:offer', {
        from: username,
        offer: offer
      });
      console.log(`📹 Video call offer from ${username} to ${to}`);
    }
  });

  socket.on('video:answer', (data) => {
    const { to, answer } = data;
    const recipientUser = activeUsers.get(to);
    
    if (recipientUser) {
      io.to(recipientUser.socketId).emit('video:answer', {
        from: username,
        answer: answer
      });
      console.log(`📹 Video call answered by ${username} to ${to}`);
    }
  });

  socket.on('video:candidate', (data) => {
    const { to, candidate } = data;
    const recipientUser = activeUsers.get(to);
    
    if (recipientUser) {
      io.to(recipientUser.socketId).emit('video:candidate', {
        from: username,
        candidate: candidate
      });
    }
  });

  socket.on('video:end', (data) => {
    const { to } = data;
    const recipientUser = activeUsers.get(to);
    
    if (recipientUser) {
      io.to(recipientUser.socketId).emit('video:end', {
        from: username
      });
      console.log(`📹 Video call ended by ${username}`);
    }
  });

  // Handle user status updates
  socket.on('user:status', (status) => {
    const user = activeUsers.get(username);
    if (user) {
      user.status = status;
      user.lastSeen = Date.now();
      
      // Broadcast status to all connected users
      socket.broadcast.emit('user:status', {
        username: username,
        status: status,
        lastSeen: user.lastSeen
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log(`❌ User ${username} disconnected: ${reason}`);
    
    // Update last seen
    const lastSeen = readJSON(LAST_SEEN_FILE);
    lastSeen[username] = Date.now();
    writeJSON(LAST_SEEN_FILE, lastSeen);
    
    // Remove from active users
    activeUsers.delete(username);
    
    // Broadcast offline status
    socket.broadcast.emit('user:status', {
      username: username,
      status: 'offline',
      lastSeen: Date.now()
    });
  });

  // Handle connection errors
  socket.on('error', (error) => {
    console.error(`Socket error for ${username}:`, error);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: Date.now(),
    activeUsers: activeUsers.size,
    uptime: process.uptime()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Server startup
const PORT = process.env.PORT || 80;

server.listen(PORT, () => {
  console.log('\n🚀 WhatsApp Clone Server Started!');
  console.log(`📡 Server running on http://localhost:${PORT}`);
  console.log(`👥 Socket.IO ready for connections`);
  console.log(`📁 Static files served from ./public`);
  console.log(`💾 Database files in ./data`);
  console.log(`📤 File uploads in ./public/uploads`);
  console.log('\n📋 Available endpoints:');
  console.log('   GET  / - Frontend app');
  console.log('   POST /auth/register - User registration');
  console.log('   POST /auth/login - User login');
  console.log('   GET  /users/search - Search users');
  console.log('   GET  /chats - Get user chats');
  console.log('   POST /upload - File upload');
  console.log('   GET  /health - Health check');
  console.log('\n✅ Ready to accept connections!\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n🛑 Server shutting down...');
  server.close(() => {
    console.log('✅ Server closed gracefully');
    process.exit(0);
  });
});
