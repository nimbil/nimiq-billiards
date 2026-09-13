/**
 * Redis Service
 * 
 * Handles:
 * - Matchmaking queues
 * - Player presence
 * - Temporary match state
 * - Rate limiting
 * - Pub/Sub for real-time events
 */

import Redis from 'ioredis';
import { config } from '../config/index.js';

let redis: Redis | null = null;
let redisSub: Redis | null = null;
let redisPub: Redis | null = null;
let redisAvailable = false;

/**
 * Initialize Redis connection
 */
export async function initRedis(): Promise<Redis> {
  if (redis) return redis;

  // Test if Redis is reachable first
  const testConn = new Redis(config.redis.url, {
    connectTimeout: 2000,
    retryStrategy: () => null,
    maxRetriesPerRequest: 0,
  });

  await new Promise<void>((resolve, reject) => {
    testConn.on('connect', () => { testConn.disconnect(); resolve(); });
    testConn.on('error', () => { testConn.disconnect(); reject(new Error('Redis unreachable')); });
    setTimeout(() => { testConn.disconnect(); reject(new Error('Redis timeout')); }, 2500);
  });

  // Redis is reachable, create real connections
  redis = new Redis(config.redis.url, {
    maxRetriesPerRequest: config.redis.maxRetries,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * config.redis.retryDelay, 5000);
    },
    connectTimeout: 3000,
  });

  redisSub = new Redis(config.redis.url, {
    maxRetriesPerRequest: config.redis.maxRetries,
    retryStrategy(times) { if (times > 3) return null; return Math.min(times * config.redis.retryDelay, 5000); },
    connectTimeout: 3000,
  });
  redisPub = new Redis(config.redis.url, {
    maxRetriesPerRequest: config.redis.maxRetries,
    retryStrategy(times) { if (times > 3) return null; return Math.min(times * config.redis.retryDelay, 5000); },
    connectTimeout: 3000,
  });

  redis.on('connect', () => console.log('[REDIS] Connected'));
  redis.on('error', () => {});
  redisSub.on('error', () => {});
  redisPub.on('error', () => {});

  redisAvailable = true;
  return redis;
}

/**
 * Get Redis instance (returns null if not available)
 */
export function getRedis(): Redis | null {
  return redis;
}

/**
 * Get Redis instance or throw
 */
export function requireRedis(): Redis {
  if (!redis) throw new Error('Redis not initialized');
  return redis;
}

/**
 * Get pub/sub instances
 */
export function getRedisPub(): Redis {
  if (!redisPub) throw new Error('Redis pub not initialized');
  return redisPub;
}

export function getRedisSub(): Redis {
  if (!redisSub) throw new Error('Redis sub not initialized');
  return redisSub;
}

/**
 * Close Redis connections
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
  if (redisSub) {
    await redisSub.quit();
    redisSub = null;
  }
  if (redisPub) {
    await redisPub.quit();
    redisPub = null;
  }
  console.log('[REDIS] Connections closed');
}

// ============================================
// Matchmaking Queue Operations
// ============================================

const QUEUE_PREFIX = 'queue:';
const MATCH_PREFIX = 'match:';
const PLAYER_PREFIX = 'player:';
const RATE_LIMIT_PREFIX = 'ratelimit:';
const PRESENCE_PREFIX = 'presence:';

/**
 * Add player to matchmaking queue
 */
export async function addToQueue(tierId: string, playerId: string, data: Record<string, unknown>): Promise<number> {
  const r = getRedis();
  const key = `${QUEUE_PREFIX}${tierId}`;
  const score = Date.now(); // Use timestamp as score for FIFO
  await r.zadd(key, score, JSON.stringify({ playerId, ...data }));
  return r.zcard(key);
}

/**
 * Get next player from queue
 */
export async function getNextFromQueue(tierId: string): Promise<Record<string, unknown> | null> {
  const r = getRedis();
  const key = `${QUEUE_PREFIX}${tierId}`;
  const results = await r.zrange(key, '0', '0', 'WITHSCORES');
  if (results.length === 0) return null;
  
  const data = JSON.parse(results[0]);
  await r.zrem(key, results[0]);
  return data;
}

/**
 * Remove player from queue
 */
export async function removeFromQueue(tierId: string, playerId: string): Promise<number> {
  const r = getRedis();
  const key = `${QUEUE_PREFIX}${tierId}`;
  
  // Find and remove player
  const members = await r.zrange(key, '0', '-1');
  for (const member of members) {
    const data = JSON.parse(member);
    if (data.playerId === playerId) {
      return r.zrem(key, member);
    }
  }
  return 0;
}

/**
 * Get queue length
 */
