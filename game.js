const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const GRID = { cols: 20, rows: 9, cell: 56 };
const MAX_ROUTE_LENGTH = 100;
const TOTAL_ROUNDS = 50;
const STEP_MS = 1000;
const INCOME_INTERVAL_MS = 1500;
const COOLDOWNS = { soldier: 1000, cavalry: 2000, bishop: 3000, rook: 5000, queen: 8000, king: 3000 };
const BASE_SOLDIER_CHANCE = 0.2;
const FLAG_CONTACT_DISTANCE = 0.45;
const MAX_DEFENDER_HP = { soldier: 2, cavalry: 3, bishop: 3, rook: 15, queen: 40, king: 3 };
const X_CELL = canvas.width / GRID.cols;
const Y_CELL = canvas.height / GRID.rows;
let state;

function makeState() {
  return {
    round: 1, money: 2, lives: 10, enemies: [], defenders: [], route: [], fullRoute: [],
    started: false, waveActive: false, waveDone: false, ended: false, won: false,
    spawnLeft: 0, spawnTimer: 0, lastStep: 0, lastIncome: 0,
    cooldowns: { soldier: 0, cavalry: 0, bishop: 0, rook: 0, queen: 0, king: 0 },
    kingSummons: 0,
    routeName: '固定路線', routeKey: '', flash: 0,
    speed: 1, paused: false, pendingPlacement: null, shovelMode: false, projectiles: [],
    endless: false, bossSpawnedRound: null, bossSpawnedRounds: { regular: null, final: null }
    , npcEventAt: 0, npcEvent: null, npcEventChoice: null, lastNpcEventKey: null, hammerUses: 10, hammerBonusRound: 0
  };
}

const NPC_EVENTS = [
  { key: 'fee', kind: 'good', title: '作者送來稿費', text: '作者心情很好，送你 8 塊錢。', apply: () => { state.money += 8; } },
  { key: 'repair', kind: 'good', title: '作者修好旗幟', text: '作者幫你修復 1 點旗子生命。', apply: () => { state.lives = Math.min(10, state.lives + 1); } },
  { key: 'cooldown', kind: 'good', title: '作者加速施工', text: '所有部署冷卻減少 3 秒。', apply: () => { Object.keys(state.cooldowns).forEach((type) => { state.cooldowns[type] = Math.max(0, state.cooldowns[type] - 3000); }); } },
  { key: 'shortcut', kind: 'good', title: '作者畫出捷徑', text: '敵人暫停 5 秒。', apply: () => { state.enemies.forEach((enemy) => { enemy.frozenUntil = performance.now() + 5000; }); } },
  { key: 'morale', kind: 'good', title: '作者鼓舞士氣', text: '場上旗子單位恢復 1 點生命。', apply: () => { state.defenders.forEach((defender) => { defender.hp = Math.min(defender.maxHp, defender.hp + 1); }); } },
  { key: 'ink', kind: 'bad', title: '作者打翻墨水', text: '你損失 5 塊錢。', apply: () => { state.money = Math.max(0, state.money - 5); } },
  { key: 'flag', kind: 'bad', title: '作者誤畫旗子', text: '旗子生命減少 1 點。', apply: () => { state.lives -= 1; if (state.lives <= 0) endGame(false); } },
  { key: 'rush', kind: 'bad', title: '作者催稿', text: '敵人暫時加速 5 秒。', apply: () => { state.enemies.forEach((enemy) => { enemy.rushedUntil = performance.now() + 5000; }); } },
  { key: 'trade', kind: 'choice', title: '作者提出奇怪交易', text: '你支付 10 金幣，我給你 99 金幣。要交易嗎？', apply: null },
  { key: 'eat-flags', kind: 'eat-flags', title: '作者正在吃旗子', text: '我吃旗子常常鹹淡，事件開始後會吃掉 1～3 個旗子。', apply: null }
];

function triggerNpcEvent() {
  state.npcEventChoice = null;
  const candidates = NPC_EVENTS.filter((event) => event.key !== state.lastNpcEventKey);
  state.npcEvent = candidates[Math.floor(Math.random() * candidates.length)];
  state.lastNpcEventKey = state.npcEvent.key;
  $('npc-event').classList.remove('hidden');
  $('npc-event-title').textContent = `作者：${state.npcEvent.title}`;
  $('npc-event-copy').textContent = state.npcEvent.text;
  $('npc-event-countdown').textContent = '5';
  $('npc-yes').classList.toggle('hidden', state.npcEvent.kind !== 'choice');
  $('npc-no').classList.toggle('hidden', state.npcEvent.kind !== 'choice');
  let remaining = 5;
  const timer = setInterval(() => {
    if (!state.npcEvent) { clearInterval(timer); return; }
    remaining -= 1;
    $('npc-event-countdown').textContent = String(Math.max(0, remaining));
    if (remaining <= 0) {
      clearInterval(timer);
      applyNpcEvent();
    }
  }, 1000);
}

function applyNpcEvent() {
  if (!state.npcEvent) return;
  if (state.npcEvent.kind === 'eat-flags') {
    const eatenFlags = 1 + Math.floor(Math.random() * 3);
    state.lives -= eatenFlags;
    $('npc-event-copy').textContent = `作者吃掉了 ${eatenFlags} 個旗子。`;
    if (state.lives <= 0) endGame(false);
  } else if (state.npcEvent.kind === 'choice') {
    if (state.npcEventChoice === 'yes') {
      state.money = Math.max(0, state.money - 10);
      $('npc-event-copy').textContent = '真貪心！你支付 10 金幣，但沒有得到 99 金幣。';
    } else {
      $('npc-event-copy').textContent = '真慫！你拒絕了交易。';
    }
  } else {
    state.npcEvent.apply();
    $('npc-event-copy').textContent = `${state.npcEvent.text}（事件已生效）`;
  }
  updateUI();
  setTimeout(closeNpcEvent, 1200);
}

