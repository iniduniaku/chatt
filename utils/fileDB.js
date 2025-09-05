const fs = require('fs');
const path = require('path');

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getFilePath(name) {
  return path.join(__dirname, '../data', `${name}.json`);
}

module.exports = { readJSON, writeJSON, getFilePath };
