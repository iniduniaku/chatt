let socket;
let token = '';
let currentUser = '';
let currentRoom = '';
let peerConnection;
let localStream;

const emojis = ['😀','😂','😍','😎','😢','😡','👍','🙏','🎉','❤️'];

function login() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
    .then(res => res.json())
    .then(data => {
      if (data.token) {
        token = data.token;
        currentUser = username;
        initChat();
      }
    });
}

function signup() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  fetch('/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  }).then(() => login());
}

function initChat() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('chat-screen').classList.remove('hidden');

  socket = io({ auth: { token } });

  fetch(`/users/search?q=`, {
    headers: { Authorization: `Bearer ${token}` }
  })
    .then(res => res.json())
    .then(users => {
      const list = document.getElementById('user-list');
      list.innerHTML = '';
      users.forEach(u => {
        const li = document.createElement('li');
        li.textContent = u.username;
        li.onclick = () => joinChat(u.username);
        list.appendChild(li);
      });
    });

  socket.on('dm:message', msg => {
    if (getRoomId(msg.from, msg.to) === currentRoom) {
      renderMessage(msg);
    }
  });

  socket.on('dm:delete', ({ messageId }) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) el.textContent = 'Pesan dihapus';
  });

  socket.on('call:offer', handleOffer);
  socket.on('call:answer', handleAnswer);
  socket.on('call:candidate', handleCandidate);
  socket.on('video:offer', handleOffer);
  socket.on('video:answer', handleAnswer);
  socket.on('video:candidate', handleCandidate);
}

function joinChat(otherUser) {
  socket.emit('dm:join', otherUser, ({ roomId, messages }) => {
    currentRoom = roomId;
    document.getElementById('chat-header').textContent = `Chat dengan ${otherUser}`;
    const container = document.getElementById('messages');
    container.innerHTML = '';
    messages.forEach(renderMessage);
  });
}

function renderMessage(msg) {
  const div = document.createElement('div');
  div.className = `message ${msg.from === currentUser ? 'you' : 'other'}`;
  div.id = `msg-${msg.id}`;
  div.textContent = msg.text || '[Media]';
  div.onclick = () => deleteMessage(msg.id);
  document.getElementById('messages').appendChild(div);
}

function sendMessage() {
  const text = document.getElementById('message-input').value;
  const mediaFile = document.getElementById('media-input').files[0];

  if (mediaFile) {
    const form = new FormData();
    form.append('media', mediaFile);

    fetch('/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form
    })
      .then(res => res.json())
      .then(data => {
        socket.emit('dm:message', { to: getOtherUser(), text, media: data.url });
      });
  } else {
    socket.emit('dm:message', { to: getOtherUser(), text });
  }

  document.getElementById('message-input').value = '';
  document.getElementById('media-input').value = '';
}

function deleteMessage(messageId) {
  socket.emit('dm:delete', { roomId: currentRoom, messageId, forEveryone: true }, res => {
    if (res.success) {
      const el = document.getElementById(`msg-${messageId}`);
      if (el) el.textContent = 'Pesan dihapus';
    }
  });
}

function getRoomId(u1, u2) {
  return ['dm', [u1, u2].sort().join('::')].join(':');
}

function getOtherUser() {
  const parts = currentRoom.split('::');
  return parts[0].includes(currentUser) ? parts[1] : parts[0];
}

function toggleTheme() {
  document.body.classList.toggle('dark');
}

function toggleEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  picker.classList.toggle('hidden');
  if (!picker.innerHTML) {
    emojis.forEach(e => {
      const span = document.createElement('span');
      span.textContent = e;
      span.onclick = () => {
        document.getElementById('message-input').value += e;
        picker.classList.add('hidden');
      };
      picker.appendChild(span);
    });
  }
}

// WebRTC Voice & Video Call
function startVoiceCall() {
  startCall({ audio: true, video: false }, 'call');
}

function startVideoCall() {
  startCall({ audio: true, video: true }, 'video');
}

function startCall(constraints, type) {
  peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

  navigator.mediaDevices.getUserMedia(constraints).then(stream => {
    localStream = stream;
    if (constraints.video) {
      document.getElementById('local-video').srcObject = stream;
    }

    stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));

    peerConnection.ontrack = event => {
      document.getElementById('remote-video').srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        socket.emit(`${type}:candidate`, { to: getOtherUser(), candidate: event.candidate });
      }
    };

    peerConnection.createOffer().then(offer => {
      peerConnection.setLocalDescription(offer);
      socket.emit(`${type}:offer`, { to: getOtherUser(), offer });
    });
  });
}

function handleOffer({ from, offer }) {
  peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

  navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(stream => {
    localStream = stream;
    document.getElementById('local-video').srcObject = stream;

    stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));

    peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    peerConnection.ontrack = event => {
      document.getElementById('remote-video').srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        socket.emit('video:candidate', { to: from, candidate: event.candidate });
      }
    };

    peerConnection.createAnswer().then(answer => {
      peerConnection.setLocalDescription(answer);
      socket.emit('video:answer', { to: from, answer });
    });
  });
}

function handleAnswer({ answer }) {
  peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
}

function handleCandidate({ candidate }) {
  peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
}

function endCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  document.getElementById('local-video').srcObject = null;
  document.getElementById('remote-video').srcObject = null;
          }
