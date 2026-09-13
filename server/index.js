import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

let MnemonicUtils, ExtendedPrivateKey, KeyPair, TransactionBuilder, TransactionFlag, Address;
try {
  const core = await import('@nimiq/core');
  MnemonicUtils = core.MnemonicUtils;
  ExtendedPrivateKey = core.ExtendedPrivateKey;
  KeyPair = core.KeyPair;
  TransactionBuilder = core.TransactionBuilder;
  TransactionFlag = core.TransactionFlag;
  Address = core.Address;
  console.log('[CORE] @nimiq/core loaded');
} catch (e) {
  console.error('[CORE] Failed to load @nimiq/core:', e.message);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSIONS_FILE = path.join(__dirname, '.auth-sessions.json');

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
      for (const [token, session] of Object.entries(data)) {
        authSessions.set(token, session);
      }
      console.log(`[AUTH] Restored ${authSessions.size} sessions from disk`);
    }
  } catch (e) {
    console.error('[AUTH] Failed to load sessions:', e.message);
  }
}

function saveSessions() {
  try {
    const obj = Object.fromEntries(authSessions);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('[AUTH] Failed to save sessions:', e.message);
  }
}

import { MatchStateMachine, MATCH_STATES, TRANSITION_REASONS } from './match-state-machine.js';
import { SettlementService } from './settlement-service.js';
import { ValidationService, VALIDATION_ERRORS } from './validation.js';
import { SecurityMiddleware, SUSPICIOUS_TYPES } from './security.js';
import { MatchReplayLogger } from './match-replay.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
app.use(express.static(path.join(__dirname, '..')));

const TABLE_W = 900, TABLE_H = 450, RAIL_W = 30, BALL_R = 10, POCKET_R = 22;
const FRICTION = 0.985, MIN_VEL = 0.15, SUBSTEPS = 4;
const MATCH_TIMEOUT_MS = 5 * 60 * 1000, DISCONNECT_GRACE_MS = 30 * 1000, TURN_TIME_LIMIT = 60 * 1000;

const POCKETS = [
  { x: RAIL_W - 4, y: RAIL_W - 4 }, { x: TABLE_W / 2, y: RAIL_W - 6 },
  { x: TABLE_W - RAIL_W + 4, y: RAIL_W - 4 }, { x: RAIL_W - 4, y: TABLE_H - RAIL_W + 4 },
  { x: TABLE_W / 2, y: TABLE_H - RAIL_W + 6 }, { x: TABLE_W - RAIL_W + 4, y: TABLE_H - RAIL_W + 4 },
];

const RACK_ORDER = [1, 9, 2, 10, 8, 11, 3, 13, 6, 14, 12, 4, 7, 15, 5];
const AVATARS = ['A','B','C','D','E','F','G','H','J','K','L','M','N','P','R','S','T','W','X','Y','Z'];
const NAMES = ['Shark','CueMaster','PocketPro','BreakKing','SinkShot','RackBoss','AngleAce','SpinDr','PotLuck','FeltFox','8BallBandit','CueBallKid','TableTop','RailRunner','NoseShot'];

const MATCH_TIERS = [
  { id: 'bronze', name: 'Bronze', entryFee: 10000000, platformFeePercent: 5, minimumBalance: 10000000, description: '100 NIM entry, casual competitive', color: '#cd7f32', icon: '\u{1F7E4}' },
  { id: 'silver', name: 'Silver', entryFee: 50000000, platformFeePercent: 5, minimumBalance: 50000000, description: '500 NIM entry, serious matches', color: '#c0c0c0', icon: '\u{1FA99}' },
  { id: 'gold', name: 'Gold', entryFee: 100000000, platformFeePercent: 5, minimumBalance: 100000000, description: '1000 NIM entry, high stakes', color: '#ffd700', icon: '\u{1FA99}' },
  { id: 'diamond', name: 'Diamond', entryFee: 500000000, platformFeePercent: 3, minimumBalance: 500000000, description: '5000 NIM entry, elite competition', color: '#b9f2ff', icon: '\u{1F48E}' },
];

function getTierById(id) { return MATCH_TIERS.find(t => t.id === id); }
function calcPrize(tier) {
  const totalPot = tier.entryFee * 2;
  const platformFee = Math.round(totalPot * tier.platformFeePercent / 100);
  return { entryFee: tier.entryFee, totalPot, platformFee, winnerPrize: totalPot - platformFee };
}
function formatLamports(l) {
  const nim = l / 100000;
  if (nim >= 1000) return `${(nim / 1000).toFixed(1)}K NIM`;
  if (nim >= 100) return `${Math.round(nim)} NIM`;
  return `${nim.toFixed(2)} NIM`;
}

function genId() { return uuidv4().replace(/-/g, '').slice(0, 12); }
function randItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function createRack() {
  const startX = TABLE_W * 0.72, startY = TABLE_H / 2;
  const d = BALL_R * 2 + 1, h = d * Math.sin(Math.PI / 3);
  const balls = []; let idx = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      const num = RACK_ORDER[idx++];
      balls.push({ id: num, x: startX + row * h, y: startY + (col - row / 2) * d, vx: 0, vy: 0, pocketed: false });
    }
  }
  balls.unshift({ id: 0, x: TABLE_W * 0.25, y: TABLE_H / 2, vx: 0, vy: 0, pocketed: false });
  return balls;
}

class ServerPhysics {
  step(balls) {
    for (let s = 0; s < SUBSTEPS; s++) {
      this._move(balls); this._ballCollisions(balls); this._wallCollisions(balls); this._checkPockets(balls);
    }
    this._friction(balls);
  }
  _move(balls) { for (const b of balls) { if (!b.pocketed) { b.x += b.vx / SUBSTEPS; b.y += b.vy / SUBSTEPS; } } }
  _friction(balls) { for (const b of balls) { if (!b.pocketed) { b.vx *= FRICTION; b.vy *= FRICTION; if (Math.abs(b.vx) < MIN_VEL && Math.abs(b.vy) < MIN_VEL) { b.vx = 0; b.vy = 0; } } } }
  _ballCollisions(balls) {
    const active = balls.filter(b => !b.pocketed);
    for (let i = 0; i < active.length; i++) { for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j]; const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy); const minD = BALL_R * 2;
      if (dist < minD && dist > 0) { const nx = dx / dist, ny = dy / dist; const dvx = a.vx - b.vx, dvy = a.vy - b.vy; const dot = dvx * nx + dvy * ny;
        if (dot > 0) { a.vx -= dot * nx; a.vy -= dot * ny; b.vx += dot * nx; b.vy += dot * ny; }
        const overlap = minD - dist; a.x -= (overlap / 2) * nx; a.y -= (overlap / 2) * ny; b.x += (overlap / 2) * nx; b.y += (overlap / 2) * ny; }
    } } }
  _wallCollisions(balls) {
    const minX = RAIL_W + BALL_R, maxX = TABLE_W - RAIL_W - BALL_R, minY = RAIL_W + BALL_R, maxY = TABLE_H - RAIL_W - BALL_R;
    for (const b of balls) { if (!b.pocketed) {
      if (b.x < minX) { b.x = minX; b.vx = Math.abs(b.vx) * 0.85; } if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx) * 0.85; }
      if (b.y < minY) { b.y = minY; b.vy = Math.abs(b.vy) * 0.85; } if (b.y > maxY) { b.y = maxY; b.vy = -Math.abs(b.vy) * 0.85; }
    } } }
  _checkPockets(balls) {
    for (const b of balls) { if (!b.pocketed) { for (const p of POCKETS) {
      const dx = b.x - p.x, dy = b.y - p.y; if (Math.sqrt(dx * dx + dy * dy) < POCKET_R + BALL_R * 0.3) { b.pocketed = true; b.vx = 0; b.vy = 0; break; }
    } } } }
  allStopped(balls) { return balls.every(b => b.pocketed || (Math.abs(b.vx) < MIN_VEL && Math.abs(b.vy) < MIN_VEL)); }
}

