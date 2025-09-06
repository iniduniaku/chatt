const validateUsername = (username) => {
    const errors = [];
    
    if (!username) {
        errors.push('Username is required');
        return { isValid: false, errors };
    }
    
    if (typeof username !== 'string') {
        errors.push('Username must be a string');
    }
    
    if (username.length < 3) {
        errors.push('Username must be at least 3 characters long');
    }
    
    if (username.length > 20) {
        errors.push('Username must not exceed 20 characters');
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        errors.push('Username can only contain letters, numbers, and underscores');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};

const validatePassword = (password) => {
    const errors = [];
    
    if (!password) {
        errors.push('Password is required');
        return { isValid: false, errors };
    }
    
    if (typeof password !== 'string') {
        errors.push('Password must be a string');
    }
    
    if (password.length < 6) {
        errors.push('Password must be at least 6 characters long');
    }
    
    if (password.length > 128) {
        errors.push('Password must not exceed 128 characters');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};

const validateEmail = (email) => {
    const errors = [];
    
    if (!email) {
        errors.push('Email is required');
        return { isValid: false, errors };
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        errors.push('Please enter a valid email address');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};

module.exports = {
    validateUsername,
    validatePassword,
    validateEmail
};
