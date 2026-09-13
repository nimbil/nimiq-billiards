/**
 * Database Schema - Drizzle ORM
 * 
 * PostgreSQL schema for Nimiq Billiards.
 * 
 * SECURITY: Never store private wallet credentials.
 * Only public keys and addresses are stored.
 */

import { 
  pgTable, 
  uuid, 
  varchar, 
  integer, 
  bigint, 
  decimal,
  boolean, 
  timestamp, 
  jsonb, 
  index, 
  uniqueIndex,
  text,
  smallint,
  inet
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ============================================
// User - Basic account information
// ============================================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Authentication (wallet-based, no passwords)
  walletAddress: varchar('wallet_address', { length: 64 }).unique().notNull(),
  publicKey: varchar('public_key', { length: 128 }), // Public key for signature verification
  
  // Profile
  username: varchar('username', { length: 32 }).unique(),
  email: varchar('email', { length: 255 }),
  
  // Status
  isActive: boolean('is_active').default(true).notNull(),
  isBanned: boolean('is_banned').default(false).notNull(),
  banReason: varchar('ban_reason', { length: 512 }),
  
  // Metadata
  lastLoginAt: timestamp('last_login_at'),
  lastActiveAt: timestamp('last_active_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  walletAddressIdx: uniqueIndex('idx_users_wallet').on(table.walletAddress),
  usernameIdx: uniqueIndex('idx_users_username').on(table.username),
  emailIdx: index('idx_users_email').on(table.email),
  isActiveIdx: index('idx_users_active').on(table.isActive),
}));

// ============================================
// Wallet - Wallet information (PUBLIC ONLY)
// ============================================

/**
 * SECURITY NOTICE: This table only stores PUBLIC wallet information.
 * 
 * NEVER STORE:
 * - Private keys
 * - Seed phrases
 * - Wallet passwords
 * - Keystore files
 * 
 * ONLY STORE:
 * - Public addresses
 * - Public keys (for signature verification)
 * - Balance information
 */
export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  
  // Public wallet information ONLY
  address: varchar('address', { length: 64 }).unique().notNull(), // Public address
  publicKey: varchar('public_key', { length: 128 }), // Public key (for verification)
  
  // Balance (cached from blockchain)
  balance: bigint('balance', { mode: 'number' }).default(0).notNull(), // In lamports
  pendingBalance: bigint('pending_balance', { mode: 'number' }).default(0).notNull(),
  
  // Network
  network: varchar('network', { length: 16 }).default('testnet').notNull(), // 'mainnet' or 'testnet'
  
  // Status
  isVerified: boolean('is_verified').default(false).notNull(),
  lastSyncedAt: timestamp('last_synced_at'),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('idx_wallets_user').on(table.userId),
  addressIdx: uniqueIndex('idx_wallets_address').on(table.address),
  networkIdx: index('idx_wallets_network').on(table.network),
}));

// ============================================
// PlayerProfile - Game profile and stats
// ============================================

export const playerProfiles = pgTable('player_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).unique().notNull(),
  
  // Display
  nickname: varchar('nickname', { length: 32 }).notNull(),
  avatar: varchar('avatar', { length: 64 }),
  
  // Stats
  wins: integer('wins').default(0).notNull(),
  losses: integer('losses').default(0).notNull(),
  gamesPlayed: integer('games_played').default(0).notNull(),
  
  // Rating (ELO-like)
  rating: integer('rating').default(1000).notNull(),
  peakRating: integer('peak_rating').default(1000).notNull(),
  
  // Streaks
  currentStreak: integer('current_streak').default(0).notNull(),
  longestWinStreak: integer('longest_win_streak').default(0).notNull(),
  longestLoseStreak: integer('longest_lose_streak').default(0).notNull(),
  
  // Financials
  totalWinnings: bigint('total_winnings', { mode: 'number' }).default(0).notNull(),
  totalLosses: bigint('total_losses', { mode: 'number' }).default(0).notNull(),
  
  // Level/Experience
  level: integer('level').default(1).notNull(),
  experience: integer('experience').default(0).notNull(),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('idx_profiles_user').on(table.userId),
  nicknameIdx: uniqueIndex('idx_profiles_nickname').on(table.nickname),
  ratingIdx: index('idx_profiles_rating').on(table.rating),
  winsIdx: index('idx_profiles_wins').on(table.wins),
}));

// ============================================
// Match - Match information
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

