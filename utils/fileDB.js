// utils/fileDB.js
const fs = require('fs');
const path = require('path');

// folder untuk menyimpan data JSON
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Ambil path file JSON
function getFilePath(name) {
  return path.join(dataDir, `${name}.json`);
}

// Baca JSON
function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, 'utf-8');
    return content ? JSON.parse(content) : {};
  } catch (err) {
    console.error(`❌ Error readJSON(${filePath}):`, err);
    return {};
  }
}

// Tulis JSON
function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`❌ Error writeJSON(${filePath}):`, err);
  }
}

module.exports = { getFilePath, readJSON, writeJSON };
