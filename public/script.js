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
    
    // Page visibility handling
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
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
    
    // Request notification permission
    requestNotificationPermission();
    
    // Load chat list from server
    loadChatList();
}

function initializeSocket(token) {
    socket = io({
        auth: { token }
    });
    
    // Connection events
    socket.on('connect', () => {
        console.log('✅ Connected to server');
        hideConnectionStatus();
        showToast('Terhubung ke server', 'success');
    });
    
    socket.on('disconnect', (reason) => {
        console.log('❌ Disconnected:', reason);
        showConnectionStatus('Terputus dari server', false, 'fas fa-exclamation-triangle');
    });
    
    socket.on('connect_error', (error) => {
        console.error('❌ Connection error:', error);
        showConnectionStatus('Gagal terhubung ke server', false, 'fas fa-times');
    });
    
    // Chat events
    socket.on('chat:list', handleChatList);
    socket.on('dm:message', handleNewMessage);
    socket.on('dm:delete', handleMessageDelete);
    socket.on('chat:new_message', handleNewMessageNotification);
    socket.on('chat:cleared', handleChatCleared);
    socket.on('user:status', handleUserStatus);
    socket.on('typing:start', handleTypingStart);
    socket.on('typing:stop', handleTypingStop);
    socket.on('message:read', handleMessageRead);
    
    // Call events
    setupCallEvents();
}

