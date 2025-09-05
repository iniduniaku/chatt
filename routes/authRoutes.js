// routes/authRoutes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getFilePath, readJSON, writeJSON } = require('../utils/fileDB');

const router = express.Router();
const USERS_FILE = getFilePath('users');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// ===== Signup =====
router.post('/signup', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username & password required' });
  }

  const users = readJSON(USERS_FILE);

  // pastikan unique
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  const newUser = {
    id: uuidv4(),
    username,
    password, // ⚠️ sebaiknya gunakan bcrypt di production
    createdAt: Date.now()
  };

  users.push(newUser);
  writeJSON(USERS_FILE, users);

  const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET, { expiresIn: '7d' });

  res.json({ success: true, user: { id: newUser.id, username: newUser.username }, token });
});

// ===== Login =====
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.username === username && u.password === password);

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

  res.json({ success: true, user: { id: user.id, username: user.username }, token });
});

module.exports = router;
