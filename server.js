
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- IMAGES ---
const images = {
    weapon: {
        "سكينة": "https://images.unsplash.com/photo-1588506066223-1d54b4c7344e?w=400&q=80",
        "شلاكة": "https://images.unsplash.com/photo-1606821295326-646df4f2537c?w=400&q=80", 
        "سم": "https://images.unsplash.com/photo-1598202521921-93c41793709b?w=400&q=80",
        "مسدس": "https://images.unsplash.com/photo-1595590424283-b8f17842773f?w=400&q=80",
        "حبل": "https://images.unsplash.com/photo-1599408169542-620fc137e6da?w=400&q=80",
        "مقص": "https://images.unsplash.com/photo-1596499878201-9a7213876e78?w=400&q=80"
    },
    location: {
        "قهوة": "https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=400&q=80",
        "دار": "https://images.unsplash.com/photo-1565512217032-9013c7a6e190?w=400&q=80",
        "شارع": "https://images.unsplash.com/photo-1506159263177-336c1e19484b?w=400&q=80",
        "يخت": "https://images.unsplash.com/photo-1569263979104-865ab7dd8d17?w=400&q=80",
        "عرس": "https://images.unsplash.com/photo-1519741497674-611481863552?w=400&q=80",
        "فيلا": "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&q=80"
    },
    generic: "https://images.unsplash.com/photo-1579208575657-c595a05383b7?w=400&q=80" 
};

// --- MYSTERIES (Sample of previous DB for brevity, logic applies to all) ---
// Keeping the same structure but changing logic below.
const mysteriesDB = [
    {
        title: "ليلة الدم في عرس سوسة",
        story: "العريس يختفي قبل تقطيع الكيك. تلقاوه في غرفة التبديل مطعون. القاعة مسكّرة.",
        killerDesc: "اللي لابس بدلة زرقاء وعندو ساعة ذهب كبيرة",
        clues: [
            { text: "الباب مسكّر من الداخل، ما فماش كسر.", img: images.location["عرس"] },
            { text: "ساعة ذهب طايحة تحت الطاولة.", img: null },
            { text: "الكاميرا تورّي بدلة زرقاء داخلة قبل 7 دقايق.", img: images.generic },
            { text: "بصمات (القاتل) على السكينة.", img: images.weapon["سكينة"] }
        ],
        rumors: ["شافو واحد يغسل يديه ومربك.", "سمعو عركة قديمة على فلوس."],
        secret: "دافع على صاحب البدلة الزرقاء ويشكك في الكاميرا."
    },
    {
        title: "غدرة في رحلة بحرية",
        story: "في يخت خاص، واحد يطيح في البحر بالليل. الصباح يلقاو جاكيته مقصوصة.",
        killerDesc: "اللي عندو وشم حوت في يدو اليسار",
        clues: [
            { text: "الجاكيتة مقصوصة بسكين صغير.", img: images.weapon["سكينة"] },
            { text: "سكين مطبخ ناقص من اليخت.", img: null },
            { text: "الكاميرا تورّي وشم واضح.", img: images.generic },
            { text: "آثار ملح على سروال (القاتل).", img: images.location["يخت"] }
        ],
        rumors: ["الضحية كان مديون.", "واحد قال 'يا ليتو يختفي'."],
        secret: "ركّز الحديث على الديون."
    },
    // ... (Assume full list is here)
];

let players = {};
let gameStarted = false;
let currentMystery = null;
let currentClueIndex = 0;
let intervals = [];

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

