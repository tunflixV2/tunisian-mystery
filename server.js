
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- SMART IMAGES ---
const images = {
    weapon: {
        "مزهرية": "https://images.unsplash.com/photo-1585803277271-e5d0d8291079?w=400&q=80", 
        "سم": "https://images.unsplash.com/photo-1628731309855-66795d666633?w=400&q=80", 
        "حبل": "https://images.unsplash.com/photo-1599408169542-620fc137e6da?w=400&q=80",
        "كيك": "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&q=80", 
        "frein": "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=400&q=80",
        "سكينة": "https://images.unsplash.com/photo-1588506066223-1d54b4c7344e?w=400&q=80"
    },
    location: {
        "عرس": "https://images.unsplash.com/photo-1519741497674-611481863552?w=400&q=80",
        "فيلا": "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&q=80",
        "غابة": "https://images.unsplash.com/photo-1448375240586-dfd8d395ea6c?w=400&q=80",
        "مكتب": "https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&q=80"
    },
    generic: "https://images.unsplash.com/photo-1579208575657-c595a05383b7?w=400&q=80"
};

// --- MYSTERIES (Same 6 Cases) ---
const mysteriesDB = [
    {
        title: "السهرة اللي تبدلت لمأتم",
        story: "سهرة في قمرت. الضحية طلع للطابق الثاني وما رجعش. تلقاوه مضروب بمزهرية، والدم سخون. الشباك محلول، والباب مش مكسور.",
        killerDesc: "اللي لابس chemise سودة، وكان قاعد وحدو في البالكون",
        clues: [
            { text: "المزهرية اللي تضرب بيها الضحية عليها بصمات (القاتل).", img: images.weapon["مزهرية"] },
            { text: "قطرات دم صغيرة تمشي لباب البالكون.", img: images.location["فيلا"] },
            { text: "الكاميرا صورت (القاتل) طالع قبل 6 دقايق.", img: images.generic },
            { text: "ألياف قماش سودة تحت أظافر الضحية تطابق قماش (القاتل).", img: null }
        ],
        rumors: ["سمعو واحد يهدد الضحية: 'تو تندم'.", "واحد طلع للطابق الثاني وهو متوتر."],
        secret: "دافع على صاحب الـ chemise السودة وقول الألياف قديمة."
    },
    {
        title: "ليلة الفيلا والسرّ المدفون",
        story: "weekend في الحمامات. الضحية طلع لبيتو ومات مسموم. اللابتوب مكسور وكأس عصير مقلوبة.",
        killerDesc: "اللي لابس polo رمادي، وكان ساكت أغلب السهرة",
        clues: [
            { text: "الكأس فيها سم ما يتحط كان في السوائل الباردة.", img: images.weapon["سم"] },
            { text: "في المطبخ، علبة دواء ناقصة حبة عند (القاتل).", img: null },
            { text: "الكاميرا صورت (القاتل) داخل للمطبخ قبل 10 دقايق.", img: images.generic },
            { text: "بحث في تلفون (القاتل) على: 'كيفاش السم يبان أزمة قلبية'.", img: null }
        ],
        rumors: ["واحد يغار من الضحية على طفلة.", "مولى الـ stories فسخ فيديو."],
        secret: "شكك في السم وقول أزمة قلبية."
    },
    {
        title: "المخيم اللي ما كملش",
        story: "تخييم في عين دراهم. الضحية مشى يجيب حطب وتلقى مخنوق بحبل.",
        killerDesc: "اللي كان دايماً يتحدّى الضحية",
        clues: [
            { text: "الحبل المستعمل موجود في شنطة (القاتل).", img: images.weapon["حبل"] },
            { text: "آثار الأحذية في الطين تطابق صباط (القاتل).", img: images.location["غابة"] },
            { text: "قطعة قماش من جاكيت (القاتل) في يد الضحية.", img: null },
            { text: "رسالة تهديد في تلفون الضحية من عند (القاتل).", img: images.generic }
        ],
        rumors: ["واحد يغار من الضحية.", "سمعو عركة في الغابة."],
        secret: "دافع على صاحب الحبل وقول يستعمل فيه للتخييم."
    },
    {
        title: "العشاء اللي تسمّم فيه الكل",
        story: "عيد ميلاد في المنزه. الكل كلا كيك، أما الضحية برك مات مسموم.",
        killerDesc: "اللي قصّ الكيك بيدو",
        clues: [
            { text: "السم موجود كان في الطبقة العلوية لقطعة الضحية.", img: images.weapon["كيك"] },
            { text: "قفازات بلاستيك ملوحة في poubelle متاع (القاتل).", img: null },
            { text: "واحد شاف (القاتل) يبدّل صحن الضحية.", img: images.generic },
            { text: "ميساج عند (القاتل): 'كان يبيع الدار نخسر كل شي'.", img: null }
        ],
        rumors: ["واحد محتاج فلوس الميراث.", "الضحية يبدل في الوصية."],
        secret: "قول مستحيل يكون هو خاطر الكل كلاو."
    },
    {
        title: "حادث في الطريق السريعة",
        story: "حادث خايب في الرجوع من سوسة. الضحية مات والفرامل مقطوعة.",
        killerDesc: "اللي كان يسوق الكرهبة اللي قدامو",
        clues: [
            { text: "liquide frein متاع الضحية ناقص بفعل فاعل.", img: images.weapon["frein"] },
            { text: "نفس ماركة الزيت موجودة عند (القاتل).", img: null },
            { text: "الكاميرا صورت (القاتل) يحل في capot الضحية.", img: images.generic },
            { text: "ميساج تهديد: 'كان تحكي تو تندم'.", img: null }
        ],
        rumors: ["الضحية كان سكران.", "واحد يغار من نجاحو."],
        secret: "شكك في الفرامل وقول عطب قديم."
    },
    {
        title: "المكتب المسكّر من الداخل",
        story: "انتحار ظاهري في شركة. الباب مسكر بالمفتاح والضحية مسموم.",
        killerDesc: "الشخص اللي دايماً هادي",
        clues: [
            { text: "عقدة الحبل ما يعرفها كان (القاتل) اللي كان scout.", img: images.weapon["حبل"] },
            { text: "كوب قهوة فيه مهدئ عطاه (القاتل) للضحية.", img: images.location["مكتب"] },
            { text: "خيط رقيق تحت الباب استعملو (القاتل) لتسكير المفتاح.", img: images.generic },
            { text: "الضحية كان باش يبعث mail يفضح (القاتل).", img: null }
        ],
        rumors: ["الضحية مكتئب.", "الموظف الجديد يسرق."],
        secret: "ركز على الاكتئاب ودافع على (القاتل)."
    }
];

