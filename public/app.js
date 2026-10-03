// Production signaling server URL deployed on Render
const PRODUCTION_SERVER = 'https://flux-stream-zmdi.onrender.com';

const SERVER_URL = (() => {
  const { protocol, port, origin } = window.location;
  if (protocol === 'https:') return origin;
  if (port === '3000') return origin;
  return PRODUCTION_SERVER || 'http://10.0.2.2:3000';
})();

const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
  timeout: 8000,
  reconnectionAttempts: 5,
});

socket.on('connect', () => {
  console.log('Socket connected to', SERVER_URL, '— id:', socket.id);
});

socket.on('connect_error', (err) => {
  console.warn('Socket connect error:', err.message, '| URL tried:', socket.io.uri);
  // APK on real phone: 10.0.2.2 only works on emulator. Try localhost as last resort.
  if (socket.io.uri.includes('10.0.2.2')) {
    socket.io.uri = 'http://localhost:3000';
    socket.connect();
  }
});

// DOM refs
const lobbyScreen    = document.getElementById('lobbyScreen');
const callScreen     = document.getElementById('callScreen');
const nameInput      = document.getElementById('nameInput');
const roomInput      = document.getElementById('roomInput');
const joinBtn        = document.getElementById('joinBtn');
const createBtn      = document.getElementById('createBtn');
const displayRoomId  = document.getElementById('displayRoomId');
const copyRoomBtn    = document.getElementById('copyRoomBtn');
const videoGrid      = document.getElementById('videoGrid');
const localVideo     = document.getElementById('localVideo');
const remoteVideo    = document.getElementById('remoteVideo');
const localLabel     = document.getElementById('localLabel');
const remoteLabel    = document.getElementById('remoteLabel');
const remoteAvatar   = document.getElementById('remoteAvatar');
const localAvatar    = document.getElementById('localAvatar');
const remoteInitial  = document.getElementById('remoteInitial');
const localInitial   = document.getElementById('localInitial');
const toggleMicBtn   = document.getElementById('toggleMicBtn');
const toggleCamBtn   = document.getElementById('toggleCamBtn');
const flipCamBtn     = document.getElementById('flipCamBtn');
const screenShareBtn = document.getElementById('screenShareBtn');
const hangupBtn      = document.getElementById('hangupBtn');
const toggleChatBtn  = document.getElementById('toggleChatBtn');
const closeChatBtn   = document.getElementById('closeChatBtn');
const chatDrawer     = document.getElementById('chatDrawer');
const chatMessages   = document.getElementById('chatMessages');
const chatInput      = document.getElementById('chatInput');
const sendMsgBtn     = document.getElementById('sendMsgBtn');
const chatUnreadDot  = document.getElementById('chatUnreadDot');

// State
let localStream       = null;
let screenStream      = null;
let peerConnection    = null;
let dataChannel       = null;
let currentRoomId     = null;
let myUserName        = 'User';
let peerUserName      = 'Peer';
let isAudioMuted      = false;
let isVideoMuted      = false;
let currentFacingMode = 'user';
let isSharingScreen   = false;
let candidateQueue    = [];

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // TURN relay — used as fallback when direct P2P fails (e.g. emulator ↔ browser, strict NAT)
    // Traffic is still DTLS-SRTP encrypted end-to-end through the relay.
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

// Drain ICE candidates that arrived before setRemoteDescription completed
async function drainCandidateQueue() {
  while (candidateQueue.length > 0) {
    const candidate = candidateQueue.shift();
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('Failed to add queued ICE candidate:', e.message);
    }
  }
}

function closePeerConnection() {
  if (!peerConnection) return;
  peerConnection.ontrack = null;
  peerConnection.onicecandidate = null;
  peerConnection.ondatachannel = null;
  peerConnection.onconnectionstatechange = null;
  peerConnection.close();
  peerConnection = null;
  dataChannel = null;
  candidateQueue = [];
}

// Media capture with constraint fallback for older/mobile browsers
async function startMedia(facingMode = 'user') {
  if (localStream) localStream.getTracks().forEach(t => t.stop());

  localVideo.muted = true;
  localVideo.playsInline = true;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: { facingMode },
    });
  } catch {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch (err) {
      alert('Camera and microphone access is required. Please check your browser permissions.');
      console.error('getUserMedia failed:', err.message);
      return;
    }
  }

  localVideo.srcObject = localStream;
  localVideo.classList.toggle('mirror', facingMode === 'user' && !isSharingScreen);
  localVideo.play().catch(() => {});
  currentFacingMode = facingMode;
  replaceTracksOnPeer();
}

