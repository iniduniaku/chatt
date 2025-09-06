const fs = require('fs');
const path = require('path');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// File paths
const getFilePath = (type) => {
    const files = {
        users: path.join(dataDir, 'users.json'),
        messages: path.join(dataDir, 'messages.json'),
        last_seen: path.join(dataDir, 'last_seen.json'),
        chats: path.join(dataDir, 'chats.json')
    };
    return files[type];
};

// Read JSON file
const readJSON = (filePath) => {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading JSON file ${filePath}:`, error);
        return null;
    }
};

// Write JSON file
const writeJSON = (filePath, data) => {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error(`Error writing JSON file ${filePath}:`, error);
        return false;
    }
};

// Generate unique ID
const generateId = (prefix = 'id') => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${prefix}_${timestamp}_${random}`;
};

// Ensure file exists with default data
const ensureFileExists = (filePath, defaultData = {}) => {
    try {
        if (!fs.existsSync(filePath)) {
            writeJSON(filePath, defaultData);
            console.log(`Created file: ${filePath}`);
        }
    } catch (error) {
        console.error(`Error ensuring file exists ${filePath}:`, error);
    }
};

module.exports = {
    readJSON,
    writeJSON,
    getFilePath,
    generateId,
    ensureFileExists
};
