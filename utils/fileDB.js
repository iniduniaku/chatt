const fs = require('fs');
const path = require('path');

// Pastikan folder data exists
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getFilePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      // Create empty array for users, empty object for others
      const defaultData = filePath.includes('users') ? [] : {};
      writeJSON(filePath, defaultData);
      return defaultData;
    }
    
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading JSON:', error);
    // Return appropriate default based on file type
    return filePath.includes('users') ? [] : {};
  }
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing JSON:', error);
    throw error;
  }
}

module.exports = {
  readJSON,
  writeJSON,
  getFilePath
};