class ServerRules {
  constructor() { this.reset(); }
  reset() { this.turn = 1; this.player1Type = 'unassigned'; this.player2Type = 'unassigned'; this.state = 'aiming'; this.foul = false; this.foulReason = ''; this.winner = null; this.winReason = ''; this.pocketedThisTurn = []; this.turnStartPocketed = []; this.firstPocketedThisTurn = null; }
  startBreak() { this.state = 'aiming'; this.turn = 1; }
  onShotStart(balls) { this.foul = false; this.foulReason = ''; this.pocketedThisTurn = []; this.firstPocketedThisTurn = null; this.turnStartPocketed = balls.filter(b => b.pocketed).map(b => b.id); this.state = 'shooting'; }
  onBallPocketed(ball) { if (ball.id === 0) return; this.pocketedThisTurn.push(ball.id); if (!this.firstPocketedThisTurn) this.firstPocketedThisTurn = ball.id; }
  onShotEnd(balls) {
    const cueBall = balls.find(b => b.id === 0), eightBall = balls.find(b => b.id === 8);
    const cuePocketed = cueBall && cueBall.pocketed, eightPocketed = eightBall && eightBall.pocketed;
    if (cuePocketed) { this.foul = true; this.foulReason = 'Cue ball scratched!'; }
    if (this.turn === 1 && this.player1Type === 'unassigned' && !eightPocketed) {
      const solids = this.pocketedThisTurn.filter(id => id >= 1 && id <= 7), stripes = this.pocketedThisTurn.filter(id => id >= 9 && id <= 15);
      if (solids.length > 0 && !this.foul) { this.player1Type = 'solids'; this.player2Type = 'stripes'; }
      else if (stripes.length > 0 && !this.foul) { this.player1Type = 'stripes'; this.player2Type = 'solids'; }
    }
    if (eightPocketed) {
      const curType = this.turn === 1 ? this.player1Type : this.player2Type;
      const allOwn = this._allOwnPocketed(balls, curType);
      if (this.foul || !allOwn) { this.winner = this.turn === 1 ? 2 : 1; this.winReason = this.foul ? '8-ball on foul' : '8-ball early'; this.state = 'game_over'; return this.winner; }
      else { this.winner = this.turn; this.winReason = 'Legal 8-ball!'; this.state = 'game_over'; return this.winner; }
    }
    if (this.foul) { this.state = 'ball_in_hand'; return null; }
    const curType = this.turn === 1 ? this.player1Type : this.player2Type;
    if (this._pocketedOwnBalls(curType).length > 0) { this.state = 'aiming'; return null; }
    this.turn = this.turn === 1 ? 2 : 1; this.state = 'aiming'; return null;
  }
  _allOwnPocketed(balls, type) { if (type === 'unassigned') return false; const [lo, hi] = type === 'solids' ? [1, 7] : [9, 15]; return balls.filter(b => b.id >= lo && b.id <= hi).every(b => b.pocketed); }
  _pocketedOwnBalls(type) { if (type === 'unassigned') return []; const [lo, hi] = type === 'solids' ? [1, 7] : [9, 15]; return this.pocketedThisTurn.filter(id => id >= lo && id <= hi); }
  getPublicState() { return { turn: this.turn, state: this.state, player1Type: this.player1Type, player2Type: this.player2Type, foul: this.foul, foulReason: this.foulReason, winner: this.winner, winReason: this.winReason }; }
}

const matchmakingQueue = { free: [], competitive: new Map() };
const activeMatches = new Map();
const connectedPlayers = new Map();
const playerStats = new Map();
const playerBalances = new Map();
const BALANCES_FILE = path.join(__dirname, '.player-balances.json');
const STATS_FILE = path.join(__dirname, '.player-stats.json');

function loadBalances() {
  try {
    if (fs.existsSync(BALANCES_FILE)) {
      const data = JSON.parse(fs.readFileSync(BALANCES_FILE, 'utf-8'));
      for (const [addr, bal] of Object.entries(data)) playerBalances.set(addr, bal);
      console.log(`[BAL] Restored ${playerBalances.size} balances`);
    }
  } catch (e) {}
}

function saveBalances() {
  try { fs.writeFileSync(BALANCES_FILE, JSON.stringify(Object.fromEntries(playerBalances), null, 2)); } catch (e) {}
}

function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
      for (const [pid, stats] of Object.entries(data)) playerStats.set(pid, stats);
      console.log(`[STATS] Restored ${playerStats.size} player stats`);
    }
  } catch (e) {}
}

function saveStats() {
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(Object.fromEntries(playerStats), null, 2)); } catch (e) {}
}

function getStats(pid) {
  if (!playerStats.has(pid)) playerStats.set(pid, { wins: 0, losses: 0, gamesPlayed: 0, streak: 0, totalWinnings: 0, totalLosses: 0, xp: 0, level: 1 });
  return playerStats.get(pid);
}

function playerKey(player) { return player.nimAddress || player.id; }

function getBalance(pid) {
  if (!playerBalances.has(pid)) playerBalances.set(pid, 0);
  return playerBalances.get(pid);
}

function setBalance(pid, bal) { playerBalances.set(pid, bal); saveBalances(); }

class Player {
  constructor(ws, id) {
    this.ws = ws; this.id = id;
    this.name = randItem(NAMES) + '_' + id.slice(0, 4);
    this.avatar = randItem(AVATARS);
    this.inQueue = false; this.currentMatch = null;
    this.nimAddress = null; this.connected = true; this.disconnectedAt = 0;
    this.competitiveTier = null;
    this.nonce = null;
  }
  send(type, data = {}) { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type, ...data })); }
}

