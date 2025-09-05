// =====================================
// GLOBAL VARIABLES
// =====================================
let socket;
let currentUser = '';
let currentChatWith = '';
let currentRoom = '';
let isTyping = false;
let typingTimeout;
let userChats = new Map();
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let isCallActive = false;
let callStartTime = null;
let callTimer = null;

// =====================================
// APP INITIALIZATION
// =====================================
document.addEventListener('DOMContentLoaded', () => {
    showLoadingScreen();
    
    // Check if user is already logged in
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    
    setTimeout(() => {
        hideLoadingScreen();
        
        if (token && username) {
            initializeChat();
        } else {
            showLogin();
        }
    }, 1500);
    
    // Initialize event listeners
    initializeEventListeners();
});

// =====================================
// EVENT LISTENERS
// =====================================
function initializeEventListeners() {
    // Auth form listeners
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    
    // Message input listeners
    const messageInput = document.getElementById('messageInput');
    messageInput.addEventListener('input', handleMessageInput);
    messageInput.addEventListener('keydown', handleMessageKeydown);
    
    // Search listeners
    document.getElementById('chatSearch').addEventListener('input', handleChatSearch);
    document.getElementById('userSearchInput').addEventListener('input', debounce(handleUserSearch, 300));
    
    // File input listener
    document.getElementById('fileInput').addEventListener('change', handleFileSelect);
    
    // Window events
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Click outside modal to close
    document.addEventListener('click', handleOutsideClick);
    
    // Password strength checker
    document.getElementById('registerPassword').addEventListener('input', checkPasswordStrength);
}

// =====================================
// LOADING SCREEN
// =====================================
function showLoadingScreen() {
    document.getElementById('loadingScreen').style.display = 'flex';
}

function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loadingScreen');
    loadingScreen.style.opacity = '0';
    setTimeout(() => {
        loadingScreen.style.display = 'none';
        loadingScreen.style.opacity = '1';
    }, 300);
}

// =====================================
// AUTHENTICATION
// =====================================
function showLogin() {
    hideAllPages();
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('loginUsername').focus();
}

function showRegister() {
    hideAllPages();
    document.getElementById('registerPage').style.display = 'flex';
    document.getElementById('registerUsername').focus();
}

function hideAllPages() {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('registerPage').style.display = 'none';
    document.getElementById('chatContainer').style.display = 'none';
}

async function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    
    if (!username || !password) {
        showError('loginError', 'Username dan password harus diisi');
        return;
    }
    
    setButtonLoading(submitBtn, true);
    hideError('loginError');
    
    try {
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('username', data.user.username);
            
            showToast('Berhasil masuk!', 'success');
            initializeChat();
        } else {
            showError('loginError', data.message || 'Login gagal');
        }
    } catch (error) {
        console.error('Login error:', error);
        showError('loginError', 'Terjadi kesalahan. Silakan coba lagi.');
    } finally {
        setButtonLoading(submitBtn, false);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    
    if (!username || !password || !confirmPassword) {
        showError('registerError', 'Semua field harus diisi');
        return;
    }
    
    if (password !== confirmPassword) {
        showError('registerError', 'Password dan konfirmasi password tidak sama');
        return;
    }
    
    if (password.length < 6) {
        showError('registerError', 'Password minimal 6 karakter');
        return;
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        showError('registerError', 'Username hanya boleh mengandung huruf, angka, dan underscore');
        return;
    }
    
    setButtonLoading(submitBtn, true);
    hideError('registerError');
    hideError('registerSuccess');
    
    try {
        const response = await fetch('/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showSuccess('registerSuccess', 'Akun berhasil dibuat! Silakan login.');
            document.getElementById('registerForm').reset();
            
            setTimeout(() => {
                showLogin();
            }, 2000);
        } else {
            showError('registerError', data.message || 'Registrasi gagal');
        }
    } catch (error) {
        console.error('Register error:', error);
        showError('registerError', 'Terjadi kesalahan. Silakan coba lagi.');
    } finally {
        setButtonLoading(submitBtn, false);
    }
}

function logout() {
    if (confirm('Yakin ingin keluar?')) {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        
        if (socket) {
            socket.disconnect();
        }
        
        showToast('Berhasil keluar', 'info');
        showLogin();
    }
}

// =====================================
// CHAT INITIALIZATION
// =====================================
function initializeChat() {
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    
    if (!token || !username) {
        showLogin();
        return;
    }
    
    currentUser = username;
    
    // Update UI
    document.getElementById('currentUsername').textContent = username;
    document.getElementById('userAvatar').textContent = username.charAt(0).toUpperCase();
    document.getElementById('settingsUsername').textContent = username;
    
    // Show chat interface
    hideAllPages();
    document.getElementById('chatContainer').style.display = 'flex';
    
    // Initialize Socket.IO
    initializeSocket(token);
    
    // Show welcome screen initially
    showWelcomeScreen();
}

