const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { readJSON, writeJSON, getFilePath } = require('../utils/fileDB');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';
const USERS_FILE = getFilePath('users');

// Input validation middleware
const validateUserInput = (req, res, next) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ 
      message: 'Username and password are required' 
    });
  }
  
  if (username.length < 3) {
    return res.status(400).json({ 
      message: 'Username must be at least 3 characters long' 
    });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ 
      message: 'Password must be at least 6 characters long' 
    });
  }
  
  // Check for valid username (alphanumeric and underscore only)
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ 
      message: 'Username can only contain letters, numbers, and underscores' 
    });
  }
  
  next();
};

// Register endpoint
router.post('/register', validateUserInput, async (req, res) => {
  try {
    const { username, password } = req.body;

    console.log(`📝 Registration attempt for username: ${username}`);

    const users = readJSON(USERS_FILE);
    
    // Check if user already exists
    const existingUser = users.find(user => 
      user.username.toLowerCase() === username.toLowerCase()
    );
    
    if (existingUser) {
      console.log(`❌ Registration failed: Username ${username} already exists`);
      return res.status(400).json({ 
        message: 'Username already exists' 
      });
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Create new user
    const newUser = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      username: username,
      password: hashedPassword,
      createdAt: Date.now(),
      lastLogin: null,
      isActive: true
    };

    users.push(newUser);
    writeJSON(USERS_FILE, users);

    console.log(`✅ User registered successfully: ${username}`);
    
    res.status(201).json({ 
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        username: newUser.username,
        createdAt: newUser.createdAt
      }
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      message: 'Internal server error during registration' 
    });
  }
});

// Login endpoint
router.post('/login', validateUserInput, async (req, res) => {
  try {
    const { username, password } = req.body;

    console.log(`🔐 Login attempt for username: ${username}`);

    const users = readJSON(USERS_FILE);
    
    // Find user (case insensitive)
    const user = users.find(u => 
      u.username.toLowerCase() === username.toLowerCase()
    );

    if (!user) {
      console.log(`❌ Login failed: User ${username} not found`);
      return res.status(401).json({ 
        message: 'Invalid username or password' 
      });
    }

    // Check if user is active
    if (!user.isActive) {
      console.log(`❌ Login failed: User ${username} is deactivated`);
      return res.status(401).json({ 
        message: 'Account is deactivated' 
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      console.log(`❌ Login failed: Invalid password for ${username}`);
      return res.status(401).json({ 
        message: 'Invalid username or password' 
      });
    }

    // Update last login
    const userIndex = users.findIndex(u => u.id === user.id);
    if (userIndex !== -1) {
      users[userIndex].lastLogin = Date.now();
      writeJSON(USERS_FILE, users);
    }

    // Generate JWT token
    const tokenPayload = {
      id: user.id,
      username: user.username
    };
    
    const token = jwt.sign(
      tokenPayload,
      JWT_SECRET,
      { 
        expiresIn: '7d',
        issuer: 'whatsapp-clone',
        audience: 'whatsapp-clone-users'
      }
    );

    console.log(`✅ Login successful for: ${username}`);

    res.json({
      message: 'Login successful',
      token: token,
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt,
        lastLogin: users[userIndex].lastLogin
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      message: 'Internal server error during login' 
    });
  }
});

// Verify token endpoint
router.get('/verify', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Invalid token format' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if user still exists
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === decoded.id);
    
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'User not found or inactive' });
    }

    res.json({
      valid: true,
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    
    console.error('Token verification error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
});

// Get user profile endpoint
router.get('/profile', require('../utils/jwtMiddleware'), (req, res) => {
  try {
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      }
    });
    
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Failed to get profile' });
  }
});

// Update password endpoint
router.put('/password', require('../utils/jwtMiddleware'), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        message: 'Current password and new password are required' 
      });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ 
        message: 'New password must be at least 6 characters long' 
      });
    }

    const users = readJSON(USERS_FILE);
    const userIndex = users.findIndex(u => u.id === req.user.id);
    
    if (userIndex === -1) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[userIndex];
    
    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 12);
    
    // Update password
    users[userIndex].password = hashedNewPassword;
    users[userIndex].passwordUpdatedAt = Date.now();
    
    writeJSON(USERS_FILE, users);

    console.log(`✅ Password updated for user: ${user.username}`);

    res.json({ message: 'Password updated successfully' });
    
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({ message: 'Failed to update password' });
  }
});

module.exports = router;