class GameMatch {
  constructor(id, p1, p2, matchType, tierId = null, stateMachine = null) {
    this.id = id; this.player1 = p1; this.player2 = p2;
    this.matchType = matchType; this.tierId = tierId;
    this.stateMachine = stateMachine;
    this.balls = createRack(); this.rules = new ServerRules(); this.physics = new ServerPhysics();
    this.turnTimer = null; this.matchTimer = null;
    this.createdAt = Date.now(); this.lastActive = Date.now();
    this.rematchVotes = new Set(); this.turnTimeoutId = null;
    this.physicsInterval = null; this.shotInProgress = false;
    this.rules.startBreak(); this._startMatchTimer(); this._startPhysicsLoop();

    this.replay = new MatchReplayLogger(id, { matchType, tierId, p1: p1.id, p2: p2.id });
    this.replay.logMatchCreated(p1.id, p2.id, tierId ? getTierById(tierId) : null);
  }
  getPlayerNumber(p) { return p.id === this.player1.id ? 1 : 2; }
  getCurrentPlayer() { return this.rules.turn === 1 ? this.player1 : this.player2; }
  getOpponent(p) { return p.id === this.player1.id ? this.player2 : this.player1; }
  _startMatchTimer() {
    this.matchTimer = setTimeout(() => { if (this.stateMachine && this.stateMachine.state === MATCH_STATES.MATCH_STARTED) {
      const p1a = this.player1.connected, p2a = this.player2.connected;
      if (p1a && !p2a) endMatch(this, this.player1.id, 'Timeout - opponent inactive');
      else if (!p1a && p2a) endMatch(this, this.player2.id, 'Timeout - opponent inactive');
      else endMatch(this, this.player1.id, 'Match timeout');
    } }, MATCH_TIMEOUT_MS);
  }
  _startPhysicsLoop() {
    this.physicsInterval = setInterval(() => { if (this.stateMachine && this.stateMachine.state === MATCH_STATES.MATCH_STARTED && this.shotInProgress) {
      this.physics.step(this.balls);
      if (this.physics.allStopped(this.balls)) this._onShotPhysicsComplete();
    } }, 1000 / 60);
  }
  _onShotPhysicsComplete() {
    this.shotInProgress = false;
    const ballsBefore = this.balls.map(b => ({ ...b }));
    const rulesBefore = this.rules.getPublicState();

    const newly = this.balls.filter(b => b.pocketed && !this.rules.turnStartPocketed.includes(b.id));
    for (const ball of newly) this.rules.onBallPocketed(ball);
    const winner = this.rules.onShotEnd(this.balls);

    const rulesAfter = this.rules.getPublicState();
    this.replay.logShot(this.getCurrentPlayer().id, 0, 0, ballsBefore, this.balls, rulesBefore, rulesAfter);

    if (this.rules.foul) {
      this.replay.logFoul(this.getCurrentPlayer().id, this.rules.foulReason, rulesAfter);
    }

    if (winner !== null || this.rules.state === 'game_over') {
      const winnerId = (winner || this.rules.winner) === 1 ? this.player1.id : this.player2.id;
      endMatch(this, winnerId, this.rules.winReason || 'Game over');
      return;
    }

    this._broadcastToPlayers('serverStateUpdate', { balls: this._sanitizeBalls(), rules: this.rules.getPublicState(), message: this.rules.state === 'ball_in_hand' ? this.rules.foulReason : undefined });
    this._startTurnTimer();
  }
  _startTurnTimer() {
    if (this.turnTimeoutId) clearTimeout(this.turnTimeoutId);
    this.turnTimeoutId = setTimeout(() => { if (this.stateMachine && this.stateMachine.state === MATCH_STATES.MATCH_STARTED && !this.shotInProgress) {
      const current = this.getCurrentPlayer();
      this.replay.logTurnChange(current.id, this.getOpponent(current).id, 'timeout');
      this.rules.foul = true; this.rules.foulReason = 'Turn timeout!'; this.rules.turn = this.rules.turn === 1 ? 2 : 1; this.rules.state = 'ball_in_hand';
      this._broadcastToPlayers('serverStateUpdate', { balls: this._sanitizeBalls(), rules: this.rules.getPublicState(), message: 'Turn timeout! Ball in hand.' });
    } }, TURN_TIME_LIMIT);
  }
  validateShot(p, angle, power) {
    if (!this.stateMachine || this.stateMachine.state !== MATCH_STATES.MATCH_STARTED) return { valid: false, reason: 'Match not active' };
    if (this.shotInProgress) return { valid: false, reason: 'Shot in progress' };
    if (p.id !== this.getCurrentPlayer().id) return { valid: false, reason: 'Not your turn' };
    if (typeof angle !== 'number' || typeof power !== 'number' || isNaN(angle) || isNaN(power)) return { valid: false, reason: 'Invalid data' };
    if (power < 1 || power > 25) return { valid: false, reason: 'Power out of range' };
    const cb = this.balls.find(b => b.id === 0);
    if (!cb || cb.pocketed) { if (this.rules.state === 'ball_in_hand') return { valid: true, needsPlacement: true }; return { valid: false, reason: 'No cue ball' }; }
    return { valid: true };
  }
  executeShot(p, angle, power) {
    const v = this.validateShot(p, angle, power); if (!v.valid) return v; if (v.needsPlacement) return v;
    if (this.turnTimeoutId) clearTimeout(this.turnTimeoutId); this.lastActive = Date.now();
    const cb = this.balls.find(b => b.id === 0);
    this.rules.onShotStart(this.balls);
    cb.vx = Math.cos(angle) * power; cb.vy = Math.sin(angle) * power;
    this.shotInProgress = true;
    this._broadcastToPlayers('shotExecuted', { angle, power, playerId: p.id, balls: this._sanitizeBalls(), rules: this.rules.getPublicState() });
    return { valid: true };
  }
  placeCueBall(p, x, y) {
    if (!this.stateMachine || this.stateMachine.state !== MATCH_STATES.MATCH_STARTED) return { valid: false, reason: 'Match not active' };
    if (this.rules.state !== 'ball_in_hand') return { valid: false, reason: 'Not ball in hand' };
    if (p.id !== this.getCurrentPlayer().id) return { valid: false, reason: 'Not your turn' };
    const cb = this.balls.find(b => b.id === 0); if (!cb) return { valid: false, reason: 'No cue ball' };
    cb.x = clamp(x, RAIL_W + BALL_R + 2, TABLE_W - RAIL_W - BALL_R - 2);
    cb.y = clamp(y, RAIL_W + BALL_R + 2, TABLE_H - RAIL_W - BALL_R - 2);
    cb.pocketed = false; cb.vx = 0; cb.vy = 0; this.rules.state = 'aiming';
    this.replay.logCueBallPlacement(p.id, cb.x, cb.y, this.balls);
    this._broadcastToPlayers('cueBallPlaced', { x: cb.x, y: cb.y, playerId: p.id, balls: this._sanitizeBalls(), rules: this.rules.getPublicState() });
    this._startTurnTimer(); return { valid: true };
  }
  requestRematch(p) {
    this.rematchVotes.add(p.id); this.getOpponent(p).send('rematchRequest', { matchId: this.id, from: p.name });
    if (this.rematchVotes.size === 2) this._startRematch();
  }
  _startRematch() {
    this.balls = createRack(); this.rules.reset(); this.rules.startBreak();
    this.rematchVotes.clear(); this.shotInProgress = false; this.lastActive = Date.now();
    if (this.matchTimer) clearTimeout(this.matchTimer); this._startMatchTimer();
    this._broadcastToPlayers('rematchStarted', { balls: this._sanitizeBalls(), rules: this.rules.getPublicState(), message: 'Rematch!' });
    this._startTurnTimer();
  }
  _sanitizeBalls() { return this.balls.map(b => ({ id: b.id, x: Math.round(b.x * 100) / 100, y: Math.round(b.y * 100) / 100, vx: 0, vy: 0, pocketed: b.pocketed })); }
  _broadcastToPlayers(type, data) { this.player1.send(type, data); this.player2.send(type, data); }
  destroy() { if (this.matchTimer) clearTimeout(this.matchTimer); if (this.turnTimeoutId) clearTimeout(this.turnTimeoutId); if (this.physicsInterval) clearInterval(this.physicsInterval); }
}

