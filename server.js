
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- CONFIGURATION ---
const API_KEY = "AIzaSyDBDNnDyvUqdaySHOiRmeFJpfrXmSDHAJQ"; // ⚠️ YOUR KEY
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// --- GAME STATE ---
let players = {};
let gameStarted = false;
let currentMystery = null;
let currentClueIndex = 0;
let clueInterval = null;
let rumorInterval = null;
let votes = {};
let killerCooldown = false;

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- AI GENERATION ---
async function generateMystery(playerList) {
    const playerNames = playerList.map(p => p.name).join(", ");

    const prompt = `
    أنت مخرج أفلام رعب نفسي تونسي.
    اللاعبين: [${playerNames}].

    1. اختر "القاتل" عشوائياً.
    2. اكتب قصة جريمة غامضة ومشوقة باللهجة التونسية.
    3. اكتب 4 أدلة (Clues) ذكية ومتدرجة (بعضها مضلل).
    4. اكتب 3 "إشاعات" (Rumors) خبيثة تفرق بين الأصدقاء (مثلاً: "فلان شفتو يفسخ في ميساجات"، "فلان يخبّي في حاجة").
    5. اكتب "مهام سرية" (Secret Objectives) لـ 2 لاعبين أبرياء تجعلهم يتصرفون بريبة (مثلاً: "دافع عن القاتل"، "اتهم فلان زوراً").

    الرد JSON فقط:
    {
      "title": "العنوان",
      "story": "القصة...",
      "killer": "اسم القاتل",
      "clues": ["دليل 1", "دليل 2", "دليل 3", "دليل 4"],
      "rumors": ["إشاعة 1", "إشاعة 2", "إشاعة 3"],
      "secrets": [
          {"player": "اسم لاعب بريء 1", "task": "مهمتك السرية..."},
          {"player": "اسم لاعب بريء 2", "task": "مهمتك السرية..."}
      ]
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json|```/g, "").trim();
        return JSON.parse(text);
    } catch (error) {
        console.error("AI Error:", error);
        return {
            title: "جريمة السيرفر 💻",
            story: "الذكاء الاصطناعي عمل إضراب.. والقاتل استغل الفرصة.",
            killer: playerList[0].name,
            clues: ["القاتل هو الأول في الليسة", "القاتل لابس مريول", "القاتل يضحك تو", "القاتل هو (القاتل)"],
            rumors: ["سمعت (فلان) يحكي في التليفون بالسرقة", "فما واحد فيكم يصور فيكم"],
            secrets: []
        };
    }
}

