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
 * Write JSON data to file with atomic write
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
    const tempPath = filePath + '.tmp';
    
    // Write to temporary file first
    fs.writeFileSync(tempPath, jsonString, 'utf8');
    
    // Atomic rename (more reliable than direct write)
    fs.renameSync(tempPath, filePath);
    
  } catch (error) {
    console.error(`❌ Error writing JSON file ${filePath}:`, error.message);
    
    // Clean up temp file if it exists
    const tempPath = filePath + '.tmp';
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (cleanupError) {
        console.error('Error cleaning up temp file:', cleanupError);
      }
    }
    
    throw new Error(`Failed to write to ${path.basename(filePath)}`);
  }
}

/**
 * Safely read and write JSON with retry mechanism
 * @param {string} filePath - Path to the JSON file
 * @param {function} updateFn - Function to update the data
 * @param {number} maxRetries - Maximum number of retries
 */
function updateJSON(filePath, updateFn, maxRetries = 3) {
  let attempts = 0;
  
  while (attempts < maxRetries) {
    try {
      const data = readJSON(filePath);
      const updatedData = updateFn(data);
      writeJSON(filePath, updatedData);
      return updatedData;
      
    } catch (error) {
      attempts++;
      console.error(`❌ Error updating JSON file (attempt ${attempts}/${maxRetries}):`, error.message);
      
      if (attempts >= maxRetries) {
        throw error;
      }
      
      // Wait before retry
      const delay = Math.min(100 * Math.pow(2, attempts), 1000);
      require('child_process').execSync(`sleep ${delay / 1000}`, { stdio: 'ignore' });
    }
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
    const backupDir = path.join(path.dirname(filePath), 'backups');
    
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const fileName = path.basename(filePath, '.json');
    const backupPath = path.join(backupDir, `${fileName}_backup_${timestamp}.json`);
    
    fs.copyFileSync(filePath, backupPath);
    console.log(`💾 Backup created: ${path.basename(backupPath)}`);
    
    // Clean up old backups
    cleanupBackups(filePath);
    
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
      sizeFormatted: formatBytes(stats.size),
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
    const backupDir = path.join(path.dirname(basePath), 'backups');
    const baseName = path.basename(basePath, '.json');
    
    if (!fs.existsSync(backupDir)) {
      return;
    }
    
    const files = fs.readdirSync(backupDir);
    const backupFiles = files
      .filter(file => file.startsWith(`${baseName}_backup_`) && file.endsWith('.json'))
      .map(file => ({
        name: file,
        path: path.join(backupDir, file),
        stats: fs.statSync(path.join(backupDir, file))
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

/**
 * Format bytes to human readable format
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Validate JSON file integrity
 * @param {string} filePath - Path to the JSON file
 * @returns {boolean} True if valid, false otherwise
 */
function validateJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    
    const data = fs.readFileSync(filePath, 'utf8');
    JSON.parse(data);
    return true;
    
  } catch (error) {
    console.error(`❌ Invalid JSON file ${filePath}:`, error.message);
    return false;
  }
}

/**
 * Get directory size
 * @param {string} dirPath - Directory path
 * @returns {number} Size in bytes
 */
function getDirectorySize(dirPath) {
  try {
    let totalSize = 0;
    
    function calculateSize(currentPath) {
      const stats = fs.statSync(currentPath);
      
      if (stats.isFile()) {
        totalSize += stats.size;
      } else if (stats.isDirectory()) {
        const files = fs.readdirSync(currentPath);
        files.forEach(file => {
          calculateSize(path.join(currentPath, file));
        });
      }
    }
    
    calculateSize(dirPath);
    return totalSize;
    
  } catch (error) {
    console.error(`❌ Error calculating directory size:`, error.message);
    return 0;
  }
}

// Auto-backup function (call this periodically)
function autoBackup() {
  try {
    const files = ['users', 'messages', 'last_seen', 'chat_rooms'];
    
    files.forEach(fileName => {
      const filePath = getFilePath(fileName);
      if (fs.existsSync(filePath)) {
        backupJSON(filePath);
      }
    });
    
    console.log('✅ Auto-backup completed');
    
  } catch (error) {
    console.error('❌ Auto-backup failed:', error);
  }
}

// Run auto-backup every 6 hours in production
if (process.env.NODE_ENV === 'production') {
  setInterval(autoBackup, 6 * 60 * 60 * 1000); // 6 hours
}

module.exports = {
  readJSON,
  writeJSON,
  updateJSON,
  getFilePath,
  backupJSON,
  getFileStats,
  cleanupBackups,
  formatBytes,
  validateJSON,
  getDirectorySize,
  autoBackup
};