// Replace existing tracks on an active peer connection (e.g. camera flip)
function replaceTracksOnPeer() {
  if (!peerConnection || !localStream) return;
  const senders = peerConnection.getSenders();
  localStream.getTracks().forEach(track => {
    const sender = senders.find(s => s.track?.kind === track.kind);
    if (sender) {
      sender.replaceTrack(track);
    } else {
      peerConnection.addTrack(track, localStream);
    }
  });
}

// Room join
createBtn.addEventListener('click', () => {
  initiateJoin(Math.random().toString(36).substring(2, 8).toUpperCase());
});

joinBtn.addEventListener('click', () => {
  const code = roomInput.value.trim().toUpperCase();
  if (!code) { alert('Please enter a room code.'); return; }
  initiateJoin(code);
});

async function initiateJoin(roomId) {
  myUserName = nameInput.value.trim() || 'User';
  localLabel.textContent = `${myUserName} (You)`;
  if (localInitial) localInitial.textContent = myUserName[0].toUpperCase();

  currentRoomId = roomId;
  displayRoomId.textContent = roomId;

  lobbyScreen.classList.remove('active');
  callScreen.classList.add('active');
  setGridMode('alone');

  socket.emit('join-room', { roomId, userName: myUserName });
  await startMedia('user');
}

function setGridMode(mode) {
  videoGrid.className = `video-grid ${mode}`;
  if (mode === 'alone') {
    if (remoteAvatar) remoteAvatar.classList.add('hidden');
    remoteVideo.srcObject = null;
  }
  if (localVideo?.srcObject) localVideo.play().catch(() => {});
}

// Unlock audio on mobile — browsers block autoplay until user interaction
function unlockAudio() {
  if (remoteVideo?.srcObject) {
    remoteVideo.muted = false;
    remoteVideo.volume = 1.0;
    remoteVideo.play().catch(() => {});
  }
}
document.addEventListener('click', unlockAudio);
document.addEventListener('touchstart', unlockAudio);

copyRoomBtn.addEventListener('click', () => {
  const url = `${window.location.origin}?room=${currentRoomId}`;
  navigator.clipboard.writeText(url).catch(() => {});
  alert(`Room link copied!\n${url}`);
});

window.addEventListener('DOMContentLoaded', () => {
  const room = new URLSearchParams(window.location.search).get('room');
  if (room) roomInput.value = room;
});

// WebRTC peer connection setup
function createPeerConnection() {
  closePeerConnection();

  peerConnection = new RTCPeerConnection(rtcConfig);

  if (localStream) {
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  }

  peerConnection.ontrack = (event) => {
    if (event.streams?.[0]) {
      remoteVideo.srcObject = event.streams[0];
    } else {
      const stream = remoteVideo.srcObject || new MediaStream();
      stream.addTrack(event.track);
      remoteVideo.srcObject = stream;
    }
    remoteVideo.muted = false;
    remoteVideo.volume = 1.0;
    remoteVideo.play().catch(() => {});
    setGridMode('connected');
  };

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('ice-candidate', { candidate, roomId: currentRoomId });
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('Connection state:', peerConnection?.connectionState);
    if (peerConnection?.connectionState === 'failed') handlePeerDisconnect();
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE state:', peerConnection?.iceConnectionState);
  };

  peerConnection.onicegatheringstatechange = () => {
    console.log('ICE gathering:', peerConnection?.iceGatheringState);
  };

  // Answerer receives the data channel opened by the offerer
  peerConnection.ondatachannel = ({ channel }) => {
    dataChannel = channel;
    bindDataChannelEvents();
  };
}

function bindDataChannelEvents() {
  dataChannel.onmessage = ({ data }) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'chat') {
        appendMessage(msg.text, 'received', msg.sender);
        if (!chatDrawer.classList.contains('open')) {
          chatUnreadDot.classList.remove('hidden');
        }
      } else if (msg.type === 'cam-toggle') {
        remoteAvatar?.classList.toggle('hidden', !msg.isOff);
        remoteVideo.style.opacity = msg.isOff ? '0' : '1';
      }
    } catch {
      appendMessage(data, 'received', peerUserName);
    }
  };
}

function handlePeerDisconnect() {
  closePeerConnection();
  remoteVideo.srcObject = null;
  remoteAvatar?.classList.add('hidden');
  setGridMode('alone');
  appendSystemMessage('Call ended.');
}

// Signaling
socket.on('user-connected', async ({ userName }) => {
  peerUserName = userName || 'Peer';
  remoteLabel.textContent = peerUserName;
  if (remoteInitial) remoteInitial.textContent = peerUserName[0].toUpperCase();

  if (!localStream) await startMedia('user');
  createPeerConnection();

  // Offerer creates the data channel; answerer receives it via ondatachannel
  dataChannel = peerConnection.createDataChannel('flux-chat');
  bindDataChannelEvents();

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('offer', { offer, roomId: currentRoomId, userName: myUserName });
});

