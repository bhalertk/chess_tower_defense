const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const GRID = { cols: 15, rows: 9, cell: 56 };
const TOTAL_ROUNDS = 30;
const STEP_MS = 1000;
const INCOME_INTERVAL_MS = 1500;
const COOLDOWNS = { soldier: 1000, cavalry: 2000, bishop: 3000 };
const BASE_SOLDIER_CHANCE = 0.2;
const FLAG_CONTACT_DISTANCE = 0.45;
const MAX_DEFENDER_HP = { soldier: 2, cavalry: 3, bishop: 3 };
const X_CELL = canvas.width / GRID.cols;
let state;

function makeState() {
  return {
    round: 1, money: 2, lives: 3, enemies: [], defenders: [], route: [], fullRoute: [],
    started: false, waveActive: false, waveDone: false, ended: false,
    spawnLeft: 0, spawnTimer: 0, lastStep: 0, lastIncome: 0,
    cooldowns: { soldier: 0, cavalry: 0, bishop: 0 },
    routeName: '固定路線', routeKey: '', flash: 0,
    speed: 1, paused: false
  };
}

function makeRoute() {
  if (state.fullRoute.length === 0) {
    const fullRoute = [{ x: 0, y: 4 }];
    let y = 4;
    for (let x = 1; x < GRID.cols; x += 1) {
      const options = [y];
      if (y > 1) options.push(y - 1);
      if (y < GRID.rows - 2) options.push(y + 1);
      y = options[Math.floor(Math.random() * options.length)];
      fullRoute.push({ x, y });
    }
    state.fullRoute = fullRoute;
  }
  const routeLength = Math.min(15, 10 + state.round - 1);
  state.route = state.fullRoute.slice(0, routeLength);
  state.routeKey = state.route.map((point) => point.y).join(',');
  state.routeName = `固定路線 · ${routeLength} 格`;
  $('route-label').textContent = state.routeName;
}

function getWaveSize() {
  return Math.max(1, Math.min(3 + Math.floor(state.round * 0.55) - 1, 12));
}

function startWave() {
  if (state.ended) return;
  state.started = true; state.waveActive = true; state.waveDone = false;
  state.spawnLeft = getWaveSize();
  state.spawnTimer = 0; state.lastStep = performance.now();
  $('arena-message').classList.add('hidden');
  $('wave-title').textContent = `第 ${state.round} 回合`;
  updateUI();
}

function spawnEnemy() {
  if (state.round >= 6) {
    const specialRoll = Math.random();
    if (specialRoll < 0.1) {
      const becomesCannon = Math.random() < 0.2;
      state.enemies.push(becomesCannon
        ? { type: '炮', hp: 5, speed: 3, moveInterval: 1500, index: 0, moveAt: performance.now() }
        : { type: '包', hp: 4, speed: 3, moveInterval: 2000, index: 0, moveAt: performance.now() });
      state.spawnLeft -= 1;
      return;
    }
  }
  if (state.round >= 4) {
    const specialRoll = Math.random();
    if (specialRoll < 0.30) {
      const becomesQueen = Math.random() < 0.2;
      state.enemies.push(becomesQueen
        ? { type: '瑪', hp: 3, speed: 2, moveInterval: STEP_MS, index: 0, moveAt: performance.now(), cargo: [] }
        : { type: '馬', hp: 2, speed: 2, moveInterval: STEP_MS, index: 0, moveAt: performance.now() });
      state.spawnLeft -= 1;
      return;
    }
  }
  const soldierChance = Math.min(BASE_SOLDIER_CHANCE + Math.floor((state.round - 1) / 5) * 0.02, 1);
  const becomesSoldier = Math.random() < soldierChance;
  state.enemies.push({ type: becomesSoldier ? '兵' : '卒', hp: becomesSoldier ? 2 : 1, speed: 1, moveInterval: STEP_MS, index: 0, moveAt: performance.now() });
  state.spawnLeft -= 1;
}

function deploy(type = 'soldier') {
  const cost = type === 'cavalry' ? 3 : type === 'bishop' ? 4 : 1;
  if (!state.started || state.ended || state.money < cost || state.cooldowns[type] > 0) return;
  state.money -= cost; state.cooldowns[type] = COOLDOWNS[type];
  state.defenders.push({
    type,
    damage: type === 'cavalry' ? 2 : 1,
    hp: type === 'cavalry' ? 2 : 1,
    maxHp: type === 'cavalry' ? 2 : 1,
    healAt: performance.now(),
    attackAt: performance.now(),
    index: state.route.length - 1,
    moveAt: performance.now()
  });
  updateUI();
}

