/**
 * Admin API Routes
 * 
 * Read-only dashboard for monitoring:
 * - Users, matches, transactions, settlements, disputes
 * - Suspicious matches and player statistics
 * - Revenue/platform fees
 * - Match replay/event history
 * 
 * SECURITY: No endpoints allow modifying or moving user funds.
 * All mutations are restricted to dispute resolution (refunds via proper settlement flow).
 */

import { Router, Request, Response } from 'express';
import { getRedis } from '../services/redis.js';
import logger from '../lib/logger.js';

const router = Router();

// ============================================
// Mock Data Store (replace with DB queries in production)
// ============================================

const mockUsers = generateMockUsers(87);
const mockMatches = generateMockMatches(234);
const mockTransactions = generateMockTransactions(1200);
const mockSettlements = generateMockSettlements(180);
const mockDisputes = generateMockDisputes(12);
const mockSuspiciousMatches = generateMockSuspiciousMatches(8);

// ============================================
// Middleware: Admin Auth (simple token in dev)
// ============================================

function adminAuth(req: Request, res: Response, next: Function) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== 'admin-dev-token-2024') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(adminAuth);

// ============================================
// Dashboard Overview
// ============================================

router.get('/overview', async (req: Request, res: Response) => {
  let activePlayers = 0;
  try {
    const redis = getRedis();
    if (redis) {
      const activePlayerKeys = await redis.keys('presence:*');
      activePlayers = activePlayerKeys.length;
    }
  } catch {
    // Redis not available
  }
  
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  const oneDayAgo = now - 86400000;
  
  const recentMatches = mockMatches.filter(m => new Date(m.createdAt).getTime() > oneDayAgo);
  const activeMatches = mockMatches.filter(m => m.status === 'in_progress');
  const pendingSettlements = mockSettlements.filter(s => s.status === 'pending');
  const failedSettlements = mockSettlements.filter(s => s.status === 'failed');
  
  const totalRevenue = mockSettlements
    .filter(s => s.status === 'completed')
    .reduce((sum, s) => sum + s.platformFee, 0);
  
  const todayRevenue = mockSettlements
    .filter(s => s.status === 'completed' && new Date(s.completedAt || s.createdAt).getTime() > oneDayAgo)
    .reduce((sum, s) => sum + s.platformFee, 0);

  res.json({
    stats: {
      totalUsers: mockUsers.length,
      activePlayers,
      totalMatches: mockMatches.length,
      matchesToday: recentMatches.length,
      activeMatches: activeMatches.length,
      totalTransactions: mockTransactions.length,
      pendingSettlements: pendingSettlements.length,
      failedSettlements: failedSettlements.length,
      openDisputes: mockDisputes.filter(d => d.status === 'open').length,
      suspiciousMatches: mockSuspiciousMatches.length,
      totalRevenue,
      todayRevenue,
    },
    recentActivity: mockMatches
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10)
      .map(m => ({
        id: m.id,
        type: 'match',
        description: `${m.player1Name} vs ${m.player2Name} (${m.mode})`,
        status: m.status,
        timestamp: m.createdAt,
      })),
  });
});

// ============================================
// Users
// ============================================