function closeNpcEvent() {
  state.npcEvent = null;
  state.npcEventChoice = null;
  $('npc-event').classList.add('hidden');
}

function cancelNpcEvent() {
  if (!state.npcEvent || state.hammerUses <= 0) return;
  state.hammerUses -= 1;
  closeNpcEvent();
  updateUI();
}

function makeRoute() {
  if (state.fullRoute.length === 0) {
    const fullRoute = [{ x: 0, y: 4 }];
    let x = 0;
    let y = 4;
    for (let step = 1; step < MAX_ROUTE_LENGTH; step += 1) {
      const canMoveVertically = y > 1 && y < GRID.rows - 2;
      if (canMoveVertically && Math.random() < 0.3) {
        y += Math.random() < 0.5 ? -1 : 1;
      } else {
        x += 1;
      }
      fullRoute.push({ x, y });
    }
    state.fullRoute = fullRoute;
  }
  const routeLength = Math.min(MAX_ROUTE_LENGTH, 10 + state.round - 1);
  state.route = state.fullRoute.slice(0, routeLength);
  state.routeKey = state.route.map((point) => point.y).join(',');
  state.routeName = `固定路線 · ${routeLength} 格`;
  $('route-label').textContent = state.routeName;
}

function getCameraOffset() {
  return Math.max(0, state.route.length - GRID.cols);
}

function getWaveSize() {
  return Math.max(1, 2 + Math.floor(state.round * 0.55));
}

function getEnemyHp(baseHp) {
  return Math.max(1, baseHp - 2 + Math.floor(state.round / 5) * 3);
}

function startWave() {
  if (state.ended) return;
  state.started = true; state.waveActive = true; state.waveDone = false;
  state.spawnLeft = getWaveSize();
  state.spawnTimer = 0; state.lastStep = performance.now();
  if (state.endless && state.round % 5 === 0 && state.hammerBonusRound !== state.round) {
    state.hammerUses += 1;
    state.hammerBonusRound = state.round;
  }
  $('arena-message').classList.add('hidden');
  $('wave-title').textContent = `第 ${state.round} 回合`;
  updateUI();
}

function spawnEnemy() {
  const finalBossDue = state.endless ? state.round % 25 === 0 : state.round === 50;
  const regularBossDue = state.endless ? state.round % 15 === 0 : state.round === 15 || state.round === 30;
  if (finalBossDue && (state.endless ? state.bossSpawnedRounds.final !== state.round : state.bossSpawnedRound !== state.round)) {
    spawnFinalBoss();
    state.bossSpawnedRound = state.round;
    state.bossSpawnedRounds.final = state.round;
    state.spawnLeft -= 1;
    return;
  }
  if (regularBossDue && (state.endless ? state.bossSpawnedRounds.regular !== state.round : state.bossSpawnedRound !== state.round)) {
    spawnBoss();
    state.bossSpawnedRound = state.round;
    state.bossSpawnedRounds.regular = state.round;
    state.spawnLeft -= 1;
    return;
  }

  function spawnFinalBoss() {
    const becomesMarshal = Math.random() < 0.1;
    const bossType = becomesMarshal ? '帥' : '將';
    const escortTypes = becomesMarshal
      ? ['兵', '兵', '兵', '兵', '兵', '瑪', '瑪', '俥', '俥', '仕', '仕', '炮', '炮']
      : ['卒', '卒', '卒', '卒', '卒', '馬', '馬', '車', '車', '相', '相', '士', '士', '包', '包'];
    const now = performance.now();
    const boss = {
      type: bossType, hp: getEnemyHp(becomesMarshal ? 67 : 55), speed: 1,
      moveInterval: 2000, index: 0, moveAt: now, direction: 1,
      boss: true, finalBoss: true, stepsTaken: 0
    };
    state.enemies.push(boss);
    escortTypes.forEach((type) => {
      const stats = {
        卒: { hp: getEnemyHp(1), speed: 1, moveInterval: STEP_MS },
        兵: { hp: getEnemyHp(2), speed: 1, moveInterval: STEP_MS },
        馬: { hp: getEnemyHp(2), speed: 2, moveInterval: STEP_MS },
        瑪: { hp: getEnemyHp(3), speed: 2, moveInterval: STEP_MS, cargo: [] },
        車: { hp: getEnemyHp(9), speed: 2, moveInterval: 2000 },
        俥: { hp: getEnemyHp(12), speed: 2, moveInterval: 2000 },
        相: { hp: getEnemyHp(40), speed: 1, moveInterval: STEP_MS },
        士: { hp: getEnemyHp(2), speed: 1, moveInterval: STEP_MS, guardFor: bossType },
        仕: { hp: getEnemyHp(2), speed: 1, moveInterval: STEP_MS, guardFor: bossType },
        包: { hp: getEnemyHp(3), speed: 2, moveInterval: 2000 },
        炮: { hp: getEnemyHp(3), speed: 3, moveInterval: 1500 }
      }[type];
      state.enemies.push({ type, ...stats, index: 0, moveAt: now });
    });
  }
  if (state.round >= 10 && Math.random() < 0.1) {
    const becomesChariot = Math.random() < 0.2;
    state.enemies.push(becomesChariot
      ? { type: '俥', hp: getEnemyHp(12), speed: 2, moveInterval: 2000, index: 0, moveAt: performance.now() }
      : { type: '車', hp: getEnemyHp(9), speed: 2, moveInterval: 2000, index: 0, moveAt: performance.now() });
    state.spawnLeft -= 1;
    return;
  }
  if (state.round >= 6) {
    const specialRoll = Math.random();
    if (specialRoll < 0.1) {
      const becomesCannon = Math.random() < 0.2;
      state.enemies.push(becomesCannon
        ? { type: '炮', hp: getEnemyHp(3), speed: 3, moveInterval: 1500, attackInterval: 3000, index: 0, moveAt: performance.now(), attackAt: performance.now() }
        : { type: '包', hp: getEnemyHp(3), speed: 2, moveInterval: 2000, attackInterval: 4000, index: 0, moveAt: performance.now(), attackAt: performance.now() });
      state.spawnLeft -= 1;
      return;
    }
  }
  if (state.round >= 4) {
    const specialRoll = Math.random();
    if (specialRoll < 0.30) {
      const becomesQueen = Math.random() < 0.2;
      state.enemies.push(becomesQueen
        ? { type: '瑪', hp: getEnemyHp(3), speed: 2, moveInterval: STEP_MS, index: 0, moveAt: performance.now(), cargo: [] }
        : { type: '馬', hp: getEnemyHp(2), speed: 2, moveInterval: STEP_MS, index: 0, moveAt: performance.now() });
      state.spawnLeft -= 1;
      return;
    }
  }
  const soldierChance = Math.min(BASE_SOLDIER_CHANCE + Math.floor((state.round - 1) / 5) * 0.02, 1);
  const becomesSoldier = Math.random() < soldierChance;
  state.enemies.push({ type: becomesSoldier ? '兵' : '卒', hp: getEnemyHp(becomesSoldier ? 2 : 1), speed: 1, moveInterval: STEP_MS, index: 0, moveAt: performance.now() });
  state.spawnLeft -= 1;
}