export const matches = pgTable('matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Mode
  mode: varchar('mode', { length: 16 }).notNull(), // 'free', 'competitive', 'ranked', 'tournament'
  tierId: varchar('tier_id', { length: 16 }),
  
  // Status
  status: varchar('status', { length: 16 }).default('created').notNull(),
  
  // Financials
  entryFee: bigint('entry_fee', { mode: 'number' }).default(0).notNull(), // In lamports
  prizeAmount: bigint('prize_amount', { mode: 'number' }).default(0).notNull(),
  platformFee: bigint('platform_fee', { mode: 'number' }).default(0).notNull(),
  currency: varchar('currency', { length: 8 }).default('NIM').notNull(),
  
  // Players (denormalized for quick access)
  player1Id: uuid('player1_id').references(() => users.id).notNull(),
  player2Id: uuid('player2_id').references(() => users.id),
  winnerId: uuid('winner_id').references(() => users.id),
  loserId: uuid('loser_id').references(() => users.id),
  
  // Game state
  totalShots: integer('total_shots'),
  turnCount: integer('turn_count'),
  winnerBy: varchar('winner_by', { length: 64 }), // 'legal_8ball', 'opponent_foul', 'timeout', etc.
  
  // Timing
  createdAt: timestamp('created_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  duration: integer('duration'), // milliseconds
  
  // Metadata
  metadata: jsonb('metadata'),
}, (table) => ({
  statusIdx: index('idx_matches_status').on(table.status),
  modeIdx: index('idx_matches_mode').on(table.mode),
  player1Idx: index('idx_matches_player1').on(table.player1Id),
  player2Idx: index('idx_matches_player2').on(table.player2Id),
  winnerIdx: index('idx_matches_winner').on(table.winnerId),
  createdAtIdx: index('idx_matches_created').on(table.createdAt),
}));

// ============================================
// MatchPlayer - Player participation in matches
// ============================================

export const matchPlayers = pgTable('match_players', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchId: uuid('match_id').references(() => matches.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  
  // Player position
  playerNumber: smallint('player_number').notNull(), // 1 or 2
  
  // Ball assignment
  assignedGroup: varchar('assigned_group', { length: 16 }), // 'solids' or 'stripes'
  
  // Match stats
  shotsTaken: integer('shots_taken').default(0).notNull(),
  ballsPocketed: integer('balls_pocketed').default(0).notNull(),
  fouls: integer('fouls').default(0).notNull(),
  
  // Outcome
  result: varchar('result', { length: 8 }), // 'win', 'loss', 'draw'
  ratingChange: integer('rating_change').default(0),
  
  // Connection
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
  disconnectedAt: timestamp('disconnected_at'),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  matchIdx: index('idx_match_players_match').on(table.matchId),
  userIdx: index('idx_match_players_user').on(table.userId),
  matchUserIdx: uniqueIndex('idx_match_players_match_user').on(table.matchId, table.userId),
}));

// ============================================
// MatchEvent - Events during a match (audit log)
// ============================================

export type MatchEventType = 
  | 'player_joined'
  | 'player_left'
  | 'shot_taken'
  | 'ball_pocketed'
  | 'foul_committed'
  | 'turn_changed'
  | 'game_over'
  | 'disconnection'
  | 'reconnection'
  | 'state_update';

export const matchEvents = pgTable('match_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchId: uuid('match_id').references(() => matches.id).notNull(),
  userId: uuid('user_id').references(() => users.id),
  
  // Event info
  eventType: varchar('event_type', { length: 32 }).notNull(),
  sequence: integer('sequence').notNull(), // Order within match
  
  // Event data
  data: jsonb('data').notNull(),
  
  // Integrity
  previousHash: varchar('previous_hash', { length: 64 }),
  hash: varchar('hash', { length: 64 }).notNull(),
  
  // Timing
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  matchIdx: index('idx_match_events_match').on(table.matchId),
  userIdx: index('idx_match_events_user').on(table.userId),
  typeIdx: index('idx_match_events_type').on(table.eventType),
  matchSeqIdx: uniqueIndex('idx_match_events_match_seq').on(table.matchId, table.sequence),
}));

// ============================================
// GameState - Game state snapshots
// ============================================

export const gameStates = pgTable('game_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchId: uuid('match_id').references(() => matches.id).unique().notNull(),
  
  // Ball positions (JSON array)
  balls: jsonb('balls').notNull(),
  
  // Rules state
  turn: integer('turn').default(1).notNull(),
  currentPlayer: smallint('current_player'),
  gameState: varchar('game_state', { length: 32 }).notNull(), // 'aiming', 'shooting', 'ball_in_hand', etc.
  
  // Player types
  player1Group: varchar('player1_group', { length: 16 }), // 'solids' or 'stripes'
  player2Group: varchar('player2_group', { length: 16 }),
  
  // Foul state
  isFoul: boolean('is_foul').default(false).notNull(),
  foulType: varchar('foul_type', { length: 32 }),
  foulReason: text('foul_reason'),
  
  // Shot tracking
  shotCount: integer('shot_count').default(0).notNull(),
  lastShotAngle: decimal('last_shot_angle', { precision: 10, scale: 4 }),
  lastShotPower: decimal('last_shot_power', { precision: 10, scale: 4 }),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  matchIdx: uniqueIndex('idx_game_states_match').on(table.matchId),
}));

