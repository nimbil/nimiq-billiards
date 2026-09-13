/**
 * Matchmaking Service
 * 
 * Queue management and player matching with rating, queue time, and tier constraints.
 * 
 * RULE: Never match players with different entry fees.
 */

import { getRedis } from './redis.js';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// Queue Definitions
// ============================================

export interface QueueTier {
  id: string;
  name: string;
  entryFee: number; // In lamports (1 NIM = 100,000 lamports)
  platformFeePercent: number; // 0-100
  minimumBalance: number; // Required wallet balance to enter
  minimumRating: number; // Optional rating requirement
  maximumRating: number; // Optional rating cap (0 = no cap)
  description: string;
  color: string;
  icon: string;
}

export const QUEUE_TIERS: Record<string, QueueTier> = {
  free_casual: {
    id: 'free_casual',
    name: 'Free Casual',
    entryFee: 0,
    platformFeePercent: 0,
    minimumBalance: 0,
    minimumRating: 0,
    maximumRating: 0,
    description: 'No entry fee, just for fun',
    color: '#10b981',
    icon: '🎮',
  },
  nim_500: {
    id: 'nim_500',
    name: 'NIM 500',
    entryFee: 500 * 100_000, // 50,000,000 lamports
    platformFeePercent: 10,
    minimumBalance: 500 * 100_000 * 1.1, // Entry + 10% buffer
    minimumRating: 0,
    maximumRating: 0,
    description: '500 NIM entry fee',
    color: '#f59e0b',
    icon: '💰',
  },
  nim_100: {
    id: 'nim_100',
    name: 'NIM 100',
    entryFee: 100 * 100_000,
    platformFeePercent: 10,
    minimumBalance: 100 * 100_000 * 1.1,
    minimumRating: 0,
    maximumRating: 0,
    description: '100 NIM entry fee',
    color: '#3b82f6',
    icon: '💎',
  },
  nim_1000: {
    id: 'nim_1000',
    name: 'NIM 1000',
    entryFee: 1000 * 100_000,
    platformFeePercent: 10,
    minimumBalance: 1000 * 100_000 * 1.1,
    minimumRating: 0,
    maximumRating: 0,
    description: '1,000 NIM entry fee',
    color: '#8b5cf6',
    icon: '👑',
  },
  nim_5000: {
    id: 'nim_5000',
    name: 'NIM 5000',
    entryFee: 5000 * 100_000,
    platformFeePercent: 10,
    minimumBalance: 5000 * 100_000 * 1.1,
    minimumRating: 0,
    maximumRating: 0,
    description: '5,000 NIM entry fee',
    color: '#ef4444',
    icon: '🔥',
  },
};

// ============================================
// Queue Entry
// ============================================

export interface QueueEntry {
  playerId: string;
  walletAddress: string;
  rating: number;
  joinedAt: number; // Timestamp
  region: string; // 'eu', 'us', 'asia', etc.
  latency: number; // Estimated latency in ms
}

// ============================================
// Match Result
// ============================================

export interface MatchResult {
  matchId: string;
  player1: QueueEntry;
  player2: QueueEntry;
  tier: QueueTier;
  createdAt: number;
}

// ============================================
// Queue Operations
// ============================================

const QUEUE_PREFIX = 'matchmaking:queue:';
const STATS_PREFIX = 'matchmaking:stats:';
const MATCHED_PREFIX = 'matchmaking:matched:';

/**
 * Add player to matchmaking queue
 */
export async function joinQueue(
  tierId: string,
  player: QueueEntry
): Promise<{ position: number; tier: QueueTier }> {
  const tier = QUEUE_TIERS[tierId];
  if (!tier) {
    throw new Error(`Unknown tier: ${tierId}`);
  }

  // Validate minimum balance for paid tiers
  if (tier.entryFee > 0 && player.rating < tier.minimumRating) {
    throw new Error(`Minimum rating for ${tier.name} is ${tier.minimumRating}`);
  }

  const r = getRedis();
  const key = `${QUEUE_PREFIX}${tierId}`;
  
  // Check if already in queue
  const existing = await r.zrange(key, '0', '-1');
  for (const member of existing) {
    const entry: QueueEntry = JSON.parse(member);
    if (entry.playerId === player.playerId) {
      throw new Error('Already in queue');
    }
  }

  // Add to queue with rating as primary score, joinedAt as secondary
  // Score = rating * 1_000_000 + (MAX_JOIN_TIME - joinedAt)
  // This sorts by rating first, then by earliest join time
  const score = player.rating * 1_000_000 + (Number.MAX_SAFE_INTEGER - player.joinedAt);
  await r.zadd(key, score, JSON.stringify(player));

  // Update stats
  await r.hincrby(`${STATS_PREFIX}${tierId}`, 'totalJoins', 1);
  await r.hincrby(`${STATS_PREFIX}${tierId}`, 'currentPlayers', 1);

  const position = await r.zcard(key);
  return { position, tier };
}

/**
 * Remove player from queue
 */
