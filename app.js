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
console.log('🚀 Initializing database files...');
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
    console.log(`📁 File uploaded: ${fileUrl}`);
    
    res.json({ 
      url: fileUrl,
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error('❌ Upload error:', error);
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
        user.username !== req.user.username &&
        user.isActive !== false
      )
      .map(user => ({
        id: user.id,
        username: user.username
      }))
      .slice(0, 10); // Limit results

    res.json(results);
  } catch (error) {
    console.error('❌ Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get user's chat list
app.get('/chats', authMiddleware, (req, res) => {
  try {
    const username = req.user.username;
    const chatList = getUserChatList(username);
    res.json(chatList);
  } catch (error) {
    console.error('❌ Get chats error:', error);
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
    console.log(`🔌 User ${decoded.username} connecting...`);
    next();
  } catch (error) {
    console.error('❌ Socket auth error:', error);
    next(new Error('Invalid token'));
  }
});

// Utility function to generate room ID
function getRoomId(user1, user2) {
  const sortedUsers = [user1, user2].sort();
  return `dm:${sortedUsers.join('::')}`;
}

// Function to get user's chat list
function getUserChatList(username) {
  try {
    const messages = readJSON(MESSAGES_FILE);
    const lastSeen = readJSON(LAST_SEEN_FILE);
    
    const chatList = [];
    
    // Find all rooms user is part of
    Object.keys(messages).forEach(roomId => {
      if (roomId.includes(username)) {
        const roomMessages = messages[roomId];
        if (roomMessages && roomMessages.length > 0) {
          // Filter messages not deleted for this user
          const visibleMessages = roomMessages.filter(msg => 
            !msg.deletedFor || !msg.deletedFor.includes(username)
          );
          
          if (visibleMessages.length > 0) {
            const lastMessage = visibleMessages[visibleMessages.length - 1];
            const otherUser = roomId.replace('dm:', '').split('::').find(u => u !== username);
            
            if (otherUser) {
              // Count unread messages
              const unreadCount = visibleMessages.filter(msg => 
                msg.from !== username && (!msg.readBy || !msg.readBy.includes(username))
              ).length;

              chatList.push({
                username: otherUser,
                lastMessage: {
                  text: lastMessage.text || 'Media',
                  timestamp: lastMessage.timestamp,
                  from: lastMessage.from
                },
                unreadCount: unreadCount,
                roomId: roomId,
                lastSeen: lastSeen[otherUser] || null,
                status: activeUsers.has(otherUser) ? 'online' : 'offline'
              });
            }
          }
        }
      }
    });
    
    // Sort by last message timestamp
    chatList.sort((a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp);
    
    return chatList;
  } catch (error) {
    console.error('❌ Get user chat list error:', error);
    return [];
  }
}

// Active users and socket tracking
const activeUsers = new Map();
const userSockets = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
  const { username, id } = socket.user;
  
  // Track user socket connection
  userSockets.set(username, socket.id);
  
  // Track active user
  activeUsers.set(username, {
    socketId: socket.id,
    lastSeen: Date.now(),
    status: 'online'
  });

  console.log(`✅ User ${username} connected with socket ${socket.id}`);

  // Send user's chat list when they connect
  socket.emit('chat:list', getUserChatList(username));

  // Broadcast user online status
  socket.broadcast.emit('user:status', {
    username: username,
    status: 'online',
    lastSeen: Date.now()
  });

  // Handle getting chat list
  socket.on('get:chats', (callback) => {
    try {
      const chatList = getUserChatList(username);
      if (callback) {
        callback({ success: true, chats: chatList });
      } else {
        socket.emit('chat:list', chatList);
      }
    } catch (error) {
      console.error('❌ Get chats error:', error);
      if (callback) callback({ success: false, error: 'Failed to get chats' });
    }
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
      
      console.log(`📨 ${username} joined room: ${roomId}`);
      
      if (callback) {
        callback({ 
          success: true,
          roomId: roomId, 
          messages: filteredMessages 
        });
      }
    } catch (error) {
      console.error('❌ Join room error:', error);
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

      // Emit to all users in the room (including sender)
      io.to(roomId).emit('dm:message', message);

      // Notify recipient even if they're not in the chat room
      const recipientSocketId = userSockets.get(to);
      if (recipientSocketId) {
        // Send new message notification
        io.to(recipientSocketId).emit('chat:new_message', {
          from: username,
          message: message,
          roomId: roomId
        });

        // Update recipient's chat list
        io.to(recipientSocketId).emit('chat:list', getUserChatList(to));
      }

      // Update sender's chat list too
      socket.emit('chat:list', getUserChatList(username));

      console.log(`💬 Message sent from ${username} to ${to}`);
      
      if (callback) {
        callback({ success: true, message });
      }
    } catch (error) {
      console.error('❌ Send message error:', error);
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

        // Update chat lists for both users
        const roomUsers = roomId.replace('dm:', '').split('::');
        roomUsers.forEach(user => {
          const userSocketId = userSockets.get(user);
          if (userSocketId) {
            io.to(userSocketId).emit('chat:list', getUserChatList(user));
          }
        });

        console.log(`🗑️ Message ${messageId} deleted by ${username}`);
        
        if (callback) {
          callback({ success: true });
        }
      } else {
        if (callback) {
          callback({ success: false, error: 'Message not found' });
        }
      }
    } catch (error) {
      console.error('❌ Delete message error:', error);
      if (callback) {
        callback({ success: false, error: 'Failed to delete message' });
      }
    }
  });

  // Handle message read status
  socket.on('message:read', (data) => {
    try {
      const { messageId, roomId } = data;
      const messages = readJSON(MESSAGES_FILE);
      
      if (messages[roomId]) {
        const message = messages[roomId].find(msg => msg.id === messageId);
        if (message) {
          if (!message.readBy) message.readBy = [];
          if (!message.readBy.includes(username)) {
            message.readBy.push(username);
            writeJSON(MESSAGES_FILE, messages);
            
            // Notify sender about read status
            io.to(roomId).emit('message:read', {
              messageId: messageId,
              readBy: username
            });
          }
        }
      }
    } catch (error) {
      console.error('❌ Mark message read error:', error);
    }
  });

  // Handle typing indicators
  socket.on('typing:start', (data) => {
    try {
      const roomId = getRoomId(username, data.to);
      socket.to(roomId).emit('typing:start', { from: username });
      console.log(`⌨️ ${username} started typing to ${data.to}`);
    } catch (error) {
      console.error('❌ Typing start error:', error);
    }
  });

  socket.on('typing:stop', (data) => {
    try {
      const roomId = getRoomId(username, data.to);
      socket.to(roomId).emit('typing:stop', { from: username });
      console.log(`⌨️ ${username} stopped typing to ${data.to}`);
    } catch (error) {
      console.error('❌ Typing stop error:', error);
    }
  });

  // WebRTC signaling for voice calls
  socket.on('call:offer', (data) => {
    try {
      const { to, offer } = data;
      const recipientSocketId = userSockets.get(to);
      
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('call:offer', {
          from: username,
          offer: offer
        });
        console.log(`📞 Voice call offer from ${username} to ${to}`);
      } else {
        socket.emit('call:error', { error: 'User not online' });
      }
    } catch (error) {
      console.error('❌ Call offer error:', error);
    }
  });

  socket.on('call:answer', (data) => {
    try {
      const { to, answer } = data;
      const recipientSocketId = userSockets.get(to);
      
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('call:answer', {
          from: username,
          answer: answer
        });
        console.log(`📞 Voice call answered by ${username} to ${to}`);
      }
    } catch (error) {
      console.error('❌ Call answer error:', error);
    }
  });

  socket.on('call:candidate', (data) => {
    try {
      const { to, candidate } = data;
      const recipientSocketId = userSockets.get(to);
      
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('call:candidate', {
          from: username,
          candidate: candidate
        });
      }
    } catch (error) {
      console.error('❌ Call candidate error:', error);
    }
  });

  socket.on('call:end', (data) => {
    try {
      const { to } = data;
      const recipientSocketId = userSockets.get(to);
      
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('call:end', {
          from: username
        });
        console.log(`📞 Call ended by ${username}`);
      }
    } catch (error) {
      console.error('❌ Call end error:', error);
    }
  });

  // WebRTC signaling for video calls
  socket.on('video:offer', (data) => {
    try {
      const { to, offer } = data;
      const recipientSocketId = userSockets.get(to);
      
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('video:offer', {
          from: username,
          offer: offer
        });
        console.log(`📹 Video call offer from ${username} to ${to}`);
      } else {
        socket.emit('video:error', { error: 'User not online' });
      }
    } catch (error) {
      console.error('❌ Video offer error:', error);
    }
  });

  socket.on('video:answer', (data) => {
    try {
      const { to, answer } = data;
      const recipientSocketId = userSockets.get(to);
      
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('video:answer', {
          from: username,
          answer: answer
        });
        console.log(`📹 Video call answered by ${username} to ${to}`);
      }
    } catch (error) {
      console.error('❌ Video answer error:', error);
    }
  });

  socket.on('video:candidate', (data) => {
    try {
      const { to, candidate } = data;
      const recipientSocketId = userSockets.get(to);
      
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('video:candidate', {
          from: username,
          candidate: candidate
        });
      }
    } catch (error) {
      console.error('❌ Video candidate error:', error);
    }
  });

  socket.on('video:end', (data) => {
    try {
      const { to } = data;
      const recipientSocketId = userSockets.get(to);
      
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('video:end', {
          from: username
        });
        console.log(`📹 Video call ended by ${username}`);
      }
    } catch (error) {
      console.error('❌ Video end error:', error);
    }
  });

  // Handle user status updates
  socket.on('user:status', (status) => {
    try {
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
        
        console.log(`👤 ${username} status: ${status}`);
      }
    } catch (error) {
      console.error('❌ Status update error:', error);
    }
  });

  // Handle ping/pong for connection health
  socket.on('ping', () => {
    socket.emit('pong');
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log(`❌ User ${username} disconnected: ${reason}`);
    
    try {
      // Update last seen
      const lastSeen = readJSON(LAST_SEEN_FILE);
      lastSeen[username] = Date.now();
      writeJSON(LAST_SEEN_FILE, lastSeen);
      
      // Remove from tracking maps
      activeUsers.delete(username);
      userSockets.delete(username);
      
      // Broadcast offline status
      socket.broadcast.emit('user:status', {
        username: username,
        status: 'offline',
        lastSeen: Date.now()
      });
    } catch (error) {
      console.error('❌ Disconnect handling error:', error);
    }
  });

  // Handle connection errors
  socket.on('error', (error) => {
    console.error(`❌ Socket error for ${username}:`, error);
  });

  // Handle reconnection
  socket.on('reconnect', () => {
    console.log(`🔄 User ${username} reconnected`);
    
    // Update user tracking
    userSockets.set(username, socket.id);
    activeUsers.set(username, {
      socketId: socket.id,
      lastSeen: Date.now(),
      status: 'online'
    });
    
    // Send updated chat list
    socket.emit('chat:list', getUserChatList(username));
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();
  
  res.json({ 
    status: 'OK', 
    timestamp: Date.now(),
    activeUsers: activeUsers.size,
    connectedSockets: userSockets.size,
    uptime: Math.floor(uptime),
    memory: {
      used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB'
    }
  });
});