function spawnBoss() {
  const becomesMinister = Math.random() < 0.2;
  const bossType = becomesMinister ? '相' : '象';
  const escortTypes = becomesMinister ? ['兵', '兵', '瑪', '俥', '俥'] : ['卒', '卒', '馬', '車', '車'];
  const now = performance.now();
  state.enemies.push({
    type: bossType, hp: getEnemyHp(becomesMinister ? 40 : 30), speed: 1,
    moveInterval: STEP_MS, index: 0, moveAt: now, direction: 1, boss: true
  });
  escortTypes.forEach((type) => {
    const stats = {
      卒: { hp: getEnemyHp(1), speed: 1, moveInterval: STEP_MS },
      兵: { hp: getEnemyHp(2), speed: 1, moveInterval: STEP_MS },
      馬: { hp: getEnemyHp(2), speed: 2, moveInterval: STEP_MS },
      瑪: { hp: getEnemyHp(3), speed: 2, moveInterval: STEP_MS, cargo: [] },
      車: { hp: getEnemyHp(9), speed: 2, moveInterval: 2000 },
      俥: { hp: getEnemyHp(12), speed: 2, moveInterval: 2000 }
    }[type];
    state.enemies.push({ type, ...stats, index: 0, moveAt: now });
  });
}

function deploy(type = 'soldier') {
  const cost = getDefenderCost(type);
  if (type !== 'soldier') {
    if (!state.started || state.ended || state.money < cost || state.cooldowns[type] > 0) return;
    state.pendingPlacement = type;
    updateUI();
    return;
  }
  if (!state.started || state.ended || state.money < cost || state.cooldowns[type] > 0) return;
  state.money -= cost; state.cooldowns[type] = getEffectiveCooldown(type);
  state.defenders.push({
    type,
    damage: type === 'cavalry' ? 2 : type === 'rook' ? 0 : type === 'queen' ? 3 : type === 'king' ? 1 : 1,
    hp: MAX_DEFENDER_HP[type],
    maxHp: MAX_DEFENDER_HP[type],
    healAt: performance.now(),
    attackAt: performance.now(),
    index: state.route.length - 1,
    moveAt: performance.now()
  });
  updateUI();
}

function placeDefender(x, y) {
  const type = state.pendingPlacement;
  if (!type) return;
  const cost = getDefenderCost(type);
  const onRoute = state.route.some((point) => point.x === x && point.y === y);
  if ((type === 'rook' ? !onRoute : type === 'queen' ? false : onRoute) || state.money < cost) return;
  if (state.defenders.some((defender) => defender.x === x && defender.y === y)) return;
  state.money -= cost;
  state.cooldowns[type] = getEffectiveCooldown(type);
  state.defenders.push({
    type, damage: type === 'cavalry' ? 2 : type === 'rook' ? 0 : type === 'queen' ? 3 : type === 'king' ? 1 : 1,
    hp: MAX_DEFENDER_HP[type], maxHp: MAX_DEFENDER_HP[type],
    healAt: performance.now(), attackAt: performance.now(),
    x, y, index: state.route.findIndex((point) => point.x === x && point.y === y), moveAt: performance.now(),
    blockAt: performance.now()
  });
  if (type === 'king') state.kingSummons += 1;
  state.pendingPlacement = null;
  updateUI();
}

