
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- CONFIG ---
const API_KEY = "AIzaSyDBDNnDyvUqdaySHOiRmeFJpfrXmSDHAJQ"; 
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// --- LOCAL MYSTERIES (BACKUP) ---
// If AI fails, we use these high-quality pre-written stories.
const backupMysteries = [
    {
        title: "جريمة في الـ Colocation 🏠",
        story: "الضو مقصوص، لقيتو (صالح) ميت في بيت القعاد مضروب بمقلاة.. شكون قتلو؟",
        clues: [
            "📜 تقرير: الضحية مات مضروب بحاجة ثقيلة.",
            "🕵️ شهادة: الجار سمع عياط مع الـ 10 متاع الليل.",
            "🔦 دليل: لقينا 'شلاكة' ملطخة بالدم تحت فرشك (القاتل).",
            "📱 ميساج: الضحية كان يسال واحد فيكم برشا فلوس."
        ],
        rumors: [
            "سمعت (فلان) يحكي في التليفون بالسرقة ويقول 'فسخت الأدلة'",
            "ريت (فلان) يغسل في دبشو بالزربة",
            "فما واحد فيكم يصور فيكم فيديو"
        ],
        secrets: [
            { task: "دافع على (القاتل) في الشات وقول هو بريء." },
            { task: "اتهم (فلان) زورا وبهتانا." }
        ]
    },
    {
        title: "سرقة القهوة ☕",
        story: "مولى القهوة لقى الكاسة فارغة.. السارق واحد من السرفارة! لكن الحارس تقتل.",
        clues: [
            "🎥 كاميرا: الكاميرا تسكرت 5 دقائق قبل السرقة.",
            "🔑 مفتاح: السارق استعمل مفتاح أصلي.",
            "👣 أثر: فما طبعة سبادري (Nike) في الكوجينة.",
            "💸 شهادة: واحد فيكم شرى iPhone جديد البارح."
        ],
        rumors: [
            "فلان عنده مفتاح زايد متاع القهوة",
            "ريت فلان مخبي فلوس في جيبو"
        ],
        secrets: []
    }
];

let players = {};
let gameStarted = false;
let currentMystery = null;
let currentClueIndex = 0;
let intervals = [];

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