function advance() {
  if (!state.waveActive || state.ended || state.paused) return;
  const now = performance.now();
  if (state.spawnLeft > 0 && now - state.lastStep >= 800 / state.speed) { spawnEnemy(); state.lastStep = now; }
  if (now - state.lastIncome >= INCOME_INTERVAL_MS / state.speed) { state.money += 1; state.lastIncome = now; }
  state.enemies.forEach((enemy) => {
    if (now - enemy.moveAt >= enemy.moveInterval / state.speed) {
      enemy.index += enemy.speed;
      enemy.moveAt = now;
      if (enemy.type === '瑪') carryNearbyEnemies(enemy);
    }
  });
  const healedThisTick = new Set();
  state.defenders.forEach((defender) => {
    if (defender.type !== 'bishop' || now - defender.healAt < STEP_MS / state.speed) return;
    state.defenders.forEach((nearby) => {
      if (Math.abs(nearby.index - defender.index) <= 2 && !healedThisTick.has(nearby)) {
        nearby.maxHp = Math.min(MAX_DEFENDER_HP[nearby.type], nearby.maxHp + 1);
        healedThisTick.add(nearby);
      }
    });
    defender.healAt = now;
  });
  const defeatedByBishop = new Set();
  state.defenders.forEach((defender) => {
    if (defender.type !== 'bishop' || now - defender.attackAt < (STEP_MS * 2) / state.speed) return;
    const target = state.enemies.reduce((closest, enemy) => {
      if (defeatedByBishop.has(enemy)) return closest;
      if (!closest || Math.abs(enemy.index - defender.index) < Math.abs(closest.index - defender.index)) return enemy;
      return closest;
    }, null);
    if (target) {
      target.hp -= 1;
      if (target.hp <= 0) defeatedByBishop.add(target);
    }
    defender.attackAt = now;
  });
  if (defeatedByBishop.size) {
    state.enemies = state.enemies.filter((enemy) => !defeatedByBishop.has(enemy));
  }
  state.defenders.forEach((defender) => {
    if (now - defender.moveAt >= STEP_MS / state.speed) {
      if (defender.type === 'cavalry') {
        const nearest = state.enemies.reduce((closest, enemy) => {
          if (!closest || Math.abs(enemy.index - defender.index) < Math.abs(closest.index - defender.index)) return enemy;
          return closest;
        }, null);
        defender.index += nearest && nearest.index > defender.index ? 1 : -1;
      } else {
        defender.index -= 1;
      }
      defender.moveAt = now;
    }
  });
  state.cooldowns.soldier = Math.max(0, state.cooldowns.soldier - 50 * state.speed);
  state.cooldowns.cavalry = Math.max(0, state.cooldowns.cavalry - 50 * state.speed);
  state.cooldowns.bishop = Math.max(0, state.cooldowns.bishop - 50 * state.speed);
  resolveCollisions();
  const flagIndex = state.route.length - 1;
  const reached = state.enemies.filter((e) => e.index >= flagIndex - FLAG_CONTACT_DISTANCE);
  if (reached.length) {
    state.lives -= reached.reduce((total, enemy) => total + 1 + (enemy.cargo ? enemy.cargo.length : 0), 0);
    state.enemies = state.enemies.filter((e) => e.index < flagIndex - FLAG_CONTACT_DISTANCE);
    state.flash = 20;
    if (state.lives <= 0) endGame(false);
  }
  if (state.waveActive && state.spawnLeft === 0 && state.enemies.length === 0) finishWave();
  updateUI();
}

function carryNearbyEnemies(carrier) {
  const carried = [];
  state.enemies = state.enemies.filter((enemy) => {
    if (enemy === carrier || enemy.type === '馬' || enemy.type === '瑪') return true;
    if (Math.abs(enemy.index - carrier.index) <= 0.5) {
      carried.push(enemy);
      return false;
    }
    return true;
  });
  carrier.cargo = [...(carrier.cargo || []), ...carried];
  carrier.cargo.forEach((enemy) => { enemy.index = carrier.index; });
}