const security = new SecurityMiddleware();
const validation = new ValidationService();

const authNonces = new Map();
const authSessions = new Map();
let PLATFORM_WALLET = process.env.PLATFORM_WALLET || 'NQ27 9CG2 XP33 N5NH 29EP 2YUS LMKV 3EM0 R4DJ';
const PLATFORM_SEED = process.env.PLATFORM_SEED || '';

let platformKeyPair = null;
let platformAddress = null;
const NIMIQ_RPC = process.env.NIMIQ_RPC || 'https://rpc.nimiqwatch.com/';
const NIMIQ_NETWORK_ID = 24;

function initPlatformWallet() {
  if (!PLATFORM_SEED) {
    console.log('[WALLET] No PLATFORM_SEED set — auto-withdraw disabled (ledger only)');
    return;
  }
  try {
    const words = PLATFORM_SEED.trim().split(/\s+/);
    if (words.length !== 24) {
      console.error(`[WALLET] PLATFORM_SEED must be 24 words (got ${words.length})`);
      return;
    }
    const extKey = MnemonicUtils.mnemonicToExtendedPrivateKey(words);
    const derived = extKey.derivePath("m/44'/2747'/0'/0'");
    platformKeyPair = KeyPair.derive(derived.privateKey);
    platformAddress = derived.toAddress();
    const derivedAddr = platformAddress.toUserFriendlyAddress();
    console.log(`[WALLET] Platform wallet: ${derivedAddr}`);

    if (!process.env.PLATFORM_WALLET) {
      PLATFORM_WALLET = derivedAddr;
      console.log(`[WALLET] Auto-set PLATFORM_WALLET to derived address`);
    }

    console.log(`[WALLET] Auto-withdraw ENABLED via ${NIMIQ_RPC}`);
  } catch (e) {
    console.error('[WALLET] Failed to init platform wallet:', e.message);
  }
}

async function rpcCall(method, params = [], id = 1) {
  const resp = await fetch(NIMIQ_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
  });
  return (await resp.json()).result;
}

async function sendNim(recipientAddr, amountLamports) {
  if (!platformKeyPair) throw new Error('Platform wallet not configured');

  const recipient = Address.fromUserFriendlyAddress(recipientAddr);

  const acctResult = await rpcCall('getAccountByAddress', [platformAddress.toUserFriendlyAddress()]);
  const nonce = acctResult?.data?.nonce || 0;

  const blockResult = await rpcCall('getBlockNumber', []);
  const height = blockResult?.data || 1;

  const tx = TransactionBuilder.newBasic(
    platformAddress,
    recipient,
    BigInt(amountLamports),
    0n,
    height,
    NIMIQ_NETWORK_ID,
  );
  tx.sign(platformKeyPair);

  const rawHex = tx.toHex();
  const sendResult = await rpcCall('sendRawTransaction', [rawHex]);

  if (sendResult?.error) throw new Error(sendResult.error.message || 'Broadcast failed');
  return sendResult?.data || 'broadcast-ok';
}

function generateAuthToken() {
  return genId() + genId() + genId();
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No auth token' });
  const token = auth.slice(7);
  const session = authSessions.get(token);
  if (!session) return res.status(401).json({ error: 'Invalid token' });
  req.wallet = session.wallet;
  next();
}

function removeFromQueue(player) {
  for (const type of ['free']) { const idx = matchmakingQueue[type].indexOf(player); if (idx > -1) { matchmakingQueue[type].splice(idx, 1); player.inQueue = false; } }
  for (const [tierId, queue] of matchmakingQueue.competitive) { const idx = queue.indexOf(player); if (idx > -1) { queue.splice(idx, 1); player.inQueue = false; } }
}

function findMatchFree(player) {
  const rateCheck = security.checkRateLimit(player.id, 'matchCreation');
  if (!rateCheck.allowed) { player.send('error', { message: 'Rate limit exceeded. Please wait.' }); return null; }

  const queue = matchmakingQueue.free;
  const eligible = queue.filter(p => p.id !== player.id && !p.currentMatch);
  if (eligible.length > 0) {
    const opp = eligible.shift(); const matchId = genId();
    const stateMachine = new MatchStateMachine(matchId, { matchType: 'free' });
    stateMachine.player1 = opp.id; stateMachine.player2 = player.id;
    stateMachine.state = MATCH_STATES.MATCH_STARTED;

    const match = new GameMatch(matchId, opp, player, 'free', null, stateMachine);
    activeMatches.set(matchId, match); opp.currentMatch = match; player.currentMatch = match;
    opp.inQueue = false; player.inQueue = false;
    const idx = queue.indexOf(opp); if (idx > -1) queue.splice(idx, 1);

    console.log(`[MATCH] Free ${matchId}: ${opp.name} vs ${player.name}`);

    if (opp.nimAddress) { const oppProfile = getProfile(opp.nimAddress); if (oppProfile.name && oppProfile.name !== 'Guest') opp.name = oppProfile.name; if (oppProfile.avatar) opp.avatar = oppProfile.avatar; }
    if (player.nimAddress) { const plProfile = getProfile(player.nimAddress); if (plProfile.name && plProfile.name !== 'Guest') player.name = plProfile.name; if (plProfile.avatar) player.avatar = plProfile.avatar; }

    const p1s = getStats(playerKey(opp)), p2s = getStats(playerKey(player));
    opp.send('matchFound', { matchId, opponentName: player.name, opponentAvatar: player.avatar, opponentStats: p2s, playerNumber: 1, balls: match._sanitizeBalls(), rules: match.rules.getPublicState(), matchType: 'free' });
    player.send('matchFound', { matchId, opponentName: opp.name, opponentAvatar: opp.avatar, opponentStats: p1s, playerNumber: 2, balls: match._sanitizeBalls(), rules: match.rules.getPublicState(), matchType: 'free' });
    match._startTurnTimer(); return match;
  }
  if (!player.inQueue) { queue.push(player); player.inQueue = true; player.send('queueUpdate', { position: queue.length }); }
  return null;
}