// =====================================
// CHAT LIST MANAGEMENT
// =====================================
async function loadChatList() {
    try {
        const response = await fetch('/chats', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (response.ok) {
            const chats = await response.json();
            handleChatList(chats);
        } else {
            console.error('Failed to load chat list');
        }
    } catch (error) {
        console.error('Load chat list error:', error);
    }
}

function handleChatList(chats) {
    console.log('📋 Received chat list:', chats);
    const chatList = document.getElementById('chatList');
    
    if (!chats || chats.length === 0) {
        chatList.innerHTML = `
            <div class="no-chats">
                <i class="fas fa-comments"></i>
                <p>Belum ada percakapan</p>
                <button class="btn btn-primary" onclick="showUserSearch()">
                    <i class="fas fa-user-plus"></i>
                    <span>Mulai Chat</span>
                </button>
            </div>
        `;
        userChats.clear();
        return;
    }
    
    // Clear existing chats
    chatList.innerHTML = '';
    userChats.clear();
    
    // Sort chats by last message timestamp (newest first)
    const sortedChats = chats.sort((a, b) => {
        const timeA = a.lastMessage ? new Date(a.lastMessage.timestamp).getTime() : 0;
        const timeB = b.lastMessage ? new Date(b.lastMessage.timestamp).getTime() : 0;
        return timeB - timeA;
    });
    
    sortedChats.forEach(chat => {
        const chatItem = createChatItem(chat);
        chatList.appendChild(chatItem);
        userChats.set(chat.username, chat);
    });
    
    // Update page title with unread count
    updatePageTitle();
}

function createChatItem(chat) {
    const chatItem = document.createElement('div');
    chatItem.className = 'chat-item';
    chatItem.setAttribute('data-chat', chat.username);
    
    // Handle case where there might not be a last message yet
    let timeString = '';
    let lastMessageText = 'Mulai percakapan';
    let lastMessageFrom = '';
    
    if (chat.lastMessage) {
        timeString = formatTime(chat.lastMessage.timestamp);
        lastMessageText = chat.lastMessage.text || 'Media';
        lastMessageFrom = chat.lastMessage.from === currentUser ? 'Anda: ' : '';
    }
    
    const isOnline = chat.status === 'online';
    const unreadCount = chat.unreadCount || 0;
    
    chatItem.innerHTML = `
        <div class="chat-info" onclick="openChat('${escapeHtml(chat.username)}')">
            <div class="chat-avatar">
                ${chat.username.charAt(0).toUpperCase()}
                <div class="status-indicator ${isOnline ? 'online' : 'offline'}"></div>
            </div>
            <div class="chat-details">
                <div class="chat-name">${escapeHtml(chat.username)}</div>
                <div class="chat-last-message ${!chat.lastMessage ? 'placeholder' : ''}">
                    ${lastMessageFrom}${escapeHtml(lastMessageText)}
                </div>
            </div>
            <div class="chat-time">${timeString}</div>
            ${unreadCount > 0 ? `<div class="unread-count">${unreadCount}</div>` : ''}
        </div>
        <div class="chat-actions">
            <button class="delete-chat-btn" onclick="event.stopPropagation(); clearChatHistory('${escapeHtml(chat.username)}')" title="Hapus Chat">
                🗑️
            </button>
        </div>
    `;
    
    // Add current chat highlight
    if (currentChatWith === chat.username) {
        chatItem.classList.add('active');
    }
    
    return chatItem;
}

// =====================================
// CLEAR CHAT FUNCTIONALITY
// =====================================
function clearChatHistory(otherUser) {
    if (!otherUser) {
        otherUser = currentChatWith;
    }
    
    if (!otherUser) {
        showToast('Pilih chat terlebih dahulu', 'warning');
        return;
    }
    
    showConfirmModal(
        'Hapus Chat',
        `Yakin ingin menghapus semua pesan dengan ${otherUser}? Tindakan ini tidak dapat dibatalkan.`,
        () => {
            // Via socket for real-time update
            socket.emit('chat:clear', { otherUser }, (response) => {
                if (response && response.success) {
                    showToast('Chat berhasil dihapus', 'success');
                    
                    // If currently viewing this chat, go back to welcome screen
                    if (currentChatWith === otherUser) {
                        showWelcomeScreen();
                    }
                    
                    // Reload chat list
                    loadChatList();
                } else {
                    showToast('Gagal menghapus chat', 'error');
                }
            });
            
            // Also via HTTP as backup
            fetch(`/chats/${encodeURIComponent(otherUser)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    'Content-Type': 'application/json'
                }
            }).catch(error => {
                console.error('HTTP delete chat error:', error);
            });
        }
    );
}

function clearAllChats() {
    showConfirmModal(
        'Hapus Semua Chat',
        'Yakin ingin menghapus semua percakapan? Tindakan ini tidak dapat dibatalkan.',
        () => {
            // Via socket for real-time update
            socket.emit('chats:clear_all', (response) => {
                if (response && response.success) {
                    showToast('Semua chat berhasil dihapus', 'success');
                    
                    // Go back to welcome screen
                    showWelcomeScreen();
                    
                    // Clear chat list
                    userChats.clear();
                    const chatList = document.getElementById('chatList');
                    chatList.innerHTML = `
                        <div class="no-chats">
                            <i class="fas fa-comments"></i>
                            <p>Belum ada percakapan</p>
                            <button class="btn btn-primary" onclick="showUserSearch()">
                                <i class="fas fa-user-plus"></i>
                                <span>Mulai Chat</span>
                            </button>
                        </div>
                    `;
                    
                    updatePageTitle();
                } else {
                    showToast('Gagal menghapus semua chat', 'error');
                }
            });
            
            // Also via HTTP as backup
            fetch('/chats', {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    'Content-Type': 'application/json'
                }
            }).catch(error => {
                console.error('HTTP clear all chats error:', error);
            });
        }
    );
}

function clearCurrentChatHistory() {
    if (!currentChatWith) {
        showToast('Tidak ada chat yang sedang dibuka', 'warning');
        return;
    }
    
    clearChatHistory(currentChatWith);
}

function handleChatCleared(data) {
    showToast(`Chat dengan ${data.by} telah dihapus`, 'info');
    
    // Reload chat list
    loadChatList();
    
    // If currently viewing this chat, go back to welcome screen
    if (currentChatWith === data.by) {
        showWelcomeScreen();
    }
}

// =====================================
// CONFIRMATION MODAL
// =====================================
function showConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    const titleElement = document.getElementById('confirmTitle');
    const messageElement = document.getElementById('confirmMessage');
    const confirmButton = document.getElementById('confirmAction');
    
    titleElement.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${title}`;
    messageElement.textContent = message;
    
    // Remove existing event listeners
    const newConfirmButton = confirmButton.cloneNode(true);
    confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);
    
    // Add new event listener
    newConfirmButton.addEventListener('click', () => {
        closeModal('confirmModal');
        if (onConfirm) onConfirm();
    });
    
    showModal('confirmModal');
}

// =====================================
// CHAT INFO FUNCTIONALITY
// =====================================
function showChatInfo() {
    if (!currentChatWith) {
        showToast('Pilih chat terlebih dahulu', 'warning');
        return;
    }
    
    document.getElementById('chatInfoUsername').textContent = currentChatWith;
    
    const chat = userChats.get(currentChatWith);
    const statusElement = document.getElementById('chatInfoStatus');
    
    if (chat && chat.status === 'online') {
        statusElement.textContent = 'Online';
        statusElement.style.color = 'var(--text-success)';
    } else if (chat && chat.lastSeen) {
        statusElement.textContent = getLastSeenText(chat.lastSeen);
        statusElement.style.color = 'var(--text-muted)';
    } else {
        statusElement.textContent = 'Offline';
        statusElement.style.color = 'var(--text-muted)';
    }
    
    showModal('chatInfoModal');
}

// =====================================
// ENHANCED MESSAGE HANDLING
// =====================================
function handleNewMessage(message) {
    console.log('📨 New message received:', message);
    
    // Check if this message is for current open chat
    const isCurrentChat = (currentChatWith === message.from || currentChatWith === message.to);
    
    if (isCurrentChat && currentRoom) {
        // Add message to current chat view
        const messageElement = createMessageElement(message);
        document.getElementById('messagesList').appendChild(messageElement);
        scrollToBottom();
        
        // Mark as read if user is viewing the chat and message is from other user
        if (message.from === currentChatWith && document.hasFocus()) {
            setTimeout(() => {
                markMessageAsRead(message.id);
            }, 500);
        }
    }
    
    // Show notification only if not in current chat or window is not focused
    if (!isCurrentChat || !document.hasFocus()) {
        showMessageNotification(message);
    }
    
    // Play notification sound (optional)
    if (!isCurrentChat) {
        playNotificationSound();
    }
}

function handleMessageDelete(data) {
    console.log('🗑️ Message delete received:', data);
    
    const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
    if (messageElement) {
        if (data.forEveryone) {
            messageElement.remove();
        } else if (data.by === currentUser) {
            const bubble = messageElement.querySelector('.message-bubble');
            bubble.innerHTML = `
                <div class="message-content" style="font-style: italic; opacity: 0.7;">
                    <i class="fas fa-ban"></i> Pesan dihapus
                </div>
                <div class="message-footer">
                    <span class="message-time">${bubble.querySelector('.message-time').textContent}</span>
                </div>
            `;
        }
    }
}

function handleNewMessageNotification(data) {
    console.log('🔔 Message notification received:', data);
    
    // Show notification if not in current chat
    if (currentChatWith !== data.from && currentChatWith !== data.to) {
        showMessageNotification(data);
        playNotificationSound();
    }
}

function createMessageElement(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.from === currentUser ? 'own' : ''}`;
    messageDiv.setAttribute('data-message-id', message.id);
    
    // Check if message is deleted for current user
    if (message.deletedFor && message.deletedFor.includes(currentUser)) {
        messageDiv.innerHTML = `
            <div class="message-bubble">
                <div class="message-content" style="font-style: italic; opacity: 0.7;">
                    <i class="fas fa-ban"></i> Pesan dihapus
                </div>
                <div class="message-footer">
                    <span class="message-time">${formatTime(message.timestamp)}</span>
                </div>
            </div>
        `;
        return messageDiv;
    }
    
    const time = new Date(message.timestamp).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    let mediaContent = '';
    if (message.media) {
        const mediaType = getMediaType(message.media);
        if (mediaType === 'image') {
            mediaContent = `<div class="message-media"><img src="${message.media}" alt="Image" onclick="openImageModal('${message.media}')"></div>`;
        } else if (mediaType === 'video') {
            mediaContent = `<div class="message-media"><video src="${message.media}" controls></video></div>`;
        } else if (mediaType === 'audio') {
            mediaContent = `<div class="message-media"><audio src="${message.media}" controls></audio></div>`;
        }
    }
    
    let textContent = '';
    if (message.text) {
        textContent = `<div class="message-content">${escapeHtml(message.text)}</div>`;
    }
    
    const isRead = message.readBy && message.readBy.includes(currentChatWith);
    const statusIcon = message.from === currentUser ? (isRead ? 'fa-check-double' : 'fa-check') : '';
    
    messageDiv.innerHTML = `
        <div class="message-bubble">
            ${mediaContent}
            ${textContent}
            <div class="message-footer">
                <span class="message-time">${time}</span>
                ${statusIcon ? `<div class="message-status ${isRead ? 'read' : ''}"><i class="fas ${statusIcon}"></i></div>` : ''}
            </div>
        </div>
    `;
    
    // Add context menu for own messages
    if (message.from === currentUser) {
        messageDiv.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showMessageContextMenu(e, message.id);
        });
    }
    
    return messageDiv;
}

// =====================================
// ENHANCED NOTIFICATIONS
// =====================================
function showMessageNotification(message) {
    const from = message.from === currentUser ? message.to : message.from;
    const messageText = message.text || 'Mengirim media';
    
    // Browser notification if supported and permitted
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(`Pesan baru dari ${from}`, {
            body: messageText.length > 50 ? messageText.substring(0, 50) + '...' : messageText,
            icon: '/favicon.ico',
            tag: `message-${from}`,
            renotify: true
        });
        
        notification.onclick = () => {
            window.focus();
            openChat(from);
            notification.close();
        };
        
        setTimeout(() => notification.close(), 5000);
    }
    
    // In-app toast notification
    showToast(`${from}: ${messageText}`, 'info', () => {
        openChat(from);
    });
}

function updatePageTitle() {
    let totalUnread = 0;
    userChats.forEach(chat => {
        totalUnread += chat.unreadCount || 0;
    });
    
    const baseTitle = 'ChatVibe';
    document.title = totalUnread > 0 ? `(${totalUnread}) ${baseTitle}` : baseTitle;
}

function playNotificationSound() {
    if (window.AudioContext || window.webkitAudioContext) {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
            
            gainNode.gain.setValueAtTime(0, audioContext.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.2);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.2);
        } catch (error) {
            console.log('Could not play notification sound:', error);
        }
    }
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                showToast('Notifikasi desktop diaktifkan', 'success');
            }
        });
    }
}

// =====================================
// IMPROVED CHAT OPENING
// =====================================
function openChat(username) {
    const previousChat = currentChatWith;
    currentChatWith = username;
    
    // Close sidebar on mobile
    if (window.innerWidth <= 768) {
        closeSidebar();
    }
    
    // Update active chat in sidebar
    updateActiveChatInSidebar(username);
    
    // Clear unread count for this chat
    clearUnreadCount(username);
    
    // Update chat header
    document.getElementById('chatName').textContent = username;
    document.getElementById('chatAvatar').textContent = username.charAt(0).toUpperCase();
    
    // Show chat interface
    showChatInterface();
    
    // Join room and load messages
    socket.emit('dm:join', username, (response) => {
        if (response && response.success) {
            currentRoom = response.roomId;
            
            // Only clear messages if switching to different chat
            if (previousChat !== username) {
                document.getElementById('messagesList').innerHTML = '';
            }
            
            displayMessages(response.messages || []);
            scrollToBottom();
            
            // Mark all messages as read
            markAllMessagesAsRead(response.messages || []);
        } else {
            showToast('Gagal membuka chat', 'error');
        }
    });
    
    // Update user status
    updateChatUserStatus(username);
    
    // Update page title
    updatePageTitle();
}

function clearUnreadCount(username) {
    const chatItem = document.querySelector(`[data-chat="${username}"]`);
    if (chatItem) {
        const unreadElement = chatItem.querySelector('.unread-count');
        if (unreadElement) {
            unreadElement.remove();
        }
    }
    
    // Update in memory
    const chat = userChats.get(username);
    if (chat) {
        chat.unreadCount = 0;
        userChats.set(username, chat);
    }
}

function markAllMessagesAsRead(messages) {
    if (!messages || !currentRoom) return;
    
    const unreadMessages = messages.filter(msg => 
        msg.from === currentChatWith && 
        (!msg.readBy || !msg.readBy.includes(currentUser))
    );
    
    unreadMessages.forEach(message => {
        setTimeout(() => {
            markMessageAsRead(message.id);
        }, 100);
    });
}

// =====================================
// PAGE VISIBILITY HANDLING
// =====================================
function handleVisibilityChange() {
    if (!document.hidden && currentChatWith) {
        // Mark messages as read when user comes back to page
        setTimeout(() => {
            const messages = document.querySelectorAll(`[data-message-id]`);
            messages.forEach(msgElement => {
                const messageId = msgElement.getAttribute('data-message-id');
                if (messageId && !messageId.startsWith('temp-')) {
                    markMessageAsRead(messageId);
                }
            });
        }, 500);
        
        // Clear unread count
        clearUnreadCount(currentChatWith);
        updatePageTitle();
    }
}

function handleWindowFocus() {
    if (currentChatWith) {
        // Clear unread count for current chat
        clearUnreadCount(currentChatWith);
        updatePageTitle();
    }
}

// =====================================
// MESSAGE SENDING (Updated)
// =====================================
async function sendTextMessage(messageData) {
    const messageInput = document.getElementById('messageInput');
    const originalMessage = messageData.text;
    
    // Clear input immediately for better UX
    messageInput.value = '';
    messageInput.style.height = 'auto';
    handleMessageInput({ target: messageInput });
    
    // Create optimistic message (show immediately)
    const optimisticMessage = {
        id: 'temp-' + Date.now(),
        from: currentUser,
        to: messageData.to,
        text: messageData.text,
        timestamp: Date.now(),
        pending: true
    };
    
    // Add to UI immediately
    const messageElement = createMessageElement(optimisticMessage);
    messageElement.classList.add('sending');
    document.getElementById('messagesList').appendChild(messageElement);
    scrollToBottom();
    
    try {
        socket.emit('dm:message', messageData, (response) => {
            // Remove optimistic message
            messageElement.remove();
            
            if (!response || !response.success) {
                showToast('Gagal mengirim pesan', 'error');
                // Restore message in input
                messageInput.value = originalMessage;
                handleMessageInput({ target: messageInput });
            }
        });
    } catch (error) {
        console.error('❌ Send message error:', error);
        messageElement.remove();
        showToast('Gagal mengirim pesan', 'error');
        messageInput.value = originalMessage;
        handleMessageInput({ target: messageInput });
    }
}

// =====================================
// SISA FUNGSI LAINNYA
// =====================================

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
    
    // Filter out messages deleted for current user
    const visibleMessages = messages.filter(message => 
        !message.deletedFor || !message.deletedFor.includes(currentUser)
    );
    
    visibleMessages.forEach(message => {
        const messageElement = createMessageElement(message);
        messagesList.appendChild(messageElement);
    });
    
    scrollToBottom();
}

function handleMessageInput(e) {
    const input = e.target;
    
    // Auto-resize textarea
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    
    // Show/hide send button
    const sendBtn = document.getElementById('sendBtn');
    const micBtn = document.getElementById('micBtn');
    
    if (input.value.trim()) {
        sendBtn.style.display = 'flex';
        micBtn.style.display = 'none';
        
        // Send typing indicator
        if (!isTyping && currentChatWith) {
            isTyping = true;
            socket.emit('typing:start', { to: currentChatWith });
        }
        
        // Clear existing timeout
        clearTimeout(typingTimeout);
        
        // Set timeout to stop typing
        typingTimeout = setTimeout(() => {
            isTyping = false;
            if (currentChatWith) {
                socket.emit('typing:stop', { to: currentChatWith });
            }
        }, 1000);
    } else {
        sendBtn.style.display = 'none';
        micBtn.style.display = 'flex';
        
        if (isTyping && currentChatWith) {
            isTyping = false;
            socket.emit('typing:stop', { to: currentChatWith });
        }
    }
}

function handleMessageKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const text = messageInput.value.trim();
    const filePreview = document.getElementById('filePreview');
    
    if (!text && filePreview.style.display === 'none') {
        return;
    }
    
    if (!currentChatWith) {
        showToast('Pilih chat terlebih dahulu', 'warning');
        return;
    }
    
    const messageData = {
        to: currentChatWith,
        text: text
    };
    
    // Handle file attachment
    const fileInput = document.getElementById('fileInput');
    if (fileInput.files[0]) {
        uploadFileAndSend(fileInput.files[0], messageData);
    } else {
        sendTextMessage(messageData);
    }
}

async function uploadFileAndSend(file, messageData) {
    const formData = new FormData();
    formData.append('media', file);
    
    // Show upload progress
    showToast('Mengunggah file...', 'info');
    
    try {
        const response = await fetch('/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            messageData.media = data.url;
            
            socket.emit('dm:message', messageData, (response) => {
                if (response && response.success) {
                    removeFilePreview();
                    document.getElementById('messageInput').value = '';
                    showToast('File berhasil dikirim', 'success');
                } else {
                    showToast('Gagal mengirim file', 'error');
                }
            });
        } else {
            showToast(data.error || 'Gagal mengunggah file', 'error');
        }
    } catch (error) {
        console.error('Upload error:', error);
        showToast('Gagal mengunggah file', 'error');
    }
}

// =====================================
// FILE HANDLING
// =====================================
function showAttachmentMenu() {
    showModal('attachmentModal');
}

function selectFile(type) {
    const fileInput = document.getElementById('fileInput');
    
    switch (type) {
        case 'image':
            fileInput.accept = 'image/*';
            break;
        case 'video':
            fileInput.accept = 'video/*';
            break;
        case 'audio':
            fileInput.accept = 'audio/*';
            break;
        default:
            fileInput.accept = 'image/*,video/*,audio/*';
    }
    
    fileInput.click();
    closeModal('attachmentModal');
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate file size (50MB)
    if (file.size > 50 * 1024 * 1024) {
        showToast('File terlalu besar (maksimal 50MB)', 'error');
        return;
    }
    
    // Show file preview
    showFilePreview(file);
}

function showFilePreview(file) {
    const filePreview = document.getElementById('filePreview');
    const previewMedia = filePreview.querySelector('.preview-media');
    
    const mediaType = getMediaType(file.name);
    
    if (mediaType === 'image') {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.onload = () => URL.revokeObjectURL(img.src);
        previewMedia.innerHTML = '';
        previewMedia.appendChild(img);
    } else if (mediaType === 'video') {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.controls = true;
        previewMedia.innerHTML = '';
        previewMedia.appendChild(video);
    } else if (mediaType === 'audio') {
        previewMedia.innerHTML = `
            <div style="padding: 20px; text-align: center;">
                <i class="fas fa-music" style="font-size: 2rem; margin-bottom: 10px;"></i>
                <p>${file.name}</p>
                <p style="font-size: 12px; color: var(--text-muted);">${formatFileSize(file.size)}</p>
            </div>
        `;
    }
    
    filePreview.style.display = 'block';
}

function removeFilePreview() {
    const filePreview = document.getElementById('filePreview');
    const fileInput = document.getElementById('fileInput');
    
    filePreview.style.display = 'none';
    fileInput.value = '';
}

function getMediaType(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        return 'image';
    } else if (['mp4', 'mov', 'avi', 'webm'].includes(ext)) {
        return 'video';
    } else if (['mp3', 'wav', 'ogg', 'mpeg'].includes(ext)) {
        return 'audio';
    }
    
    return 'unknown';
}

// =====================================
// USER SEARCH
// =====================================
function showUserSearch() {
    showModal('userSearchModal');
    document.getElementById('userSearchInput').focus();
}

async function handleUserSearch(e) {
    const query = e.target.value.trim();
    const resultsContainer = document.getElementById('userSearchResults');
    const loadingContainer = document.getElementById('userSearchLoading');
    
    if (query.length < 2) {
        resultsContainer.innerHTML = `
            <div class="search-placeholder">
                <i class="fas fa-users"></i>
                <p>Masukkan minimal 2 karakter untuk mencari</p>
            </div>
        `;
        return;
    }
    
    loadingContainer.style.display = 'block';
    resultsContainer.innerHTML = '';
    
    try {
        const response = await fetch(`/users/search?q=${encodeURIComponent(query)}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const users = await response.json();
        
        loadingContainer.style.display = 'none';
        
        if (users.length === 0) {
            resultsContainer.innerHTML = `
                <div class="search-placeholder">
                    <i class="fas fa-user-times"></i>
                    <p>Tidak ditemukan pengguna dengan username "${escapeHtml(query)}"</p>
                </div>
            `;
            return;
        }
        
        resultsContainer.innerHTML = users.map(user => `
            <div class="search-result-item" onclick="startChatWithUser('${escapeHtml(user.username)}')">
                <div class="avatar">${user.username.charAt(0).toUpperCase()}</div>
                <div class="search-result-info">
                    <div class="search-result-name">${escapeHtml(user.username)}</div>
                    <div class="search-result-status">Klik untuk mulai chat</div>
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Search error:', error);
        loadingContainer.style.display = 'none';
        resultsContainer.innerHTML = `
            <div class="search-placeholder">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Terjadi kesalahan saat mencari pengguna</p>
            </div>
        `;
    }
}

function startChatWithUser(username) {
    closeModal('userSearchModal');
    openChat(username);
    document.getElementById('userSearchInput').value = '';
}

// =====================================
// CHAT SEARCH
// =====================================
function handleChatSearch(e) {
    const query = e.target.value.toLowerCase().trim();
    const chatItems = document.querySelectorAll('.chat-item');
    const clearBtn = e.target.parentElement.querySelector('.clear-search');
    
    if (query) {
        clearBtn.style.display = 'block';
    } else {
        clearBtn.style.display = 'none';
    }
    
    chatItems.forEach(item => {
        const username = item.querySelector('.chat-name')?.textContent.toLowerCase() || '';
        const lastMessage = item.querySelector('.chat-last-message')?.textContent.toLowerCase() || '';
        
        if (username.includes(query) || lastMessage.includes(query)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function clearChatSearch() {
    const searchInput = document.getElementById('chatSearch');
    const clearBtn = document.querySelector('.clear-search');
    
    searchInput.value = '';
    clearBtn.style.display = 'none';
    
    // Show all chat items
    document.querySelectorAll('.chat-item').forEach(item => {
        item.style.display = 'flex';
    });
    
    searchInput.focus();
}

// =====================================
// TYPING INDICATORS
// =====================================
function handleTypingStart(data) {
    if (data.from === currentChatWith) {
        const typingIndicator = document.getElementById('typingIndicator');
        typingIndicator.classList.add('show');
        scrollToBottom();
    }
}

function handleTypingStop(data) {
    if (data.from === currentChatWith) {
        const typingIndicator = document.getElementById('typingIndicator');
        typingIndicator.classList.remove('show');
    }
}

// =====================================
// USER STATUS
// =====================================
function handleUserStatus(data) {
    updateUserStatusInChatList(data.username, data.status, data.lastSeen);
    
    if (currentChatWith === data.username) {
        updateChatUserStatus(data.username, data.status, data.lastSeen);
    }
}

function updateUserStatusInChatList(username, status, lastSeen) {
    const chatItem = document.querySelector(`[data-chat="${username}"]`);
    if (chatItem) {
        const statusIndicator = chatItem.querySelector('.status-indicator');
        if (statusIndicator) {
            statusIndicator.className = `status-indicator ${status === 'online' ? 'online' : 'offline'}`;
        }
    }
}

function updateChatUserStatus(username, status = null, lastSeen = null) {
    const chatStatus = document.getElementById('chatStatus');
    if (!chatStatus) return;
    
    const chat = userChats.get(username);
    const currentStatus = status || (chat && chat.status);
    const currentLastSeen = lastSeen || (chat && chat.lastSeen);
    
    if (currentStatus === 'online') {
        chatStatus.textContent = 'online';
        chatStatus.style.color = 'var(--text-success)';
    } else if (currentLastSeen) {
        const lastSeenText = getLastSeenText(currentLastSeen);
        chatStatus.textContent = lastSeenText;
        chatStatus.style.color = 'var(--text-muted)';
    } else {
        chatStatus.textContent = 'offline';
        chatStatus.style.color = 'var(--text-muted)';
    }
}

function getLastSeenText(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (minutes < 1) return 'baru saja';
    if (minutes < 60) return `${minutes} menit lalu`;
    if (hours < 24) return `${hours} jam lalu`;
    if (days < 7) return `${days} hari lalu`;
    
    return new Date(timestamp).toLocaleDateString('id-ID');
}

// =====================================
// MESSAGE READ HANDLING
// =====================================
function handleMessageRead(data) {
    const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
    if (messageElement && data.readBy) {
        const statusElement = messageElement.querySelector('.message-status');
        if (statusElement && data.readBy.includes(currentChatWith)) {
            statusElement.classList.add('read');
        }
    }
}

function markMessageAsRead(messageId) {
    if (!currentRoom || !messageId || messageId.startsWith('temp-')) return;
    
    socket.emit('message:read', { 
        messageId: messageId, 
        roomId: currentRoom 
    });
}

// =====================================
// CALL FUNCTIONALITY
// =====================================
function setupCallEvents() {
    socket.on('call:offer', handleCallOffer);
    socket.on('call:answer', handleCallAnswer);
    socket.on('call:candidate', handleCallCandidate);
    socket.on('call:end', handleCallEnd);
    socket.on('call:error', handleCallError);
    
    socket.on('video:offer', handleVideoOffer);
    socket.on('video:answer', handleVideoAnswer);
    socket.on('video:candidate', handleVideoCandidate);
    socket.on('video:end', handleVideoEnd);
    socket.on('video:error', handleVideoError);
}

async function startVoiceCall() {
    if (!currentChatWith) {
        showToast('Pilih chat untuk memulai panggilan', 'warning');
        return;
    }
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setupPeerConnection();
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('call:offer', {
            to: currentChatWith,
            offer: offer
        });
        
        showCallInterface('voice', 'Menghubungi...');
        isCallActive = true;
        
    } catch (error) {
        console.error('Voice call error:', error);
        showToast('Gagal memulai panggilan suara', 'error');
    }
}

async function startVideoCall() {
    if (!currentChatWith) {
        showToast('Pilih chat untuk memulai panggilan', 'warning');
        return;
    }
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        setupPeerConnection();
        
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('video:offer', {
            to: currentChatWith,
            offer: offer
        });
        
        showCallInterface('video', 'Menghubungi...');
        document.getElementById('videoContainer').style.display = 'flex';
        document.querySelector('.camera-btn').style.display = 'block';
        isCallActive = true;
        
    } catch (error) {
        console.error('Video call error:', error);
        showToast('Gagal memulai panggilan video', 'error');
    }
}

function setupPeerConnection() {
    const configuration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };
    
    peerConnection = new RTCPeerConnection(configuration);
    
    // Add local stream to peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }
    
    // Handle remote stream
    peerConnection.ontrack = (event) => {
        remoteStream = event.streams[0];
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo) {
            remoteVideo.srcObject = remoteStream;
        }
    };
    
    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            const eventType = document.getElementById('videoContainer').style.display === 'flex' ? 
                'video:candidate' : 'call:candidate';
            
            socket.emit(eventType, {
                to: currentChatWith,
                candidate: event.candidate
            });
        }
    };
    
    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'failed') {
            endCall();
            showToast('Panggilan terputus', 'error');
        }
    };
}

async function handleCallOffer(data) {
    const accept = confirm(`${data.from} menelepon Anda. Terima panggilan?`);
    
    if (accept) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setupPeerConnection();
            
            await peerConnection.setRemoteDescription(data.offer);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            socket.emit('call:answer', {
                to: data.from,
                answer: answer
            });
            
            showCallInterface('voice', 'Terhubung');
            startCallTimer();
            isCallActive = true;
            
        } catch (error) {
            console.error('Answer call error:', error);
            showToast('Gagal menerima panggilan', 'error');
            socket.emit('call:end', { to: data.from });
        }
    } else {
        socket.emit('call:end', { to: data.from });
    }
}

async function handleVideoOffer(data) {
    const accept = confirm(`${data.from} melakukan panggilan video. Terima panggilan?`);
    
    if (accept) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            setupPeerConnection();
            
            const localVideo = document.getElementById('localVideo');
            localVideo.srcObject = localStream;
            
            await peerConnection.setRemoteDescription(data.offer);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            socket.emit('video:answer', {
                to: data.from,
                answer: answer
            });
            
            showCallInterface('video', 'Terhubung');
            document.getElementById('videoContainer').style.display = 'flex';
            document.querySelector('.camera-btn').style.display = 'block';
            startCallTimer();
            isCallActive = true;
            
        } catch (error) {
            console.error('Answer video call error:', error);
            showToast('Gagal menerima panggilan video', 'error');
            socket.emit('video:end', { to: data.from });
        }
    } else {
        socket.emit('video:end', { to: data.from });
    }
}

async function handleCallAnswer(data) {
    try {
        await peerConnection.setRemoteDescription(data.answer);
        document.getElementById('callStatus').textContent = 'Terhubung';
        startCallTimer();
    } catch (error) {
        console.error('Handle call answer error:', error);
        endCall();
        showToast('Gagal menerima jawaban panggilan', 'error');
    }
}

async function handleVideoAnswer(data) {
    try {
        await peerConnection.setRemoteDescription(data.answer);
        document.getElementById('callStatus').textContent = 'Terhubung';
        startCallTimer();
    } catch (error) {
        console.error('Handle video answer error:', error);
        endCall();
        showToast('Gagal menerima jawaban panggilan video', 'error');
    }
}

async function handleCallCandidate(data) {
    try {
        if (peerConnection && peerConnection.remoteDescription) {
            await peerConnection.addIceCandidate(data.candidate);
        }
    } catch (error) {
        console.error('Handle candidate error:', error);
    }
}

async function handleVideoCandidate(data) {
    try {
        if (peerConnection && peerConnection.remoteDescription) {
            await peerConnection.addIceCandidate(data.candidate);
        }
    } catch (error) {
        console.error('Handle video candidate error:', error);
    }
}

function handleCallEnd(data) {
    endCall();
    showToast(`Panggilan dari ${data.from} berakhir`, 'info');
}

function handleVideoEnd(data) {
    endCall();
    showToast(`Panggilan video dari ${data.from} berakhir`, 'info');
}

function handleCallError(data) {
    endCall();
    showToast(data.error || 'Terjadi kesalahan pada panggilan', 'error');
}

function handleVideoError(data) {
    endCall();
    showToast(data.error || 'Terjadi kesalahan pada panggilan video', 'error');
}

function showCallInterface(type, status) {
    const callInterface = document.getElementById('callInterface');
    const callUserName = document.getElementById('callUserName');
    const callStatus = document.getElementById('callStatus');
    
    callUserName.textContent = currentChatWith;
    callStatus.textContent = status;
    callInterface.style.display = 'flex';
}

function startCallTimer() {
    callStartTime = Date.now();
    callTimer = setInterval(updateCallDuration, 1000);
}

function updateCallDuration() {
    if (!callStartTime) return;
    
    const elapsed = Date.now() - callStartTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    
    const durationElement = document.getElementById('callDuration');
    if (durationElement) {
        durationElement.textContent = 
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

function toggleMute() {
    if (!localStream) return;
    
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const muteBtn = document.querySelector('.mute-btn');
        
        if (audioTrack.enabled) {
            muteBtn.classList.remove('muted');
            muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        } else {
            muteBtn.classList.add('muted');
            muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        }
    }
}

function toggleCamera() {
    if (!localStream) return;
    
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        const cameraBtn = document.querySelector('.camera-btn');
        
        if (videoTrack.enabled) {
            cameraBtn.classList.remove('off');
            cameraBtn.innerHTML = '<i class="fas fa-video"></i>';
        } else {
            cameraBtn.classList.add('off');
            cameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
        }
    }
}

function endCall() {
    if (isCallActive) {
        const eventType = document.getElementById('videoContainer').style.display === 'flex' ? 
            'video:end' : 'call:end';
        
        socket.emit(eventType, { to: currentChatWith });
    }
    
    // Clean up
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    if (callTimer) {
        clearInterval(callTimer);
        callTimer = null;
    }
    
    callStartTime = null;
    isCallActive = false;
    
    // Hide call interface
    document.getElementById('callInterface').style.display = 'none';
    document.getElementById('videoContainer').style.display = 'none';
    document.querySelector('.camera-btn').style.display = 'none';
    
    // Reset buttons
    const muteBtn = document.querySelector('.mute-btn');
    const cameraBtn = document.querySelector('.camera-btn');
    if (muteBtn) {
        muteBtn.classList.remove('muted');
        muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    }
    if (cameraBtn) {
        cameraBtn.classList.remove('off');
        cameraBtn.innerHTML = '<i class="fas fa-video"></i>';
    }
}

// =====================================
// SETTINGS & MODALS
// =====================================
function showSettings() {
    const username = localStorage.getItem('username');
    document.getElementById('settingsUsername').textContent = username;
    showModal('settingsModal');
}

function showModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.add('show');
    modal.style.display = 'flex';
    
    const focusableElements = modal.querySelectorAll(
        'input, button, textarea, select, [tabindex]:not([tabindex="-1"])'
    );
    
    if (focusableElements.length > 0) {
        focusableElements[0].focus();
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('show');
    
    setTimeout(() => {
        modal.style.display = 'none';
        
        if (modalId === 'userSearchModal') {
            document.getElementById('userSearchInput').value = '';
            document.getElementById('userSearchResults').innerHTML = `
                <div class="search-placeholder">
                    <i class="fas fa-users"></i>
                    <p>Masukkan username untuk mencari pengguna</p>
                </div>
            `;
        }
    }, 300);
}

function handleOutsideClick(e) {
    if (e.target.classList.contains('modal')) {
        const modalId = e.target.id;
        closeModal(modalId);
    }
}

// =====================================
// MOBILE INTERFACE
// =====================================
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('open');
}

function backToChats() {
    showWelcomeScreen();
    updateActiveChatInSidebar(null);
    
    if (window.innerWidth <= 768) {
        toggleSidebar();
    }
}

// =====================================
// UTILITY FUNCTIONS
// =====================================
function updateActiveChatInSidebar(username) {
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });
    
    if (username) {
        const activeItem = document.querySelector(`[data-chat="${username}"]`);
        if (activeItem) {
            activeItem.classList.add('active');
        }
    }
}

function scrollToBottom() {
    const messagesContainer = document.getElementById('messagesContainer');
    if (messagesContainer) {
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 50);
    }
}

// =====================================
// PASSWORD & SECURITY
// =====================================
function togglePassword(inputId) {
    const input = document.getElementById(inputId);
    const icon = input.parentElement.querySelector('.toggle-password');
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

function checkPasswordStrength(e) {
    const password = e.target.value;
    const strengthFill = document.querySelector('.strength-fill');
    const strengthText = document.querySelector('.strength-text');
    
    let strength = 0;
    let strengthLabel = '';
    
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/\d/.test(password)) strength++;
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) strength++;
    
    if (strength <= 2) {
        strengthFill.className = 'strength-fill weak';
        strengthLabel = 'Lemah';
    } else if (strength <= 4) {
        strengthFill.className = 'strength-fill medium';
        strengthLabel = 'Sedang';
    } else {
        strengthFill.className = 'strength-fill strong';
        strengthLabel = 'Kuat';
    }
    
    strengthText.textContent = `Kekuatan password: ${strengthLabel}`;
}

// =====================================
// TOAST NOTIFICATIONS
// =====================================
function showToast(message, type = 'info', onClick = null) {
    const toastContainer = document.getElementById('toastContainer');
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    const titles = {
        success: 'Berhasil',
        error: 'Error',
        warning: 'Peringatan',
        info: 'Info'
    };
    
    toast.innerHTML = `
        <div class="toast-content">
            <div class="toast-icon">
                <i class="fas ${icons[type]}"></i>
            </div>
            <div class="toast-message">
                <div class="toast-title">${titles[type]}</div>
                <div class="toast-text">${message}</div>
            </div>
            <button class="toast-close" onclick="this.parentElement.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="toast-progress"></div>
    `;
    
    if (onClick) {
        toast.style.cursor = 'pointer';
        toast.classList.add('clickable');
        toast.addEventListener('click', onClick);
    }
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = 'slideOutRight 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, 5000);
}

// =====================================
// CONNECTION STATUS
// =====================================
function showConnectionStatus(message, isConnected, icon = 'fas fa-wifi') {
    const statusBar = document.getElementById('connectionStatus');
    const statusIcon = document.getElementById('connectionIcon');
    const statusMessage = document.getElementById('connectionMessage');
    
    statusIcon.className = icon;
    statusMessage.textContent = message;
    
    statusBar.className = `connection-status ${isConnected ? 'connected' : ''} show`;
    
    if (isConnected) {
        setTimeout(() => {
            statusBar.classList.remove('show');
        }, 3000);
    }
}

function hideConnectionStatus() {
    const statusBar = document.getElementById('connectionStatus');
    statusBar.classList.remove('show');
}

// =====================================
// NETWORK STATUS
// =====================================
function handleOnline() {
    showConnectionStatus('Kembali terhubung', true, 'fas fa-wifi');
    
    // Reconnect socket if needed
    if (socket && !socket.connected) {
        socket.connect();
    }
}

function handleOffline() {
    showConnectionStatus('Tidak ada koneksi internet', false, 'fas fa-wifi-slash');
}

// =====================================
// MESSAGE CONTEXT MENU
// =====================================
function showMessageContextMenu(e, messageId) {
    // Remove existing context menu
    const existingMenu = document.querySelector('.message-context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }
    
    const contextMenu = document.createElement('div');
    contextMenu.className = 'message-context-menu';
    contextMenu.innerHTML = `
        <button class="context-menu-item" onclick="deleteMessage('${messageId}', false)">
            <i class="fas fa-trash"></i>
            <span>Hapus untuk saya</span>
        </button>
        <button class="context-menu-item danger" onclick="deleteMessage('${messageId}', true)">
            <i class="fas fa-trash-alt"></i>
            <span>Hapus untuk semua</span>
        </button>
        <button class="context-menu-item" onclick="copyMessage('${messageId}')">
            <i class="fas fa-copy"></i>
            <span>Salin pesan</span>
        </button>
    `;
    
    // Position context menu
    contextMenu.style.position = 'fixed';
    contextMenu.style.top = e.clientY + 'px';
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.zIndex = '1000';
    
    // Adjust position if menu goes off screen
    document.body.appendChild(contextMenu);
    
    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        contextMenu.style.left = (e.clientX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        contextMenu.style.top = (e.clientY - rect.height) + 'px';
    }
    
    // Remove menu when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function removeContextMenu(event) {
            if (!contextMenu.contains(event.target)) {
                contextMenu.remove();
                document.removeEventListener('click', removeContextMenu);
            }
        });
    }, 0);
}

function deleteMessage(messageId, forEveryone) {
    const confirmMessage = forEveryone ? 
        'Yakin ingin menghapus pesan untuk semua orang?' : 
        'Yakin ingin menghapus pesan untuk Anda?';
    
    if (confirm(confirmMessage)) {
        socket.emit('dm:delete', {
            roomId: currentRoom,
            messageId: messageId,
            forEveryone: forEveryone
        }, (response) => {
            if (response && response.success) {
                showToast('Pesan berhasil dihapus', 'success');
            } else {
                showToast('Gagal menghapus pesan', 'error');
            }
        });
    }
    
    // Remove context menu
    const contextMenu = document.querySelector('.message-context-menu');
    if (contextMenu) {
        contextMenu.remove();
    }
}

function copyMessage(messageId) {
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageElement) {
        const messageContent = messageElement.querySelector('.message-content');
        if (messageContent) {
            const text = messageContent.textContent;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    showToast('Pesan berhasil disalin', 'success');
                }).catch(() => {
                    showToast('Gagal menyalin pesan', 'error');
                });
            } else {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = text;
                document.body.appendChild(textArea);
                textArea.select();
                try {
                    document.execCommand('copy');
                    showToast('Pesan berhasil disalin', 'success');
                } catch (err) {
                    showToast('Gagal menyalin pesan', 'error');
                }
                document.body.removeChild(textArea);
            }
        }
    }
    
    // Remove context menu
    const contextMenu = document.querySelector('.message-context-menu');
    if (contextMenu) {
        contextMenu.remove();
    }
}

// =====================================
// EMOJI PICKER
// =====================================
function showEmojiPicker() {
    const emojis = [
        '😀', '😃', '😄', '😁', '😊', '😍', '🥰', '😘', '😗', '😙', 
        '😚', '🙂', '🤗', '🤔', '😐', '😑', '🙄', '😏', '😣', '😥',
        '😮', '🤐', '😯', '😪', '😫', '🥱', '😴', '😌', '😛', '😜',
        '🤪', '😝', '🤑', '🤭', '🤫', '🤨', '😒', '🙃', '😔', '😕',
        '🙁', '😖', '😟', '😤', '😢', '😭', '😦', '😧', '😨', '😩',
        '🤯', '😬', '😰', '😱', '🥵', '🥶', '😳', '😵', '🥴', '😷',
        '🤒', '🤕', '🤢', '🤮', '🤧', '😇', '🥳', '🥺', '👍', '👎',
        '👏', '🙌', '👋', '🤝', '🙏', '❤️', '💔', '💕', '💖', '💗',
        '💘', '💙', '💚', '💛', '🧡', '💜', '🖤', '🤍', '🤎', '💯'
    ];
    
    // Remove existing emoji picker
    const existingPicker = document.querySelector('.emoji-picker');
    if (existingPicker) {
        existingPicker.remove();
        return;
    }
    
    const emojiPicker = document.createElement('div');
    emojiPicker.className = 'emoji-picker';
    
    const emojiGrid = document.createElement('div');
    emojiGrid.className = 'emoji-grid';
    
    emojis.forEach(emoji => {
        const emojiButton = document.createElement('button');
        emojiButton.className = 'emoji-item';
        emojiButton.textContent = emoji;
        
        emojiButton.addEventListener('click', () => {
            insertEmoji(emoji);
            emojiPicker.remove();
        });
        
        emojiGrid.appendChild(emojiButton);
    });
    
    emojiPicker.appendChild(emojiGrid);
    document.getElementById('inputContainer').appendChild(emojiPicker);
    
    // Close picker when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function closePicker(event) {
            if (!emojiPicker.contains(event.target) && !event.target.classList.contains('emoji-btn')) {
                emojiPicker.remove();
                document.removeEventListener('click', closePicker);
            }
        });
    }, 0);
}

function insertEmoji(emoji) {
    const messageInput = document.getElementById('messageInput');
    const cursorPos = messageInput.selectionStart;
    const textBefore = messageInput.value.substring(0, cursorPos);
    const textAfter = messageInput.value.substring(messageInput.selectionEnd);
    
    messageInput.value = textBefore + emoji + textAfter;
    messageInput.focus();
    
    // Set cursor position after emoji
    const newCursorPos = cursorPos + emoji.length;
    messageInput.setSelectionRange(newCursorPos, newCursorPos);
    
    // Trigger input event to update UI
    messageInput.dispatchEvent(new Event('input'));
}

// =====================================
// VOICE RECORDING
// =====================================
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

function startVoiceRecording() {
    if (isRecording) {
        stopVoiceRecording();
        return;
    }
    
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = event => {
                audioChunks.push(event.data);
            };
            
            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                const audioFile = new File([audioBlob], 'voice-message.wav', { type: 'audio/wav' });
                
                // Show file preview and prepare for sending
                showFilePreview(audioFile);
                const fileInput = document.getElementById('fileInput');
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(audioFile);
                fileInput.files = dataTransfer.files;
            };
            
            mediaRecorder.start();
            isRecording = true;
            
            // Update UI
            const micBtn = document.getElementById('micBtn');
            micBtn.innerHTML = '<i class="fas fa-stop"></i>';
            micBtn.style.background = 'var(--text-error)';
            
            showToast('Rekaman dimulai...', 'info');
            
        })
        .catch(error => {
            console.error('Voice recording error:', error);
            showToast('Gagal memulai rekaman suara', 'error');
        });
}

function stopVoiceRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        isRecording = false;
        
        // Reset UI
        const micBtn = document.getElementById('micBtn');
        micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        micBtn.style.background = 'linear-gradient(135deg, var(--primary-color), var(--primary-hover))';
        
        showToast('Rekaman selesai', 'success');
    }
}

// =====================================
// IMAGE MODAL
// =====================================
function openImageModal(imageSrc) {
    // Remove existing modal
    const existingModal = document.querySelector('.image-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const imageModal = document.createElement('div');
    imageModal.className = 'image-modal';
    
    imageModal.innerHTML = `
        <div style="position: relative; max-width: 90%; max-height: 90%;">
            <img src="${imageSrc}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: var(--border-radius);">
            <button onclick="this.parentElement.parentElement.remove()" 
                    style="position: absolute; top: -40px; right: 0; background: rgba(255, 255, 255, 0.2); border: none; 
                           color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; 
                           display: flex; align-items: center; justify-content: center; font-size: 14px;">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    // Close on click outside
    imageModal.addEventListener('click', (e) => {
        if (e.target === imageModal) {
            imageModal.remove();
        }
    });
    
    // Close on escape key
    const closeOnEscape = (e) => {
        if (e.key === 'Escape') {
            imageModal.remove();
            document.removeEventListener('keydown', closeOnEscape);
        }
    };
    document.addEventListener('keydown', closeOnEscape);
    
    document.body.appendChild(imageModal);
}

// =====================================
// CLEANUP & UTILITIES
// =====================================
function handleBeforeUnload(e) {
    if (isCallActive) {
        e.preventDefault();
        e.returnValue = 'Ada panggilan yang sedang aktif. Yakin ingin meninggalkan halaman?';
        return e.returnValue;
    }
}

function setButtonLoading(button, loading) {
    const loader = button.querySelector('.btn-loader');
    const span = button.querySelector('span');
    
    if (loading) {
        button.classList.add('loading');
        button.disabled = true;
        if (loader) loader.style.display = 'block';
        if (span) span.style.display = 'none';
    } else {
        button.classList.remove('loading');
        button.disabled = false;
        if (loader) loader.style.display = 'none';
        if (span) span.style.display = 'inline';
    }
}

function showError(elementId, message) {
    const errorElement = document.getElementById(elementId);
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.classList.add('show');
        
        setTimeout(() => {
            hideError(elementId);
        }, 5000);
    }
}

function hideError(elementId) {
    const errorElement = document.getElementById(elementId);
    if (errorElement) {
        errorElement.classList.remove('show');
    }
}

function showSuccess(elementId, message) {
    const successElement = document.getElementById(elementId);
    if (successElement) {
        successElement.textContent = message;
        successElement.classList.add('show');
        
        setTimeout(() => {
            successElement.classList.remove('show');
        }, 5000);
    }
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = now - date;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
        return date.toLocaleTimeString('id-ID', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    } else if (diffDays === 1) {
        return 'Kemarin';
    } else if (diffDays < 7) {
        return date.toLocaleDateString('id-ID', { 
            weekday: 'short' 
        });
    } else {
        return date.toLocaleDateString('id-ID', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit'
        });
    }
}

function formatFileSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

// Debounce function for search
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// =====================================
// KEYBOARD SHORTCUTS
// =====================================
document.addEventListener('keydown', (e) => {
    // ESC to close modals
    if (e.key === 'Escape') {
        const openModal = document.querySelector('.modal.show');
        if (openModal) {
            closeModal(openModal.id);
        }
        
        // Close emoji picker
        const emojiPicker = document.querySelector('.emoji-picker');
        if (emojiPicker) {
            emojiPicker.remove();
        }
        
        // Close context menu
        const contextMenu = document.querySelector('.message-context-menu');
        if (contextMenu) {
            contextMenu.remove();
        }
    }
    
    // Ctrl/Cmd + K for user search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (currentUser) {
            showUserSearch();
        }
    }
    
    // Ctrl/Cmd + / for chat search
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        if (currentUser) {
            document.getElementById('chatSearch').focus();
        }
    }
    
    // Ctrl/Cmd + D for delete current chat
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        if (currentChatWith) {
            clearCurrentChatHistory();
        }
    }
});

