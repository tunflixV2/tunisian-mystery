
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Game Data (Cases) ---
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

let players = {};
let gameStarted = false;
let currentCase = null;
let currentClueIndex = 0;
let votes = {}; // { targetId: count }

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {

  // 1. Dkhoul lel Jeu
  socket.on('joinGame', (name) => {
    if (gameStarted) {
      socket.emit('errorMsg', 'اللعبة بدات سايي! استنى الطرح الجاي.');
      return;
    }
    players[socket.id] = { id: socket.id, name: name, role: 'citizen', isDead: false, hasVoted: false };
    io.emit('updatePlayerList', Object.values(players));
  });

  // 2. Tabda el Jeu
  socket.on('startGame', (caseId) => {
    const playerIds = Object.keys(players);
    if (playerIds.length < 3) {
        io.emit('errorMsg', 'لازم على الأقل 3 ملاعبية باش تبداو!');
        return;
    }

    // Reset Game State
    gameStarted = true;
    currentClueIndex = 0;
    votes = {};
    playerIds.forEach(id => {
        players[id].isDead = false;
        players[id].hasVoted = false;
    });

    // Pick a Case
    currentCase = cases.find(c => c.id == caseId) || cases[0];

    // Assign Roles (1 Killer)
    const killerIndex = Math.floor(Math.random() * playerIds.length);
    const killerId = playerIds[killerIndex];

    playerIds.forEach(id => {
      if (id === killerId) {
        players[id].role = 'killer';
        io.to(id).emit('gameInit', { role: 'killer', caseTitle: currentCase.title, story: currentCase.story });
      } else {
        players[id].role = 'citizen';
        io.to(id).emit('gameInit', { role: 'citizen', caseTitle: currentCase.title, story: currentCase.story });
      }
    });

    io.emit('systemMessage', `🚨 **${currentCase.title}** 🚨
${currentCase.story}`);

    // Start Sending Clues Timer
    sendClueLoop();
  });

  // 3. Clue Logic
  function sendClueLoop() {
      if (!gameStarted || !currentCase) return;

      // Send a clue every 30 seconds (for demo purposes, usually longer)
      setTimeout(() => {
          if (currentClueIndex < currentCase.clues.length) {
              const clue = currentCase.clues[currentClueIndex];

              // If it's the "Specific Killer Clue", replace placeholder
              let finalClue = clue;
              if (clue.includes("(القاتل)")) {
                  const killer = Object.values(players).find(p => p.role === 'killer');
                  finalClue = clue.replace("(القاتل)", killer ? killer.name : "مجهول");
              }

              io.emit('newClue', finalClue);
              currentClueIndex++;
              sendClueLoop(); // Next clue
          } else {
              io.emit('systemMessage', "⛔ وفات الأدلة! تو وقت التصويت.. شكون القاتل؟");
              io.emit('startVoting');
          }
      }, 30000); // 30 seconds delay between clues
  }

  // 4. Chat
  socket.on('chatMessage', (msg) => {
    const player = players[socket.id];
    if (player && !player.isDead) {
      io.emit('newChat', { name: player.name, msg: msg });
    }
  });

  // 5. Killer Action
  socket.on('killPlayer', (targetName) => {
    const killer = players[socket.id];
    if (killer && killer.role === 'killer' && !killer.isDead) {
       const targetId = Object.keys(players).find(key => players[key].name === targetName);
       if (targetId && !players[targetId].isDead) {
           players[targetId].isDead = true;
           io.emit('playerDied', { name: targetName });
           io.to(targetId).emit('youDied');

           // Check win condition (Killer wins if 1 vs 1)
           const alive = Object.values(players).filter(p => !p.isDead).length;
           if (alive <= 2) {
               io.emit('gameOver', { winner: 'killer', msg: `القاتل (${killer.name}) ربح! 🔪` });
               gameStarted = false;
           }
       }
    }
  });

  // 6. Voting Logic
  socket.on('votePlayer', (targetName) => {
      const player = players[socket.id];
      if (!player || player.isDead || player.hasVoted) return;

      player.hasVoted = true;
      const targetId = Object.keys(players).find(key => players[key].name === targetName);

      if (targetId) {
          votes[targetId] = (votes[targetId] || 0) + 1;

          // Check if everyone voted (or alive players)
          const aliveCount = Object.values(players).filter(p => !p.isDead).length;
          const votesCount = Object.values(players).filter(p => p.hasVoted).length;

          if (votesCount >= aliveCount) {
              // Tally votes
              let maxVotes = 0;
              let electedId = null;
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

                  if (elected.role === 'killer') {
                      io.emit('gameOver', { winner: 'citizens', msg: `مبروك! شديتو القاتل (${elected.name})! 👮‍♂️` });
                      gameStarted = false;
                  } else {
                      io.emit('systemMessage', `😱 يا ناري.. ${elected.name} كان بريء! القاتل مازال يدور.`);
                      // Reset votes for next round
                      votes = {};
                      Object.values(players).forEach(p => p.hasVoted = false);
                  }
              }
          }
      }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('updatePlayerList', Object.values(players));
  });
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});
