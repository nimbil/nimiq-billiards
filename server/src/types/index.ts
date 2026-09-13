/**
 * Server Type Definitions
 */

import { WebSocket } from 'ws';

// ============================================
// User & Wallet Types
// ============================================

export interface User {
  id: string;
  walletAddress: string;
  publicKey: string | null;
  username: string | null;
  email: string | null;
  isActive: boolean;
  isBanned: boolean;
  banReason: string | null;
  lastLoginAt: Date | null;
  lastActiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Wallet {
  id: string;
  userId: string;
  address: string;
  publicKey: string | null;
  balance: number;
  pendingBalance: number;
  network: string;
  isVerified: boolean;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Player Types
// ============================================

export interface PlayerProfile {
  id: string;
  userId: string;
  nickname: string;
  avatar: string | null;
  wins: number;
  losses: number;
  gamesPlayed: number;
  rating: number;
  peakRating: number;
  currentStreak: number;
  longestWinStreak: number;
  longestLoseStreak: number;
  totalWinnings: number;
  totalLosses: number;
  level: number;
  experience: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Player {
  id: string;
  ws: WebSocket;
  name: string;
  avatar: string;
  inQueue: boolean;
  currentMatch: GameMatch | null;
  nimAddress: string | null;
  connected: boolean;
  disconnectedAt: number;
  competitiveTier: string | null;
  nonce: string;
}

export interface PlayerStats {
  wins: number;
  losses: number;
  gamesPlayed: number;
  streak: number;
  totalWinnings: number;
  totalLosses: number;
}

export interface PlayerData {
  id: string;
  walletAddress: string | null;
  username: string;
  avatar: string;
  stats: PlayerStats;
  balance: number;
}

// ============================================
// Ball Types
// ============================================

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pocketed: boolean;
  stationary?: boolean;
  spinX?: number;
  spinY?: number;
  spinZ?: number;
}

// ============================================
// Game Types
// ============================================

export interface GameState {
  turn: number;
  state: string;
  player1Type: string;
  player2Type: string;
  foul: boolean;
  foulType: string | null;
  foulReason: string;
  winner: number | null;
  winReason: string;
}

export interface ShotData {
  angle: number;
  power: number;
  spin?: {
    side?: number;
    top?: number;
    bottom?: number;
  };
}

// ============================================
// Match Types
// ============================================

export type MatchMode = 'free' | 'competitive' | 'ranked' | 'tournament';
export type MatchStatus = 
  | 'created'
  | 'waiting'
  | 'starting'
  | 'in_progress'
  | 'finished'
  | 'cancelled'
  | 'disputed';

export interface Match {
  id: string;
  mode: MatchMode;
  tierId: string | null;
  status: MatchStatus;
  entryFee: number;
  prizeAmount: number;
  platformFee: number;
  currency: string;
  player1Id: string;
  player2Id: string | null;
  winnerId: string | null;
  loserId: string | null;
  totalShots: number | null;
  turnCount: number | null;
  winnerBy: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  duration: number | null;
  metadata: Record<string, unknown> | null;
}

export interface MatchPlayer {
  id: string;
  matchId: string;
  userId: string;
  playerNumber: number;
  assignedGroup: string | null;
  shotsTaken: number;
  ballsPocketed: number;
  fouls: number;
  result: string | null;
  ratingChange: number | null;
  connectedAt: Date;
  disconnectedAt: Date | null;
  createdAt: Date;
}

export type MatchEvent = 'player_joined' | 'player_left' | 'shot_taken' | 'ball_pocketed' | 'foul_committed' | 'turn_changed' | 'game_over' | 'disconnection' | 'reconnection' | 'state_update';

export interface MatchEventRecord {
  id: string;
  matchId: string;
  userId: string | null;
  eventType: string;
  sequence: number;
  data: Record<string, unknown>;
  previousHash: string | null;
  hash: string;
  timestamp: Date;
  createdAt: Date;
}

export interface MatchConfig {
  matchType: MatchMode;
  tierId?: string;
  tier?: TierConfig;
}

export interface GameMatch {
  id: string;
  player1: Player;
  player2: Player;
  matchType: MatchMode;
  tierId: string | null;
  state: MatchStatus;
  balls: Ball[];
  rules: GameState;
  shotInProgress: boolean;
  createdAt: number;
  lastActive: number;
  rematchVotes: Set<string>;
  physicsInterval: NodeJS.Timeout | null;
  turnTimeoutId: NodeJS.Timeout | null;
  matchTimer: NodeJS.Timeout | null;
}

// ============================================
// Tier Types
// ============================================

export interface TierConfig {
  id: string;
  name: string;
  entryFee: number;
  platformFeePercent: number;
  minimumBalance: number;
  description: string;
  color: string;
  icon: string;
}

export interface PrizeCalculation {
  entryFee: number;
  totalPot: number;
  platformFee: number;
  winnerPrize: number;
}

// ============================================
// Transaction Types
// ============================================

export type TransactionType = 'deposit' | 'withdrawal' | 'entry_fee' | 'prize_payout' | 'platform_fee' | 'refund';
export type TransactionStatus = 'pending' | 'confirmed' | 'failed' | 'cancelled';

export interface Transaction {
  id: string;
  userId: string;
  matchId: string | null;
  type: TransactionType;
  amount: number;
  currency: string;
  blockchainTxHash: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  status: TransactionStatus;
  statusMessage: string | null;
  networkFee: number;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt: Date | null;
  failedAt: Date | null;
}

// ============================================
// Settlement Types
// ============================================

export type SettlementStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'disputed';

export interface Settlement {
  id: string;
  matchId: string;
  winnerId: string;
  loserId: string;
  entryFeeTotal: number;
  platformFee: number;
  winnerPrize: number;
  currency: string;
  status: SettlementStatus;
  payoutTxId: string | null;
  feeTxId: string | null;
  payoutTxHash: string | null;
  createdAt: Date;
  processedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
}

// ============================================
// Player Stats Types
// ============================================

export interface PlayerStatsRecord {
  id: string;
  userId: string;
  totalGames: number;
  totalWins: number;
  totalLosses: number;
  winRate: number;
  freeGames: number;
  freeWins: number;
  competitiveGames: number;
  competitiveWins: number;
  rankedGames: number;
  rankedWins: number;
  bronzeGames: number;
  bronzeWins: number;
  silverGames: number;
  silverWins: number;
  goldGames: number;
  goldWins: number;
  diamondGames: number;
  diamondWins: number;
  totalShots: number;
  totalBallsPocketed: number;
  totalFouls: number;
  totalScratches: number;
  eightBallPockets: number;
  breakWins: number;
  totalWinnings: number;
  totalSpent: number;
  netProfit: number;
  currentWinStreak: number;
  longestWinStreak: number;
  currentLoseStreak: number;
  longestLoseStreak: number;
  rating: number;
  peakRating: number;
  ratingHistory: Array<{ date: string; rating: number }> | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Leaderboard Types
// ============================================

export type LeaderboardPeriod = 'daily' | 'weekly' | 'monthly' | 'all_time';

export interface Leaderboard {
  id: string;
  period: LeaderboardPeriod;
  periodStart: Date;
  periodEnd: Date | null;
  userId: string;
  rank: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
  winRate: number;
  winnings: number;
  ratingChange: number;
  rating: number;
  isCurrent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Audit Log Types
// ============================================

export type AuditCategory = 'auth' | 'game' | 'payment' | 'security';
export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface AuditLog {
  id: string;
  userId: string | null;
  action: string;
  category: AuditCategory;
  details: Record<string, unknown> | null;
  severity: AuditSeverity;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

// ============================================
// WebSocket Message Types
// ============================================

export type ClientMessage =
  | { type: 'reconnect'; matchId: string }
  | { type: 'setName'; name: string }
  | { type: 'joinQueue'; matchType: MatchMode; tierId?: string }
  | { type: 'leaveQueue' }
  | { type: 'shoot'; angle: number; power: number }
  | { type: 'placeCueBall'; x: number; y: number }
  | { type: 'rematch' }
  | { type: 'setNimAddress'; address: string };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; playerName: string; avatar: string; stats: PlayerStats; balance: number; nonce: string }
  | { type: 'matchFound'; matchId: string; opponentName: string; opponentAvatar: string; opponentStats: PlayerStats; playerNumber: number; balls: Ball[]; rules: GameState; matchType: MatchMode; tier?: Record<string, unknown>; depositTx?: Transaction; balance?: number }
  | { type: 'reconnected'; matchId: string; balls: Ball[]; rules: GameState; playerNumber: number; opponentName: string; opponentAvatar: string; opponentStats: PlayerStats; matchType: MatchMode; tier?: Record<string, unknown>; balance: number }
  | { type: 'shotExecuted'; angle: number; power: number; playerId: string; balls: Ball[]; rules: GameState }
  | { type: 'serverStateUpdate'; balls: Ball[]; rules: GameState; message?: string }
  | { type: 'cueBallPlaced'; x: number; y: number; playerId: string; balls: Ball[]; rules: GameState }
  | { type: 'shotRejected'; reason: string }
  | { type: 'matchResult'; matchId: string; won: boolean; reason: string; winnerStats: PlayerStats; loserStats: PlayerStats; prize?: Record<string, unknown> }
  | { type: 'opponentDisconnected'; matchId: string; gracePeriodMs: number }
  | { type: 'opponentReconnected'; matchId: string }
  | { type: 'rematchRequest'; matchId: string; from: string }
  | { type: 'rematchStarted'; balls: Ball[]; rules: GameState; message: string }
  | { type: 'queueUpdate'; position: number; tier?: string }
  | { type: 'error'; message: string };

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface HealthResponse {
  status: string;
  players: number;
  matches: number;
  queues: Record<string, number>;
  redis: boolean;
  database: boolean;
}

export interface TierResponse extends TierConfig {
  prize: PrizeCalculation;
  prizeFormatted: string;
}

// ============================================
// Matchmaking Types
// ============================================

export interface QueueTier {
  id: string;
  name: string;
  entryFee: number;
  platformFeePercent: number;
  minimumBalance: number;
  minimumRating: number;
  maximumRating: number;
  description: string;
  color: string;
  icon: string;
}

export interface QueueEntry {
  playerId: string;
  walletAddress: string;
  rating: number;
  joinedAt: number;
  region: string;
  latency: number;
}

export interface MatchResult {
  matchId: string;
  player1: QueueEntry;
  player2: QueueEntry;
  tier: QueueTier;
  createdAt: number;
}

export interface QueueStats {
  tier: QueueTier;
  currentPlayers: number;
  totalJoins: number;
  totalMatches: number;
  averageWaitTime: number;
}