function resolveCollisions() {
  const deadDefenders = new Set();
  const deadEnemies = new Set();
  state.defenders.forEach((defender, di) => {
    state.enemies.forEach((enemy, ei) => {
      if (!deadDefenders.has(di) && !deadEnemies.has(ei) && Math.abs(defender.index - enemy.index) <= 0.25) {
        enemy.hp -= defender.damage;
        deadDefenders.add(di);
        if (enemy.hp <= 0) deadEnemies.add(ei);
      }
    });
  });
  const defeated = state.enemies.filter((_, i) => deadEnemies.has(i));
  defeated.forEach((enemy) => {
    if (enemy.type === '瑪' && enemy.cargo) state.enemies.push(...enemy.cargo.map((carried) => ({ ...carried, moveAt: performance.now() })));
  });
  state.defenders = state.defenders.filter((_, i) => !deadDefenders.has(i));
  state.enemies = state.enemies.filter((_, i) => !deadEnemies.has(i));
}

function finishWave() {
  if (state.round >= TOTAL_ROUNDS) return endGame(true);
  state.round += 1; makeRoute();
  $('round-title').textContent = `第 ${state.round} 回合 · 路線延長`;
  startWave();
}

function endGame(won) {
  state.ended = true; state.waveActive = false;
  showMessage(won ? '♛' : '×', won ? '守住王城！' : '旗子失守', won ? '你成功守過全部 30 回合。' : '敵人突破了防線，再試一次吧。', won ? '再玩一次' : '重新挑戰');
}

function showMessage(icon, title, copy, action) {
  $('arena-message').classList.remove('hidden'); $('message-icon').textContent = icon;
  $('message-title').textContent = title; $('message-copy').textContent = copy; $('message-action').textContent = action;
}

function updateUI() {
  $('round').textContent = `${state.round} / ${TOTAL_ROUNDS}`;
  $('money').textContent = state.money;
  $('lives').innerHTML = `${Math.max(0, state.lives)} <small>♥</small>`;
  const waveSize = getWaveSize();
  $('wave-count').textContent = `${Math.max(0, state.spawnLeft)} / ${waveSize}`;
  $('wave-progress').style.width = `${state.spawnLeft ? 100 - state.spawnLeft / waveSize * 100 : (state.waveActive ? 100 : 0)}%`;
  $('wave-status').textContent = state.waveActive ? (state.spawnLeft ? '敵人正在接近' : '清理剩餘敵人') : (state.waveDone ? '等待指揮官' : '點擊開始遊戲');
  $('timer').textContent = state.waveActive ? 'LIVE' : '—';
  const soldierCooling = state.cooldowns.soldier > 0;
  const cavalryCooling = state.cooldowns.cavalry > 0;
  const bishopCooling = state.cooldowns.bishop > 0;
  $('cooldown').textContent = soldierCooling || cavalryCooling || bishopCooling ? '分開計算' : '可部署';
  $('cooldown').classList.toggle('active', soldierCooling || cavalryCooling || bishopCooling);
  $('soldier-cooldown').textContent = soldierCooling ? `${(state.cooldowns.soldier / 1000).toFixed(1)} 秒` : '可部署';
  $('cavalry-cooldown').textContent = cavalryCooling ? `${(state.cooldowns.cavalry / 1000).toFixed(1)} 秒` : '可部署';
  $('bishop-cooldown').textContent = bishopCooling ? `${(state.cooldowns.bishop / 1000).toFixed(1)} 秒` : '可部署';
  $('deploy-button').disabled = !state.started || state.ended || state.money < 1 || soldierCooling;
  $('cavalry-button').disabled = !state.started || state.ended || state.money < 3 || cavalryCooling;
  $('bishop-button').disabled = !state.started || state.ended || state.money < 4 || bishopCooling;
  $('speed-label').textContent = `${state.speed}x`;
  $('pause-label').textContent = state.paused ? '繼續' : '暫停';
  $('pause-button').classList.toggle('active', state.paused);
}

function draw() {
  const t = performance.now();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e7eee5'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let x = 0; x < GRID.cols; x++) for (let y = 0; y < GRID.rows; y++) {
    ctx.fillStyle = (x + y) % 2 ? 'rgba(255,255,255,.16)' : 'rgba(197,215,198,.12)';
    ctx.fillRect(x * X_CELL, y * GRID.cell, X_CELL, GRID.cell);
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 28; ctx.strokeStyle = '#c0d1c1';
  drawRoute(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.8)'; drawRoute();
  drawEndpoint(state.route[0], '↠', '#ee754d'); drawEndpoint(state.route[state.route.length - 1], '⚑', '#1f6a55');
  state.enemies.forEach((enemy) => drawPiece(enemy, false, t));
  state.defenders.forEach((defender) => drawPiece(defender, true, t));
  if (state.flash > 0) { ctx.fillStyle = `rgba(238,117,77,${state.flash / 100})`; ctx.fillRect(0, 0, canvas.width, canvas.height); state.flash -= 1; }
  requestAnimationFrame(draw);
}

