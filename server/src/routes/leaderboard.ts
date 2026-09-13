/**
 * Leaderboard API Routes
 * 
 * Provides global, weekly, and monthly leaderboards
 * sortable by win rate, rating, and games played.
 */

import { Router, Request, Response } from 'express';

const router = Router();

// ============================================
// Mock Player Data
// ============================================

interface Player {
  id: string;
  username: string;
  avatar: string;
  rating: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
  winRate: number;
  currentStreak: number;
  longestWinStreak: number;
  totalWinnings: number;
  joinedAt: string;
  lastActiveAt: string;
  weeklyWins: number;
  weeklyLosses: number;
  weeklyGames: number;
  monthlyWins: number;
  monthlyLosses: number;
  monthlyGames: number;
}

const PLAYER_NAMES = [
  'PoolMaster', 'CueKing', 'BreakShot', 'EightBall_Pro', 'StripeKiller',
  'SolidForce', 'RackEm', 'ChalkDust', 'FeltQueen', 'PocketAce',
  'BankShot', 'ScratchProof', 'DiamondCut', 'RailBanger', 'TableKing',
  'NimiqNinja', 'CryptoCue', 'BlockBreaker', 'HashHustler', 'Satoshi8Ball',
  'GrandMaster', 'TopSpin', 'DeepSink', 'AngleSharp', 'PowerBreak',
  'SoftTouch', 'CutMaster', 'PlaySafe', 'OneRail', 'TwoBall',
  'ComboKing', 'KickShot', 'MasséMaster', 'JumpQueen', 'MidsTable',
  'EndGame', 'ClutchPlayer', 'RackAttack', 'CueBallWizard', 'PocketPicks',
];

const AVATARS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];

function generatePlayers(count: number): Player[] {
  const players: Player[] = [];
  
  for (let i = 0; i < count; i++) {
    const wins = Math.floor(Math.random() * 300) + 10;
    const losses = Math.floor(Math.random() * 200) + 5;
    const gamesPlayed = wins + losses;
    const winRate = Math.round((wins / gamesPlayed) * 100 * 10) / 10;
    const rating = Math.floor(800 + Math.random() * 1200);
    
    const weeklyGames = Math.floor(Math.random() * 30) + 2;
    const weeklyWins = Math.floor(Math.random() * weeklyGames);
    const weeklyLosses = weeklyGames - weeklyWins;
    
    const monthlyGames = Math.floor(Math.random() * 100) + 10;
    const monthlyWins = Math.floor(Math.random() * monthlyGames);
    const monthlyLosses = monthlyGames - monthlyWins;
    
    players.push({
      id: `player_${i.toString().padStart(4, '0')}`,
      username: i < PLAYER_NAMES.length ? PLAYER_NAMES[i] : `Player_${i}`,
      avatar: AVATARS[i % AVATARS.length],
      rating,
      wins,
      losses,
      gamesPlayed,
      winRate,
      currentStreak: Math.floor(Math.random() * 20) - 8,
      longestWinStreak: Math.floor(Math.random() * 25) + 3,
      totalWinnings: Math.floor(Math.random() * 50000000),
      joinedAt: new Date(Date.now() - Math.random() * 180 * 86400000).toISOString(),
      lastActiveAt: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
      weeklyWins,
      weeklyLosses,
      weeklyGames,
      monthlyWins,
      monthlyLosses,
      monthlyGames,
    });
  }
  
  return players;
}

const allPlayers = generatePlayers(40);

// ============================================
// Leaderboard Endpoints
// ============================================

/**
 * GET /api/leaderboard
 * Query params:
 *   period: 'all' | 'weekly' | 'monthly' (default: 'all')
 *   sort: 'rating' | 'winRate' | 'gamesPlayed' (default: 'rating')
 *   limit: number (default: 20, max: 100)
 */
router.get('/', (req: Request, res: Response) => {
  const period = (req.query.period as string) || 'all';
  const sort = (req.query.sort as string) || 'rating';
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  
  let players = [...allPlayers];
  
  // Filter by period - adjust stats
  if (period === 'weekly') {
    players = players.map(p => ({
      ...p,
      wins: p.weeklyWins,
      losses: p.weeklyLosses,
      gamesPlayed: p.weeklyGames,
      winRate: p.weeklyGames > 0 ? Math.round((p.weeklyWins / p.weeklyGames) * 100 * 10) / 10 : 0,
    }));
  } else if (period === 'monthly') {
    players = players.map(p => ({
      ...p,
      wins: p.monthlyWins,
      losses: p.monthlyLosses,
      gamesPlayed: p.monthlyGames,
      winRate: p.monthlyGames > 0 ? Math.round((p.monthlyWins / p.monthlyGames) * 100 * 10) / 10 : 0,
    }));
  }
  
  // Sort
  players.sort((a, b) => {
    switch (sort) {
      case 'winRate':
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        return b.gamesPlayed - a.gamesPlayed;
      case 'gamesPlayed':
        return b.gamesPlayed - a.gamesPlayed;
      case 'rating':
      default:
        return b.rating - a.rating;
    }
  });
  
  // Add rank
  const ranked = players.slice(0, limit).map((p, i) => ({
    rank: i + 1,
    ...p,
  }));
  
  res.json({
    period,
    sort,
    total: players.length,
    players: ranked,
  });
});

/**
 * GET /api/leaderboard/preview
 * Returns top 5 for lobby preview
 */
router.get('/preview', (req: Request, res: Response) => {
  const sorted = [...allPlayers].sort((a, b) => b.rating - a.rating);
  const top5 = sorted.slice(0, 5).map((p, i) => ({
    rank: i + 1,
    id: p.id,
    username: p.username,
    avatar: p.avatar,
    rating: p.rating,
    wins: p.wins,
    losses: p.losses,
    winRate: p.winRate,
  }));
  
  res.json({ players: top5 });
});

export default router;
