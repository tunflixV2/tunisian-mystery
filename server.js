
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Store players: { socketId: { name, role, isDead } }
let players = {};
let gameStarted = false;

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // 1. Join Game
  socket.on('joinGame', (name) => {
    if (gameStarted) {
      socket.emit('errorMsg', 'The game has already started!');
      return;
    }
    players[socket.id] = { name: name, role: 'citizen', isDead: false };
    io.emit('updatePlayerList', Object.values(players));
  });

  // 2. Start Game (Admin only - simplified for now anyone can start)
  socket.on('startGame', () => {
    if (Object.keys(players).length < 3) { // Minimum 3 players
        io.emit('errorMsg', 'Need at least 3 players to start!');
        return;
    }
    gameStarted = true;

    // Assign Roles Randomly
    const playerIds = Object.keys(players);
    const killerIndex = Math.floor(Math.random() * playerIds.length);
    const killerId = playerIds[killerIndex];

    playerIds.forEach(id => {
      if (id === killerId) {
        players[id].role = 'killer';
        io.to(id).emit('roleAssigned', { role: 'killer', message: 'You are the KILLER! 🔪' });
      } else {
        players[id].role = 'citizen';
        io.to(id).emit('roleAssigned', { role: 'citizen', message: 'You are an Innocent Citizen. Find the killer! 🕵️' });
      }
    });

    io.emit('gameStarted');
  });

  // 3. Chat Message
  socket.on('chatMessage', (msg) => {
    const player = players[socket.id];
    if (player && !player.isDead) {
      io.emit('newChat', { name: player.name, msg: msg });
    }
  });

  // 4. Killer Action (Fake "Kill" for demo)
  socket.on('killPlayer', (targetName) => {
    const killer = players[socket.id];
    if (killer && killer.role === 'killer' && !killer.isDead) {
       // Find target socket ID
       const targetId = Object.keys(players).find(key => players[key].name === targetName);
       if (targetId) {
           players[targetId].isDead = true;
           io.emit('playerDied', { name: targetName });
           io.to(targetId).emit('youDied');
       }
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('updatePlayerList', Object.values(players));
  });
});

server.listen(3000, () => {
  console.log('listening on *:3000');
});
