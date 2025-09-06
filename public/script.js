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
    message