function pickMystery(playerList) {
    const template = mysteriesDB[Math.floor(Math.random() * mysteriesDB.length)];
    const killer = playerList[Math.floor(Math.random() * playerList.length)];

    // --- TWIST LOGIC: Pick a SCAPEGOAT (Someone innocent to frame) ---
    let scapegoat = playerList.find(p => p.name !== killer.name);
    if (!scapegoat) scapegoat = killer; // Fallback

    // Modify Clues to be tricky
    let finalClues = template.clues.map((c, index) => {
        let newText = c.text;

        // 50% chance to Frame the Scapegoat in early clues (Misdirection)
        if (index < 2 && Math.random() > 0.5) {
            newText = newText.replace("(القاتل)", scapegoat.name); 
            newText += " (لكن الدليل هذا مشكوك فيه...)"; 
        } else {
            // Real clues pointing to killer
            newText = newText.replace("(القاتل)", killer.name);
        }

        return { text: newText, img: c.img };
    });

    // Ensure the LAST clue is always true (The smoking gun)
    finalClues[finalClues.length - 1].text = template.clues[template.clues.length - 1].text.replace("(القاتل)", killer.name);

    let finalRumors = template.rumors.map(r => r.replace("(القاتل)", killer.name));
    let finalSecret = template.secret ? template.secret.replace("(القاتل)", killer.name) : null;

    return {
        title: template.title,
        story: template.story,
        killer: killer.name,
        killerDesc: template.killerDesc,
        clues: finalClues,
        rumors: finalRumors,
        secretTask: finalSecret
    };
}

io.on('connection', (socket) => {

    socket.on('joinGame', (name) => {
        if (gameStarted) return socket.emit('errorMsg', 'الطرح بدا! استنى.');
        players[socket.id] = { id: socket.id, name: name, role: 'citizen', isDead: false, hasVoted: false };
        io.emit('updatePlayerList', Object.values(players));
    });

    socket.on('startGame', () => {
        const playerValues = Object.values(players);
        if (playerValues.length < 1) return io.emit('errorMsg', 'زيد دخل عباد!'); 

        currentMystery = pickMystery(playerValues);
        gameStarted = true;
        intervals.forEach(clearInterval); intervals = [];
        currentClueIndex = 0;

        playerValues.forEach(p => {
            p.isDead = false; p.hasVoted = false;

            if (p.name === currentMystery.killer) {
                p.role = 'killer';
                io.to(p.id).emit('gameInit', { 
                    role: 'killer', 
                    title: currentMystery.title, 
                    story: currentMystery.story + "\n🔴 وصفك: " + currentMystery.killerDesc 
                });
            } else {
                p.role = 'citizen';
                io.to(p.id).emit('gameInit', { 
                    role: 'citizen', 
                    title: currentMystery.title, 
                    story: currentMystery.story 
                });

                if (currentMystery.secretTask && Math.random() > 0.5) {
                    io.to(p.id).emit('secretTask', currentMystery.secretTask);
                }
            }
        });

        io.emit('systemMessage', `🚨 **${currentMystery.title}** 🚨\n${currentMystery.story}`);

        startLoops();
    });

    function startLoops() {
        // Clues Loop (Every 25s)
        const clueInt = setInterval(() => {
            if (!gameStarted) return;
            if (currentClueIndex < currentMystery.clues.length) {
                const clueObj = currentMystery.clues[currentClueIndex];
                io.emit('newClue', clueObj); 
                io.emit('playAudio', "دليل جديد");
                currentClueIndex++;
            } else {
                clearInterval(clueInt);
                io.emit('systemMessage', "⛔ وفات الأدلة! وقت التصويت!");
                io.emit('startVoting');
                io.emit('playAudio', "وقت التصويت");
            }
        }, 25000);
        intervals.push(clueInt);

        // Rumors Loop (Every 20s)
        const rumorInt = setInterval(() => {
            if (!gameStarted) return;
            const rumor = currentMystery.rumors[Math.floor(Math.random() * currentMystery.rumors.length)];
            const pIds = Object.keys(players);
            const target = pIds[Math.floor(Math.random() * pIds.length)];
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
            io.emit('startVoting');

            const alive = Object.values(players).filter(p => !p.isDead).length;
            if (alive <= 1) {
                gameStarted = false; intervals.forEach(clearInterval);
                io.emit('gameOver', { winner: 'killer', msg: `🔪 القاتل (${killer.name}) ربح!` });
            }
        }
    });

    socket.on('votePlayer', (targetName) => {
        const player = players[socket.id];
        if (!player || player.hasVoted) return;
        player.hasVoted = true;
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('updatePlayerList', Object.values(players));
        if (gameStarted && Object.keys(players).length < 1) {
             gameStarted = false; intervals.forEach(clearInterval);
        }
    });
});

server.listen(3000, () => console.log('Server 3000'));