function advance() {
  if (!state.waveActive || state.ended || state.paused) return;
  const now = performance.now();
  if (state.round >= 10 && !state.npcEvent && now - state.npcEventAt >= 15000) {
    triggerNpcEvent();
    state.npcEventAt = now;
  }
  if (state.spawnLeft > 0 && now - state.lastStep >= 800 / state.speed) { spawnEnemy(); state.lastStep = now; }
  if (now - state.lastIncome >= INCOME_INTERVAL_MS / state.speed) { state.money += 1; state.lastIncome = now; }
  state.enemies.forEach((enemy) => {
    if (enemy.frozenUntil > now) return;
    const moveInterval = enemy.rushedUntil > now ? enemy.moveInterval / 1.5 : enemy.moveInterval;
    if (now - enemy.moveAt >= moveInterval / state.speed) {
      const nextIndex = enemy.index + (enemy.boss ? enemy.direction : enemy.speed);
      const blocker = state.defenders.find((defender) => defender.type === 'rook'
        && defender.index >= 0 && ((enemy.boss && enemy.direction === 1 && defender.index <= nextIndex)
          || (!enemy.boss && defender.index >= enemy.index && defender.index <= nextIndex)));
      enemy.index = blocker ? blocker.index : nextIndex;
      enemy.moveAt = now;
      if (enemy.type === '瑪') carryNearbyEnemies(enemy);
      if (enemy.finalBoss && enemy.direction === 1 && ++enemy.stepsTaken >= 3) {
        enemy.direction = -1;
      } else if (enemy.boss && !enemy.finalBoss && enemy.direction === 1 && enemy.index >= Math.floor((state.route.length - 1) / 2)) {
        enemy.direction = -1;
      }
    }
  });
  state.enemies.forEach((enemy) => {
    if (!enemy.guardFor) return;
    const boss = state.enemies.find((candidate) => candidate.type === enemy.guardFor && candidate.finalBoss);
    if (boss) enemy.index = boss.index;
  });
  state.enemies.forEach((enemy) => {
    if (enemy.type === '瑪') carryNearbyEnemies(enemy);
  });
  const defeatedDefenders = new Set();
  state.enemies.forEach((enemy) => {
    if (!enemy.attackInterval || now - enemy.attackAt < enemy.attackInterval / state.speed) return;
    const enemyPoint = state.route[Math.max(0, Math.min(state.route.length - 1, Math.floor(enemy.index)))];
    const target = state.defenders.reduce((closest, defender) => {
      if (defeatedDefenders.has(defender)) return closest;
      const defenderPoint = defender.x !== undefined
        ? { x: defender.x, y: defender.y }
        : state.route[Math.max(0, Math.min(state.route.length - 1, Math.round(defender.index)))];
      if (!enemyPoint || !defenderPoint) return closest;
      if (!closest || Math.hypot(defenderPoint.x - enemyPoint.x, defenderPoint.y - enemyPoint.y) <
        Math.hypot(closest.point.x - enemyPoint.x, closest.point.y - enemyPoint.y)) {
        return { defender, point: defenderPoint };
      }
      return closest;
    }, null);
    if (target) {
      state.projectiles.push({ from: enemyPoint, targetPoint: target.point, color: '#3f7f8f', createdAt: now });
      target.defender.hp -= 1;
      enemy.attackAt = now;
      if (target.defender.hp <= 0) defeatedDefenders.add(target.defender);
    }
  });
  if (defeatedDefenders.size) {
    state.defenders = state.defenders.filter((defender) => !defeatedDefenders.has(defender));
  }
  const healedThisTick = new Set();
  state.defenders.forEach((defender) => {
    if (defender.type !== 'bishop' || now - defender.healAt < STEP_MS / state.speed) return;
    state.defenders.forEach((nearby) => {
      const nearbyPoint = state.route[Math.max(0, Math.min(state.route.length - 1, Math.floor(nearby.index)))];
      const close = nearbyPoint && Math.hypot(nearbyPoint.x - defender.x, nearbyPoint.y - defender.y) <= 2;
      if (close && !healedThisTick.has(nearby)) {
        nearby.hp = Math.min(nearby.maxHp, nearby.hp + 1);
        healedThisTick.add(nearby);
      }
    });
    defender.healAt = now;
  });
  const defeatedByBishop = new Set();
  const defeatedByCavalry = new Set();
  const defeatedByQueen = new Set();
  const defeatedByKing = new Set();
  state.defenders.forEach((defender) => {
    if (defender.type !== 'king' || now - defender.attackAt < getAttackInterval('king') / state.speed) return;
    const target = state.enemies.reduce((closest, enemy) => (
      !closest || enemy.index < closest.index ? enemy : closest
    ), null);
    if (target) {
      const targetPoint = state.route[Math.max(0, Math.min(state.route.length - 1, Math.floor(target.index)))];
      state.projectiles.push({
        from: { x: defender.x, y: defender.y }, targetPoint, color: '#d6a93b', createdAt: now
      });
      const damagedTarget = damageEnemy(target, getAttackDamage(1), Math.floor(getActiveKingCount() / 10));
      if (damagedTarget.hp <= 0) defeatedByKing.add(damagedTarget);
    }
    defender.attackAt = now;
  });
  if (defeatedByKing.size) state.enemies = state.enemies.filter((enemy) => !defeatedByKing.has(enemy));
  state.defenders.forEach((defender) => {
    if (defender.type !== 'queen' || now - defender.attackAt < getAttackInterval('queen') / state.speed) return;
    const target = state.enemies.reduce((closest, enemy) => {
      if (!closest || enemy.index < closest.index) return enemy;
      return closest;
    }, null);
    if (target) {
      const targetPoint = state.route[Math.max(0, Math.min(state.route.length - 1, Math.floor(target.index)))];
      const from = defender.x !== undefined
        ? { x: defender.x, y: defender.y }
        : state.route[Math.max(0, Math.min(state.route.length - 1, Math.round(defender.index)))];
      state.projectiles.push({ from, targetPoint, color: '#9b5bb5', createdAt: now });
      const damagedTarget = damageEnemy(target, getAttackDamage(3), Math.floor(getActiveKingCount() / 10));
      if (damagedTarget.hp <= 0) defeatedByQueen.add(damagedTarget);
    }
    defender.attackAt = now;
  });
  if (defeatedByQueen.size) {
    state.enemies = state.enemies.filter((enemy) => !defeatedByQueen.has(enemy));
  }
  state.defenders.forEach((defender) => {
    if (defender.type !== 'cavalry' || defender.x === undefined || now - defender.attackAt < getAttackInterval('cavalry') / state.speed) return;
    const target = state.enemies.reduce((closest, enemy) => {
      const targetPoint = state.route[Math.max(0, Math.min(state.route.length - 1, Math.floor(enemy.index)))];
      if (!targetPoint || !closest || Math.hypot(targetPoint.x - defender.x, targetPoint.y - defender.y) < Math.hypot(
        state.route[Math.max(0, Math.min(state.route.length - 1, Math.floor(closest.index)))].x - defender.x,
        state.route[Math.max(0, Math.min(state.route.length - 1, Math.floor(closest.index)))].y - defender.y
      )) return targetPoint && Math.hypot(targetPoint.x - defender.x, targetPoint.y - defender.y) <= 1 ? enemy : closest;
      return closest;
    }, null);
    if (target) {
      const targetPoint = state.route[Math.max(0, Math.min(state.route.length - 1, Math.floor(target.index)))];
      state.projectiles.push({ from: { x: defender.x, y: defender.y }, targetPoint, color: '#d28b42', createdAt: now });
      const damagedTarget = damageEnemy(target, getAttackDamage(2), Math.floor(getActiveKingCount() / 10));
      if (damagedTarget.hp <= 0) defeatedByCavalry.add(damagedTarget);
    }
    if (target) defender.attackAt = now;
  });
  if (defeatedByCavalry.size) {
    state.enemies = state.enemies.filter((enemy) => !defeatedByCavalry.has(enemy));
  }
  state.defenders.forEach((defender) => {
    if (defender.type !== 'bishop' || now - defender.attackAt < getAttackInterval('bishop') / state.speed) return;
    const target = state.enemies.reduce((closest, enemy) => {
      if (defeatedByBishop.has(enemy)) return closest;
      const targetPoint = state.route[Math.max(0, Math.min(state.route.length - 1, Math.floor(enemy.index)))];
      if (!targetPoint) return closest;
      if (!closest || Math.abs(enemy.index - defender.index) < Math.abs(closest.index - defender.index)) return enemy;
      return closest;
    }, null);
    if (target) {
      const targetPoint = state.route[Math.max(0, Math.min(state.route.length - 1, Math.floor(target.index)))];
      state.projectiles.push({ from: { x: defender.x, y: defender.y }, targetPoint, color: '#8265b1', createdAt: now });
      const damagedTarget = damageEnemy(target, getAttackDamage(1), Math.floor(getActiveKingCount() / 10));
      if (damagedTarget.hp <= 0) defeatedByBishop.add(damagedTarget);
    }
    defender.attackAt = now;
  });
  if (defeatedByBishop.size) {
    state.enemies = state.enemies.filter((enemy) => !defeatedByBishop.has(enemy));
  }
  state.defenders.forEach((defender) => {
    if (defender.type === 'queen' || (defender.type !== 'soldier' && defender.x !== undefined)) return;
    if (now - defender.moveAt >= STEP_MS / state.speed) {
      if (defender.type === 'cavalry') {
        const nearest = state.enemies.reduce((closest, enemy) => {
          if (!closest || Math.abs(enemy.index - defender.index) < Math.abs(closest.index - defender.index)) return enemy;
          return closest;
        }, null);
        defender.index += nearest && nearest.index > defender.index ? 1 : -1;
      } else {
        defender.index -= 1;
        if (defender.index <= 0) defender.index = state.route.length - 1;
      }
      defender.moveAt = now;
    }
  });
  state.cooldowns.soldier = Math.max(0, state.cooldowns.soldier - 50 * state.speed);
  state.cooldowns.cavalry = Math.max(0, state.cooldowns.cavalry - 50 * state.speed);
  state.cooldowns.bishop = Math.max(0, state.cooldowns.bishop - 50 * state.speed);
  state.cooldowns.rook = Math.max(0, state.cooldowns.rook - 50 * state.speed);
  state.cooldowns.queen = Math.max(0, state.cooldowns.queen - 50 * state.speed);
  state.cooldowns.king = Math.max(0, state.cooldowns.king - 50 * state.speed);
  resolveCollisions(now);
  const flagIndex = state.route.length - 1;
  state.enemies.filter((enemy) => enemy.type === '瑪' && enemy.index >= flagIndex - FLAG_CONTACT_DISTANCE)
    .forEach(unloadQueenCargo);
  const reached = state.enemies.filter((e) => e.index >= flagIndex - FLAG_CONTACT_DISTANCE);
  if (reached.length) {
    state.lives -= reached.length;
    state.enemies = state.enemies.filter((e) => e.index < flagIndex - FLAG_CONTACT_DISTANCE);
    state.flash = 20;
    if (state.lives <= 0) endGame(false);
  }
  state.enemies.filter((enemy) => enemy.boss && enemy.index <= 0)
    .forEach(convertBossAtStart);
  if (state.waveActive && state.spawnLeft === 0 && state.enemies.length === 0) finishWave();
  updateUI();
}