socket.on('offer', async ({ offer, userName }) => {
  peerUserName = userName || 'Peer';
  remoteLabel.textContent = peerUserName;
  if (remoteInitial) remoteInitial.textContent = peerUserName[0].toUpperCase();

  if (!localStream) await startMedia('user');
  createPeerConnection();

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  await drainCandidateQueue();

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('answer', { answer, roomId: currentRoomId, userName: myUserName });
});

socket.on('answer', async ({ answer, userName }) => {
  if (userName) {
    peerUserName = userName;
    remoteLabel.textContent = peerUserName;
    if (remoteInitial) remoteInitial.textContent = peerUserName[0].toUpperCase();
  }
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  await drainCandidateQueue();
});

socket.on('ice-candidate', async ({ candidate }) => {
  if (!peerConnection?.remoteDescription) {
    candidateQueue.push(candidate);
  } else {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('addIceCandidate failed:', e.message);
    }
  }
});

socket.on('user-disconnected', handlePeerDisconnect);

// In-call controls
toggleMicBtn.addEventListener('click', () => {
  isAudioMuted = !isAudioMuted;
  localStream?.getAudioTracks().forEach(t => { t.enabled = !isAudioMuted; });
  toggleMicBtn.classList.toggle('active-off', isAudioMuted);
  toggleMicBtn.textContent = isAudioMuted ? '🔇' : '🎙️';
});

toggleCamBtn.addEventListener('click', () => {
  isVideoMuted = !isVideoMuted;
  localStream?.getVideoTracks().forEach(t => { t.enabled = !isVideoMuted; });
  toggleCamBtn.classList.toggle('active-off', isVideoMuted);
  toggleCamBtn.textContent = isVideoMuted ? '🚫' : '📹';
  localAvatar?.classList.toggle('hidden', !isVideoMuted);
  localVideo.style.opacity = isVideoMuted ? '0' : '1';
  if (dataChannel?.readyState === 'open') {
    dataChannel.send(JSON.stringify({ type: 'cam-toggle', isOff: isVideoMuted }));
  }
});

flipCamBtn.addEventListener('click', async () => {
  await startMedia(currentFacingMode === 'user' ? 'environment' : 'user');
});

// Screen share is not supported on Android — hide the button if unavailable
if (!navigator.mediaDevices?.getDisplayMedia) {
  screenShareBtn.style.display = 'none';
}

screenShareBtn.addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getDisplayMedia) return;

  if (!isSharingScreen) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const [screenTrack] = screenStream.getVideoTracks();

      peerConnection?.getSenders()
        .find(s => s.track?.kind === 'video')
        ?.replaceTrack(screenTrack);

      localVideo.srcObject = screenStream;
      localVideo.classList.remove('mirror');
      isSharingScreen = true;
      screenShareBtn.classList.add('active-off');
      screenTrack.onended = stopScreenShare;
    } catch (err) {
      if (err.name !== 'NotAllowedError') console.warn('Screen share error:', err.message);
    }
  } else {
    stopScreenShare();
  }
});

function stopScreenShare() {
  screenStream?.getTracks().forEach(t => t.stop());
  const cameraTrack = localStream?.getVideoTracks()[0];
  peerConnection?.getSenders()
    .find(s => s.track?.kind === 'video')
    ?.replaceTrack(cameraTrack);
  localVideo.srcObject = localStream;
  if (currentFacingMode === 'user') localVideo.classList.add('mirror');
  isSharingScreen = false;
  screenShareBtn.classList.remove('active-off');
}

// Chat
toggleChatBtn.addEventListener('click', () => {
  chatDrawer.classList.toggle('open');
  chatUnreadDot.classList.add('hidden');
});

closeChatBtn.addEventListener('click', () => chatDrawer.classList.remove('open'));

sendMsgBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || dataChannel?.readyState !== 'open') return;
  dataChannel.send(JSON.stringify({ type: 'chat', text, sender: myUserName }));
  appendMessage(text, 'sent', 'You');
  chatInput.value = '';
}

function appendMessage(text, type, sender = '') {
  const el = document.createElement('div');
  el.className = `msg ${type}`;
  el.innerHTML = sender
    ? `<small style="display:block;font-size:0.65rem;opacity:0.7;margin-bottom:2px;">${sender}</small>${text}`
    : text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendSystemMessage(text) {
  const el = document.createElement('div');
  el.className = 'system-message';
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

hangupBtn.addEventListener('click', () => {
  localStream?.getTracks().forEach(t => t.stop());
  screenStream?.getTracks().forEach(t => t.stop());
  closePeerConnection();
  window.location.reload();
});