function drawRoute() {
  ctx.beginPath();   state.route.forEach((point, i) => { const x = point.x * X_CELL + X_CELL / 2; const y = point.y * GRID.cell + GRID.cell / 2; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
  state.route.forEach((point) => { ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(point.x * X_CELL + X_CELL / 2, point.y * GRID.cell + 28, 3, 0, Math.PI * 2); ctx.fill(); });
}

function drawEndpoint(point, symbol, color) {
  const x = point.x * X_CELL + X_CELL / 2;
  const y = point.y * GRID.cell + 28;
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(symbol, x, y);
}

function drawPiece(piece, defender, now) {
  const point = state.route[Math.max(0, Math.min(state.route.length - 1, Math.floor(piece.index)))];
  const next = state.route[Math.max(0, Math.min(state.route.length - 1, Math.ceil(piece.index)))];
  const ratio = piece.index - Math.floor(piece.index);
  const x = (point.x + (next.x - point.x) * ratio) * X_CELL + X_CELL / 2;
  const y = (point.y + (next.y - point.y) * ratio) * GRID.cell + 28;
  ctx.fillStyle = defender ? (piece.type === 'cavalry' ? '#b87833' : piece.type === 'bishop' ? '#8265b1' : '#4caf87') : piece.type === '兵' ? '#a65370' : piece.type === '馬' ? '#6c62a8' : piece.type === '瑪' ? '#b05c9f' : piece.type === '炮' ? '#3f7f8f' : piece.type === '包' ? '#8a694f' : '#ee754d';
  ctx.beginPath(); ctx.arc(x, y, defender ? 16 : 15, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = `${defender ? 19 : 17}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';     ctx.fillText(defender ? (piece.type === 'cavalry' ? '♞' : piece.type === 'bishop' ? '♝' : '♟') : piece.type, x, y + 1);
  if (!defender && piece.hp > 1) { ctx.fillStyle = '#fff'; ctx.font = '9px "DM Mono"'; ctx.fillText(`${piece.hp}`, x + 11, y - 12); }
}

function restart() {
  state = makeState();
  makeRoute();
  state.lastIncome = performance.now();
  $('round-title').textContent = '第 1 回合 · 新路線';
  $('wave-title').textContent = '等待開始';
  updateUI();
  showMessage('⚑', '準備開始', '派出士兵，守住你的旗子。', '開始遊戲');
}

function cycleSpeed() {
  state.speed = state.speed === 3 ? 1 : state.speed + 1;
  updateUI();
}

function togglePause() {
  if (!state.started || state.ended) return;
  state.paused = !state.paused;
  const now = performance.now();
  if (!state.paused) {
    state.lastStep = now;
    state.lastIncome = now;
    state.enemies.forEach((enemy) => { enemy.moveAt = now; });
    state.defenders.forEach((defender) => { defender.moveAt = now; });
  }
  updateUI();
}

$('deploy-button').addEventListener('click', deploy);
$('cavalry-button').addEventListener('click', () => deploy('cavalry'));
$('bishop-button').addEventListener('click', () => deploy('bishop'));
$('message-action').addEventListener('click', () => { if (state.ended) restart(); else if (!state.started || state.waveDone) startWave(); });
$('restart-button').addEventListener('click', restart);
$('speed-button').addEventListener('click', cycleSpeed);
$('pause-button').addEventListener('click', togglePause);
document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.code === 'Space') { event.preventDefault(); togglePause(); return; }
  if (event.key.toLowerCase() === 'r') { cycleSpeed(); return; }
  if (event.key === '1') deploy('soldier');
  if (event.key === '2') deploy('cavalry');
  if (event.key === '3') deploy('bishop');
});
state = makeState(); makeRoute(); state.lastIncome = performance.now(); updateUI(); showMessage('⚑', '準備開始', '派出士兵，守住你的旗子。', '開始遊戲');
setInterval(advance, 50); draw();
