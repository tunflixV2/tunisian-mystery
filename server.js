
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
let votes = {};
let killerCooldown = false;

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- AI GENERATION FUNCTION ---
async function generateMystery(playerList) {
    const playerNames = playerList.map(p => p.name).join(", ");

    const prompt = `
    أنت كاتب سيناريو مبدع لألعاب الجريمة والغموض باللهجة التونسية.
    لدينا مجموعة من اللاعبين: [${playerNames}].

    المطلوب:
    1. اختر عشوائياً واحداً من اللاعبين ليكون "القاتل".
    2. اكتب قصة جريمة قتل غامضة قصيرة (سياق تونسي: قهوة، حومة، عرس، وتيل...).
    3. اكتب 4 أدلة (Clues) ذكية ومتدرجة الصعوبة:
       - الدليل 1 و 2: غامضة وموجهة للجميع.
       - الدليل 3: يشير لصفة في القاتل (لبسة، تصرف).
       - الدليل 4: دليل قاطع يكشف القاتل بذكاء (لكن لا تذكر اسمه صراحة).

    الرد يجب أن يكون **فقط** بصيغة JSON وبدون أي كود ماركداون، بالشكل التالي:
    {
      "title": "عنوان مشوق للقضية",
      "story": "ملخص القصة وماذا حدث للضحية...",
      "killer": "اسم اللاعب القاتل (يجب أن يكون من القائمة)",
      "clues": ["دليل 1", "دليل 2", "دليل 3", "دليل 4"]
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Cleanup JSON string (remove markdown ```json ... ``` if present)
        const cleanText = text.replace(/```json|```/g, "").trim();
        return JSON.parse(cleanText);
    } catch (error) {
        console.error("AI Error:", error);
        // Fallback Mystery if AI fails
        return {
            title: "جريمة السيرفر الطايح 💻",
            story: "الكونيكسيون قصت، والـ API ما حبش يجاوب.. والضحية هو (مولى اللعبة).",
            killer: playerList[Math.floor(Math.random() * playerList.length)].name,
            clues: [
                "دليل 1: القاتل كان يزرب يحب يبدا الطرح.",
                "دليل 2: فما واحد قاعد يضحك تو.",
                "دليل 3: القاتل هو اللي يكتب بالغالط.",
                "دليل 4: القاتل هو (القاتل)."
            ]
        };
    }
}

io.on('connection', (socket) => {

  // -- Join --
  socket.on('joinGame', (name) => {
    if (gameStarted) {
      socket.emit('errorMsg', 'اللعبة بدات! استنى الطرح الجاي.');
      return;
    }
    players[socket.id] = { id: socket.id, name: name, role: 'citizen', isDead: false, hasVoted: false };
    io.emit('updatePlayerList', Object.values(players));
  });

  // -- Start Game (AI Version) --
  socket.on('startGame', async () => {
    const playerValues = Object.values(players);
    if (playerValues.length < 2) {
        io.emit('errorMsg', 'لازم على الأقل 2 ملاعبية!');
        return;
    }

    io.emit('systemMessage', "🤖 **قاعد نصنع في قضية جديدة بالذكاء الاصطناعي... لحظة بربي!** ⏳");
    gameStarted = true;

    // 1. Generate Mystery
    currentMystery = await generateMystery(playerValues);

    // 2. Setup Game State
    currentClueIndex = 0;
    votes = {};
    killerCooldown = false;
    clearInterval(clueInterval);

    playerValues.forEach(p => {
        p.isDead = false;
        p.hasVoted = false;
        // Assign Roles based on AI selection
        if (p.name === currentMystery.killer) {
            p.role = 'killer';
            io.to(p.id).emit('gameInit', { role: 'killer', caseTitle: currentMystery.title, story: currentMystery.story });
        } else {
            p.role = 'citizen';
            io.to(p.id).emit('gameInit', { role: 'citizen', caseTitle: currentMystery.title, story: currentMystery.story });
        }
    });

    // Broadcast Story
    io.emit('systemMessage', `🚨 **${currentMystery.title}** 🚨\n${currentMystery.story}`);

    // 3. Start Clues Loop
    startClueLoop();
  });

  function startClueLoop() {
      if (clueInterval) clearInterval(clueInterval);

      clueInterval = setInterval(() => {
          if (!gameStarted || !currentMystery) return;

          if (currentClueIndex < currentMystery.clues.length) {
              let clue = currentMystery.clues[currentClueIndex];
              io.emit('newClue', clue);
              currentClueIndex++;
          } else {
              clearInterval(clueInterval);
              io.emit('systemMessage', "⛔ وفات الأدلة! تو وقت التصويت.. شكون القاتل؟");
              io.emit('startVoting');
          }
      }, 45000); // 45s per clue (AI clues are longer/better)
  }

  // -- Chat --
  socket.on('chatMessage', (msg) => {
    const player = players[socket.id];
    if (player && !player.isDead) {
      io.emit('newChat', { name: player.name, msg: msg });
    }
  });

  // -- Kill Logic --
  socket.on('killPlayer', (targetName) => {
    const killer = players[socket.id];
    if (!killer || killer.role !== 'killer' || killer.isDead) return;

    if (killerCooldown) {
        socket.emit('errorMsg', '⏳ اصبر شوية! Cooldown.');
        return;
    }

    const targetId = Object.keys(players).find(key => players[key].name === targetName);
    if (targetId && !players[targetId].isDead) {
        players[targetId].isDead = true;
        io.emit('playerDied', { name: targetName });
        io.to(targetId).emit('youDied');

        io.emit('systemMessage', `🚨 **جثة!** ${targetName} مات مقتول! التصويت تحل.`);
        io.emit('startVoting');

        killerCooldown = true;
        socket.emit('cooldownStart', 30);
        setTimeout(() => {
            killerCooldown = false;
            socket.emit('cooldownEnd');
        }, 30000);

        // Win Condition
        const alive = Object.values(players).filter(p => !p.isDead).length;
        if (alive <= 1) {
             io.emit('gameOver', { winner: 'killer', msg: `🔪 القاتل (${killer.name}) ربح! ذكي برشا.` });
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

          if (votesCount >= aliveCount) {
              let maxVotes = 0;
              let electedId = null;
              for (const [pid, count] of Object.entries(votes)) {
                  if (count > maxVotes) { maxVotes = count; electedId = pid; }
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
                      votes = {};
                      Object.values(players).forEach(p => p.hasVoted = false);
                  }
              } else {
                  io.emit('systemMessage', "⚖️ تعادل! ما مات حد.");
                  votes = {};
                  Object.values(players).forEach(p => p.hasVoted = false);
              }
          }
      }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('updatePlayerList', Object.values(players));
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
