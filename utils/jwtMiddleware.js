const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

const authMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({ 
                success: false, 
                error: 'Access token required' 
            });
        }

        const token = authHeader.split(' ')[1]; // Bearer TOKEN
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Access token required' 
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        console.error('JWT verification error:', error);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false, 
                error: 'Token expired' 
            });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid token' 
            });
        }
        
        return res.status(401).json({ 
            success: false, 
            error: 'Token verification failed' 
        });
    }
};

module.exports = authMiddleware;
