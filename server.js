
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 1. Game Data (Cases) ---
const cases = [
    {
        id: 1,
        title: "جريمة في الـ Colocation 🏠",
        story: "الضو مقصوص، لقيتو (صالح) ميت في بيت القعاد.. شكون قتلو؟",
        clues: [
            "📜 تقرير: الضحية مات مضروب بحاجة ثقيلة على راسو.",
            "🕵️ شهادة: الجار سمع عياط مع الـ 10 متاع الليل.",
            "🔦 دليل: لقينا 'شلاكة' ملطخة بالدم تحت فرشك (القاتل).",
            "📱 ميساج: الضحية كان يسال واحد فيكم برشا فلوس."
        ]
    },
    {
        id: 2,
        title: "سرقة القهوة ☕",
        story: "مولى القهوة لقى الكاسة فارغة.. السارق واحد من السرفارة!",
        clues: [
            "🎥 كاميرا: الكاميرا تسكرت 5 دقائق قبل السرقة.",
            "🔑 مفتاح: السارق استعمل مفتاح أصلي، ما كسرش الباب.",
            "👣 أثر: فما طبعة سبادري (Nike) في الكوجينة.",
            "💸 شهادة: واحد فيكم شرى iPhone جديد البارح."
        ]
    }
];

// --- 2. Game State ---
let players = {};
let gameStarted = false;
let currentCase = null;
let currentClueIndex = 0;
let votes = {}; 
let killerCooldown = false;
let clueInterval = null;

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {

  // -- Join --
  socket.on('joinGame', (name) => {
    if (gameStarted) {
      socket.emit('errorMsg', 'اللعبة بدات سايي! استنى الطرح الجاي.');
      return;
    }
    players[socket.id] = { id: socket.id, name: name, role: 'citizen', isDead: false, hasVoted: false };
    io.emit('updatePlayerList', Object.values(players));
  });

  // -- Start Game --
  socket.on('startGame', (caseId) => {
    const playerIds = Object.keys(players);
    // Modified for testing: Allow 2 players
    if (playerIds.length < 2) {
        io.emit('errorMsg', 'لازم على الأقل 2 ملاعبية باش تبداو!');
        return;
    }

    // Reset Game
    gameStarted = true;
    currentClueIndex = 0;
    votes = {};
    killerCooldown = false;
    clearInterval(clueInterval);

    playerIds.forEach(id => {
        players[id].isDead = false;
        players[id].hasVoted = false;
    });

    // Setup Case
    currentCase = cases.find(c => c.id == caseId) || cases[0];

    // Assign Killer
    const killerIndex = Math.floor(Math.random() * playerIds.length);
    const killerId = playerIds[killerIndex];

    playerIds.forEach(id => {
      const p = players[id];
      if (id === killerId) {
        p.role = 'killer';
        io.to(id).emit('gameInit', { role: 'killer', caseTitle: currentCase.title, story: currentCase.story });
      } else {
        p.role = 'citizen';
        io.to(id).emit('gameInit', { role: 'citizen', caseTitle: currentCase.title, story: currentCase.story });
      }
    });

    io.emit('systemMessage', `🚨 **${currentCase.title}** 🚨\n${currentCase.story}`);

    // Start Clues
    startClueLoop();
  });

  function startClueLoop() {
      if (clueInterval) clearInterval(clueInterval);

      clueInterval = setInterval(() => {
          if (!gameStarted || !currentCase) return;

          if (currentClueIndex < currentCase.clues.length) {
              let clue = currentCase.clues[currentClueIndex];
              // Smart Clue Replacement
              if (clue.includes("(القاتل)")) {
                  const killer = Object.values(players).find(p => p.role === 'killer');
                  clue = clue.replace("(القاتل)", killer ? killer.name : "مجهول");
              }
              io.emit('newClue', clue);
              currentClueIndex++;
          } else {
              clearInterval(clueInterval);
              io.emit('systemMessage', "⛔ وفات الأدلة! تو وقت التصويت.. شكون القاتل؟");
              io.emit('startVoting'); // Auto-trigger vote at end of clues
          }
      }, 30000); // 30s per clue
  }

  // -- Chat --
  socket.on('chatMessage', (msg) => {
    const player = players[socket.id];
    if (player && !player.isDead) {
      io.emit('newChat', { name: player.name, msg: msg });
    }
  });

  // -- Kill Logic (The Core Fix) --
  socket.on('killPlayer', (targetName) => {
    const killer = players[socket.id];

    // 1. Validation
    if (!killer || killer.role !== 'killer' || killer.isDead) return;
    if (killerCooldown) {
        socket.emit('errorMsg', '⏳ اصبر شوية! السلاح سخون (Cooldown).');
        return;
    }

    const targetId = Object.keys(players).find(key => players[key].name === targetName);
    if (targetId && !players[targetId].isDead) {

        // 2. Execute Kill
        players[targetId].isDead = true;
        io.emit('playerDied', { name: targetName }); // Announce death
        io.to(targetId).emit('youDied'); // Show dead screen

        // 3. Trigger Emergency Meeting (Vote)
        io.emit('systemMessage', `🚨 **جثة!** لقينا ${targetName} مقتول! التصويت تحل.`);
        io.emit('startVoting');

        // 4. Set Cooldown
        killerCooldown = true;
        socket.emit('cooldownStart', 30); // 30s timer for client UI
        setTimeout(() => {
            killerCooldown = false;
            socket.emit('cooldownEnd');
        }, 30000);

        // 5. Win Condition (Killer Wins if 1v1)
        const alive = Object.values(players).filter(p => !p.isDead).length;
        if (alive <= 1) { // If only killer is left (or +1 victim in 2 player mode, instant win)
             // In 2 player mode, if you kill the other, you win instantly.
             io.emit('gameOver', { winner: 'killer', msg: `🔪 القاتل (${killer.name}) ربح! صفيتهم الكل.` });
             gameStarted = false;
             clearInterval(clueInterval);
        }
    }
  });

  // -- Vote Logic --
  socket.on('votePlayer', (targetName) => {
      const player = players[socket.id];
      if (!player || player.isDead || player.hasVoted) return;

      player.hasVoted = true;
      const targetId = Object.keys(players).find(key => players[key].name === targetName);

      if (targetId) {
          votes[targetId] = (votes[targetId] || 0) + 1;

          const aliveCount = Object.values(players).filter(p => !p.isDead).length;
          const votesCount = Object.values(players).filter(p => p.hasVoted).length;

          // If everyone voted
          if (votesCount >= aliveCount) {
              let maxVotes = 0;
              let electedId = null;

              // Find who got most votes
              for (const [pid, count] of Object.entries(votes)) {
                  if (count > maxVotes) {
                      maxVotes = count;
                      electedId = pid;
                  }
              }

              if (electedId) {
                  const elected = players[electedId];
                  elected.isDead = true;
                  io.emit('systemMessage', `⚖️ حكمتو على **${elected.name}** بالموت!`);
                  io.to(electedId).emit('youDied');

                  if (elected.role === 'killer') {
                      io.emit('gameOver', { winner: 'citizens', msg: `🎉 مبروك! شديتو القاتل (${elected.name})!` });
                      gameStarted = false;
                      clearInterval(clueInterval);
                  } else {
                      io.emit('systemMessage', `😱 يا ناري.. ${elected.name} كان بريء! القاتل مازال يدور.`);
                      // Continue game...
                      votes = {};
                      Object.values(players).forEach(p => p.hasVoted = false);
                  }
              } else {
                  io.emit('systemMessage', "⚖️ تعادل في الأصوات! ما مات حد.");
                  votes = {};
                  Object.values(players).forEach(p => p.hasVoted = false);
              }
          }
      }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('updatePlayerList', Object.values(players));
    // If fewer than 2 players left, end game
    if (gameStarted && Object.keys(players).length < 2) {
        io.emit('gameOver', { winner: 'draw', msg: "⛔ اللعبة وفات خاطر فما شكون خرج." });
        gameStarted = false;
        clearInterval(clueInterval);
    }
  });
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});
