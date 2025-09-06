const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { readJSON, writeJSON, getFilePath, generateId } = require('./utils/fileDB');
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

// File paths dan konstanta
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// Initialize JSON files
console.log('🚀 Initializing database files...');
['users', 'messages', 'last_seen', 'chats'].forEach(type => {
  const filePath = getFilePath(type);
  if (!fs.existsSync(filePath)) {
    const initialData = type === 'users' ? [] : {};
    writeJSON(filePath, initialData);
    console.log(`✅ ${type} file created`);
  }
});

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

    const users = readJSON(getFilePath('users'));
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
      .slice(0, 10);

    res.json(results);
  } catch (error) {
    console.error('❌ Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Active users dan socket tracking
const activeUsers = new Map();
const userSockets = new Map();

// Utility functions
function getRoomId(user1, user2) {
  const sortedUsers = [user1, user2].sort();
  return `dm:${sortedUsers.join('::')}`;
}

function getUserStatus(username) {
  return activeUsers.has(username) ? 'online' : 'offline';
}

function saveMessage(roomId, message) {
  const messages = readJSON(getFilePath('messages')) || {};
  if (!messages[roomId]) {
    messages[roomId] = [];
  }
  messages[roomId].push(message);
  writeJSON(getFilePath('messages'), messages);
}

function getMessages(roomId, limit = 50) {
  const messages = readJSON(getFilePath('messages')) || {};
  const roomMessages = messages[roomId] || [];
  return roomMessages.slice(-limit);
}

function getUserChatList(username) {
  try {
    const chats = readJSON(getFilePath('chats')) || {};
    const userChats = chats[username] || [];
    
    // Update status for each chat
    return userChats.map(chat => ({
      ...chat,
      status: getUserStatus(chat.username),
      lastSeen: getLastSeen(chat.username)
    }));
  } catch (error) {
    console.error('❌ Get user chat list error:', error);
    return [];
  }
}

function getLastSeen(username) {
  const lastSeen = readJSON(getFilePath('last_seen')) || {};
  return lastSeen[username] || null;
}

function updateUserChatList(username, otherUser, message) {
  const chats = readJSON(getFilePath('chats')) || {};
  
  if (!chats[username]) {
    chats[username] = [];
  }

  let existingChat = chats[username].find(chat => chat.username === otherUser);
  
  if (existingChat) {
    existingChat.lastMessage = {
      text: message.text,
      from: message.from,
      timestamp: message.timestamp
    };
    
    if (message.from !== username) {
      existingChat.unreadCount = (existingChat.unreadCount || 0) + 1;
    }
  } else {
    const newChat = {
      username: otherUser,
      lastMessage: {
        text: message.text,
        from: message.from,
        timestamp: message.timestamp
      },
      unreadCount: message.from !== username ? 1 : 0,
      status: getUserStatus(otherUser)
    };
    
    chats[username].push(newChat);
  }

  // Sort by last message timestamp
  chats[username].sort((a, b) => {
    const timeA = a.lastMessage ? new Date(a.lastMessage.timestamp) : new Date(0);
    const timeB = b.lastMessage ? new Date(b.lastMessage.timestamp) : new Date(0);
    return timeB - timeA;
  });

  writeJSON(getFilePath('chats'), chats);
}

function broadcastChatList(username) {
  const userSocketId = userSockets.get(username);
  if (userSocketId) {
    const chats = getUserChatList(username);
    io.to(userSocketId).emit('chat:list', chats);
  }
}

function clearUnreadCount(username, otherUser) {
  const chats = readJSON(getFilePath('chats')) || {};
  
  if (chats[username]) {
    const chat = chats[username].find(c => c.username === otherUser);
    if (chat) {
      chat.unreadCount = 0;
      writeJSON(getFilePath('chats'), chats);
    }
  }
}

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
      
      // Clear unread count when joining chat
      clearUnreadCount(username, otherUser);
      
      // Get messages
      const messages = getMessages(roomId);
      
      // Broadcast updated chat list to user (to update unread count)
      broadcastChatList(username);
      
      console.log(`📨 ${username} joined room: ${roomId}`);
      
      if (callback) {
        callback({ 
          success: true,
          roomId: roomId, 
          messages: messages 
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
      
      const message = {
        id: generateId('msg'),
        from: username,
        to: to,
        text: text || '',
        media: media || null,
        timestamp: Date.now(),
        readBy: [username],
        deletedFor: []
      };

      // Save message
      saveMessage(roomId, message);

      // Emit to all users in the room
      io.to(roomId).emit('dm:message', message);

      // Update chat lists for both users
      updateUserChatList(username, to, message);
      updateUserChatList(to, username, message);

      // Broadcast updated chat lists
      broadcastChatList(username);
      broadcastChatList(to);

      // Send notification to recipient
      const recipientSocketId = userSockets.get(to);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('chat:new_message', {
          from: username,
          to: to,
          text: message.text,
          media: message.media,
          timestamp: message.timestamp
        });
      }

      console.log(`💬 Message sent from ${username} to ${to}`);
      
      if (callback) {
        callback({ success: true, messageId: message.id });
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
      const messages = readJSON(getFilePath('messages'));
      
      if (!messages[roomId]) {
        if (callback) callback({ success: false, error: 'Room not found' });
        return;
      }

      let messageFound = false;

      messages[roomId].forEach((msg, index) => {
        if (msg.id === messageId) {
          messageFound = true;
          
          if (forEveryone && msg.from === username) {
            messages[roomId].splice(index, 1);
          } else {
            if (!msg.deletedFor) msg.deletedFor = [];
            if (!msg.deletedFor.includes(username)) {
              msg.deletedFor.push(username);
            }
          }
        }
      });

      if (messageFound) {
        writeJSON(getFilePath('messages'), messages);
        
        io.to(roomId).emit('dm:delete', {
          messageId: messageId,
          by: username,
          forEveryone: forEveryone
        });

        // Update chat lists
        const roomUsers = roomId.replace('dm:', '').split('::');
        roomUsers.forEach(user => {
          broadcastChatList(user);
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

  // Handle clearing chat history
  socket.on('chat:clear', (data, callback) => {
    try {
      const { otherUser } = data;
      const roomId = getRoomId(username, otherUser);
      
      // Clear messages
      const messages = readJSON(getFilePath('messages'));
      if (messages[roomId]) {
        delete messages[roomId];
        writeJSON(getFilePath('messages'), messages);
      }
      
      // Remove from chat list
      const chats = readJSON(getFilePath('chats'));
      if (chats[username]) {
        chats[username] = chats[username].filter(chat => chat.username !== otherUser);
        writeJSON(getFilePath('chats'), chats);
      }
      
      // Broadcast updated chat list
      broadcastChatList(username);
      
      // Notify the other user if online
      const otherSocketId = userSockets.get(otherUser);
      if (otherSocketId) {
        io.to(otherSocketId).emit('chat:cleared', {
          by: username,
          roomId: roomId
        });
      }
      
      console.log(`🗑️ Chat cleared between ${username} and ${otherUser}`);
      
      if (callback) {
        callback({ success: true });
      }
    } catch (error) {
      console.error('❌ Clear chat error:', error);
      if (callback) {
        callback({ success: false, error: 'Failed to clear chat' });
      }
    }
  });

  // Handle clearing all chats
  socket.on('chats:clear_all', (callback) => {
    try {
      // Get user's chats
      const chats = readJSON(getFilePath('chats'));
      const userChats = chats[username] || [];
      
      // Clear all message rooms for this user
      const messages = readJSON(getFilePath('messages'));
      userChats.forEach(chat => {
        const roomId = getRoomId(username, chat.username);
        if (messages[roomId]) {
          delete messages[roomId];
        }
      });
      writeJSON(getFilePath('messages'), messages);
      
      // Clear user's chat list
      if (chats[username]) {
        chats[username] = [];
        writeJSON(getFilePath('chats'), chats);
      }
      
      // Broadcast updated chat list
      broadcastChatList(username);
      
      console.log(`🗑️ All chats cleared for ${username}`);
      
      if (callback) {
        callback({ success: true });
      }
    } catch (error) {
      console.error('❌ Clear all chats error:', error);
      if (callback) {
        callback({ success: false, error: 'Failed to clear all chats' });
      }
    }
  });

  // Handle message read status
  socket.on('message:read', (data) => {
    try {
      const { messageId, roomId } = data;
      const messages = readJSON(getFilePath('messages'));
      
      if (messages[roomId]) {
        const message = messages[roomId].find(msg => msg.id === messageId);
        if (message) {
          if (!message.readBy) message.readBy = [];
          if (!message.readBy.includes(username)) {
            message.readBy.push(username);
            writeJSON(getFilePath('messages'), messages);
            
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
    } catch (error) {
      console.error('❌ Typing start error:', error);
    }
  });

  socket.on('typing:stop', (data) => {
    try {
      const roomId = getRoomId(username, data.to);
      socket.to(roomId).emit('typing:stop', { from: username });
    } catch (error) {
      console.error('❌ Typing stop error:', error);
    }
  });

  // WebRTC Call Events
  ['call:offer', 'call:answer', 'call:candidate', 'call:end', 
   'video:offer', 'video:answer', 'video:candidate', 'video:end'].forEach(event => {
    socket.on(event, (data) => {
      try {
        const { to } = data;
        const recipientSocketId = userSockets.get(to);
        
        if (recipientSocketId) {
          io.to(recipientSocketId).emit(event, {
            from: username,
            ...data
          });
        } else if (event.includes('offer')) {
          socket.emit(event.replace(':', ':error'), { error: 'User not online' });
        }
      } catch (error) {
        console.error(`❌ ${event} error:`, error);
      }
    });
  });

  // Handle user status updates
  socket.on('user:status', (status) => {
    try {
      const user = activeUsers.get(username);
      if (user) {
        user.status = status;
        user.lastSeen = Date.now();
        
        socket.broadcast.emit('user:status', {
          username: username,
          status: status,
          lastSeen: user.lastSeen
        });
      }
    } catch (error) {
      console.error('❌ Status update error:', error);
    }
  });

  // Handle ping/pong
  socket.on('ping', () => {
    socket.emit('pong');
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log(`❌ User ${username} disconnected: ${reason}`);
    
    try {
      // Update last seen
      const lastSeen = readJSON(getFilePath('last_seen'));
      lastSeen[username] = Date.now();
      writeJSON(getFilePath('last_seen'), lastSeen);
      
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
});

// Get user's chat list endpoint
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

// Clear chat history endpoint
app.delete('/chats/:username', authMiddleware, (req, res) => {
  try {
    const currentUser = req.user.username;
    const otherUser = req.params.username;
    
    // Clear messages from messages.json
    const messages = readJSON(getFilePath('messages'));
    const roomId = getRoomId(currentUser, otherUser);
    
    if (messages[roomId]) {
      delete messages[roomId];
      writeJSON(getFilePath('messages'), messages);
    }
    
    // Remove from chat list
    const chats = readJSON(getFilePath('chats'));
    if (chats[currentUser]) {
      chats[currentUser] = chats[currentUser].filter(chat => chat.username !== otherUser);
      writeJSON(getFilePath('chats'), chats);
    }
    
    // Broadcast updated chat list
    broadcastChatList(currentUser);
    
    // Notify the other user if online
    const otherSocketId = userSockets.get(otherUser);
    if (otherSocketId) {
      io.to(otherSocketId).emit('chat:cleared', {
        by: currentUser,
        roomId: roomId
      });
    }
    
    console.log(`🗑️ Chat history cleared between ${currentUser} and ${otherUser}`);
    res.json({ success: true, message: 'Chat history cleared' });
  } catch (error) {
    console.error('❌ Clear chat history error:', error);
    res.status(500).json({ error: 'Failed to clear chat history' });
  }
});

// Clear all chats endpoint
app.delete('/chats', authMiddleware, (req, res) => {
  try {
    const currentUser = req.user.username;
    
    // Get user's chats
    const chats = readJSON(getFilePath('chats'));
    const userChats = chats[currentUser] || [];
    
    // Clear all message rooms for this user
    const messages = readJSON(getFilePath('messages'));
    userChats.forEach(chat => {
      const roomId = getRoomId(currentUser, chat.username);
      if (messages[roomId]) {
        delete messages[roomId];
      }
    });
    writeJSON(getFilePath('messages'), messages);
    
    // Clear user's chat list
    if (chats[currentUser]) {
      chats[currentUser] = [];
      writeJSON(getFilePath('chats'), chats);
    }
    
    // Broadcast updated chat list
    broadcastChatList(currentUser);
    
    console.log(`🗑️ All chat history cleared for ${currentUser}`);
    res.json({ success: true, message: 'All chat history cleared' });
  } catch (error) {
    console.error('❌ Clear all chats error:', error);
    res.status(500).json({ error: 'Failed to clear all chats' });
  }
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

// System stats endpoint
app.get('/stats', (req, res) => {
  try {
    const users = readJSON(getFilePath('users'));
    const messages = readJSON(getFilePath('messages'));
    
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

// Cleanup function
function cleanup() {
  console.log('\n🛑 Server shutting down...');
  
  try {
    const lastSeen = readJSON(getFilePath('last_seen'));
    const now = Date.now();
    
    activeUsers.forEach((user, username) => {
      lastSeen[username] = now;
    });
    
    writeJSON(getFilePath('last_seen'), lastSeen);
    console.log('💾 User last seen data saved');
  } catch (error) {
    console.error('❌ Error saving last seen data:', error);
  }
  
  server.close(() => {
    console.log('✅ Server closed gracefully');
    process.exit(0);
  });
  
  setTimeout(() => {
    console.log('⚠️ Forcing server shutdown...');
    process.exit(1);
  }, 10000);
}

// Server startup
const PORT = process.env.PORT || 80;
const HOST = process.env.HOST || 'localhost';

server.listen(PORT, () => {
  console.clear();
  console.log('\n🚀 =============================================');
  console.log('   ChatVibe Server Started Successfully!');
  console.log('=============================================');
  console.log(`📡 Server: http://${HOST}:${PORT}`);
  console.log(`🌐 Frontend: http://${HOST}:${PORT}`);
  console.log(`👥 Socket.IO: Ready for real-time connections`);
  console.log(`📁 Static files: ./public`);
  console.log(`💾 Database: ./data (JSON files)`);
  console.log(`📤 Uploads: ./public/uploads`);
  console.log('\n✅ Server ready to accept connections!');
  console.log('=============================================\n');
});

// Graceful shutdown handlers
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  cleanup();
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  cleanup();
});

module.exports = { app, server, io };
