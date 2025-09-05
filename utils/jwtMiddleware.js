const jwt = require('jsonwebtoken');
const { readJSON, getFilePath } = require('./fileDB');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';
const USERS_FILE = getFilePath('users');

/**
 * JWT Authentication Middleware
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {Function} next - Express next function
 */
function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    // Check if authorization header exists
    if (!authHeader) {
      return res.status(401).json({ 
        message: 'Access denied. No token provided.',
        code: 'NO_TOKEN'
      });
    }

    // Check if header follows Bearer token format
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({ 
        message: 'Access denied. Invalid token format.',
        code: 'INVALID_FORMAT'
      });
    }

    const token = parts[1];
    
    if (!token) {
      return res.status(401).json({ 
        message: 'Access denied. Token is empty.',
        code: 'EMPTY_TOKEN'
      });
    }

    // Verify the token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Validate token payload
    if (!decoded.id || !decoded.username) {
      return res.status(401).json({ 
        message: 'Access denied. Invalid token payload.',
        code: 'INVALID_PAYLOAD'
      });
    }
    
    // Check if user still exists and is active
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === decoded.id);
    
    if (!user) {
      return res.status(401).json({ 
        message: 'Access denied. User not found.',
        code: 'USER_NOT_FOUND'
      });
    }
    
    if (!user.isActive) {
      return res.status(401).json({ 
        message: 'Access denied. User account is deactivated.',
        code: 'USER_INACTIVE'
      });
    }
    
    // Attach user info to request
    req.user = {
      id: decoded.id,
      username: decoded.username,
      iat: decoded.iat,
      exp: decoded.exp
    };
    
    // Add user details from database
    req.userDetails = {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      isActive: user.isActive
    };
    
    next();
    
  } catch (error) {
    console.error('JWT Middleware Error:', error.message);
    
    // Handle specific JWT errors
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        message: 'Access denied. Token has expired.',
        code: 'TOKEN_EXPIRED',
        expiredAt: error.expiredAt
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        message: 'Access denied. Invalid token.',
        code: 'INVALID_TOKEN'
      });
    }
    
    if (error.name === 'NotBeforeError') {
      return res.status(401).json({ 
        message: 'Access denied. Token not active yet.',
        code: 'TOKEN_NOT_ACTIVE',
        notBefore: error.date
      });
    }
    
    // Generic error
    return res.status(401).json({ 
      message: 'Access denied. Token verification failed.',
      code: 'VERIFICATION_FAILED'
    });
  }
}

/**
 * Optional JWT Authentication Middleware
 * Sets req.user if valid token is provided, but doesn't block if no token
 */
function optionalAuthMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      req.user = null;
      return next();
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      req.user = null;
      return next();
    }

    const token = parts[1];
    
    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (!decoded.id || !decoded.username) {
      req.user = null;
      return next();
    }
    
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === decoded.id && u.isActive);
    
    if (!user) {
      req.user = null;
      return next();
    }
    
    req.user = {
      id: decoded.id,
      username: decoded.username,
      iat: decoded.iat,
      exp: decoded.exp
    };
    
    req.userDetails = {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      isActive: user.isActive
    };
    
    next();
    
  } catch (error) {
    // In optional middleware, we don't return errors, just set user to null
    req.user = null;
    next();
  }
}

/**
 * Generate a new JWT token for a user
 * @param {object} user - User object with id and username
 * @param {string} expiresIn - Token expiration time (default: '7d')
 * @returns {string} JWT token
 */
function generateToken(user, expiresIn = '7d') {
  try {
    const payload = {
      id: user.id,
      username: user.username
    };
    
    const options = {
      expiresIn: expiresIn,
      issuer: 'whatsapp-clone',
      audience: 'whatsapp-clone-users'
    };
    
    return jwt.sign(payload, JWT_SECRET, options);
    
  } catch (error) {
    console.error('Token generation error:', error);
    throw new Error('Failed to generate token');
  }
}

/**
 * Verify a JWT token without middleware context
 * @param {string} token - JWT token to verify
 * @returns {object|null} Decoded token payload or null if invalid
 */
function verifyToken(token) {
  try {
    if (!token) {
      return null;
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (!decoded.id || !decoded.username) {
      return null;
    }
    
    // Check if user exists and is active
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === decoded.id && u.isActive);
    
    if (!user) {
      return null;
    }
    
    return {
      id: decoded.id,
      username: decoded.username,
      iat: decoded.iat,
      exp: decoded.exp,
      user: user
    };
    
  } catch (error) {
    console.error('Token verification error:', error);
    return null;
  }
}

/**
 * Extract token from authorization header
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} Token or null if invalid format
 */
function extractToken(authHeader) {
  if (!authHeader) {
    return null;
  }
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }
  
  return parts[1] || null;
}

module.exports = authMiddleware;
module.exports.optionalAuth = optionalAuthMiddleware;
module.exports.generateToken = generateToken;
module.exports.verifyToken = verifyToken;
module.exports.extractToken = extractToken;