// =====================================
// ERROR HANDLING & RECONNECTION
// =====================================
socket?.on('error', (error) => {
    console.error('Socket error:', error);
    showToast('Terjadi kesalahan koneksi', 'error');
});

socket?.on('reconnect', () => {
    console.log('Socket reconnected');
    showToast('Koneksi dipulihkan', 'success');
    loadChatList(); // Reload chat list on reconnection
});

socket?.on('reconnect_error', (error) => {
    console.error('Reconnection error:', error);
    showToast('Gagal menghubungkan ulang', 'error');
});

// =====================================
// PROGRESSIVE WEB APP
// =====================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((registration) => {
                console.log('SW registered: ', registration);
            })
            .catch((registrationError) => {
                console.log('SW registration failed: ', registrationError);
            });
    });
}

// =====================================
// AUTO-SAVE DRAFT MESSAGES
// =====================================
let draftTimer = null;

function saveDraft() {
    const messageInput = document.getElementById('messageInput');
    if (currentChatWith && messageInput.value.trim()) {
        localStorage.setItem(`draft_${currentChatWith}`, messageInput.value);
    }
}

function loadDraft() {
    if (currentChatWith) {
        const draft = localStorage.getItem(`draft_${currentChatWith}`);
        if (draft) {
            document.getElementById('messageInput').value = draft;
        }
    }
}