// ============================================
// Transaction - Financial transactions
// ============================================

export type TransactionType = 'deposit' | 'withdrawal' | 'entry_fee' | 'prize_payout' | 'platform_fee' | 'refund';
export type TransactionStatus = 'pending' | 'confirmed' | 'failed' | 'cancelled';

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // User
  userId: uuid('user_id').references(() => users.id).notNull(),
  
  // Match reference (optional)
  matchId: uuid('match_id').references(() => matches.id),
  
  // Transaction info
  type: varchar('type', { length: 32 }).notNull(), // 'deposit', 'withdrawal', 'entry_fee', 'prize_payout', etc.
  amount: bigint('amount', { mode: 'number' }).notNull(), // In lamports
  currency: varchar('currency', { length: 8 }).default('NIM').notNull(),
  
  // Blockchain (public info only)
  blockchainTxHash: varchar('blockchain_tx_hash', { length: 128 }), // Public transaction hash
  fromAddress: varchar('from_address', { length: 64 }), // Public address
  toAddress: varchar('to_address', { length: 64 }), // Public address
  
  // Status
  status: varchar('status', { length: 16 }).default('pending').notNull(),
  statusMessage: text('status_message'),
  
  // Fees
  networkFee: bigint('network_fee', { mode: 'number' }).default(0),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at'),
  failedAt: timestamp('failed_at'),
}, (table) => ({
  userIdx: index('idx_transactions_user').on(table.userId),
  matchIdx: index('idx_transactions_match').on(table.matchId),
  typeIdx: index('idx_transactions_type').on(table.type),
  statusIdx: index('idx_transactions_status').on(table.status),
  txHashIdx: index('idx_transactions_tx_hash').on(table.blockchainTxHash),
  createdAtIdx: index('idx_transactions_created').on(table.createdAt),
}));

// ============================================
// Settlement - Prize settlements
// ============================================

export type SettlementStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'disputed';

export const settlements = pgTable('settlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Match
  matchId: uuid('match_id').references(() => matches.id).notNull(),
  
  // Winner
  winnerId: uuid('winner_id').references(() => users.id).notNull(),
  loserId: uuid('loser_id').references(() => users.id).notNull(),
  
  // Financials
  entryFeeTotal: bigint('entry_fee_total', { mode: 'number' }).notNull(),
  platformFee: bigint('platform_fee', { mode: 'number' }).notNull(),
  winnerPrize: bigint('winner_prize', { mode: 'number' }).notNull(),
  currency: varchar('currency', { length: 8 }).default('NIM').notNull(),
  
  // Status
  status: varchar('status', { length: 16 }).default('pending').notNull(),
  
  // Transactions
  payoutTxId: uuid('payout_tx_id').references(() => transactions.id),
  feeTxId: uuid('fee_tx_id').references(() => transactions.id),
  
  // Blockchain
  payoutTxHash: varchar('payout_tx_hash', { length: 128 }),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
  completedAt: timestamp('completed_at'),
  failedAt: timestamp('failed_at'),
}, (table) => ({
  matchIdx: index('idx_settlements_match').on(table.matchId),
  winnerIdx: index('idx_settlements_winner').on(table.winnerId),
  loserIdx: index('idx_settlements_loser').on(table.loserId),
  statusIdx: index('idx_settlements_status').on(table.status),
}));

// ============================================
// PlayerStats - Detailed player statistics
// ============================================