// System stats endpoint (for monitoring)
app.get('/stats', (req, res) => {
  try {
    const users = readJSON(USERS_FILE);
    const messages = readJSON(MESSAGES_FILE);
    
    const totalUsers = users.length;
    const activeUsersCount = activeUsers.size;
    const totalRooms = Object.keys(messages).length;
    let totalMessages = 0;
    
    Object.values(messages).forEach(roomMessages => {
      if (Array.isArray(roomMessages)) {
        totalMessages += roomMessages.length;
      }
    });
    
    res.json({
      totalUsers,
      activeUsersCount,
      totalRooms,
      totalMessages,
      uptime: Math.floor(process.uptime()),
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('❌ Stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Express error:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large (max 50MB)' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file field' });
    }
  }
  
  if (err.message && err.message.includes('Only images, videos, and audio files are allowed')) {
    return res.status(400).json({ error: 'Invalid file type' });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Cleanup function for graceful shutdown
function cleanup() {
  console.log('\n🛑 Server shutting down...');
  
  // Update last seen for all active users
  try {
    const lastSeen = readJSON(LAST_SEEN_FILE);
    const now = Date.now();
    
    activeUsers.forEach((user, username) => {
      lastSeen[username] = now;
    });
    
    writeJSON(LAST_SEEN_FILE, lastSeen);
    console.log('💾 User last seen data saved');
  } catch (error) {
    console.error('❌ Error saving last seen data:', error);
  }
  
  // Close server
  server.close(() => {
    console.log('✅ Server closed gracefully');
    process.exit(0);
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.log('⚠️ Forcing server shutdown...');
    process.exit(1);
  }, 10000);
}

// Server startup
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

server.listen(PORT, () => {
  console.clear();
  console.log('\n🚀 =============================================');
  console.log('   WhatsApp Clone Server Started Successfully!');
  console.log('=============================================');
  console.log(`📡 Server: http://${HOST}:${PORT}`);
  console.log(`🌐 Frontend: http://${HOST}:${PORT}`);
  console.log(`👥 Socket.IO: Ready for real-time connections`);
  console.log(`📁 Static files: ./public`);
  console.log(`💾 Database: ./data (JSON files)`);
  console.log(`📤 Uploads: ./public/uploads`);
  console.log('\n📋 Available API Endpoints:');
  console.log('   📄 GET  / - Frontend application');
  console.log('   🔐 POST /auth/register - User registration');
  console.log('   🔑 POST /auth/login - User authentication');
  console.log('   👤 GET  /auth/verify - Token verification');
  console.log('   👥 GET  /users/search - Search users');
  console.log('   💬 GET  /chats - Get user chat list');
  console.log('   📁 POST /upload - File upload endpoint');
  console.log('   ❤️  GET  /health - Health check');
  console.log('   📊 GET  /stats - System statistics');
  console.log('\n🎮 Socket.IO Events:');
  console.log('   💬 dm:join, dm:message, dm:delete');
  console.log('   📞 call:offer, call:answer, call:candidate');
  console.log('   📹 video:offer, video:answer, video:candidate');
  console.log('   👤 user:status, typing:start, typing:stop');
  console.log('\n✅ Server ready to accept connections!');
  console.log('=============================================\n');
});

// Graceful shutdown handlers
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  cleanup();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  cleanup();
});

// Log memory usage periodically (every 30 minutes)
if (process.env.NODE_ENV !== 'production') {
  setInterval(() => {
    const memoryUsage = process.memoryUsage();
    console.log(`📊 Memory Usage: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`);
    console.log(`👥 Active Users: ${activeUsers.size}, Connected Sockets: ${userSockets.size}`);
  }, 30 * 60 * 1000); // 30 minutes
}

module.exports = { app, server, io };
