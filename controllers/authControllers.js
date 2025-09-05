const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { readJSON, writeJSON, getFilePath } = require('../utils/fileDB');
const USERS_FILE = getFilePath('users');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

async function signup(req, res) {
  const { username, password } = req.body;
  const users = readJSON(USERS_FILE);
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'User exists' });
  }

  const hashed = await bcrypt.hash(password, 10);
  const user = { id: Date.now().toString(), username, password: hashed };
  users.push(user);
  writeJSON(USERS_FILE, users);
  res.json({ success: true });
}

async function login(req, res) {
  const { username, password } = req.body;
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
}

module.exports = { signup, login };