let players = {};
let gameStarted = false;
let currentMystery = null;
let currentClueIndex = 0;
let intervals = [];
let votes = {};

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

function pickMystery(playerList) {
    const template = mysteriesDB[Math.floor(Math.random() * mysteriesDB.length)];

    // Ensure randomness in killer selection
    // (If testing alone, playerList[0] is always killer. With >1 players, it's random)
    const killerIndex = Math.floor(Math.random() * playerList.length);
    const killer = playerList[killerIndex];

    // Twist Logic (Scapegoat)
    let scapegoat = playerList.find((p, idx) => idx !== killerIndex);
    if (!scapegoat) scapegoat = killer; 

    // Inject Names
    let finalClues = template.clues.map((c, index) => {
        let newText = c.text;
        // 50% chance to Frame Scapegoat in first 2 clues
        if (index < 2 && Math.random() > 0.5) {
            newText = newText.replace("(القاتل)", scapegoat.name); 
            newText += " (لكن الدليل هذا مشكوك فيه...)"; 
        } else {
            newText = newText.replace("(القاتل)", killer.name);
        }
        return { text: newText, img: c.img };
    });

    // Smoking gun is always true
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
        votes = {};
        intervals.forEach(clearInterval); intervals = [];
        currentClueIndex = 0;

        playerValues.forEach(p => {
            p.isDead = false; p.hasVoted = false;

            if (p.name === currentMystery.killer) {
                p.role = 'killer';
                io.to(p.id).emit('gameInit', { 
                    role: 'killer', 
                    title: currentMystery.title, 
                    story: currentMystery.story + "\n🔴 أنت القاتل! حاول تبرر روحك وتتهم غيرك." 
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
        // Clues Loop (30s)
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
        }, 30000);
        intervals.push(clueInt);

        // Rumors Loop (25s)
        const rumorInt = setInterval(() => {
            if (!gameStarted) return;
            const rumor = currentMystery.rumors[Math.floor(Math.random() * currentMystery.rumors.length)];
            const pIds = Object.keys(players);
            const target = pIds[Math.floor(Math.random() * pIds.length)];
            io.to(target).emit('privateRumor', rumor);
        }, 25000);
        intervals.push(rumorInt);
    }

    socket.on('chatMessage', (msg) => {
        const p = players[socket.id];
        // Allow dead players to chat? Maybe not. Let's keep it restrictive for now.
        if (p) io.emit('newChat', { name: p.name, msg: msg });
    });

    // NO 'killPlayer' EVENT anymore.
    // The killer wins by surviving the vote.

    socket.on('votePlayer', (targetName) => {
        const voter = players[socket.id];
        if (!voter || !gameStarted || voter.hasVoted) return;

        voter.hasVoted = true;
        votes[targetName] = (votes[targetName] || 0) + 1;

        // Check if everyone voted
        const allPlayers = Object.values(players);
        const votesCast = allPlayers.filter(p => p.hasVoted).length;

        if (votesCast >= allPlayers.length) {
            // Tally votes
            let maxVotes = 0;
            let electedName = null;
            for (const [name, count] of Object.entries(votes)) {
                if (count > maxVotes) { maxVotes = count; electedName = name; }
            }

            // Reveal Result
            intervals.forEach(clearInterval);
            gameStarted = false;

            if (electedName === currentMystery.killer) {
                io.emit('gameOver', { winner: 'citizens', msg: `🎉 مبروك! شديتو القاتل (${currentMystery.killer})!` });
            } else {
                io.emit('gameOver', { winner: 'killer', msg: `😱 غالط! (${electedName}) كان بريء.. القاتل (${currentMystery.killer}) هرب!` });
            }
        }
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