function findMatchCompetitive(player, tierId) {
  const tier = getTierById(tierId);
  if (!tier) { player.send('error', { message: 'Invalid tier' }); return null; }

  const rateCheck = security.checkRateLimit(player.id, 'matchCreation');
  if (!rateCheck.allowed) { player.send('error', { message: 'Rate limit exceeded. Please wait.' }); return null; }

  const walletAddr = player.nimAddress;
  const bal = walletAddr ? getBalance(walletAddr) : 0;
  if (bal < tier.entryFee) {
    const need = formatLamports(tier.entryFee - bal);
    player.send('error', { message: `Insufficient balance. You need ${formatLamports(tier.entryFee)} to enter ${tier.name}. Top up ${need} more.`, code: 'INSUFFICIENT_BALANCE', need: tier.entryFee, have: bal });
    return null;
  }

  if (!matchmakingQueue.competitive.has(tierId)) matchmakingQueue.competitive.set(tierId, []);
  const queue = matchmakingQueue.competitive.get(tierId);

    // Deduct entry fee immediately when joining queue
    if (!player.inQueue) {
      if (walletAddr) {
        setBalance(walletAddr, bal - tier.entryFee);
        player.send('balanceUpdate', { balance: getBalance(walletAddr), deducted: tier.entryFee, reason: 'entry_fee' });
      }
    }

  const eligible = queue.filter(p => p.id !== player.id && !p.currentMatch);
  if (eligible.length > 0) {
    const opp = eligible.shift();
    // Clear opponent queue timeout
    if (opp._queueTimeout) { clearTimeout(opp._queueTimeout); opp._queueTimeout = null; }

    const matchId = genId();
    const stateMachine = new MatchStateMachine(matchId, { matchType: 'competitive', tierId, tier });
    stateMachine.player1 = opp.id; stateMachine.player2 = player.id;

    stateMachine.escrow.totalPot = tier.entryFee * 2;
    stateMachine.escrow.platformFee = Math.round(stateMachine.escrow.totalPot * tier.platformFeePercent / 100);
    stateMachine.escrow.winnerPrize = stateMachine.escrow.totalPot - stateMachine.escrow.platformFee;
    stateMachine.escrow.status = 'locked';
    stateMachine.state = MATCH_STATES.MATCH_STARTED;

    const match = new GameMatch(matchId, opp, player, 'competitive', tierId, stateMachine);
    activeMatches.set(matchId, match); opp.currentMatch = match; player.currentMatch = match;
    opp.inQueue = false; player.inQueue = false;
    const idx = queue.indexOf(opp); if (idx > -1) queue.splice(idx, 1);

    console.log(`[MATCH] Competitive ${tierId} ${matchId}: ${opp.name} vs ${player.name}`);
    if (opp.nimAddress) { const oppProfile = getProfile(opp.nimAddress); if (oppProfile.name && oppProfile.name !== 'Guest') opp.name = oppProfile.name; if (oppProfile.avatar) opp.avatar = oppProfile.avatar; }
    if (player.nimAddress) { const plProfile = getProfile(player.nimAddress); if (plProfile.name && plProfile.name !== 'Guest') player.name = plProfile.name; if (plProfile.avatar) player.avatar = plProfile.avatar; }
    const prize = calcPrize(tier);
    const p1s = getStats(playerKey(opp)), p2s = getStats(playerKey(player));
    const oppBal = opp.nimAddress ? getBalance(opp.nimAddress) : 0;
    const playerBal = player.nimAddress ? getBalance(player.nimAddress) : 0;
    opp.send('matchFound', { matchId, opponentName: player.name, opponentAvatar: player.avatar, opponentStats: p2s, playerNumber: 1, balls: match._sanitizeBalls(), rules: match.rules.getPublicState(), matchType: 'competitive', tier: { ...stateMachine.getPublicData().escrow, prize }, balance: oppBal });
    player.send('matchFound', { matchId, opponentName: opp.name, opponentAvatar: opp.avatar, opponentStats: p1s, playerNumber: 2, balls: match._sanitizeBalls(), rules: match.rules.getPublicState(), matchType: 'competitive', tier: { ...stateMachine.getPublicData().escrow, prize }, balance: playerBal });
    match._startTurnTimer(); return match;
  }
  if (!player.inQueue) { queue.push(player); player.inQueue = true; player.competitiveTier = tierId; player.send('queueUpdate', { position: queue.length, tier: tierId }); }
  return null;
}

function endMatch(match, winnerId, reason) {
  if (!match.stateMachine || match.stateMachine.state === MATCH_STATES.COMPLETED || match.stateMachine.state === MATCH_STATES.CANCELLED) return;
  match.destroy();

  const winner = match.player1.id === winnerId ? match.player1 : match.player2;
  const loser = match.player1.id === winnerId ? match.player2 : match.player1;
  const wStats = getStats(playerKey(winner)), lStats = getStats(playerKey(loser));
  wStats.wins++; wStats.gamesPlayed++; wStats.streak++;
  lStats.losses++; lStats.gamesPlayed++; lStats.streak = 0;

  wStats.xp = (wStats.xp || 0) + 100;
  lStats.xp = (lStats.xp || 0) + 30;
  wStats.level = Math.floor((wStats.xp || 0) / 800) + 1;
  lStats.level = Math.floor((lStats.xp || 0) / 800) + 1;

  if (match.replay) match.replay.logMatchEnd(winnerId, loser.id, reason);

  let prizeData = null;
  if (match.stateMachine.escrow && match.stateMachine.escrow.status === 'locked') {
    match.stateMachine.finishMatch(winnerId, loser.id, reason);

    const settlement = match.stateMachine.escrow;
    const winnerPrize = settlement.winnerPrize;
    const platformFee = settlement.platformFee;

    const winnerWallet = winner.nimAddress;
    const loserWallet = loser.nimAddress;

    if (winnerWallet) {
      setBalance(winnerWallet, getBalance(winnerWallet) + winnerPrize);
      winner.send('balanceUpdate', { balance: getBalance(winnerWallet), added: winnerPrize, reason: 'prize_won' });
    }
    wStats.totalWinnings += winnerPrize;
    lStats.totalLosses += settlement.totalPot / 2;

    prizeData = { entryFee: winnerPrize + platformFee, winnerPrize, platformFee, winnerPrizeFormatted: formatLamports(winnerPrize), balance: winnerWallet ? getBalance(winnerWallet) : 0 };
    console.log(`[ESCROW] ${match.id} settled: ${winner.name} wins ${formatLamports(winnerPrize)}, platform fee ${formatLamports(platformFee)}`);

    match.stateMachine.complete();
  } else {
    match.stateMachine.finishMatch(winnerId, loser.id, reason);
    match.stateMachine.complete();
  }

  winner.send('matchResult', { matchId: match.id, won: true, reason, winnerStats: wStats, loserStats: lStats, prize: prizeData });
  loser.send('matchResult', { matchId: match.id, won: false, reason, winnerStats: wStats, loserStats: lStats, prize: prizeData ? { ...prizeData, balance: loser.nimAddress ? getBalance(loser.nimAddress) : 0 } : null });
  if (loser.nimAddress) loser.send('balanceUpdate', { balance: getBalance(loser.nimAddress) });
  winner.currentMatch = null; loser.currentMatch = null;
  activeMatches.delete(match.id);
  saveStats();
  saveBalances();
  console.log(`[MATCH] ${match.id} ended: ${winner.name} wins (${reason})`);
}