function clearDraft() {
    if (currentChatWith) {
        localStorage.removeItem(`draft_${currentChatWith}`);
    }
}

// Auto-save draft every 2 seconds
document.getElementById('messageInput')?.addEventListener('input', () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 2000);
});

// =====================================
// PERFORMANCE OPTIMIZATION
// =====================================
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

// Throttle scroll events
const messagesContainer = document.getElementById('messagesContainer');
if (messagesContainer) {
    messagesContainer.addEventListener('scroll', throttle(() => {
        // Handle scroll to top for loading more messages
        if (messagesContainer.scrollTop === 0) {
            // Load more messages (implement if needed)
        }
    }, 100));
}

// =====================================
// INITIALIZATION CHECK & CLEANUP
// =====================================
window.addEventListener('beforeunload', () => {
    // Save current draft
    saveDraft();
    
    // Stop any ongoing recording
    if (isRecording) {
        stopVoiceRecording();
    }
    
    // End any active calls
    if (isCallActive) {
        endCall();
    }
    
    // Disconnect socket gracefully
    if (socket) {
        socket.disconnect();
    }
});

// Handle page refresh/reload
window.addEventListener('load', () => {
    // Clear any temporary states
    if (currentChatWith) {
        loadDraft();
    }
});

console.log('🎉 ChatVibe JavaScript loaded successfully!');
console.log('📱 Features: Persistent Chat History, Delete Chat, Real-time Messaging, Voice/Video Calls');