function convertBossAtStart(boss) {
  const type = boss.finalBoss ? (boss.type === '帥' ? '相' : '象') : (boss.type === '相' ? '俥' : '車');
  const count = boss.finalBoss ? 2 : 5;
  state.enemies = state.enemies.filter((enemy) => enemy !== boss);
  const now = performance.now();
  for (let i = 0; i < count; i += 1) {
    state.enemies.push({
      type,
      hp: getEnemyHp(type === '相' ? 40 : type === '象' ? 30 : type === '俥' ? 12 : 9),
      speed: type === '相' || type === '象' ? 1 : 2,
      moveInterval: type === '相' || type === '象' ? STEP_MS : 2000,
      index: 0, moveAt: now
    });
  }

}

function damageEnemy(enemy, amount, penetration = 0) {
  const guard = enemy.finalBoss
    ? state.enemies.find((candidate) => candidate.guardFor === enemy.type && Math.abs(candidate.index - enemy.index) <= 1)
    : null;
  const target = guard || enemy;
  const effectiveAmount = !enemy.boss && !guard ? amount + penetration : amount;
  target.hp -= effectiveAmount;
  return target;
}

function carryNearbyEnemies(carrier) {
  const carried = [];
  state.enemies = state.enemies.filter((enemy) => {
    if (enemy === carrier || (enemy.type !== '卒' && enemy.type !== '兵')) return true;
    if (Math.abs(enemy.index - carrier.index) <= 0.5) {
      carried.push(enemy);
      return false;
    }
    return true;
  });
  carrier.cargo = [...(carrier.cargo || []), ...carried];
  carrier.cargo.forEach((enemy) => { enemy.index = carrier.index; });
}