wss.on('connection', (ws) => {
  const playerId = genId(); const player = new Player(ws, playerId);
  connectedPlayers.set(playerId, player);
  player.nonce = security.generateNonce(playerId);
  player.send('welcome', { playerId, playerName: player.name, avatar: player.avatar, stats: { wins: 0, losses: 0, gamesPlayed: 0, xp: 0, level: 1 }, balance: 0, nonce: player.nonce });
  console.log(`[CONN] ${player.name} connected (${connectedPlayers.size} online)`);
  ws.on('message', (data) => { try { handleMessage(player, JSON.parse(data.toString())); } catch (e) { console.error(`[MSG] Parse error:`, e.message); } });
  ws.on('close', () => {
    player.connected = false; player.disconnectedAt = Date.now();

    // Refund if in competitive queue
    if (player.inQueue && player.competitiveTier && !player.currentMatch) {
      const tier = getTierById(player.competitiveTier);
      if (tier && player.nimAddress) {
        setBalance(player.nimAddress, getBalance(player.nimAddress) + tier.entryFee);
        console.log(`[QUEUE] ${player.name} disconnected from queue, refunded ${formatLamports(tier.entryFee)}`);
      }
    }
    if (player._queueTimeout) { clearTimeout(player._queueTimeout); player._queueTimeout = null; }

    removeFromQueue(player);
    if (player.currentMatch) {
      const match = player.currentMatch; const opp = match.getOpponent(player);
      if (match.replay) match.replay.logDisconnect(player.id, DISCONNECT_GRACE_MS);
      opp.send('opponentDisconnected', { matchId: match.id, gracePeriodMs: DISCONNECT_GRACE_MS });
      setTimeout(() => { if (!player.connected && player.currentMatch) {
        endMatch(match, opp.id, 'Opponent disconnected');
      } }, DISCONNECT_GRACE_MS);
    }
    connectedPlayers.delete(playerId); console.log(`[CONN] ${player.name} disconnected`);
  });
});

function handleMessage(player, msg) {
  const timingCheck = security.checkTiming(player.id, msg.type);
  if (!timingCheck.allowed) {
    security.auditAction(player.id, 'timing_rejected', { type: msg.type, gapMs: timingCheck.gapMs });
    return;
  }

  security.auditAction(player.id, msg.type, { ts: Date.now() });

  switch (msg.type) {
    case 'reconnect': {
      const rateCheck = security.checkRateLimit(player.id, 'reconnect', 10);
      if (!rateCheck.allowed) { player.send('error', { message: 'Rate limit exceeded' }); return; }

      const match = activeMatches.get(msg.matchId);
      if (!match) { player.send('error', { message: 'Match not found' }); return; }
      if (player.id !== match.player1.id && player.id !== match.player2.id) { player.send('error', { message: 'Not your match' }); return; }
      player.connected = true; player.currentMatch = match;
      if (match.replay) match.replay.logReconnect(player.id);
      const opp = match.getOpponent(player);
      player.send('reconnected', { matchId: match.id, balls: match._sanitizeBalls(), rules: match.rules.getPublicState(), playerNumber: match.getPlayerNumber(player), opponentName: opp.name, opponentAvatar: opp.avatar, opponentStats: getStats(playerKey(opp)), matchType: match.matchType, tier: match.stateMachine ? match.stateMachine.getPublicData().escrow : null, balance: getBalance(playerKey(player)) });
      opp.send('opponentReconnected', { matchId: match.id });
      break;
    }
    case 'setName': {
      if (msg.name && typeof msg.name === 'string') {
        const cleanName = msg.name.slice(0, 20).replace(/[<>"'&]/g, '');
        player.name = cleanName;
        if (player.nimAddress) {
          const profile = getProfile(player.nimAddress);
          profile.name = cleanName;
          playerProfiles.set(player.nimAddress, profile);
          saveProfileToDisk();
        }
      }
      break;
    }
    case 'joinQueue': {
      if (msg.matchType === 'competitive') findMatchCompetitive(player, msg.tierId || 'silver');
      else findMatchFree(player);
      break;
    }
    case 'leaveQueue': {
      // Refund if leaving competitive queue
      if (player.inQueue && player.competitiveTier && !player.currentMatch) {
        const tier = getTierById(player.competitiveTier);
        if (tier && player.nimAddress) {
          setBalance(player.nimAddress, getBalance(player.nimAddress) + tier.entryFee);
          player.send('balanceUpdate', { balance: getBalance(player.nimAddress), refunded: tier.entryFee, reason: 'left_queue' });
        }
      }
      if (player._queueTimeout) { clearTimeout(player._queueTimeout); player._queueTimeout = null; }
      removeFromQueue(player);
      player.send('queueUpdate', { position: 0 });
      break;
    }
    case 'leaveMatch': {
      if (player.currentMatch) {
        const match = player.currentMatch;
        const opp = match.getOpponent(player);
        endMatch(match, opp.id, 'Opponent left the match');
      }
      break;
    }
    case 'shoot': {
      if (!player.currentMatch) return;
      const rateCheck = security.checkRateLimit(player.id, 'shot');
      if (!rateCheck.allowed) { player.send('shotRejected', { reason: 'Rate limit exceeded' }); return; }

      const result = player.currentMatch.executeShot(player, msg.angle, msg.power);
      if (!result.valid) player.send('shotRejected', { reason: result.reason });
      break;
    }
    case 'placeCueBall': { if (!player.currentMatch) return; const result = player.currentMatch.placeCueBall(player, msg.x, msg.y); if (!result.valid) player.send('error', { message: result.reason }); break; }
    case 'rematch': { if (!player.currentMatch) return; player.currentMatch.requestRematch(player); break; }
    case 'setNimAddress': {
      player.nimAddress = msg.address;
      const balance = getBalance(msg.address);
      player.send('balanceUpdate', { balance });
      break;
    }
    case 'authenticate': {
      const session = authSessions.get(msg.token);
      if (session) {
        player.nimAddress = session.wallet;
        const balance = getBalance(session.wallet);
        const profile = getProfile(session.wallet);
        console.log(`[AUTH] wallet=${session.wallet} profileName="${profile.name}" playerName="${player.name}"`);
        const isRandomName = NAMES.some(n => player.name.startsWith(n + '_'));
        if (profile.name && profile.name !== 'Guest' && profile.name !== 'Guest Player') {
          player.name = profile.name;
          if (profile.avatar) player.avatar = profile.avatar;
        } else if (isRandomName) {
          // Server has no custom name yet — keep the random name for now, let client decide
        } else {
          profile.name = player.name;
          playerProfiles.set(session.wallet, profile);
          saveProfileToDisk();
        }
        const stats = getStats(session.wallet);
        const winRate = stats.gamesPlayed > 0 ? Math.round((stats.wins / stats.gamesPlayed) * 1000) / 10 : 0;
        player.send('balanceUpdate', { balance });
        player.send('profileUpdate', { name: player.name, avatar: player.avatar, stats: { ...stats, winRate }, balance });
      } else {
        console.log(`[AUTH] FAILED: token not found`);
      }
      break;
    }
    default: break;
  }
}

// ============================================
// Auth & Balance API
// ============================================

app.post('/api/auth/nonce', (req, res) => {
  const nonce = genId() + '-' + Date.now().toString(36);
  authNonces.set(nonce, { createdAt: Date.now() });
  res.json({ nonce });
});

app.post('/api/auth/login', (req, res) => {
  const { wallet, message, signature } = req.body;
  if (!wallet || !message || !signature) return res.status(400).json({ error: 'Missing fields' });

  let matchedNonce = null;
  for (const [nonce, data] of authNonces) {
    if (message.includes(nonce)) {
      matchedNonce = nonce;
      break;
    }
  }
  if (!matchedNonce) return res.status(401).json({ error: 'Invalid or expired nonce' });
  authNonces.delete(matchedNonce);

  const token = generateAuthToken();
  authSessions.set(token, { wallet, createdAt: Date.now() });
  saveSessions();

  const balance = getBalance(wallet);
  res.json({ token, wallet, balance, profile: getProfile(wallet) });
});

// Profile storage per wallet
const playerProfiles = new Map();
const PROFILES_FILE = path.join(__dirname, '.player-profiles.json');

function loadProfiles() {
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf-8'));
      for (const [addr, profile] of Object.entries(data)) playerProfiles.set(addr, profile);
      console.log(`[PROFILE] Restored ${playerProfiles.size} profiles`);
    }
  } catch (e) {}
}