export async function getQueueLength(tierId: string): Promise<number> {
  const r = getRedis();
  return r.zcard(`${QUEUE_PREFIX}${tierId}`);
}

// ============================================
// Match State Operations
// ============================================

/**
 * Store match state (temporary)
 */
export async function setMatchState(matchId: string, state: Record<string, unknown>, ttlSeconds: number = 3600): Promise<void> {
  const r = getRedis();
  const key = `${MATCH_PREFIX}${matchId}`;
  await r.setex(key, ttlSeconds, JSON.stringify(state));
}

/**
 * Get match state
 */
export async function getMatchState(matchId: string): Promise<Record<string, unknown> | null> {
  const r = getRedis();
  const key = `${MATCH_PREFIX}${matchId}`;
  const data = await r.get(key);
  return data ? JSON.parse(data) : null;
}

/**
 * Update match state field
 */
export async function updateMatchField(matchId: string, field: string, value: unknown): Promise<void> {
  const r = getRedis();
  const key = `${MATCH_PREFIX}${matchId}`;
  const state = await getMatchState(matchId);
  if (state) {
    state[field] = value;
    await r.setex(key, 3600, JSON.stringify(state));
  }
}

/**
 * Delete match state
 */
export async function deleteMatchState(matchId: string): Promise<void> {
  const r = getRedis();
  await r.del(`${MATCH_PREFIX}${matchId}`);
}

// ============================================
// Player Presence Operations
// ============================================

/**
 * Set player online
 */
export async function setPlayerOnline(playerId: string, data: Record<string, unknown>): Promise<void> {
  const r = getRedis();
  const key = `${PRESENCE_PREFIX}${playerId}`;
  await r.setex(key, 300, JSON.stringify({ ...data, lastSeen: Date.now() })); // 5 min TTL
}

/**
 * Update player presence
 */
export async function updatePlayerPresence(playerId: string, data: Record<string, unknown>): Promise<void> {
  const r = getRedis();
  const key = `${PRESENCE_PREFIX}${playerId}`;
  const existing = await r.get(key);
  if (existing) {
    const current = JSON.parse(existing);
    await r.setex(key, 300, JSON.stringify({ ...current, ...data, lastSeen: Date.now() }));
  }
}

/**
 * Set player offline
 */
export async function setPlayerOffline(playerId: string): Promise<void> {
  const r = getRedis();
  await r.del(`${PRESENCE_PREFIX}${playerId}`);
}

/**
 * Check if player is online
 */
export async function isPlayerOnline(playerId: string): Promise<boolean> {
  const r = getRedis();
  const exists = await r.exists(`${PRESENCE_PREFIX}${playerId}`);
  return exists === 1;
}

/**
 * Get all online players
 */
export async function getOnlinePlayers(): Promise<string[]> {
  const r = getRedis();
  const keys = await r.keys(`${PRESENCE_PREFIX}*`);
  return keys.map(k => k.replace(PRESENCE_PREFIX, ''));
}

// ============================================
// Rate Limiting Operations
// ============================================

/**
 * Check and increment rate limit
 * Returns true if allowed, false if exceeded
 */
export async function checkRateLimit(
  playerId: string, 
  action: string, 
  maxRequests: number, 
  windowMs: number
): Promise<{ allowed: boolean; count: number; retryAfterMs: number }> {
  const r = getRedis();
  const key = `${RATE_LIMIT_PREFIX}${playerId}:${action}`;
  const now = Date.now();
  const windowStart = now - windowMs;

  // Use Redis pipeline for atomicity
  const pipeline = r.pipeline();
  pipeline.zremrangebyscore(key, 0, windowStart); // Remove old entries
  pipeline.zadd(key, now, `${now}`);
  pipeline.zcard(key);
  pipeline.pexpire(key, windowMs);
  
  const results = await pipeline.exec();
  const count = results![2][1] as number;

  return {
    allowed: count <= maxRequests,
    count,
    retryAfterMs: count > maxRequests ? windowMs - (now - windowStart) : 0,
  };
}

/**
 * Get rate limit count
 */
export async function getRateLimitCount(playerId: string, action: string): Promise<number> {
  const r = getRedis();
  const key = `${RATE_LIMIT_PREFIX}${playerId}:${action}`;
  return r.zcard(key);
}

// ============================================
// Pub/Sub Operations
// ============================================

/**
 * Subscribe to channel
 */
export async function subscribe(channel: string, callback: (message: string) => void): Promise<void> {
  const sub = getRedisSub();
  await sub.subscribe(channel);
  sub.on('message', (ch, msg) => {
    if (ch === channel) callback(msg);
  });
}

/**
 * Publish message
 */
export async function publish(channel: string, message: string): Promise<void> {
  const pub = getRedisPub();
  await pub.publish(channel, message);
}