function unloadQueenCargo(carrier) {
  if (!carrier.cargo || carrier.cargo.length === 0) return;
  state.enemies.push(...carrier.cargo.map((enemy) => ({
    ...enemy,
    index: carrier.index,
    moveAt: performance.now()
  })));
  carrier.cargo = [];
}

function resolveCollisions(now) {
  const deadDefenders = new Set();
  const deadEnemies = new Set();
  state.defenders.forEach((defender, di) => {
    const isRouteBlocker = defender.type === 'rook' || defender.type === 'queen';
    if (defender.x !== undefined && !isRouteBlocker) return;
    state.enemies.forEach((enemy, ei) => {
      if (!deadDefenders.has(di) && !deadEnemies.has(ei) && Math.abs(defender.index - enemy.index) <= 0.25) {
        if (defender.type === 'rook' || defender.type === 'queen') {
          if (now - defender.blockAt >= STEP_MS / state.speed) {
            defender.hp -= 1;
            defender.blockAt = now;
            if (defender.hp <= 0) deadDefenders.add(di);
          }
          return;
        }
          const damage = defender.type === 'cavalry' && enemy.type === '卒' ? 1 : defender.damage;
          const damagedEnemy = damageEnemy(enemy, getAttackDamage(damage), Math.floor(getActiveKingCount() / 10));
        deadDefenders.add(di);
        if (damagedEnemy.hp <= 0) {
          const damagedIndex = state.enemies.indexOf(damagedEnemy);
          if (damagedIndex >= 0) deadEnemies.add(damagedIndex);
        }
      }
    });
  });
  const defeated = state.enemies.filter((_, i) => deadEnemies.has(i));
  defeated.forEach((enemy) => {
    if (enemy.type === '瑪') unloadQueenCargo(enemy);
  });
  state.defenders = state.defenders.filter((_, i) => !deadDefenders.has(i));
  state.enemies = state.enemies.filter((_, i) => !deadEnemies.has(i));
}

function finishWave() {
  if (!state.endless && state.round >= TOTAL_ROUNDS) return endGame(true);
  state.round += 1; makeRoute();
  $('round-title').textContent = `第 ${state.round} 回合 · 路線延長`;
  startWave();
}

function endGame(won) {
  state.ended = true; state.won = won; state.waveActive = false;
  showMessage(won ? '♛' : '×', won ? '守住王城！' : '旗子失守', won ? '你成功守過全部 50 回合。' : '敵人突破了防線，再試一次吧。', won ? '再玩一次' : '重新挑戰');
}

function showMessage(icon, title, copy, action) {
  $('arena-message').classList.remove('hidden'); $('message-icon').textContent = icon;
  $('message-title').textContent = title; $('message-copy').textContent = copy; $('message-action').textContent = action;
}

function updateUI() {
  $('round').textContent = state.endless ? `${state.round} / ∞` : `${state.round} / ${TOTAL_ROUNDS}`;
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
  const rookCooling = state.cooldowns.rook > 0;
  const queenCooling = state.cooldowns.queen > 0;
  const kingCooling = state.cooldowns.king > 0;
  $('cooldown').textContent = soldierCooling || cavalryCooling || bishopCooling || rookCooling || queenCooling || kingCooling ? '分開計算' : '可部署';
  $('cooldown').classList.toggle('active', soldierCooling || cavalryCooling || bishopCooling || rookCooling || queenCooling || kingCooling);
  $('soldier-cooldown').textContent = soldierCooling ? `${(state.cooldowns.soldier / 1000).toFixed(1)} 秒` : '可部署';
  $('cavalry-cooldown').textContent = cavalryCooling ? `${(state.cooldowns.cavalry / 1000).toFixed(1)} 秒` : '可部署';
  $('bishop-cooldown').textContent = bishopCooling ? `${(state.cooldowns.bishop / 1000).toFixed(1)} 秒` : '可部署';
  $('rook-cooldown').textContent = rookCooling ? `${(state.cooldowns.rook / 1000).toFixed(1)} 秒` : '可部署';
  $('queen-cooldown').textContent = queenCooling ? `${(state.cooldowns.queen / 1000).toFixed(1)} 秒` : '可部署';
  $('king-cooldown').textContent = kingCooling ? `${(state.cooldowns.king / 1000).toFixed(1)} 秒` : '可部署';
  $('king-cost').textContent = `${getDefenderCost('king')} ₲`;
  $('deploy-button').disabled = !state.started || state.ended || state.money < 1 || soldierCooling;
  $('cavalry-button').disabled = !state.started || state.ended || state.money < 3 || cavalryCooling;
  $('bishop-button').disabled = !state.started || state.ended || state.money < 4 || bishopCooling;
  $('rook-button').disabled = !state.started || state.ended || state.money < 10 || rookCooling;
  $('queen-button').disabled = !state.started || state.ended || state.money < 20 || queenCooling;
  $('king-button').disabled = !state.started || state.ended || state.money < getDefenderCost('king') || kingCooling;
  $('mode-button').disabled = !state.ended || !state.won;
  $('hammer-button').innerHTML = `🔨 槌子停止事件 (${state.hammerUses}) <kbd>Q</kbd>`;
  $('speed-label').textContent = `${state.speed}x`;
  $('pause-label').textContent = state.paused ? '繼續' : '暫停';
  $('pause-button').classList.toggle('active', state.paused);
  $('cavalry-button').classList.toggle('active', state.pendingPlacement === 'cavalry');
  $('bishop-button').classList.toggle('active', state.pendingPlacement === 'bishop');
  $('rook-button').classList.toggle('active', state.pendingPlacement === 'rook');
  $('queen-button').classList.toggle('active', state.pendingPlacement === 'queen');
  $('king-button').classList.toggle('active', state.pendingPlacement === 'king');
  $('shovel-button').classList.toggle('active', state.shovelMode);
}

