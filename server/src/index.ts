/**
 * Nimiq Billiards Server - Main Entry Point
 * 
 * Architecture:
 * - Express HTTP server for REST API
 * - WebSocket server for real-time gameplay
 * - PostgreSQL for persistent data
 * - Redis for matchmaking, presence, rate limiting
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config/index.js';
import { initDatabase, closeDatabase } from './db/index.js';
import { initRedis, closeRedis } from './services/redis.js';
import logger from './lib/logger.js';
import adminRoutes from './routes/admin.js';
import leaderboardRoutes from './routes/leaderboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// Initialize Services
// ============================================

async function initializeServices() {
  // Initialize Redis (optional in development)
  try {
    await initRedis();
    logger.info('Redis connected');
  } catch (err) {
    logger.warn('Redis not available, running without caching/matchmaking');
  }

  // Initialize Database (optional in development)
  try {
    await initDatabase();
    logger.info('PostgreSQL connected');
  } catch (err) {
    logger.warn('PostgreSQL not available, running without persistence');
  }
}

// ============================================
// Express App
// ============================================

const app = express();
const server = createServer(app);

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, '../../..')));

// Admin API routes
app.use('/api/admin', adminRoutes);

// Leaderboard API routes
app.use('/api/leaderboard', leaderboardRoutes);

// ============================================
// REST API Routes
// ============================================

// Auth: in-memory nonces, sessions, balances
const authNonces = new Map<string, { createdAt: number }>();
const authSessions = new Map<string, { wallet: string; createdAt: number }>();
const playerBalances = new Map<string, number>();
const PLATFORM_WALLET = process.env.PLATFORM_WALLET || 'NQ27 9CG2 XP33 N5NH 29EP 2YUS LMKV 3EM0 R4DJ';
const LUNA_PER_NIM = 100_000;

function genId() { return crypto.randomUUID().replace(/-/g, '').slice(0, 12); }

function getBalance(wallet: string): number {
  if (!playerBalances.has(wallet)) playerBalances.set(wallet, 100_000_000);
  return playerBalances.get(wallet)!;
}

function setBalance(wallet: string, bal: number) { playerBalances.set(wallet, bal); }

function formatLamports(l: number): string {
  const nim = l / LUNA_PER_NIM;
  if (nim >= 1000) return `${(nim / 1000).toFixed(1)}K NIM`;
  if (nim >= 100) return `${Math.round(nim)} NIM`;
  return `${nim.toFixed(2)} NIM`;
}

function authMiddleware(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No auth token' });
  const token = auth.slice(7);
  const session = authSessions.get(token);
  if (!session) return res.status(401).json({ error: 'Invalid token' });
  req.wallet = session.wallet;
  next();
}

app.get('/api/health', async (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('/api/platform-balance', (req, res) => {
  res.json({ wallet: PLATFORM_WALLET });
});

app.post('/api/auth/nonce', (req, res) => {
  const nonce = genId() + '-' + Date.now().toString(36);
  authNonces.set(nonce, { createdAt: Date.now() });
  res.json({ nonce });
});

app.post('/api/auth/login', (req, res) => {
  const { wallet, message, signature } = req.body;
  if (!wallet || !message || !signature) return res.status(400).json({ error: 'Missing fields' });

  let matchedNonce: string | null = null;
  for (const [nonce] of authNonces) {
    if (message.includes(nonce)) { matchedNonce = nonce; break; }
  }
  if (!matchedNonce) return res.status(401).json({ error: 'Invalid or expired nonce' });
  authNonces.delete(matchedNonce);

  const token = genId() + genId() + genId();
  authSessions.set(token, { wallet, createdAt: Date.now() });

  const balance = getBalance(wallet);
  res.json({ token, wallet, balance });
});

app.get('/api/balance', authMiddleware, (req: any, res) => {
  const balance = getBalance(req.wallet);
  res.json({ wallet: req.wallet, balance });
});

app.post('/api/topup', authMiddleware, (req: any, res) => {
  const { txHash, sender, recipient, value } = req.body;
  if (!txHash || !sender || !recipient || !value) return res.status(400).json({ error: 'Missing fields' });
  if (sender !== req.wallet) return res.status(400).json({ error: 'Sender mismatch' });
  if (recipient !== PLATFORM_WALLET) return res.status(400).json({ error: 'Invalid recipient' });

  const currentBalance = getBalance(req.wallet);
  const topUpAmount = value;
  setBalance(req.wallet, currentBalance + topUpAmount);

  logger.info({ wallet: req.wallet, topUpAmount, txHash }, 'Top-up verified');

  res.json({ wallet: req.wallet, balance: getBalance(req.wallet), topUpAmount });
});

app.get('/api/tiers', (req, res) => {
  const tiers = Object.entries(config.tiers).map(([id, tier]) => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    ...tier,
    prize: {
      entryFee: tier.entryFee,
      totalPot: tier.entryFee * 2,
      platformFee: Math.round(tier.entryFee * 2 * tier.platformFeePercent / 100),
      winnerPrize: tier.entryFee * 2 - Math.round(tier.entryFee * 2 * tier.platformFeePercent / 100),
    },
  }));
  res.json(tiers);
});

// ============================================
// WebSocket Server
// ============================================

const wss = new WebSocketServer({ server, path: '/ws' });

// Connected players for balance updates
const connectedPlayers = new Map<string, { ws: WebSocket; nimAddress?: string }>();

wss.on('connection', (ws, req) => {
  const playerId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  logger.info({ playerId, ip: req.socket.remoteAddress }, 'Player connected');
  connectedPlayers.set(playerId, { ws });

  // Send welcome
  ws.send(JSON.stringify({
    type: 'welcome',
    playerId,
    playerName: `Player_${playerId.slice(0, 4)}`,
    avatar: 'A',
    stats: { wins: 0, losses: 0, gamesPlayed: 0, streak: 0, totalWinnings: 0, totalLosses: 0 },
    balance: 100_000_000,
    nonce: crypto.randomUUID(),
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleMessage(playerId, ws, msg);
    } catch (err) {
      logger.error({ playerId, error: err }, 'Failed to parse message');
    }
  });

  ws.on('close', () => {
    connectedPlayers.delete(playerId);
    logger.info({ playerId }, 'Player disconnected');
  });
});

// ============================================
// Game State (in-memory)
// ============================================

interface BallState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pocketed: boolean;
  stripe: boolean;
  solid: boolean;
  isEight: boolean;
}

interface GameMatch {
  matchId: string;
  player1Id: string;
  player2Id: string;
  player1Ws: WebSocket;
  player2Ws: WebSocket;
  currentTurn: number;
  balls: BallState[];
  matchType: string;
  createdAt: number;
}

const activeMatches = new Map<string, GameMatch>();
const matchmakingQueue: { playerId: string; ws: WebSocket; matchType: string; joinedAt: number }[] = [];

function createRack(): BallState[] {
  const TABLE_W = 900, TABLE_H = 450;
  const RACK_X = TABLE_W * 0.73, RACK_Y = TABLE_H / 2;
  const SPACING = 22;
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 14, 7, 12, 5, 15, 6, 13];
  const balls: BallState[] = [];
  
  balls.push({
    id: 0, x: TABLE_W * 0.27, y: TABLE_H / 2,
    vx: 0, vy: 0, pocketed: false,
    stripe: false, solid: false, isEight: false,
  });
  
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      const id = order[idx++];
      const x = RACK_X + row * SPACING * Math.cos(Math.PI / 6);
      const y = RACK_Y + (col - row / 2) * SPACING;
      balls.push({
        id, x, y, vx: 0, vy: 0, pocketed: false,
        stripe: id >= 9, solid: id >= 1 && id <= 7, isEight: id === 8,
      });
    }
  }
  return balls;
}

function tryMatchPlayers() {
  if (matchmakingQueue.length < 2) return;
  
  const p1 = matchmakingQueue.shift()!;
  const p2 = matchmakingQueue.findIndex(p => p.matchType === p1.matchType);
  
  if (p2 === -1) {
    matchmakingQueue.unshift(p1);
    return;
  }
  
  const opponent = matchmakingQueue.splice(p2, 1)[0];
  const matchId = genId();
  const balls = createRack();
  
  const match: GameMatch = {
    matchId,
    player1Id: p1.playerId,
    player2Id: opponent.playerId,
    player1Ws: p1.ws,
    player2Ws: opponent.ws,
    currentTurn: 1,
    balls,
    matchType: p1.matchType,
    createdAt: Date.now(),
  };
  
  activeMatches.set(matchId, match);
  
  const sendMatch = (ws: WebSocket, playerNumber: number, opponentName: string) => {
    ws.send(JSON.stringify({
      type: 'matchFound',
      matchId,
      opponentName: opponentName,
      opponentAvatar: 'O',
      playerNumber,
      balls,
      rules: {
        turn: 1,
        state: 'aiming',
        player1Type: null,
        player2Type: null,
        foul: false,
        foulReason: '',
      },
      tier: null,
    }));
  };
  
  sendMatch(p1.ws, 1, `Player_${opponent.playerId.slice(0, 4)}`);
  sendMatch(opponent.ws, 2, `Player_${p1.playerId.slice(0, 4)}`);
  
  logger.info({ matchId, p1: p1.playerId, p2: opponent.playerId }, 'Match created');
}

function handleMessage(playerId: string, ws: WebSocket, msg: Record<string, unknown>) {
  logger.debug({ playerId, type: msg.type }, 'Message received');

  switch (msg.type) {
    case 'setNimAddress': {
      const address = msg.address as string;
      const player = connectedPlayers.get(playerId);
      if (player) player.nimAddress = address;
      const balance = getBalance(address);
      ws.send(JSON.stringify({ type: 'balanceUpdate', balance }));
      break;
    }
    case 'authenticate': {
      const token = msg.token as string;
      const session = authSessions.get(token);
      if (session) {
        const player = connectedPlayers.get(playerId);
        if (player) player.nimAddress = session.wallet;
        const balance = getBalance(session.wallet);
        ws.send(JSON.stringify({ type: 'balanceUpdate', balance }));
      }
      break;
    }
    case 'setName': {
      break;
    }
    case 'joinQueue': {
      const matchType = (msg.matchType as string) || 'free';
      
      // Remove from queue if already there
      const existingIdx = matchmakingQueue.findIndex(p => p.playerId === playerId);
      if (existingIdx !== -1) matchmakingQueue.splice(existingIdx, 1);
      
      matchmakingQueue.push({ playerId, ws, matchType, joinedAt: Date.now() });
      logger.info({ playerId, matchType }, 'Joined queue');
      
      // Try to match immediately
      tryMatchPlayers();
      break;
    }
    case 'leaveQueue': {
      const idx = matchmakingQueue.findIndex(p => p.playerId === playerId);
      if (idx !== -1) matchmakingQueue.splice(idx, 1);
      break;
    }
    case 'shotResult': {
      // Client sends final ball state after shot
      const matchId = msg.matchId as string;
      const match = activeMatches.get(matchId);
      if (!match) {
        ws.send(JSON.stringify({ type: 'shotRejected', reason: 'No active match' }));
        break;
      }
      
      const balls = msg.balls as BallState[];
      const rules = msg.rules as any;
      
      match.balls = balls;
      match.currentTurn = rules.turn;
      
      // Find opponent and relay
      const isP1 = match.player1Id === playerId;
      const opponentWs = isP1 ? match.player2Ws : match.player1Ws;
      
      if (opponentWs && opponentWs.readyState === 1) {
        opponentWs.send(JSON.stringify({
          type: 'opponentShot',
          matchId,
          balls,
          rules,
          shooterId: playerId,
        }));
      }
      
      break;
    }
    case 'shoot': {
      break;
    }
    case 'placeCueBall': {
      break;
    }
    case 'reconnect': {
      break;
    }
    case 'rematch': {
      break;
    }
  }
}

// ============================================
// Graceful Shutdown
// ============================================

async function shutdown(signal: string) {
  logger.info(`${signal} received, starting graceful shutdown`);

  // Close WebSocket server
  wss.close(() => {
    logger.info('WebSocket server closed');
  });

  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
  });

  // Close services
  await closeRedis();
  await closeDatabase();

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ============================================
// Start Server
// ============================================

async function start() {
  await initializeServices();

  return new Promise<void>((resolve, reject) => {
    server.on('error', (err) => {
      logger.error('Server error:', err);
      reject(err);
    });

    server.listen(config.port, '0.0.0.0', () => {
      logger.info({
        port: config.port,
        env: config.nodeEnv,
        ws: `ws://localhost:${config.port}/ws`,
      }, 'Server started');
      resolve();
    });
  });
}

start().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection:', err);
});

process.on('exit', (code) => {
  console.log(`Process exiting with code ${code}`);
});