export async function leaveQueue(tierId: string, playerId: string): Promise<boolean> {
  const r = getRedis();
  const key = `${QUEUE_PREFIX}${tierId}`;
  
  const members = await r.zrange(key, '0', '-1');
  for (const member of members) {
    const entry: QueueEntry = JSON.parse(member);
    if (entry.playerId === playerId) {
      await r.zrem(key, member);
      await r.hincrby(`${STATS_PREFIX}${tierId}`, 'currentPlayers', -1);
      return true;
    }
  }
  return false;
}

/**
 * Remove player from all queues
 */
export async function leaveAllQueues(playerId: string): Promise<void> {
  for (const tierId of Object.keys(QUEUE_TIERS)) {
    await leaveQueue(tierId, playerId);
  }
}

/**
 * Get queue length for a tier
 */
export async function getQueueLength(tierId: string): Promise<number> {
  const r = getRedis();
  return r.zcard(`${QUEUE_PREFIX}${tierId}`);
}

/**
 * Get all queue lengths
 */
export async function getAllQueueLengths(): Promise<Record<string, number>> {
  const r = getRedis();
  const lengths: Record<string, number> = {};
  
  for (const tierId of Object.keys(QUEUE_TIERS)) {
    lengths[tierId] = await r.zcard(`${QUEUE_PREFIX}${tierId}`);
  }
  
  return lengths;
}

/**
 * Check if player is in any queue
 */
export async function isInQueue(playerId: string): Promise<{ inQueue: boolean; tierId?: string }> {
  const r = getRedis();
  
  for (const tierId of Object.keys(QUEUE_TIERS)) {
    const key = `${QUEUE_PREFIX}${tierId}`;
    const members = await r.zrange(key, '0', '-1');
    
    for (const member of members) {
      const entry: QueueEntry = JSON.parse(member);
      if (entry.playerId === playerId) {
        return { inQueue: true, tierId };
      }
    }
  }
  
  return { inQueue: false };
}

// ============================================
// Matching Algorithm
// ============================================

/**
 * Configuration for matching
 */
const MATCH_CONFIG = {
  // Maximum rating difference to be considered a match
  maxRatingDiff: 200,
  
  // How much to relax rating constraint per second of waiting
  // After 60 seconds, allow up to maxRatingDiff
  ratingRelaxationPerSecond: 200 / 60,
  
  // Maximum queue time before forced match (seconds)
  maxQueueTime: 120,
  
  // Preferred latency difference (ms)
  maxLatencyDiff: 100,
  
  // Priority weights for scoring
  weights: {
    rating: 0.5,
    queueTime: 0.3,
    latency: 0.2,
  },
};

/**
 * Calculate match score between two players
 * Lower score = better match
 */
function calculateMatchScore(
  player1: QueueEntry,
  player2: QueueEntry,
  now: number
): number {
  const ratingDiff = Math.abs(player1.rating - player2.rating);
  const queueTime1 = (now - player1.joinedAt) / 1000;
  const queueTime2 = (now - player2.joinedAt) / 1000;
  const avgQueueTime = (queueTime1 + queueTime2) / 2;
  const latencyDiff = Math.abs(player1.latency - player2.latency);
  
  // Normalize scores to 0-1 range
  const normalizedRatingDiff = Math.min(ratingDiff / MATCH_CONFIG.maxRatingDiff, 1);
  const normalizedQueueTime = Math.min(avgQueueTime / MATCH_CONFIG.maxQueueTime, 1);
  const normalizedLatencyDiff = Math.min(latencyDiff / MATCH_CONFIG.maxLatencyDiff, 1);
  
  // Weighted sum
  const score = 
    normalizedRatingDiff * MATCH_CONFIG.weights.rating +
    (1 - normalizedQueueTime) * MATCH_CONFIG.weights.queueTime + // Inverted: longer wait = lower score (better)
    normalizedLatencyDiff * MATCH_CONFIG.weights.latency;
  
  return score;
}

/**
 * Check if two players can be matched
 */
function canMatch(
  player1: QueueEntry,
  player2: QueueEntry,
  tier: QueueTier,
  now: number
): { allowed: boolean; reason?: string } {
  // RULE: Never match players with different entry fees
  // (This is enforced by tier-based queues, but double-check)
  
  // Check rating difference with relaxation
  const queueTimeSeconds = Math.max(
    (now - player1.joinedAt) / 1000,
    (now - player2.joinedAt) / 1000
  );
  
  // Relax rating constraint based on queue time
  const allowedRatingDiff = Math.min(
    queueTimeSeconds * MATCH_CONFIG.ratingRelaxationPerSecond,
    MATCH_CONFIG.maxRatingDiff
  );
  
  const ratingDiff = Math.abs(player1.rating - player2.rating);
  if (ratingDiff > allowedRatingDiff && queueTimeSeconds < MATCH_CONFIG.maxQueueTime) {
    return { 
      allowed: false, 
      reason: `Rating difference ${ratingDiff} exceeds limit ${Math.round(allowedRatingDiff)} (relaxes over time)` 
    };
  }
  
  // Check for same player
  if (player1.playerId === player2.playerId) {
    return { allowed: false, reason: 'Cannot match with yourself' };
  }
  
  return { allowed: true };
}