router.get('/users', (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const search = (req.query.search as string)?.toLowerCase() || '';
  const sort = (req.query.sort as string) || 'createdAt';
  const order = req.query.order === 'asc' ? 'asc' : 'desc';
  
  let filtered = mockUsers;
  if (search) {
    filtered = mockUsers.filter(u => 
      u.username.toLowerCase().includes(search) ||
      u.walletAddress.toLowerCase().includes(search)
    );
  }
  
  filtered.sort((a: any, b: any) => {
    const aVal = a[sort];
    const bVal = b[sort];
    if (typeof aVal === 'string') {
      return order === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return order === 'asc' ? aVal - bVal : bVal - aVal;
  });
  
  const start = (page - 1) * limit;
  const users = filtered.slice(start, start + limit);
  
  res.json({
    users,
    total: filtered.length,
    page,
    limit,
    totalPages: Math.ceil(filtered.length / limit),
  });
});

router.get('/users/:id', (req: Request, res: Response) => {
  const user = mockUsers.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const userMatches = mockMatches.filter(m => m.player1Id === user.id || m.player2Id === user.id);
  const userTransactions = mockTransactions.filter(t => t.userId === user.id);
  
  res.json({
    user,
    matches: userMatches.slice(0, 20),
    transactions: userTransactions.slice(0, 20),
    stats: {
      totalMatches: userMatches.length,
      wins: userMatches.filter(m => m.winnerId === user.id).length,
      losses: userMatches.filter(m => m.loserId === user.id).length,
      totalWinnings: userTransactions.filter(t => t.type === 'prize_payout').reduce((s, t) => s + t.amount, 0),
      totalSpent: userTransactions.filter(t => t.type === 'entry_fee').reduce((s, t) => s + t.amount, 0),
    },
  });
});

// ============================================
// Matches
// ============================================

router.get('/matches', (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const status = req.query.status as string;
  const mode = req.query.mode as string;
  
  let filtered = mockMatches;
  if (status) filtered = filtered.filter(m => m.status === status);
  if (mode) filtered = filtered.filter(m => m.mode === mode);
  
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  const start = (page - 1) * limit;
  const matches = filtered.slice(start, start + limit);
  
  res.json({
    matches,
    total: filtered.length,
    page,
    limit,
    totalPages: Math.ceil(filtered.length / limit),
  });
});

router.get('/matches/active', (req: Request, res: Response) => {
  const active = mockMatches
    .filter(m => m.status === 'in_progress')
    .sort((a, b) => new Date(b.startedAt || b.createdAt).getTime() - new Date(a.startedAt || a.createdAt).getTime());
  
  res.json({ matches: active, total: active.length });
});

router.get('/matches/completed', (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  
  const completed = mockMatches
    .filter(m => m.status === 'finished')
    .sort((a, b) => new Date(b.finishedAt || b.createdAt).getTime() - new Date(a.finishedAt || a.createdAt).getTime());
  
  const start = (page - 1) * limit;
  
  res.json({
    matches: completed.slice(start, start + limit),
    total: completed.length,
    page,
    limit,
    totalPages: Math.ceil(completed.length / limit),
  });
});

// ============================================
// Match Replay / Event History
// ============================================

router.get('/matches/:id/replay', (req: Request, res: Response) => {
  const match = mockMatches.find(m => m.id === req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  
  const events = generateMatchEvents(match);
  
  res.json({
    match,
    events,
    totalEvents: events.length,
  });
});

router.get('/matches/:id/events', (req: Request, res: Response) => {
  const match = mockMatches.find(m => m.id === req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  
  const events = generateMatchEvents(match);
  const from = parseInt(req.query.from as string) || 0;
  const limit = parseInt(req.query.limit as string) || 50;
  
  res.json({
    events: events.slice(from, from + limit),
    total: events.length,
    from,
    hasMore: from + limit < events.length,
  });
});

// ============================================
// Transactions
// ============================================

router.get('/transactions', (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const type = req.query.type as string;
  const status = req.query.status as string;
  
  let filtered = mockTransactions;
  if (type) filtered = filtered.filter(t => t.type === type);
  if (status) filtered = filtered.filter(t => t.status === status);
  
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  const start = (page - 1) * limit;
  
  res.json({
    transactions: filtered.slice(start, start + limit),
    total: filtered.length,
    page,
    limit,
    totalPages: Math.ceil(filtered.length / limit),
  });
});

// ============================================
// Settlements
// ============================================

router.get('/settlements', (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const status = req.query.status as string;
  
  let filtered = mockSettlements;
  if (status) filtered = filtered.filter(s => s.status === status);
  
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  const start = (page - 1) * limit;
  
  res.json({
    settlements: filtered.slice(start, start + limit),
    total: filtered.length,
    page,
    limit,
    totalPages: Math.ceil(filtered.length / limit),
  });
});

router.get('/settlements/pending', (req: Request, res: Response) => {
  const pending = mockSettlements
    .filter(s => s.status === 'pending' || s.status === 'processing')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  
  res.json({ settlements: pending, total: pending.length });
});

router.get('/settlements/failed', (req: Request, res: Response) => {
  const failed = mockSettlements
    .filter(s => s.status === 'failed')
    .sort((a, b) => new Date(b.failedAt || b.createdAt).getTime() - new Date(a.failedAt || a.createdAt).getTime());
  
  res.json({ settlements: failed, total: failed.length });
});

// ============================================
// Disputes
// ============================================

router.get('/disputes', (req: Request, res: Response) => {
  const status = req.query.status as string;
  let filtered = mockDisputes;
  if (status) filtered = filtered.filter(d => d.status === status);
  
  res.json({ disputes: filtered, total: filtered.length });
});

router.get('/disputes/:id', (req: Request, res: Response) => {
  const dispute = mockDisputes.find(d => d.id === req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  
  const match = mockMatches.find(m => m.id === dispute.matchId);
  const events = match ? generateMatchEvents(match) : [];
  
  res.json({ dispute, match, events });
});

// ============================================
// Suspicious Matches
// ============================================

router.get('/suspicious', (req: Request, res: Response) => {
  res.json({ matches: mockSuspiciousMatches, total: mockSuspiciousMatches.length });
});

router.get('/suspicious/:id', (req: Request, res: Response) => {
  const suspicious = mockSuspiciousMatches.find(s => s.matchId === req.params.id);
  if (!suspicious) return res.status(404).json({ error: 'Not found' });
  
  const match = mockMatches.find(m => m.id === suspicious.matchId);
  const events = match ? generateMatchEvents(match) : [];
  
  res.json({ suspicious, match, events });
});

// ============================================
// Player Statistics
// ============================================

router.get('/stats/players', (req: Request, res: Response) => {
  const sortBy = (req.query.sort as string) || 'wins';
  const limit = parseInt(req.query.limit as string) || 50;
  
  const stats = mockUsers.map(u => {
    const userMatches = mockMatches.filter(m => m.player1Id === u.id || m.player2Id === u.id);
    const wins = userMatches.filter(m => m.winnerId === u.id).length;
    const losses = userMatches.filter(m => m.loserId === u.id).length;
    const totalWinnings = mockTransactions
      .filter(t => t.userId === u.id && t.type === 'prize_payout')
      .reduce((s, t) => s + t.amount, 0);
    
    return {
      userId: u.id,
      username: u.username,
      walletAddress: u.walletAddress,
      rating: u.rating,
      gamesPlayed: userMatches.length,
      wins,
      losses,
      winRate: userMatches.length > 0 ? ((wins / userMatches.length) * 100).toFixed(1) : '0.0',
      totalWinnings,
      currentStreak: u.currentStreak,
    };
  });
  
  stats.sort((a: any, b: any) => {
    if (sortBy === 'wins') return b.wins - a.wins;
    if (sortBy === 'winRate') return parseFloat(b.winRate) - parseFloat(a.winRate);
    if (sortBy === 'rating') return b.rating - a.rating;
    if (sortBy === 'winnings') return b.totalWinnings - a.totalWinnings;
    return b.gamesPlayed - a.gamesPlayed;
  });
  
  res.json({ stats: stats.slice(0, limit), total: stats.length });
});

// ============================================
// Revenue / Platform Fees
// ============================================

router.get('/stats/revenue', (req: Request, res: Response) => {
  const now = Date.now();
  const oneDayAgo = now - 86400000;
  const oneWeekAgo = now - 604800000;
  const oneMonthAgo = now - 2592000000;
  
  const completed = mockSettlements.filter(s => s.status === 'completed');
  
  const todayRevenue = completed
    .filter(s => new Date(s.completedAt || s.createdAt).getTime() > oneDayAgo)
    .reduce((sum, s) => sum + s.platformFee, 0);
  
  const weekRevenue = completed
    .filter(s => new Date(s.completedAt || s.createdAt).getTime() > oneWeekAgo)
    .reduce((sum, s) => sum + s.platformFee, 0);
  
  const monthRevenue = completed
    .filter(s => new Date(s.completedAt || s.createdAt).getTime() > oneMonthAgo)
    .reduce((sum, s) => sum + s.platformFee, 0);
  
  const totalRevenue = completed.reduce((sum, s) => sum + s.platformFee, 0);
  
  // Revenue by tier
  const byTier: Record<string, number> = {};
  completed.forEach(s => {
    byTier[s.tierId] = (byTier[s.tierId] || 0) + s.platformFee;
  });
  
  // Daily revenue for chart (last 7 days)
  const daily = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = now - (i + 1) * 86400000;
    const dayEnd = now - i * 86400000;
    const dayRevenue = completed
      .filter(s => {
        const t = new Date(s.completedAt || s.createdAt).getTime();
        return t > dayStart && t <= dayEnd;
      })
      .reduce((sum, s) => sum + s.platformFee, 0);
    daily.push({
      date: new Date(dayEnd).toISOString().split('T')[0],
      revenue: dayRevenue,
    });
  }
  
  res.json({
    summary: {
      today: todayRevenue,
      thisWeek: weekRevenue,
      thisMonth: monthRevenue,
      total: totalRevenue,
    },
    byTier,
    daily,
    totalSettlements: completed.length,
    avgPlatformFee: completed.length > 0 ? Math.round(totalRevenue / completed.length) : 0,
  });
});

// ============================================
// Mock Data Generators
// ============================================

function generateMockUsers(count: number) {
  const names = [
    'PoolMaster', 'CueKing', 'BreakShot', 'EightBall_Pro', 'StripeKiller',
    'SolidForce', 'RackEm', 'ChalkDust', 'FeltQueen', 'PocketAce',
    'BankShot', 'ScratchProof', 'DiamondCut', 'RailBanger', 'TableKing',
    'NimiqNinja', 'CryptoCue', 'BlockBreaker', 'Hash Hustler', 'Satoshi8Ball',
  ];
  
  return Array.from({ length: count }, (_, i) => ({
    id: `user_${i.toString().padStart(4, '0')}`,
    username: i < names.length ? names[i] : `Player_${i}`,
    walletAddress: `NQ${Array.from({ length: 38 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('')}`,
    rating: 800 + Math.floor(Math.random() * 1200),
    wins: Math.floor(Math.random() * 200),
    losses: Math.floor(Math.random() * 150),
    gamesPlayed: 0,
    currentStreak: Math.floor(Math.random() * 20) - 10,
    isBanned: Math.random() < 0.02,
    createdAt: new Date(Date.now() - Math.random() * 90 * 86400000).toISOString(),
    lastActiveAt: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
  })).map(u => ({ ...u, gamesPlayed: u.wins + u.losses }));
}

function generateMockMatches(count: number) {
  const modes = ['free', 'competitive', 'ranked', 'tournament'];
  const statuses = ['finished', 'finished', 'finished', 'in_progress', 'cancelled'];
  const tiers = ['free_casual', 'nim_100', 'nim_500', 'nim_1000', 'nim_5000'];
  const reasons = ['legal_8ball', 'opponent_foul', 'timeout', 'forfeit', 'disconnection'];
  
  return Array.from({ length: count }, (_, i) => {
    const mode = modes[Math.floor(Math.random() * modes.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const tier = tiers[Math.floor(Math.random() * tiers.length)];
    const entryFee = tier === 'free_casual' ? 0 : parseInt(tier.split('_')[1]) * 100000;
    const platformFee = Math.round(entryFee * 2 * 0.05);
    const winnerBy = reasons[Math.floor(Math.random() * reasons.length)];
    const player1Idx = Math.floor(Math.random() * 87);
    let player2Idx = Math.floor(Math.random() * 87);
    while (player2Idx === player1Idx) player2Idx = Math.floor(Math.random() * 87);
    const winnerIdx = Math.random() > 0.5 ? player1Idx : player2Idx;
    const loserIdx = winnerIdx === player1Idx ? player2Idx : player1Idx;
    const createdAt = new Date(Date.now() - Math.random() * 30 * 86400000);
    const duration = Math.floor(Math.random() * 1800000) + 300000;
    
    return {
      id: `match_${i.toString().padStart(4, '0')}`,
      mode,
      tierId: tier,
      status,
      entryFee,
      prizeAmount: entryFee * 2 - platformFee,
      platformFee,
      currency: 'NIM',
      player1Id: `user_${player1Idx.toString().padStart(4, '0')}`,
      player2Id: `user_${player2Idx.toString().padStart(4, '0')}`,
      player1Name: `Player_${player1Idx}`,
      player2Name: `Player_${player2Idx}`,
      winnerId: status === 'finished' ? `user_${winnerIdx.toString().padStart(4, '0')}` : null,
      loserId: status === 'finished' ? `user_${loserIdx.toString().padStart(4, '0')}` : null,
      winnerBy: status === 'finished' ? winnerBy : null,
      totalShots: status === 'finished' ? Math.floor(Math.random() * 60) + 10 : 0,
      turnCount: status === 'finished' ? Math.floor(Math.random() * 30) + 5 : 0,
      createdAt: createdAt.toISOString(),
      startedAt: status !== 'created' ? new Date(createdAt.getTime() + 30000).toISOString() : null,
      finishedAt: status === 'finished' ? new Date(createdAt.getTime() + duration).toISOString() : null,
      duration: status === 'finished' ? duration : null,
    };
  });
}

function generateMockTransactions(count: number) {
  const types = ['deposit', 'withdrawal', 'entry_fee', 'prize_payout', 'platform_fee', 'refund'];
  const statuses = ['confirmed', 'confirmed', 'confirmed', 'pending', 'failed'];
  
  return Array.from({ length: count }, (_, i) => {
    const type = types[Math.floor(Math.random() * types.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const userIdx = Math.floor(Math.random() * 87);
    const amounts: Record<string, number> = {
      deposit: Math.floor(Math.random() * 10000000) + 100000,
      withdrawal: Math.floor(Math.random() * 5000000) + 100000,
      entry_fee: [0, 100000, 500000, 1000000, 5000000][Math.floor(Math.random() * 5)],
      prize_payout: [0, 190000, 950000, 1900000, 9500000][Math.floor(Math.random() * 5)],
      platform_fee: [0, 10000, 50000, 100000, 500000][Math.floor(Math.random() * 5)],
      refund: Math.floor(Math.random() * 1000000) + 100000,
    };
    
    return {
      id: `tx_${i.toString().padStart(6, '0')}`,
      userId: `user_${userIdx.toString().padStart(4, '0')}`,
      matchId: type === 'entry_fee' || type === 'prize_payout' ? `match_${Math.floor(Math.random() * 234).toString().padStart(4, '0')}` : null,
      type,
      amount: amounts[type],
      currency: 'NIM',
      status,
      blockchainTxHash: status === 'confirmed' ? Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('') : null,
      fromAddress: `NQ${Array.from({ length: 38 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('')}`,
      toAddress: `NQ${Array.from({ length: 38 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('')}`,
      createdAt: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString(),
      confirmedAt: status === 'confirmed' ? new Date(Date.now() - Math.random() * 29 * 86400000).toISOString() : null,
    };
  });
}

function generateMockSettlements(count: number) {
  const statuses = ['completed', 'completed', 'completed', 'pending', 'processing', 'failed'];
  const tiers = ['free_casual', 'nim_100', 'nim_500', 'nim_1000', 'nim_5000'];
  
  return Array.from({ length: count }, (_, i) => {
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const tier = tiers[Math.floor(Math.random() * tiers.length)];
    const entryFee = tier === 'free_casual' ? 0 : parseInt(tier.split('_')[1]) * 100000;
    const platformFee = Math.round(entryFee * 2 * 0.05);
    const winnerPrize = entryFee * 2 - platformFee;
    const winnerIdx = Math.floor(Math.random() * 87);
    const loserIdx = Math.floor(Math.random() * 87);
    const createdAt = new Date(Date.now() - Math.random() * 30 * 86400000);
    
    return {
      id: `settlement_${i.toString().padStart(4, '0')}`,
      matchId: `match_${Math.floor(Math.random() * 234).toString().padStart(4, '0')}`,
      winnerId: `user_${winnerIdx.toString().padStart(4, '0')}`,
      loserId: `user_${loserIdx.toString().padStart(4, '0')}`,
      tierId: tier,
      entryFeeTotal: entryFee * 2,
      platformFee,
      winnerPrize,
      currency: 'NIM',
      status,
      payoutTxHash: status === 'completed' ? Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('') : null,
      createdAt: createdAt.toISOString(),
      processedAt: status !== 'pending' ? new Date(createdAt.getTime() + 5000).toISOString() : null,
      completedAt: status === 'completed' ? new Date(createdAt.getTime() + 15000).toISOString() : null,
      failedAt: status === 'failed' ? new Date(createdAt.getTime() + 30000).toISOString() : null,
      error: status === 'failed' ? 'Insufficient contract balance' : null,
    };
  });
}

function generateMockDisputes(count: number) {
  const reasons = [
    'Opponent disconnected during winning shot',
    'Suspected aimbot usage',
    'Game state mismatch reported',
    'Transaction not received after winning',
    'Match ended but no settlement',
  ];
  const statuses = ['open', 'open', 'investigating', 'resolved', 'rejected'];
  
  return Array.from({ length: count }, (_, i) => ({
    id: `dispute_${i.toString().padStart(4, '0')}`,
    matchId: `match_${Math.floor(Math.random() * 234).toString().padStart(4, '0')}`,
    reporterId: `user_${Math.floor(Math.random() * 87).toString().padStart(4, '0')}`,
    reason: reasons[Math.floor(Math.random() * reasons.length)],
    status: statuses[Math.floor(Math.random() * statuses.length)],
    severity: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
    createdAt: new Date(Date.now() - Math.random() * 14 * 86400000).toISOString(),
    notes: i % 3 === 0 ? 'Auto-flagged by suspicious activity detector' : null,
  }));
}

function generateMockSuspiciousMatches(count: number) {
  const reasons = [
    'Unusually fast match completion (< 30 seconds)',
    'Both players from same IP range',
    'Identical shot patterns across multiple matches',
    'Win trading pattern detected',
    'Abnormal settlement request timing',
    'Player account age < 1 minute',
    'Shot timing below human reaction threshold',
    'Suspicious wallet transaction pattern',
  ];
  
  return Array.from({ length: count }, (_, i) => ({
    matchId: `match_${Math.floor(Math.random() * 234).toString().padStart(4, '0')}`,
    reason: reasons[i % reasons.length],
    severity: ['medium', 'high', 'critical'][Math.floor(Math.random() * 3)],
    player1Id: `user_${Math.floor(Math.random() * 87).toString().padStart(4, '0')}`,
    player2Id: `user_${Math.floor(Math.random() * 87).toString().padStart(4, '0')}`,
    detectedAt: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
    details: {
      matchDuration: Math.floor(Math.random() * 60) + 10,
      totalShots: Math.floor(Math.random() * 10) + 2,
      confidence: (0.6 + Math.random() * 0.4).toFixed(2),
    },
  }));
}

function generateMatchEvents(match: any) {
  const events = [];
  const shotCount = match.totalShots || Math.floor(Math.random() * 30) + 5;
  
  // Match start
  events.push({
    id: `evt_${match.id}_0`,
    sequence: 0,
    type: 'match_created',
    timestamp: match.createdAt,
    data: { mode: match.mode, tierId: match.tierId, entryFee: match.entryFee },
    player: null,
    hash: Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''),
  });
  
  events.push({
    id: `evt_${match.id}_1`,
    sequence: 1,
    type: 'player_joined',
    timestamp: new Date(new Date(match.createdAt).getTime() + 1000).toISOString(),
    data: { playerId: match.player1Id, playerName: match.player1Name },
    player: match.player1Id,
    hash: Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''),
  });
  
  events.push({
    id: `evt_${match.id}_2`,
    sequence: 2,
    type: 'player_joined',
    timestamp: new Date(new Date(match.createdAt).getTime() + 2000).toISOString(),
    data: { playerId: match.player2Id, playerName: match.player2Name },
    player: match.player2Id,
    hash: Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''),
  });
  
  events.push({
    id: `evt_${match.id}_3`,
    sequence: 3,
    type: 'game_start',
    timestamp: match.startedAt || match.createdAt,
    data: { breakingPlayer: match.player1Id },
    player: match.player1Id,
    hash: Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''),
  });
  
  // Shot events
  let currentTime = new Date(match.startedAt || match.createdAt).getTime();
  let currentPlayer = match.player1Id;
  
  for (let s = 0; s < shotCount; s++) {
    currentTime += Math.floor(Math.random() * 15000) + 3000;
    const ballsPocketed = Math.floor(Math.random() * 3);
    const isFoul = Math.random() < 0.15;
    
    events.push({
      id: `evt_${match.id}_shot_${s}`,
      sequence: 4 + s * 2,
      type: 'shot_taken',
      timestamp: new Date(currentTime).toISOString(),
      data: {
        playerId: currentPlayer,
        angle: (Math.random() * Math.PI * 2 - Math.PI).toFixed(4),
        power: (Math.random() * 0.8 + 0.2).toFixed(2),
        ballsPocketed,
        isFoul,
        foulType: isFoul ? ['scratch', 'no_ball_hit', 'wrong_ball_first'][Math.floor(Math.random() * 3)] : null,
      },
      player: currentPlayer,
      hash: Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''),
    });
    
    if (ballsPocketed > 0 && !isFoul) {
      events.push({
        id: `evt_${match.id}_ball_${s}`,
        sequence: 5 + s * 2,
        type: 'ball_pocketed',
        timestamp: new Date(currentTime + 500).toISOString(),
        data: {
          playerId: currentPlayer,
          balls: Array.from({ length: ballsPocketed }, (_, bi) => ({
            number: Math.floor(Math.random() * 15) + 1,
            type: Math.random() > 0.5 ? 'solid' : 'stripe',
          })),
        },
        player: currentPlayer,
        hash: Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''),
      });
    }
    
    currentPlayer = currentPlayer === match.player1Id ? match.player2Id : match.player1Id;
  }
  
  // Game over
  events.push({
    id: `evt_${match.id}_end`,
    sequence: 4 + shotCount * 2,
    type: 'game_over',
    timestamp: match.finishedAt || new Date(currentTime + 10000).toISOString(),
    data: {
      winnerId: match.winnerId,
      loserId: match.loserId,
      winnerBy: match.winnerBy,
      totalShots: shotCount,
    },
    player: match.winnerId,
    hash: Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''),
  });
  
  return events;
}

export default router;
