const socket = io();
let currentUser = null;
let activeChatUser = null;

// Signup
async function signup() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const res = await fetch('/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  document.getElementById('auth-msg').innerText = data.message || '';
}

// Login
async function login() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const res = await fetch('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (res.ok) {
    currentUser = username;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('chat-screen').style.display = 'flex';
    socket.emit('join', username);
  } else {
    document.getElementById('auth-msg').innerText = data.message;
  }
}

// User list update
socket.on('userlistupdate', data => {
  const list = document.getElementById('user-list');
  list.innerHTML = '';
  data.users.forEach(u => {
    if (u.username !== currentUser) {
      const div = document.createElement('div');
      div.innerText = u.username + (u.status === 'online' ? ' 🟢' : ' ⚪');
      div.onclick = () => startChat(u.username);
      list.appendChild(div);
    }
  });
});

// Start private chat
function startChat(username) {
  activeChatUser = username;
  document.getElementById('messages').innerHTML = '';
}

// Send message
function sendMessage() {
  const input = document.getElementById('message-input');
  if (input.value && activeChatUser) {
    socket.emit('new_message', { text: input.value, to: activeChatUser });
    input.value = '';
  }
}

// Receive message
socket.on('message_received', msg => {
  if ((msg.username === activeChatUser && msg.to === currentUser) ||
      (msg.username === currentUser && msg.to === activeChatUser)) {
    const div = document.createElement('div');
    div.className = 'msg ' + (msg.username === currentUser ? 'me' : 'other');
    div.innerText = msg.text;
    document.getElementById('messages').appendChild(div);
    document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
  }
});

// Filter users in sidebar
function filterUsers() {
  const input = document.getElementById('search-input').value.toLowerCase();
  const items = document.querySelectorAll('#user-list div');
  items.forEach(div => {
    div.style.display = div.innerText.toLowerCase().includes(input) ? '' : 'none';
  });
}