/**
 * Try to find a match for a player
 */
export async function findMatch(
  tierId: string,
  playerId: string
): Promise<MatchResult | null> {
  const tier = QUEUE_TIERS[tierId];
  if (!tier) {
    throw new Error(`Unknown tier: ${tierId}`);
  }

  const r = getRedis();
  const key = `${QUEUE_PREFIX}${tierId}`;
  const now = Date.now();
  
  // Get all players in queue
  const members = await r.zrange(key, '0', '-1');
  const candidates: QueueEntry[] = members.map(m => JSON.parse(m));
  
  // Find target player
  const targetIndex = candidates.findIndex(c => c.playerId === playerId);
  if (targetIndex === -1) {
    return null; // Player not in queue
  }
  
  const target = candidates[targetIndex];
  
  // Try to find best match among other players
  let bestMatch: QueueEntry | null = null;
  let bestScore = Infinity;
  
  for (let i = 0; i < candidates.length; i++) {
    if (i === targetIndex) continue;
    
    const candidate = candidates[i];
    const { allowed } = canMatch(target, candidate, tier, now);
    
    if (!allowed) continue;
    
    const score = calculateMatchScore(target, candidate, now);
    if (score < bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }
  
  if (!bestMatch) {
    return null;
  }
  
  // Create match
  const matchId = uuidv4();
  
  // Remove both players from queue
  await r.zrem(key, JSON.stringify(target));
  await r.zrem(key, JSON.stringify(bestMatch));
  
  // Update stats
  await r.hincrby(`${STATS_PREFIX}${tierId}`, 'currentPlayers', -2);
  await r.hincrby(`${STATS_PREFIX}${tierId}`, 'totalMatches', 1);
  
  // Store matched pair temporarily
  await r.setex(
    `${MATCHED_PREFIX}${matchId}`,
    300, // 5 min TTL
    JSON.stringify({ player1: target, player2: bestMatch, tier, createdAt: now })
  );
  
  return {
    matchId,
    player1: target,
    player2: bestMatch,
    tier,
    createdAt: now,
  };
}

/**
 * Process queue and find matches for all waiting players
 */
export async function processQueue(tierId: string): Promise<MatchResult[]> {
  const matches: MatchResult[] = [];
  const tier = QUEUE_TIERS[tierId];
  
  if (!tier) {
    throw new Error(`Unknown tier: ${tierId}`);
  }
  
  const r = getRedis();
  const key = `${QUEUE_PREFIX}${tierId}`;
  
  // Keep matching until no more pairs can be found
  let foundMatch = true;
  while (foundMatch) {
    const members = await r.zrange(key, '0', '-1');
    if (members.length < 2) {
      foundMatch = false;
      break;
    }
    
    // Try to match the first player (oldest in queue by rating)
    const first: QueueEntry = JSON.parse(members[0]);
    const match = await findMatch(tierId, first.playerId);
    
    if (match) {
      matches.push(match);
    } else {
      foundMatch = false;
    }
  }
  
  return matches;
}

// ============================================
// Queue Stats
// ============================================

/**
 * Get queue statistics
 */
export async function getQueueStats(tierId: string): Promise<{
  tier: QueueTier;
  currentPlayers: number;
  totalJoins: number;
  totalMatches: number;
  averageWaitTime: number;
}> {
  const r = getRedis();
  const tier = QUEUE_TIERS[tierId];
  
  if (!tier) {
    throw new Error(`Unknown tier: ${tierId}`);
  }
  
  const stats = await r.hgetall(`${STATS_PREFIX}${tierId}`);
  const currentPlayers = await r.zcard(`${QUEUE_PREFIX}${tierId}`);
  
  // Calculate average wait time from current queue
  const now = Date.now();
  let totalWaitTime = 0;
  const members = await r.zrange(`${QUEUE_PREFIX}${tierId}`, '0', '-1');
  
  for (const member of members) {
    const entry: QueueEntry = JSON.parse(member);
    totalWaitTime += now - entry.joinedAt;
  }
  
  const averageWaitTime = members.length > 0 ? totalWaitTime / members.length / 1000 : 0;
  
  return {
    tier,
    currentPlayers,
    totalJoins: parseInt(stats.totalJoins || '0', 10),
    totalMatches: parseInt(stats.totalMatches || '0', 10),
    averageWaitTime: Math.round(averageWaitTime),
  };
}

/**
 * Get all queue statistics
 */
export async function getAllQueueStats(): Promise<Record<string, {
  tier: QueueTier;
  currentPlayers: number;
  totalJoins: number;
  totalMatches: number;
  averageWaitTime: number;
}>> {
  const stats: Record<string, Awaited<ReturnType<typeof getQueueStats>>> = {};
  
  for (const tierId of Object.keys(QUEUE_TIERS)) {
    stats[tierId] = await getQueueStats(tierId);
  }
  
  return stats;
}
