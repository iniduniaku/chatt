const fs = require('fs');
const path = require('path');

// Create data directory if it doesn't exist
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('📁 Data directory created:', DATA_DIR);
}

/**
 * Get file path for a given data file
 * @param {string} name - Name of the file (without extension)
 * @returns {string} Full path to the JSON file
 */
function getFilePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

/**
 * Read JSON data from file
 * @param {string} filePath - Path to the JSON file
 * @returns {any} Parsed JSON data
 */
function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      // Create file with appropriate default data structure
      const fileName = path.basename(filePath, '.json');
      let defaultData;
      
      switch (fileName) {
        case 'users':
          defaultData = [];
          break;
        case 'messages':
        case 'last_seen':
        case 'chat_rooms':
          defaultData = {};
          break;
        default:
          defaultData = [];
      }
      
      writeJSON(filePath, defaultData);
      console.log(`📄 Created new file: ${fileName}.json`);
      return defaultData;
    }
    
    const data = fs.readFileSync(filePath, 'utf8');
    
    // Handle empty files
    if (!data.trim()) {
      const fileName = path.basename(filePath, '.json');
      const defaultData = fileName === 'users' ? [] : {};
      writeJSON(filePath, defaultData);
      return defaultData;
    }
    
    return JSON.parse(data);
    
  } catch (error) {
    console.error(`❌ Error reading JSON file ${filePath}:`, error.message);
    
    // Return appropriate default data structure on error
    const fileName = path.basename(filePath, '.json');
    return fileName === 'users' ? [] : {};
  }
}

/**
 * Write JSON data to file
 * @param {string} filePath - Path to the JSON file
 * @param {any} data - Data to write
 */
function writeJSON(filePath, data) {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const jsonString = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, jsonString, 'utf8');
    
  } catch (error) {
    console.error(`❌ Error writing JSON file ${filePath}:`, error.message);
    throw new Error(`Failed to write to ${path.basename(filePath)}`);
  }
}

/**
 * Backup a JSON file
 * @param {string} filePath - Path to the JSON file to backup
 */
function backupJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = filePath.replace('.json', `_backup_${timestamp}.json`);
    
    fs.copyFileSync(filePath, backupPath);
    console.log(`💾 Backup created: ${path.basename(backupPath)}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Error creating backup for ${filePath}:`, error.message);
    return false;
  }
}

/**
 * Get file stats
 * @param {string} filePath - Path to the file
 * @returns {object|null} File stats or null if file doesn't exist
 */
function getFileStats(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const stats = fs.statSync(filePath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime
    };
    
  } catch (error) {
    console.error(`❌ Error getting stats for ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Clean up old backup files (keep only last 5)
 * @param {string} basePath - Base path to clean backups for
 */
function cleanupBackups(basePath) {
  try {
    const dir = path.dirname(basePath);
    const baseName = path.basename(basePath, '.json');
    
    if (!fs.existsSync(dir)) {
      return;
    }
    
    const files = fs.readdirSync(dir);
    const backupFiles = files
      .filter(file => file.startsWith(`${baseName}_backup_`) && file.endsWith('.json'))
      .map(file => ({
        name: file,
        path: path.join(dir, file),
        stats: fs.statSync(path.join(dir, file))
      }))
      .sort((a, b) => b.stats.mtime - a.stats.mtime); // Sort by modification time, newest first
    
    // Keep only the 5 most recent backups
    if (backupFiles.length > 5) {
      const filesToDelete = backupFiles.slice(5);
      filesToDelete.forEach(file => {
        fs.unlinkSync(file.path);
        console.log(`🗑️ Deleted old backup: ${file.name}`);
      });
    }
    
  } catch (error) {
    console.error(`❌ Error cleaning up backups:`, error.message);
  }
}

module.exports = {
  readJSON,
  writeJSON,
  getFilePath,
  backupJSON,
  getFileStats,
  cleanupBackups
};
