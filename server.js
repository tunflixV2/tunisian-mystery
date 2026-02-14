
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- CONFIG ---
// ⚠️ تأكد أن هذا المفتاح جديد وصحيح
const API_KEY = "AIzaSyDBDNnDyvUqdaySHOiRmeFJpfrXmSDHAJQ"; 
const genAI = new GoogleGenerativeAI(API_KEY);
// استعملنا flash خاطر أسرع وأرخص في الـ Quota
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// --- BACKUP MYSTERIES (للطوارئ فقط) ---
const backupMysteries = [
    {
        title: "جريمة الـ Offline (احتياطية)",
        story: "الذكاء الاصطناعي تعب.. ياخي دورناها جريمة كلاسيكية. (صالح) تقتل في القهوة.",
        clues: [
            "الضحية مضروب بـ كاس تاي.",
            "مولى القهوة شاف (القاتل) هارب.",
            "القاتل نسى تليفونو فوق الطاولة.",
            "القاتل هو (القاتل)."
        ],
        rumors: ["فما شكون يسرق في الويفي", "ريت فلان يبدل في حوايجو"],
        secrets: [{ task: "قول للناس الكل اللي انت شاكك في روحك" }]
    }
];

let players = {};
let gameStarted = false;
let currentMystery = null;
let currentClueIndex = 0;
let intervals = [];

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

// --- SMART AI FUNCTION ---
async function generateMystery(playerList) {
    const playerNames = playerList.map(p => p.name).join(", ");
    const killerName = playerList[Math.floor(Math.random() * playerList.length)].name;

    const prompt = `
    Role: Tunisian Mystery Writer.
    Players: ${playerNames}.
    Killer: ${killerName}.

    Task: Write a murder mystery in Tunisian Dialect.
    JSON Format ONLY:
    {
      "title": "Title in Tunisian",
      "story": "Short story (max 30 words)",
      "killer": "${killerName}",
      "clues": ["Clue 1 (vague)", "Clue 2", "Clue 3", "Clue 4 (revealing but no name)"],
      "rumors": ["Rumor 1", "Rumor 2"],
      "secrets": [{"player": "Name", "task": "Secret Task"}]
    }
    `;

    try {
        console.log("🤖 Sending request to Gemini...");
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        console.log("📩 Raw AI Response:", text); // Debug Log

        // --- SMART CLEANER ---
        // يلوج على أول { وآخر } باش ينحي أي كتيبة زايدة
        const jsonStart = text.indexOf('{');
        const jsonEnd = text.lastIndexOf('}') + 1;

        if (jsonStart === -1 || jsonEnd === 0) throw new Error("No JSON found");

        const cleanJson = text.substring(jsonStart, jsonEnd);
        const mystery = JSON.parse(cleanJson);

        // تأكد أن القاتل موجود في القائمة
        if (!playerNames.includes(mystery.killer)) mystery.killer = killerName;

        console.log("✅ Mystery Generated Successfully!");
        return mystery;

    } catch (error) {
        console.error("❌ AI Error:", error.message);
        // Backup
        let backup = backupMysteries[0];
        backup.killer = killerName; 
        return backup;
    }
}

io.on('connection', (socket) => {
  console.log('User joined:', socket.id);

  socket.on('joinGame', (name) => {
    if (gameStarted) return socket.emit('errorMsg', '⏳ الطرح بدا! استنى.');
    players[socket.id] = { id: socket.id, name: name, role: 'citizen', isDead: false, hasVoted: false };
    io.emit('updatePlayerList', Object.values(players));
  });

  socket.on('startGame', async () => {
    const playerValues = Object.values(players);
    // Allow 1 player for testing
    if (playerValues.length < 1) return io.emit('errorMsg', 'زيد دخل صحابك!'); 

    io.emit('loadingState', true);
    gameStarted = true;

    // Generate Mystery
    currentMystery = await generateMystery(playerValues);

    // Reset & Assign
    intervals.forEach(clearInterval); intervals = [];
    currentClueIndex = 0;

    playerValues.forEach(p => {
        p.isDead = false; p.hasVoted = false;

        if (p.name === currentMystery.killer) {
            p.role = 'killer';
            io.to(p.id).emit('gameInit', { role: 'killer', data: currentMystery });
        } else {
            p.role = 'citizen';
            io.to(p.id).emit('gameInit', { role: 'citizen', data: currentMystery });
        }

        if (currentMystery.secrets && currentMystery.secrets.length > 0) {
            const secret = currentMystery.secrets.find(s => s.player === p.name);
            if (secret && p.role !== 'killer') io.to(p.id).emit('secretTask', secret.task);
        }
    });

    io.emit('loadingState', false);
    io.emit('systemMessage', `🚨 **${currentMystery.title}** 🚨\n${currentMystery.story}`);

    startLoops();
  });

  function startLoops() {
      // Clues Loop
      const clueInt = setInterval(() => {
          if (!gameStarted) return;
          if (currentClueIndex < currentMystery.clues.length) {
              let clue = currentMystery.clues[currentClueIndex];
              if (clue.includes("(القاتل)")) clue = clue.replace("(القاتل)", currentMystery.killer);

              io.emit('newClue', clue);
              io.emit('playAudio', "دليل جديد"); 
              currentClueIndex++;
          } else {
              clearInterval(clueInt);
              io.emit('systemMessage', "⛔ وفات الأدلة! وقت التصويت!");
              io.emit('startVoting');
              io.emit('playAudio', "وقت التصويت");
          }
      }, 30000); // 30s
      intervals.push(clueInt);

      // Rumors Loop
      const rumorInt = setInterval(() => {
          if (!gameStarted || !currentMystery.rumors) return;
          const rumor = currentMystery.rumors[Math.floor(Math.random() * currentMystery.rumors.length)];
          const pIds = Object.keys(players);
          const target = pIds[Math.floor(Math.random() * pIds.length)];
          io.to(target).emit('privateRumor', rumor);
      }, 20000); // 20s
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
          io.emit('startVoting'); 

          const alive = Object.values(players).filter(p => !p.isDead).length;
          if (alive <= 1) endGame('killer', killer.name);
      }
  });

  socket.on('votePlayer', (targetName) => {
      const player = players[socket.id];
      if (!player || player.hasVoted) return;
      player.hasVoted = true;
      // Simple logic: just acknowledge vote for now
      // In real game: implement tally logic here
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