export const playerStats = pgTable('player_stats', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).unique().notNull(),
  
  // Overall stats
  totalGames: integer('total_games').default(0).notNull(),
  totalWins: integer('total_wins').default(0).notNull(),
  totalLosses: integer('total_losses').default(0).notNull(),
  winRate: decimal('win_rate', { precision: 5, scale: 2 }).default('0.00'),
  
  // By mode
  freeGames: integer('free_games').default(0).notNull(),
  freeWins: integer('free_wins').default(0).notNull(),
  competitiveGames: integer('competitive_games').default(0).notNull(),
  competitiveWins: integer('competitive_wins').default(0).notNull(),
  rankedGames: integer('ranked_games').default(0).notNull(),
  rankedWins: integer('ranked_wins').default(0).notNull(),
  
  // By tier
  bronzeGames: integer('bronze_games').default(0).notNull(),
  bronzeWins: integer('bronze_wins').default(0).notNull(),
  silverGames: integer('silver_games').default(0).notNull(),
  silverWins: integer('silver_wins').default(0).notNull(),
  goldGames: integer('gold_games').default(0).notNull(),
  goldWins: integer('gold_wins').default(0).notNull(),
  diamondGames: integer('diamond_games').default(0).notNull(),
  diamondWins: integer('diamond_wins').default(0).notNull(),
  
  // Game stats
  totalShots: integer('total_shots').default(0).notNull(),
  totalBallsPocketed: integer('total_balls_pocketed').default(0).notNull(),
  totalFouls: integer('total_fouls').default(0).notNull(),
  totalScratches: integer('total_scratches').default(0).notNull(),
  eightBallPockets: integer('eight_ball_pockets').default(0).notNull(),
  breakWins: integer('break_wins').default(0).notNull(),
  
  // Financials
  totalWinnings: bigint('total_winnings', { mode: 'number' }).default(0).notNull(),
  totalSpent: bigint('total_spent', { mode: 'number' }).default(0).notNull(),
  netProfit: bigint('net_profit', { mode: 'number' }).default(0).notNull(),
  
  // Streaks
  currentWinStreak: integer('current_win_streak').default(0).notNull(),
  longestWinStreak: integer('longest_win_streak').default(0).notNull(),
  currentLoseStreak: integer('current_lose_streak').default(0).notNull(),
  longestLoseStreak: integer('longest_lose_streak').default(0).notNull(),
  
  // Rating
  rating: integer('rating').default(1000).notNull(),
  peakRating: integer('peak_rating').default(1000).notNull(),
  ratingHistory: jsonb('rating_history'), // Array of recent rating changes
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('idx_player_stats_user').on(table.userId),
  ratingIdx: index('idx_player_stats_rating').on(table.rating),
  winsIdx: index('idx_player_stats_wins').on(table.totalWins),
}));

// ============================================
// Leaderboard - Leaderboard snapshots
// ============================================

export const leaderboards = pgTable('leaderboards', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Time period
  period: varchar('period', { length: 16 }).notNull(), // 'daily', 'weekly', 'monthly', 'all_time'
  periodStart: timestamp('period_start').notNull(),
  periodEnd: timestamp('period_end'),
  
  // Rank info
  userId: uuid('user_id').references(() => users.id).notNull(),
  rank: integer('rank').notNull(),
  
  // Stats for this period
  wins: integer('wins').default(0).notNull(),
  losses: integer('losses').default(0).notNull(),
  gamesPlayed: integer('games_played').default(0).notNull(),
  winRate: decimal('win_rate', { precision: 5, scale: 2 }).default('0.00'),
  winnings: bigint('winnings', { mode: 'number' }).default(0).notNull(),
  ratingChange: integer('rating_change').default(0),
  rating: integer('rating').default(1000).notNull(),
  
  // Snapshot
  isCurrent: boolean('is_current').default(true).notNull(),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  periodIdx: index('idx_leaderboards_period').on(table.period, table.periodStart),
  userIdx: index('idx_leaderboards_user').on(table.userId),
  rankIdx: index('idx_leaderboards_rank').on(table.rank),
  currentIdx: index('idx_leaderboards_current').on(table.isCurrent),
  periodUserIdx: uniqueIndex('idx_leaderboards_period_user').on(table.period, table.periodStart, table.userId),
}));

// ============================================
// AuditLog - Security and activity tracking
// ============================================

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // User
  userId: uuid('user_id').references(() => users.id),
  
  // Action
  action: varchar('action', { length: 64 }).notNull(),
  category: varchar('category', { length: 32 }).notNull(), // 'auth', 'game', 'payment', 'security'
  details: jsonb('details'),
  
  // Severity
  severity: varchar('severity', { length: 16 }).default('info'), // 'info', 'warning', 'error', 'critical'
  
  // Metadata
  ipAddress: inet('ip_address'),
  userAgent: varchar('user_agent', { length: 256 }),
  
  // Timestamp
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('idx_audit_user').on(table.userId),
  actionIdx: index('idx_audit_action').on(table.action),
  categoryIdx: index('idx_audit_category').on(table.category),
  severityIdx: index('idx_audit_severity').on(table.severity),
  createdAtIdx: index('idx_audit_created').on(table.createdAt),
}));