// --- AI FUNCTION ---
async function generateMystery(playerList) {
    const playerNames = playerList.map(p => p.name).join(", ");

    // Pick a random player as killer for fallback scenario
    const randomKiller = playerList[Math.floor(Math.random() * playerList.length)].name;

    const prompt = `
    أنت كاتب سيناريو تونسي.
    اللاعبين: [${playerNames}].
    1. اختر قاتل من القائمة.
    2. اكتب قصة جريمة تونسية (عرس، حومة، قهوة).
    3. 4 أدلة متدرجة.
    4. 3 إشاعات خبيثة.
    5. 2 مهام سرية.
    رد JSON فقط:
    {
      "title": "...", "story": "...", "killer": "...",
      "clues": ["..."], "rumors": ["..."],
      "secrets": [{ "player": "...", "task": "..." }]
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, "").trim();
        return JSON.parse(text);
    } catch (error) {
        console.log("AI Failed, using backup mystery.");
        // Pick a random backup mystery and inject the real killer
        let backup = backupMysteries[Math.floor(Math.random() * backupMysteries.length)];
        backup.killer = randomKiller; 
        return backup;
    }
}

io.on('connection', (socket) => {

  socket.on('joinGame', (name) => {
    if (gameStarted) return socket.emit('errorMsg', '⏳ الطرح بدا! استنى.');
    // Check if name exists
    if (Object.values(players).find(p => p.name === name)) {
        return socket.emit('errorMsg', 'الاسم هذا موجود ديجا!');
    }

    players[socket.id] = { id: socket.id, name: name, role: 'citizen', isDead: false, hasVoted: false };
    io.emit('updatePlayerList', Object.values(players));
  });

  socket.on('startGame', async () => {
    const playerValues = Object.values(players);
    if (playerValues.length < 1) return io.emit('errorMsg', 'زيد دخل صحابك!'); // Min 1 for testing

    io.emit('loadingState', true); // Show loading screen
    gameStarted = true;

    // 1. Generate (AI or Backup)
    currentMystery = await generateMystery(playerValues);

    // 2. Assign Roles
    intervals.forEach(clearInterval); intervals = [];
    currentClueIndex = 0;

    playerValues.forEach(p => {
        p.isDead = false; p.hasVoted = false;

        // Role
        if (p.name === currentMystery.killer) {
            p.role = 'killer';
            io.to(p.id).emit('gameInit', { role: 'killer', data: currentMystery });
        } else {
            p.role = 'citizen';
            io.to(p.id).emit('gameInit', { role: 'citizen', data: currentMystery });
        }

        // Secrets
        if (currentMystery.secrets) {
            const secret = currentMystery.secrets.find(s => s.player === p.name);
            if (secret && p.role !== 'killer') io.to(p.id).emit('secretTask', secret.task);
        }
    });

    io.emit('loadingState', false); // Hide loading
    io.emit('systemMessage', `🚨 **${currentMystery.title}** 🚨\n${currentMystery.story}`);

    // 3. Loops
    startLoops();
  });

  function startLoops() {
      // Clues Loop
      const clueInt = setInterval(() => {
          if (!gameStarted) return;
          if (currentClueIndex < currentMystery.clues.length) {
              let clue = currentMystery.clues[currentClueIndex];
              // Replace placeholder
              if (clue.includes("(القاتل)")) clue = clue.replace("(القاتل)", currentMystery.killer);

              io.emit('newClue', clue);
              io.emit('playAudio', "دليل جديد وصل"); 
              currentClueIndex++;
          } else {
              clearInterval(clueInt);
              io.emit('systemMessage', "⛔ وفات الأدلة! وقت التصويت!");
              io.emit('startVoting');
              io.emit('playAudio', "وقت التصويت");
          }
      }, 30000);
      intervals.push(clueInt);

      // Rumors Loop
      const rumorInt = setInterval(() => {
          if (!gameStarted || !currentMystery.rumors) return;
          const rumor = currentMystery.rumors[Math.floor(Math.random() * currentMystery.rumors.length)];
          const pIds = Object.keys(players);
          const target = pIds[Math.floor(Math.random() * pIds.length)];
          // Send to random player (Private)
          io.to(target).emit('privateRumor', rumor);
      }, 20000);
      intervals.push(rumorInt);
  }

  socket.on('chatMessage', (msg) => {
    const p = players[socket.id];
    if (p && !p.isDead) io.emit('newChat', { name: p.name, msg: msg });
  });

  socket.on('killPlayer', (targetName) => {
      const killer = players[socket.id];
      if (!killer || killer.role !== 'killer' || killer.isDead) return;

      const targetId = Object.keys(players).find(k => players[k].name === targetName);
      if (targetId && !players[targetId].isDead) {
          players[targetId].isDead = true;
          io.emit('playerDied', { name: targetName });
          io.to(targetId).emit('youDied');
          io.emit('systemMessage', `🚨 **${targetName}** مات مقتول!`);
          io.emit('playAudio', "جريمة قتل");
          io.emit('startVoting'); // Auto meeting

          // Win Check
          const alive = Object.values(players).filter(p => !p.isDead).length;
          if (alive <= 1) endGame('killer', killer.name);
      }
  });

  // Vote Logic (Simplified)
  socket.on('votePlayer', (targetName) => {
      // ... (Same vote logic as before, just triggering endGame)
      const player = players[socket.id];
      if (!player || player.hasVoted) return;
      player.hasVoted = true;
      // ... (omitted for brevity, assume standard voting logic)
  });

  function endGame(winner, name) {
      gameStarted = false;
      intervals.forEach(clearInterval);
      io.emit('gameOver', { winner, msg: winner === 'killer' ? `🔪 القاتل (${name}) ربح!` : `👮 المواطنين ربحوا!` });
  }

  socket.on('disconnect', () => {
      delete players[socket.id];
      io.emit('updatePlayerList', Object.values(players));
      if (gameStarted && Object.keys(players).length < 1) {
          gameStarted = false; intervals.forEach(clearInterval);
      }
  });
});

server.listen(3000, () => console.log('Server 3000'));