io.on('connection', (socket) => {

  socket.on('joinGame', (name) => {
    if (gameStarted) return socket.emit('errorMsg', 'اللعبة بدات!');
    players[socket.id] = { id: socket.id, name: name, role: 'citizen', isDead: false, hasVoted: false, secret: null };
    io.emit('updatePlayerList', Object.values(players));
  });

  socket.on('startGame', async () => {
    const playerValues = Object.values(players);
    if (playerValues.length < 2) return io.emit('errorMsg', 'لازم 2+ ملاعبية!');

    io.emit('systemMessage', "🤖 **قاعد نخطط في مؤامرة... استناو شوية!** 😈");
    gameStarted = true;

    // 1. Generate Mystery
    currentMystery = await generateMystery(playerValues);

    // 2. Setup Roles & Secrets
    currentClueIndex = 0;
    votes = {};
    killerCooldown = false;
    clearInterval(clueInterval);
    clearInterval(rumorInterval);

    playerValues.forEach(p => {
        p.isDead = false;
        p.hasVoted = false;

        // Assign Role
        if (p.name === currentMystery.killer) {
            p.role = 'killer';
            io.to(p.id).emit('gameInit', { role: 'killer', caseTitle: currentMystery.title, story: currentMystery.story });
        } else {
            p.role = 'citizen';
            io.to(p.id).emit('gameInit', { role: 'citizen', caseTitle: currentMystery.title, story: currentMystery.story });
        }

        // Assign Secret Tasks (Side Quests)
        if (currentMystery.secrets) {
            const secretObj = currentMystery.secrets.find(s => s.player === p.name);
            if (secretObj && p.role !== 'killer') {
                p.secret = secretObj.task;
                io.to(p.id).emit('secretTask', secretObj.task); // Send private secret
            }
        }
    });

    io.emit('systemMessage', `🚨 **${currentMystery.title}** 🚨\n${currentMystery.story}`);

    // 3. Loops
    startClueLoop();
    startRumorLoop(); // New loop for chaos
  });

  function startClueLoop() {
      if (clueInterval) clearInterval(clueInterval);
      clueInterval = setInterval(() => {
          if (!gameStarted || !currentMystery) return;
          if (currentClueIndex < currentMystery.clues.length) {
              let clue = currentMystery.clues[currentClueIndex];
              io.emit('newClue', clue);
              // Trigger TTS on client side for clues
              io.emit('playAudio', clue); 
              currentClueIndex++;
          } else {
              clearInterval(clueInterval);
              clearInterval(rumorInterval);
              io.emit('systemMessage', "⛔ وفات الأدلة! شكون القاتل؟");
              io.emit('startVoting');
          }
      }, 40000); 
  }

  function startRumorLoop() {
      if (rumorInterval) clearInterval(rumorInterval);
      rumorInterval = setInterval(() => {
          if (!gameStarted || !currentMystery || !currentMystery.rumors) return;

          // Pick random rumor & random target player
          const rumor = currentMystery.rumors[Math.floor(Math.random() * currentMystery.rumors.length)];
          const playerIds = Object.keys(players);
          const randomTarget = playerIds[Math.floor(Math.random() * playerIds.length)];

          // Send PRIVATE rumor to ONE player only
          io.to(randomTarget).emit('privateRumor', rumor);

      }, 25000); // Rumors every 25s
  }

  socket.on('chatMessage', (msg) => {
    const player = players[socket.id];
    if (player && !player.isDead) io.emit('newChat', { name: player.name, msg: msg });
  });

  socket.on('killPlayer', (targetName) => {
    const killer = players[socket.id];
    if (!killer || killer.role !== 'killer' || killer.isDead || killerCooldown) return;

    const targetId = Object.keys(players).find(key => players[key].name === targetName);
    if (targetId && !players[targetId].isDead) {
        players[targetId].isDead = true;
        io.emit('playerDied', { name: targetName });
        io.to(targetId).emit('youDied');

        io.emit('systemMessage', `🚨 **جثة!** ${targetName} مات!`);
        io.emit('playAudio', `عاجل! ${targetName} مات مقتول!`); // Audio alert
        io.emit('startVoting');

        killerCooldown = true;
        socket.emit('cooldownStart', 30);
        setTimeout(() => { killerCooldown = false; socket.emit('cooldownEnd'); }, 30000);

        const alive = Object.values(players).filter(p => !p.isDead).length;
        if (alive <= 1) {
             io.emit('gameOver', { winner: 'killer', msg: `🔪 القاتل (${killer.name}) ربح!` });
             gameStarted = false;
             clearInterval(clueInterval); clearInterval(rumorInterval);
        }
    }
  });

  socket.on('votePlayer', (targetName) => {
      const player = players[socket.id];
      if (!player || player.isDead || player.hasVoted) return;

      player.hasVoted = true;
      const targetId = Object.keys(players).find(key => players[key].name === targetName);
      if (targetId) {
          votes[targetId] = (votes[targetId] || 0) + 1;
          const aliveCount = Object.values(players).filter(p => !p.isDead).length;
          const votesCount = Object.values(players).filter(p => p.hasVoted).length;

          if (votesCount >= aliveCount) {
              let maxVotes = 0; let electedId = null;
              for (const [pid, count] of Object.entries(votes)) { if (count > maxVotes) { maxVotes = count; electedId = pid; } }

              if (electedId) {
                  const elected = players[electedId];
                  elected.isDead = true;
                  io.emit('systemMessage', `⚖️ حكمتو على **${elected.name}** بالموت!`);
                  io.to(electedId).emit('youDied');

                  if (elected.role === 'killer') {
                      io.emit('gameOver', { winner: 'citizens', msg: `🎉 مبروك! شديتو القاتل (${elected.name})!` });
                      gameStarted = false;
                      clearInterval(clueInterval); clearInterval(rumorInterval);
                  } else {
                      io.emit('systemMessage', `😱 ${elected.name} كان بريء! القاتل مازال يدور.`);
                      io.emit('playAudio', "يا ناري! قتلتو واحد بريء!");
                      votes = {}; Object.values(players).forEach(p => p.hasVoted = false);
                  }
              } else {
                   io.emit('systemMessage', "⚖️ تعادل!");
                   votes = {}; Object.values(players).forEach(p => p.hasVoted = false);
              }
          }
      }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('updatePlayerList', Object.values(players));
    if (gameStarted && Object.keys(players).length < 2) {
        io.emit('gameOver', { winner: 'draw', msg: "⛔ اللعبة وفات." });
        gameStarted = false;
        clearInterval(clueInterval); clearInterval(rumorInterval);
    }
  });
});

server.listen(3000, () => { console.log('Server running on port 3000'); });