function getProfile(wallet) {
  if (!playerProfiles.has(wallet)) playerProfiles.set(wallet, { name: 'Guest', avatar: 'man1' });
  return playerProfiles.get(wallet);
}

function saveProfileToDisk() {
  try { fs.writeFileSync(PROFILES_FILE, JSON.stringify(Object.fromEntries(playerProfiles), null, 2)); } catch (e) {}
}

app.get('/api/profile', authMiddleware, (req, res) => {
  const profile = getProfile(req.wallet);
  const stats = getStats(req.wallet);
  const balance = getBalance(req.wallet);
  const winRate = stats.gamesPlayed > 0 ? Math.round((stats.wins / stats.gamesPlayed) * 1000) / 10 : 0;
  console.log(`[PROFILE] GET: wallet=${req.wallet} name="${profile.name}"`);
  res.json({ ...profile, stats: { ...stats, winRate }, balance });
});

app.post('/api/profile', authMiddleware, (req, res) => {
  const { name, avatar } = req.body;
  const profile = getProfile(req.wallet);
  console.log(`[PROFILE] POST save: wallet=${req.wallet} name="${name}" avatar="${avatar}" currentName="${profile.name}"`);
  if (name && typeof name === 'string' && name.length >= 2 && name.length <= 20) {
    profile.name = name.replace(/[<>"'&]/g, '').slice(0, 20);
  }
  if (avatar && typeof avatar === 'string') {
    profile.avatar = avatar.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
  }
  playerProfiles.set(req.wallet, profile);
  saveProfileToDisk();
  console.log(`[PROFILE] POST saved: wallet=${req.wallet} name="${profile.name}"`);

  // Update connected player
  for (const [, player] of connectedPlayers) {
    if (player.nimAddress === req.wallet) {
      player.name = profile.name;
      player.avatar = profile.avatar;
    }
  }

  res.json(profile);
});

app.get('/api/balance', authMiddleware, (req, res) => {
  const balance = getBalance(req.wallet);
  res.json({ wallet: req.wallet, balance });
});

app.post('/api/topup', authMiddleware, (req, res) => {
  const { txHash, sender, recipient, value } = req.body;
  const norm = (a) => (a || '').replace(/\s/g, '').toUpperCase();
  const senderNorm = norm(sender);
  const walletNorm = norm(req.wallet);
  const recipientNorm = norm(recipient);
  const platformNorm = norm(PLATFORM_WALLET);
  console.log(`[TOPUP] sender="${sender}" wallet="${req.wallet}" match=${senderNorm === walletNorm} recipient="${recipient}" platform="${PLATFORM_WALLET}" match=${recipientNorm === platformNorm} value=${value}`);
  if (!txHash || !sender || !recipient || !value) return res.status(400).json({ error: 'Missing fields' });
  if (senderNorm !== walletNorm) {
    console.log(`[TOPUP] Sender mismatch: "${senderNorm}" !== "${walletNorm}"`);
    return res.status(400).json({ error: 'Sender mismatch' });
  }
  if (recipientNorm !== platformNorm) {
    console.log(`[TOPUP] Recipient mismatch: "${recipientNorm}" !== "${platformNorm}"`);
    return res.status(400).json({ error: 'Invalid recipient' });
  }

  const currentBalance = getBalance(req.wallet);
  const topUpAmount = value;
  setBalance(req.wallet, currentBalance + topUpAmount);

  console.log(`[TOPUP] ${req.wallet}: +${formatLamports(topUpAmount)} (tx: ${txHash})`);

  // Update the in-memory player balance for connected players
  for (const [, player] of connectedPlayers) {
    if (player.nimAddress === req.wallet) {
      player.send('balanceUpdate', { balance: getBalance(req.wallet) });
    }
  }

  res.json({ wallet: req.wallet, balance: getBalance(req.wallet), topUpAmount });
});

app.get('/api/platform-balance', (req, res) => {
  res.json({ wallet: PLATFORM_WALLET });
});

const withdrawRequests = [];

app.post('/api/withdraw', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  if (!amount || typeof amount !== 'number' || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const wallet = req.wallet;
  const currentBalance = getBalance(wallet);

  if (amount > currentBalance) return res.status(400).json({ error: 'Insufficient balance', balance: currentBalance });

  setBalance(wallet, currentBalance - amount);

  const request = {
    id: genId(),
    wallet,
    amount,
    status: 'pending',
    txHash: null,
    createdAt: Date.now(),
  };

  if (platformKeyPair) {
    try {
      const txHash = await sendNim(wallet, amount);
      request.status = 'approved';
      request.txHash = txHash;
      console.log(`[WITHDRAW] ${wallet}: -${formatLamports(amount)} (sent tx: ${txHash})`);
    } catch (e) {
      console.error(`[WITHDRAW] Blockchain send failed for ${wallet}:`, e.message);
      request.status = 'failed';
      request.error = e.message;
      setBalance(wallet, getBalance(wallet) + amount);
      return res.status(500).json({ error: 'Blockchain transaction failed: ' + e.message, balance: getBalance(wallet) });
    }
  } else {
    request.status = 'approved';
    request.txHash = `ledger-${Date.now()}-${genId().slice(0, 8)}`;
    console.log(`[WITHDRAW] ${wallet}: -${formatLamports(amount)} (ledger only, no PLATFORM_SEED)`);
  }

  withdrawRequests.push(request);

  for (const [, player] of connectedPlayers) {
    if (player.nimAddress === wallet) {
      player.send('balanceUpdate', { balance: getBalance(wallet), reason: 'withdraw', withdrawId: request.id });
    }
  }

  res.json({ wallet, balance: getBalance(wallet), withdrawId: request.id, txHash: request.txHash, amount, status: request.status });
});

app.get('/api/withdraw/:id', authMiddleware, (req, res) => {
  const w = withdrawRequests.find(r => r.id === req.params.id && r.wallet === req.wallet);
  if (!w) return res.status(404).json({ error: 'Request not found' });
  res.json(w);
});

app.post('/api/game-result', authMiddleware, (req, res) => {
  const { won, matchType } = req.body;
  const wallet = req.wallet;
  const stats = getStats(wallet);
  stats.gamesPlayed++;
  if (won) {
    stats.wins++;
    stats.xp = (stats.xp || 0) + 100;
    stats.streak++;
  } else {
    stats.losses++;
    stats.xp = (stats.xp || 0) + 30;
    stats.streak = 0;
  }
  stats.level = Math.floor((stats.xp || 0) / 800) + 1;
  saveStats();
  res.json({ ok: true, stats: { wins: stats.wins, losses: stats.losses, gamesPlayed: stats.gamesPlayed, xp: stats.xp, level: stats.level, winRate: stats.gamesPlayed > 0 ? Math.round((stats.wins / stats.gamesPlayed) * 1000) / 10 : 0 } });
});

app.get('/api/health', (req, res) => {
  const compQueues = {}; for (const [k, v] of matchmakingQueue.competitive) compQueues[k] = v.length;
  res.json({ status: 'ok', players: connectedPlayers.size, matches: activeMatches.size, queues: { free: matchmakingQueue.free.length, competitive: compQueues }, security: { suspicious: security.getAllSuspicious().length } });
});

app.get('/api/leaderboard', (req, res) => {
  const sort = req.query.sort || 'rating';
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const players = [];
  for (const [pid, stats] of playerStats) {
    if (stats.gamesPlayed > 0) {
      const total = stats.wins + stats.losses;
      players.push({ rank: 0, username: connectedPlayers.get(pid)?.name || stats.name || pid.slice(0, 8), avatar: connectedPlayers.get(pid)?.avatar || stats.avatar || 'U', rating: (stats.xp || 0), wins: stats.wins, losses: stats.losses, winRate: total > 0 ? Math.round((stats.wins / total) * 1000) / 10 : 0, level: stats.level || 1 });
    }
  }
  players.sort((a, b) => sort === 'wins' ? b.wins - a.wins : b.rating - a.rating);
  players.forEach((p, i) => p.rank = i + 1);
  res.json({ players: players.slice(0, limit), total: players.length, period: req.query.period || 'weekly', sort });
});

app.get('/api/tiers', (req, res) => {
  res.json(MATCH_TIERS.map(t => ({ ...t, prize: calcPrize(t), prizeFormatted: formatLamports(calcPrize(t).winnerPrize) })));
});

app.get('/api/match/:id/replay', (req, res) => {
  const match = activeMatches.get(req.params.id);
  if (!match || !match.replay) return res.status(404).json({ error: 'Match not found' });
  res.json(match.replay.getReplay());
});

// ============================================
// Admin API
// ============================================

const ADMIN_EMAIL = 'esileilavi88@gmail.com';
const ADMIN_PASS = 'Hamzad2464!';
const adminSessions = new Map();

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
    const token = 'adm_' + genId();
    adminSessions.set(token, { createdAt: Date.now() });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !adminSessions.has(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/admin/users', adminAuth, (req, res) => {
  const users = [];
  for (const [id, player] of connectedPlayers) {
    users.push({
      id,
      name: player.name,
      wallet: player.nimAddress || 'Not connected',
      stats: player.stats || { wins: 0, losses: 0, streak: 0, rating: 1000 },
      balance: player.nimAddress ? getBalance(player.nimAddress) : 0,
      connected: true,
    });
  }
  for (const [token, session] of authSessions) {
    if (!users.find(u => u.wallet === session.wallet)) {
      users.push({
        id: session.wallet,
        name: session.wallet.slice(0, 12) + '...',
        wallet: session.wallet,
        stats: { wins: 0, losses: 0, streak: 0, rating: 1000 },
        balance: getBalance(session.wallet),
        connected: false,
      });
    }
  }
  res.json({ users, total: users.length });
});

app.get('/api/admin/withdraw-requests', adminAuth, (req, res) => {
  res.json({ requests: withdrawRequests, total: withdrawRequests.length });
});

app.post('/api/admin/withdraw/:id/approve', adminAuth, (req, res) => {
  const w = withdrawRequests.find(r => r.id === req.params.id);
  if (!w) return res.status(404).json({ error: 'Request not found' });
  if (w.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  w.status = 'approved';
  w.approvedAt = Date.now();
  res.json(w);
});

app.post('/api/admin/withdraw/:id/reject', adminAuth, (req, res) => {
  const w = withdrawRequests.find(r => r.id === req.params.id);
  if (!w) return res.status(404).json({ error: 'Request not found' });
  if (w.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  w.status = 'rejected';
  w.rejectedAt = Date.now();
  setBalance(w.wallet, getBalance(w.wallet) + w.amount);
  res.json(w);
});

app.get('/api/admin/overview', adminAuth, (req, res) => {
  res.json({
    stats: {
      totalUsers: authSessions.size + connectedPlayers.size,
      activePlayers: connectedPlayers.size,
      matchesToday: activeMatches.size,
      activeMatches: activeMatches.size,
      pendingSettlements: withdrawRequests.filter(w => w.status === 'pending').length,
      failedSettlements: 0,
      openDisputes: 0,
      suspiciousMatches: security.getAllSuspicious().length,
      todayRevenue: 0,
    },
    recentActivity: [],
  });
});

setInterval(() => security.cleanup(), 60000);

const PORT = process.env.PORT || 3001;
loadSessions();
loadBalances();
loadProfiles();
loadStats();
initPlatformWallet();

const FAKE_PLAYERS = [
  { id: 'fake_nimiq_king', name: 'NimiqKing', avatar: 'A', xp: 4800, wins: 42, losses: 8 },
  { id: 'fake_pool_pro', name: 'PoolPro99', avatar: 'B', xp: 3600, wins: 35, losses: 12 },
  { id: 'fake_billiard_queen', name: 'BilliardQueen', avatar: 'C', xp: 3200, wins: 30, losses: 14 },
  { id: 'fake_rack_master', name: 'RackMaster', avatar: 'D', xp: 2800, wins: 27, losses: 11 },
  { id: 'fake_cue_wizard', name: 'CueWizard', avatar: 'E', xp: 2400, wins: 23, losses: 15 },
  { id: 'fake_nimiq_hustler', name: 'NimiqHustler', avatar: 'F', xp: 2000, wins: 20, losses: 10 },
  { id: 'fake_broke_king', name: 'BrokeKing', avatar: 'A', xp: 1600, wins: 16, losses: 14 },
  { id: 'fake_spin_master', name: 'SpinMaster', avatar: 'B', xp: 1200, wins: 12, losses: 18 },
  { id: 'fake_beginner_joe', name: 'BeginnerJoe', avatar: 'C', xp: 800, wins: 8, losses: 12 },
  { id: 'fake_newbie_nim', name: 'NewbieNim', avatar: 'D', xp: 400, wins: 4, losses: 16 },
];

for (const f of FAKE_PLAYERS) {
  const gamesPlayed = f.wins + f.losses;
  playerStats.set(f.id, { wins: f.wins, losses: f.losses, gamesPlayed, streak: 0, totalWinnings: f.wins * 5000000, totalLosses: f.losses * 5000000, xp: f.xp, level: Math.floor(f.xp / 800) + 1, name: f.name, avatar: f.avatar });
}
console.log(`[LEADERBOARD] Loaded ${FAKE_PLAYERS.length} fake players`);

const USER_WALLET = 'NQ67 9109 XEQ5 E5U3 A0ME C0VS 9N5N SRG1 RGBE';
if (getBalance(USER_WALLET) < 20000000) {
  setBalance(USER_WALLET, 20000000);
  console.log(`[BAL] Pre-funded ${USER_WALLET} with 200 NIM`);
}

server.listen(PORT, () => {
  console.log(`\n  ==========================================\n    Nimiq Billiards Server (Authoritative)\n    Port: ${PORT}\n    Mode: MAINNET\n    Auto-Withdraw: ${platformKeyPair ? 'ENABLED' : 'DISABLED (no PLATFORM_SEED)'}\n    Competitive Tiers: ${MATCH_TIERS.map(t => t.name).join(', ')}\n    WebSocket: ws://localhost:${PORT}/ws\n    Security: Rate limiting, Nonce tracking, Replay logging\n  ==========================================\n`);
});
