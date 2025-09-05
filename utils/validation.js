/**
 * Input validation utilities
 */

/**
 * Validate username format
 * @param {string} username - Username to validate
 * @returns {object} Validation result
 */
function validateUsername(username) {
  const result = {
    isValid: true,
    errors: []
  };

  if (!username || typeof username !== 'string') {
    result.isValid = false;
    result.errors.push('Username is required');
    return result;
  }

  const trimmedUsername = username.trim();

  if (trimmedUsername.length < 3) {
    result.isValid = false;
    result.errors.push('Username must be at least 3 characters long');
  }

  if (trimmedUsername.length > 30) {
    result.isValid = false;
    result.errors.push('Username must be less than 30 characters');
  }

  if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
    result.isValid = false;
    result.errors.push('Username can only contain letters, numbers, and underscores');
  }

  if (/^\d+$/.test(trimmedUsername)) {
    result.isValid = false;
    result.errors.push('Username cannot be only numbers');
  }

  // Reserved usernames
  const reservedUsernames = ['admin', 'root', 'system', 'api', 'bot', 'null', 'undefined'];
  if (reservedUsernames.includes(trimmedUsername.toLowerCase())) {
    result.isValid = false;
    result.errors.push('Username is reserved');
  }

  return result;
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {object} Validation result
 */
function validatePassword(password) {
  const result = {
    isValid: true,
    errors: [],
    strength: 'weak'
  };

  if (!password || typeof password !== 'string') {
    result.isValid = false;
    result.errors.push('Password is required');
    return result;
  }

  if (password.length < 6) {
    result.isValid = false;
    result.errors.push('Password must be at least 6 characters long');
  }

  if (password.length > 128) {
    result.isValid = false;
    result.errors.push('Password must be less than 128 characters');
  }

  // Check password strength
  let strengthScore = 0;

  if (password.length >= 8) strengthScore++;
  if (/[a-z]/.test(password)) strengthScore++;
  if (/[A-Z]/.test(password)) strengthScore++;
  if (/\d/.test(password)) strengthScore++;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) strengthScore++;

  if (strengthScore <= 2) {
    result.strength = 'weak';
  } else if (strengthScore <= 3) {
    result.strength = 'medium';
  } else {
    result.strength = 'strong';
  }

  // Common weak passwords
  const commonPasswords = ['123456', 'password', 'qwerty', '123456789', 'abc123'];
  if (commonPasswords.includes(password.toLowerCase())) {
    result.isValid = false;
    result.errors.push('Password is too common');
    result.strength = 'weak';
  }

  return result;
}

/**
 * Validate message content
 * @param {string} text - Message text
 * @returns {object} Validation result
 */
function validateMessage(text) {
  const result = {
    isValid: true,
    errors: []
  };

  if (!text || typeof text !== 'string') {
    result.isValid = false;
    result.errors.push('Message text is required');
    return result;
  }

  const trimmedText = text.trim();

  if (trimmedText.length === 0) {
    result.isValid = false;
    result.errors.push('Message cannot be empty');
  }

  if (trimmedText.length > 4096) {
    result.isValid = false;
    result.errors.push('Message is too long (max 4096 characters)');
  }

  // Check for spam patterns
  const spamPatterns = [
    /(.)\1{10,}/, // Repeated characters
    /https?:\/\/[^\s]+/gi // URLs (if you want to block them)
  ];

  // Uncomment if you want to block URLs
  // if (spamPatterns[1].test(trimmedText)) {
  //   result.isValid = false;
  //   result.errors.push('URLs are not allowed');
  // }

  if (spamPatterns[0].test(trimmedText)) {
    result.isValid = false;
    result.errors.push('Message contains too many repeated characters');
  }

  return result;
}

/**
 * Validate file upload
 * @param {object} file - Multer file object
 * @returns {object} Validation result
 */
function validateFileUpload(file) {
  const result = {
    isValid: true,
    errors: []
  };

  if (!file) {
    result.isValid = false;
    result.errors.push('No file provided');
    return result;
  }

  // Check file size (50MB max)
  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    result.isValid = false;
    result.errors.push('File is too large (max 50MB)');
  }

  // Check file type
  const allowedMimeTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/mov', 'video/avi', 'video/webm',
    'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/mpeg'
  ];

  if (!allowedMimeTypes.includes(file.mimetype)) {
    result.isValid = false;
    result.errors.push('File type not allowed');
  }

  // Check file extension
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.avi', '.webm', '.mp3', '.wav', '.ogg'];
  const fileExtension = require('path').extname(file.originalname).toLowerCase();
  
  if (!allowedExtensions.includes(fileExtension)) {
    result.isValid = false;
    result.errors.push('File extension not allowed');
  }

  return result;
}

/**
 * Sanitize text input
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text
 */
function sanitizeText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .replace(/\s+/g, ' '); // Normalize whitespace
}

/**
 * Check if text contains profanity
 * @param {string} text - Text to check
 * @returns {boolean} True if contains profanity
 */
function containsProfanity(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // Basic profanity filter - extend this list as needed
  const profanityList = [
    // Add your profanity words here
    // 'badword1', 'badword2'
  ];

  const lowerText = text.toLowerCase();
  return profanityList.some(word => lowerText.includes(word));
}

module.exports = {
  validateUsername,
  validatePassword,
  validateMessage,
  validateFileUpload,
  sanitizeText,
  containsProfanity
};