function draw() {
  const t = performance.now();
  state.projectiles = state.projectiles.filter((projectile) => t - projectile.createdAt < 280);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let x = 0; x < GRID.cols; x++) for (let y = 0; y < GRID.rows; y++) {
    ctx.fillStyle = (x + y) % 2 ? 'rgba(255,255,255,.16)' : 'rgba(197,215,198,.12)';
    ctx.fillRect(x * X_CELL, y * Y_CELL, X_CELL, Y_CELL);
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 28; ctx.strokeStyle = '#c0d1c1';
  drawRoute(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.8)'; drawRoute();
  drawEndpoint(state.route[0], '↠', '#ee754d'); drawEndpoint(state.route[state.route.length - 1], '⚑', '#1f6a55');
  state.enemies.forEach((enemy) => drawPiece(enemy, false, t));
  state.defenders.forEach((defender) => drawPiece(defender, true, t));
  state.projectiles.forEach((projectile) => drawProjectile(projectile, t));
  if (state.flash > 0) { ctx.fillStyle = `rgba(238,117,77,${state.flash / 100})`; ctx.fillRect(0, 0, canvas.width, canvas.height); state.flash -= 1; }
  requestAnimationFrame(draw);
}

function drawProjectile(projectile, now) {
  const targetPoint = projectile.targetPoint;
  if (!targetPoint) return;
  const progress = Math.min(1, (now - projectile.createdAt) / 280);
  const cameraOffset = getCameraOffset();
  const startX = (projectile.from.x - cameraOffset) * X_CELL + X_CELL / 2;
  const startY = projectile.from.y * Y_CELL + Y_CELL / 2;
  const endX = (targetPoint.x - cameraOffset) * X_CELL + X_CELL / 2;
  const endY = targetPoint.y * Y_CELL + Y_CELL / 2;
  const x = startX + (endX - startX) * progress;
  const y = startY + (endY - startY) * progress;
  ctx.fillStyle = projectile.color;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawRoute() {
  const cameraOffset = getCameraOffset();
  ctx.beginPath(); state.route.forEach((point, i) => {
    const x = (point.x - cameraOffset) * X_CELL + X_CELL / 2;
    const y = point.y * Y_CELL + Y_CELL / 2;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }); ctx.stroke();
  state.route.forEach((point) => {
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath();
    ctx.arc((point.x - cameraOffset) * X_CELL + X_CELL / 2, point.y * Y_CELL + Y_CELL / 2, 3, 0, Math.PI * 2); ctx.fill();
  });
}

function drawEndpoint(point, symbol, color) {
  const x = (point.x - getCameraOffset()) * X_CELL + X_CELL / 2;
  const y = point.y * Y_CELL + Y_CELL / 2;
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(symbol, x, y);
}

function drawPiece(piece, defender, now) {
  if (defender && piece.x !== undefined) {
    const x = (piece.x - getCameraOffset()) * X_CELL + X_CELL / 2;
    const y = piece.y * Y_CELL + Y_CELL / 2;
    drawPieceAt(piece, true, x, y);
    return;
  }
  const point = state.route[Math.max(0, Math.min(state.route.length - 1, Math.floor(piece.index)))];
  const next = state.route[Math.max(0, Math.min(state.route.length - 1, Math.ceil(piece.index)))];
  const ratio = piece.index - Math.floor(piece.index);
  const x = (point.x + (next.x - point.x) * ratio - getCameraOffset()) * X_CELL + X_CELL / 2;
  const y = (point.y + (next.y - point.y) * ratio) * Y_CELL + Y_CELL / 2;
  drawPieceAt(piece, defender, x, y);
}

function drawPieceAt(piece, defender, x, y) {
  ctx.fillStyle = defender ? (piece.type === 'cavalry' ? '#b87833' : piece.type === 'bishop' ? '#8265b1' : piece.type === 'rook' ? '#526b7d' : piece.type === 'queen' ? '#9b5bb5' : piece.type === 'king' ? '#d6a93b' : '#4caf87') : piece.type === '兵' ? '#a65370' : piece.type === '馬' ? '#6c62a8' : piece.type === '瑪' ? '#b05c9f' : piece.type === '炮' ? '#3f7f8f' : piece.type === '包' ? '#8a694f' : piece.type === '車' || piece.type === '俥' ? '#384f68' : piece.type === '將' || piece.type === '帥' ? '#8b3f52' : piece.type === '象' || piece.type === '相' ? '#6b4c8f' : '#ee754d';
  ctx.beginPath(); ctx.arc(x, y, defender ? 16 : 15, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = `${defender ? 19 : 17}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';         ctx.fillText(defender ? (piece.type === 'cavalry' ? '♞' : piece.type === 'bishop' ? '♝' : piece.type === 'rook' ? '♜' : piece.type === 'queen' ? '♛' : piece.type === 'king' ? '♚' : '♟') : piece.type, x, y + 1);
  if (!defender && piece.hp > 1) { ctx.fillStyle = '#fff'; ctx.font = '9px "DM Mono"'; ctx.fillText(`${piece.hp}`, x + 11, y - 12); }
}

function restart() {
  state = makeState();
  makeRoute();
  state.lastIncome = performance.now();
  $('round-title').textContent = '第 1 回合 · 新路線';
  $('wave-title').textContent = '等待開始';
  $('mode-button').textContent = '獲勝後切換無盡模式';
  updateUI();
  showMessage('⚑', '準備開始', '派出士兵，守住你的旗子。', '開始遊戲');
}

function toggleEndless() {
  if (state.ended && state.won && !state.endless) {
    restart();
    state.endless = true;
    $('mode-button').textContent = '切換一般模式';
    $('message-copy').textContent = '無盡模式：每 15 回合與每 25 回合會出現 Boss。';
    updateUI();
    return;
  }
}

function cycleSpeed() {
  state.speed = state.speed === 3 ? 1 : state.speed + 1;
  updateUI();
}

function toggleShovel() {
  state.shovelMode = !state.shovelMode;
  state.pendingPlacement = null;
  updateUI();
}

function getDefenderCost(type) {
  return type === 'cavalry' ? 3 : type === 'bishop' ? 4 : type === 'rook' ? 10 : type === 'queen' ? 20
    : type === 'king' ? 5 * (2 ** state.kingSummons) : 1;
}

function getActiveKingCount() {
  return state.defenders.filter((defender) => defender.type === 'king').length;
}

function getAttackDamage(baseDamage) {
  return baseDamage + getActiveKingCount() * 0.1;
}

function getEffectiveCooldown(type) {
  return Math.max(300, COOLDOWNS[type] - Math.floor(getActiveKingCount() / 5) * 300);
}

function getAttackInterval(type) {
  return Math.max(300, (type === 'king' ? COOLDOWNS.king : type === 'queen' ? STEP_MS * 2 : STEP_MS * 3)
    - Math.floor(getActiveKingCount() / 5) * 300);
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
$('rook-button').addEventListener('click', () => deploy('rook'));
$('queen-button').addEventListener('click', () => deploy('queen'));
$('king-button').addEventListener('click', () => deploy('king'));
$('game-canvas').addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(MAX_ROUTE_LENGTH - 1,
    Math.floor((event.clientX - rect.left) / rect.width * GRID.cols) + getCameraOffset()));
  const y = Math.max(0, Math.min(GRID.rows - 1, Math.floor((event.clientY - rect.top) / rect.height * GRID.rows)));
  if (state.shovelMode) {
    const defenderIndex = state.defenders.findIndex((defender) => {
      if (defender.x !== undefined) return defender.x === x && defender.y === y;
      const point = state.route[Math.max(0, Math.min(state.route.length - 1, Math.round(defender.index)))];
      return point && point.x === x && point.y === y;
    });
    if (defenderIndex >= 0) {
      const [removed] = state.defenders.splice(defenderIndex, 1);
      state.money += Math.floor(getDefenderCost(removed.type) * 0.5);
    }
    state.shovelMode = false;
    updateUI();
    return;
  }
  placeDefender(x, y);
});
$('message-action').addEventListener('click', () => { if (state.ended) restart(); else if (!state.started || state.waveDone) startWave(); });
$('restart-button').addEventListener('click', restart);
$('mode-button').addEventListener('click', toggleEndless);
$('hammer-button').addEventListener('click', cancelNpcEvent);
$('npc-yes').addEventListener('click', () => { state.npcEventChoice = 'yes'; });
$('npc-no').addEventListener('click', () => { state.npcEventChoice = 'no'; });
$('speed-button').addEventListener('click', cycleSpeed);
$('pause-button').addEventListener('click', togglePause);
$('shovel-button').addEventListener('click', toggleShovel);
document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.code === 'Space') { event.preventDefault(); togglePause(); return; }
  if (event.key.toLowerCase() === 'r') { cycleSpeed(); return; }
  if (event.key.toLowerCase() === 'e') { toggleShovel(); return; }
  if (event.key.toLowerCase() === 'q') { cancelNpcEvent(); return; }
  if (event.key === '1') deploy('soldier');
  if (event.key === '2') deploy('cavalry');
  if (event.key === '3') deploy('bishop');
  if (event.key === '4' || event.code === 'Numpad4' || event.code === 'Digit4') {
    event.preventDefault();
    deploy('rook');
  }
  if (event.key === '5' || event.code === 'Numpad5' || event.code === 'Digit5') {
    event.preventDefault();
    deploy('queen');
  }
  if (event.key === '6' || event.code === 'Numpad6' || event.code === 'Digit6') {
    event.preventDefault();
    deploy('king');
  }
});
state = makeState(); makeRoute(); state.lastIncome = performance.now(); updateUI(); showMessage('⚑', '準備開始', '派出士兵，守住你的旗子。', '開始遊戲');
setInterval(advance, 50); draw();
