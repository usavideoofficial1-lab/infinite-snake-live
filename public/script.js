window.onerror = function(msg, url, line) {
    const notif = document.getElementById('notification');
    if(notif) {
        notif.textContent = "ERROR: " + msg;
        notif.style.color = "#ff0000";
        notif.style.borderColor = "#ff0000";
        notif.classList.add('show');
    }
    return false;
};

(function() {
    'use strict';

    // --- Configuration ---
    const COLS = 18;
    const ROWS = 32;
    const CELL = 40;
    const W = COLS * CELL;
    const H = ROWS * CELL;
    const TICK_MAX = 140;
    const TICK_MIN = 65;

    // --- DOM Elements ---
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    const ui = {
        level: document.getElementById('ui-level'),
        score: document.getElementById('ui-score'),
        apples: document.getElementById('ui-apples'),
        length: document.getElementById('ui-length'),
        gift: document.getElementById('ui-gift'),
        progFill: document.getElementById('ui-progress-fill'),
        progText: document.getElementById('ui-progress-text'),
        notif: document.getElementById('notification')
    };

    // --- Web Audio API ---
    let audioCtx = null;
    const initAudio = () => {
        if (!audioCtx) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            } catch(e) {
                console.log("Audio not supported");
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    };
    
    window.addEventListener('click', initAudio, { once: true });
    window.addEventListener('touchstart', initAudio, { once: true });

    const playSound = (type) => {
        if (!audioCtx) return;
        try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            const now = audioCtx.currentTime;

            if (type === 'move') {
                osc.type = 'square';
                osc.frequency.setValueAtTime(150, now);
                osc.frequency.exponentialRampToValueAtTime(100, now + 0.03);
                gain.gain.setValueAtTime(0.03, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
                osc.start(now);
                osc.stop(now + 0.04);
            } else if (type === 'eat') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.setValueAtTime(900, now + 0.1);
                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
                osc.start(now);
                osc.stop(now + 0.3);
            }
        } catch(e) {}
    };

    // --- Game State ---
    let snake = [];
    let dir = { x: 1, y: 0 };
    let food = { x: 0, y: 0 };
    let level = 1, score = 0, totalApples = 0;
    let applesInLevel = 0, applesNeeded = 7;
    let tickMs = TICK_MAX;
    let lastTick = 0;
    let isGameOver = false;

    // --- Buffers ---
    const occBuf = new Uint8Array(COLS * ROWS);
    const visitedBuf = new Int32Array(COLS * ROWS);
    const queueBuf = new Int32Array(COLS * ROWS);
    const parentBuf = new Int32Array(COLS * ROWS);
    const DIRS = [{x:1,y:0}, {x:-1,y:0}, {x:0,y:1}, {x:0,y:-1}];

    // --- Initialization ---
    function resetRound() {
        const cy = Math.floor(ROWS / 2);
        snake = [];
        for (let i = 0; i < 5; i++) snake.push({ x: 4 - i, y: cy });
        dir = { x: 1, y: 0 };
        spawnFood();
        isGameOver = false;
    }

    function spawnFood() {
        occBuf.fill(0);
        snake.forEach(s => occBuf[s.y * COLS + s.x] = 1);
        let freeCells = [];
        for (let i = 0; i < COLS * ROWS; i++) {
            if (!occBuf[i]) freeCells.push(i);
        }
        if (freeCells.length === 0) return resetRound();
        const idx = freeCells[Math.floor(Math.random() * freeCells.length)];
        food = { x: idx % COLS, y: Math.floor(idx / COLS) };
    }

    // --- AI Pathfinding ---
    function getNextMove() {
        const head = snake[0];
        visitedBuf.fill(0);
        let headIdx = head.y * COLS + head.x, foodIdx = food.y * COLS + food.x;
        let qHead = 0, qTail = 0;
        queueBuf[qTail++] = headIdx; 
        visitedBuf[headIdx] = 1; 
        parentBuf[headIdx] = -1;
        let found = false;

        while (qHead < qTail) {
            let curr = queueBuf[qHead++];
            if (curr === foodIdx) { found = true; break; }
            let cx = curr % COLS, cy = Math.floor(curr / COLS);
            for (let d of DIRS) {
                let nx = cx + d.x, ny = cy + d.y;
                if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
                let nIdx = ny * COLS + nx;
                if (visitedBuf[nIdx] || occBuf[nIdx]) continue;
                visitedBuf[nIdx] = 1; 
                parentBuf[nIdx] = curr; 
                queueBuf[qTail++] = nIdx;
            }
        }

        if (found) {
            let curr = foodIdx;
            while (parentBuf[curr] !== headIdx) {
                curr = parentBuf[curr];
                if (curr === -1) return null; // Safety catch
            }
            return { x: (curr % COLS) - head.x, y: Math.floor(curr / COLS) - head.y };
        }

        let safeMoves = [];
        for (let d of DIRS) {
            let nx = head.x + d.x, ny = head.y + d.y;
            if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && !occBuf[ny * COLS + nx]) safeMoves.push(d);
        }
        return safeMoves.length > 0 ? safeMoves[Math.floor(Math.random() * safeMoves.length)] : null;
    }

    // --- Game Loop ---
    function updateGame() {
        if (isGameOver) return;
        const nextDir = getNextMove();
        if (!nextDir) {
            showNotification("AUTO RECOVERY...", "#ff2d3f");
            resetRound();
            return;
        }
        dir = nextDir;
        const head = snake[0];
        const newHead = { x: head.x + dir.x, y: head.y + dir.y };
        
        snake.unshift(newHead);
        playSound('move');

        if (newHead.x === food.x && newHead.y === food.y) {
            playSound('eat');
            score += 10 * level;
            totalApples++;
            applesInLevel++;
            if (applesInLevel >= applesNeeded) levelUp(); 
            else spawnFood();
        } else {
            snake.pop();
        }
        updateHUD();
    }

    function levelUp() {
        level++;
        applesInLevel = 0;
        applesNeeded = 5 + (level * 2);
        tickMs = Math.max(TICK_MIN, TICK_MAX - (level * 5));
        showNotification(`LEVEL ${level}`, "#4ade80");
        spawnFood();
    }

    // --- Rendering ---
    function draw() {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= COLS; i++) {
            ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, H); ctx.stroke();
        }
        for (let i = 0; i <= ROWS; i++) {
            ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(W, i * CELL); ctx.stroke();
        }

        // Draw Food
        const fx = food.x * CELL + CELL / 2;
        const fy = food.y * CELL + CELL / 2;
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#ff2d3f';
        ctx.fillStyle = '#ff2d3f';
        ctx.beginPath();
        ctx.arc(fx, fy, CELL * 0.35, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.arc(fx - 4, fy - 4, 3, 0, Math.PI * 2);
        ctx.fill();

        // Draw Snake
        for (let i = snake.length - 1; i >= 0; i--) {
            const s = snake[i];
            const sx = s.x * CELL + CELL / 2;
            const sy = s.y * CELL + CELL / 2;
            
            ctx.shadowBlur = i === 0 ? 15 : 5;
            ctx.shadowColor = '#22c55e';
            ctx.fillStyle = i === 0 ? '#4ade80' : '#16a34a';
            
            ctx.beginPath();
            ctx.arc(sx, sy, CELL * 0.4, 0, Math.PI * 2);
            ctx.fill();

            if (i > 0) {
                ctx.fillStyle = 'rgba(255,255,255,0.1)';
                ctx.beginPath();
                ctx.arc(sx - 3, sy - 3, CELL * 0.15, 0, Math.PI * 2);
                ctx.fill();
            }
            
            if (i === 0) {
                ctx.fillStyle = '#000';
                ctx.shadowBlur = 0;
                let eye1X = sx + (dir.x * 6) - (dir.y * 6);
                let eye1Y = sy + (dir.y * 6) + (dir.x * 6);
                let eye2X = sx + (dir.x * 6) + (dir.y * 6);
                let eye2Y = sy + (dir.y * 6) - (dir.x * 6);
                
                ctx.beginPath(); ctx.arc(eye1X, eye1Y, 3, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(eye2X, eye2Y, 3, 0, Math.PI * 2); ctx.fill();
            }
        }
        ctx.shadowBlur = 0;
    }

    // --- UI ---
    let notifTimeout = null;
    function showNotification(text, color) {
        ui.notif.textContent = text;
        ui.notif.style.color = color;
        ui.notif.style.borderColor = color;
        ui.notif.classList.add('show');
        clearTimeout(notifTimeout);
        notifTimeout = setTimeout(() => {
            ui.notif.classList.remove('show');
        }, 2000);
    }

    function updateHUD() {
        ui.level.textContent = level;
        ui.score.textContent = score.toLocaleString();
        ui.apples.textContent = totalApples;
        ui.length.textContent = snake.length;
        
        const progPercent = (applesInLevel / applesNeeded) * 100;
        ui.progFill.style.width = `${progPercent}%`;
        ui.progText.textContent = `${applesInLevel} / ${applesNeeded}`;
        
        if (totalApples > 0 && totalApples % 7 === 0) {
            ui.gift.textContent = "BONUS +50";
        }
    }

    // --- Main Loop ---
    function loop(time) {
        requestAnimationFrame(loop);
        if (!lastTick) lastTick = time;
        const elapsed = time - lastTick;
        if (elapsed >= tickMs) {
            updateGame();
            lastTick = time;
        }
        draw();
    }

    // Start Game
    try {
        resetRound();
        updateHUD();
        requestAnimationFrame(loop);
    } catch (e) {
        window.onerror(e.message, "script.js", 0);
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) lastTick = performance.now();
    });

})();