function initializeSocket(token) {
    socket = io({
        auth: { token }
    });
    
    // Connection events
    socket.on('connect', () => {
        console.log('Connected to server');
        hideConnectionStatus();
        showToast('Terhubung ke server', 'success');
    });
    
    socket.on('disconnect', (reason) => {
        console.log('Disconnected:', reason);
        showConnectionStatus('Terputus dari server', false, 'fas fa-exclamation-triangle');
    });
    
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        showConnectionStatus('Gagal terhubung ke server', false, 'fas fa-times');
    });
    
    // Chat events
    socket.on('chat:list', handleChatList);
    socket.on('dm:message', handleNewMessage);
    socket.on('chat:new_message', handleNewMessageNotification);
    socket.on('user:status', handleUserStatus);
    socket.on('typing:start', handleTypingStart);
    socket.on('typing:stop', handleTypingStop);
    
    // Call events
    setupCallEvents();
}

// =====================================
// CHAT FUNCTIONALITY
// =====================================
function handleChatList(chats) {
    const chatList = document.getElementById('chatList');
    chatList.innerHTML = '';
    
    if (!chats || chats.length === 0) {
        chatList.innerHTML = `
            <div class="chat-list-empty">
                <i class="fas fa-comments"></i>
                <p>Belum ada percakapan</p>
                <p style="font-size: 12px; margin-top: 8px;">Mulai chat baru dengan mencari pengguna</p>
            </div>
        `;
        return;
    }
    
    chats.forEach(chat => {
        const chatItem = createChatItem(chat);
        chatList.appendChild(chatItem);
        userChats.set(chat.username, chat);
    });
}

function createChatItem(chat) {
    const chatItem = document.createElement('div');
    chatItem.className = 'chat-item';
    chatItem.setAttribute('data-chat', chat.username);
    
    const timeString = formatTime(chat.lastMessage.timestamp);
    const isOnline = chat.status === 'online';
    
    chatItem.innerHTML = `
        <div class="avatar">
            ${chat.username.charAt(0).toUpperCase()}
            <div class="status-indicator ${isOnline ? 'status-online' : 'status-offline'}"></div>
        </div>
        <div class="chat-info">
            <div class="chat-name">${escapeHtml(chat.username)}</div>
            <div class="last-message">
                ${chat.lastMessage.from === currentUser ? 'Anda: ' : ''}${escapeHtml(chat.lastMessage.text || 'Media')}
            </div>
        </div>
        <div class="chat-meta">
            <div class="chat-time">${timeString}</div>
            ${chat.unreadCount > 0 ? `<div class="unread-count">${chat.unreadCount}</div>` : ''}
        </div>
    `;
    
    chatItem.addEventListener('click', () => openChat(chat.username));
    
    return chatItem;
}

function openChat(username) {
    currentChatWith = username;
    
    // Close sidebar on mobile
    if (window.innerWidth <= 768) {
        closeSidebar();
    }
    
    // Update active chat
    updateActiveChatInSidebar(username);
    
    // Update chat header
    document.getElementById('chatName').textContent = username;
    document.getElementById('chatAvatar').textContent = username.charAt(0).toUpperCase();
    
    // Show chat interface
    showChatInterface();
    
    // Join room and load messages
    socket.emit('dm:join', username, (response) => {
        if (response.success) {
            currentRoom = response.roomId;
            displayMessages(response.messages);
            scrollToBottom();
        } else {
            showToast('Gagal membuka chat', 'error');
        }
    });
    
    // Update user status
    updateChatUserStatus(username);
}

function showChatInterface() {
    document.getElementById('welcomeScreen').style.display = 'none';
    document.getElementById('chatHeader').style.display = 'flex';
    document.getElementById('messagesContainer').style.display = 'block';
    document.getElementById('inputContainer').style.display = 'block';
    
    // Focus message input
    document.getElementById('messageInput').focus();
}

function showWelcomeScreen() {
    document.getElementById('welcomeScreen').style.display = 'flex';
    document.getElementById('chatHeader').style.display = 'none';
    document.getElementById('messagesContainer').style.display = 'none';
    document.getElementById('inputContainer').style.display = 'none';
    
    currentChatWith = '';
    currentRoom = '';
}

function displayMessages(messages) {
    const messagesList = document.getElementById('messagesList');
    messagesList.innerHTML = '';
    
    messages.forEach(message => {
        const messageElement = createMessageElement(message);
        messagesList.appendChild(messageElement);
    });
    
    scrollToBottom();
}

function createMessageElement(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.from === currentUser ? 'own' : ''}`;
    messageDiv.setAttribute('data-message-id', message.id);
    
    const time = new Date(message.timestamp).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    let mediaContent = '';
    if (message.media) {
        const mediaType = getMediaType(message.media);
        if (mediaType === 'image') {
            mediaContent = `<div class="message-media"><img src="${message.media}" alt="Image" onclick="openImageModal('${message.media}')"></div>`;
        } else if (media
