const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.on('join-room', (payload) => {
    const roomId   = typeof payload === 'object' ? payload.roomId   : String(payload);
    const userName = typeof payload === 'object' ? payload.userName : 'Peer';

    socket.join(roomId);

    // Notify existing room members that a new peer has joined
    socket.to(roomId).emit('user-connected', { userId: socket.id, userName });

    socket.on('offer',         data => socket.to(roomId).emit('offer',         data));
    socket.on('answer',        data => socket.to(roomId).emit('answer',        data));
    socket.on('ice-candidate', data => socket.to(roomId).emit('ice-candidate', data));

    socket.on('disconnect', () => {
      socket.to(roomId).emit('user-disconnected', socket.id);
    });
  });
});

function getLocalIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIp();
  console.log(`Server running on port ${PORT}`);
  console.log(`Local network: http://${ip}:${PORT}`);
});