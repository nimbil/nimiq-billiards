/**
 * Security Service - Comprehensive protection against attacks
 * 
 * Handles:
 * - Rate limiting (per-player, per-action)
 * - Nonce-based replay protection
 * - Idempotent settlement (payouts never happen twice)
 * - Input validation and sanitization
 * - Session management
 * - Suspicious activity detection
 * - Double settlement prevention
 */

import { createHash, randomBytes } from 'crypto';
import Redis from 'ioredis';

// ============================================
// Types
// ============================================

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterMs: number;
}

export interface NonceValidation {
  valid: boolean;
  error?: string;
}

export interface SettlementIdempotencyKey {
  matchId: string;
  winnerId: string;
  loserId: string;
  tierId: string;
}

export interface SettlementRecord {
  id: string;
  matchId: string;
  winnerId: string;
  loserId: string;
  tierId: string;
  entryFee: number;
  winnerPrize: number;
  platformFee: number;
  state: 'pending' | 'processing' | 'completed' | 'failed';
  idempotencyKey: string;
  createdAt: number;
  completedAt?: number;
  payoutTxHash?: string;
  error?: string;
}

export interface SuspiciousActivity {
  timestamp: number;
  playerId: string;
  type: string;
  details: Record<string, unknown>;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// ============================================
// Security Service
// ============================================

export class SecurityService {
  private redis: Redis;
  
  // Rate limiting keys
  private readonly RATE_LIMIT_PREFIX = 'ratelimit:';
  private readonly RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
  
  // Nonce keys
  private readonly NONCE_PREFIX = 'nonce:';
  private readonly NONCE_EXPIRY_MS = 300000; // 5 minutes
  
  // Idempotency keys for settlement
  private readonly IDEMPOTENCY_PREFIX = 'settlement:idempotency:';
  private readonly IDEMPOTENCY_EXPIRY_MS = 86400000; // 24 hours
  
  // Settlement records
  private readonly SETTLEMENT_PREFIX = 'settlement:record:';
  private readonly SETTLEMENT_EXPIRY_MS = 2592000000; // 30 days
  
  // Session keys
  private readonly SESSION_PREFIX = 'session:';
  private readonly SESSION_EXPIRY_MS = 3600000; // 1 hour
  
  // Suspicious activity
  private readonly SUSPICIOUS_PREFIX = 'suspicious:';
  private readonly SUSPICIOUS_EXPIRY_MS = 86400000; // 24 hours
  
  // Rate limit configurations
  private readonly RATE_LIMITS = {
    shot: { maxPerMinute: 30, maxPerSecond: 2 },
    joinQueue: { maxPerMinute: 5, maxPerSecond: 1 },
    leaveQueue: { maxPerMinute: 10, maxPerSecond: 2 },
    reconnect: { maxPerMinute: 10, maxPerSecond: 1 },
    shoot: { maxPerMinute: 30, maxPerSecond: 2 },
    placeCueBall: { maxPerMinute: 20, maxPerSecond: 2 },
    rematch: { maxPerMinute: 5, maxPerSecond: 1 },
    default: { maxPerMinute: 100, maxPerSecond: 10 },
  };

  constructor(redis: Redis) {
    this.redis = redis;
  }

  // ============================================
  // Rate Limiting
  // ============================================

  /**
   * Check rate limit for an action
   * Uses sliding window counter with Redis
   */
  async checkRateLimit(
    playerId: string,
    action: string
  ): Promise<RateLimitResult> {
    const limits = this.RATE_LIMITS[action as keyof typeof this.RATE_LIMITS] || this.RATE_LIMITS.default;
    const now = Date.now();
    const windowStart = now - this.RATE_LIMIT_WINDOW_MS;
    
    const key = `${this.RATE_LIMIT_PREFIX}${playerId}:${action}`;
    
    // Use Redis pipeline for atomicity
    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart); // Remove old entries
    pipeline.zadd(key, now, `${now}:${randomBytes(4).toString('hex')}`);
    pipeline.zcard(key);
    pipeline.expire(key, Math.ceil(this.RATE_LIMIT_WINDOW_MS / 1000));
    
    const results = await pipeline.exec();
    const count = results![2][1] as number;
    
    const allowed = count <= limits.maxPerMinute;
    const retryAfterMs = allowed ? 0 : this.RATE_LIMIT_WINDOW_MS - (now - windowStart);
    
    if (!allowed) {
      await this.logSuspiciousActivity(playerId, 'RATE_LIMIT_EXCEEDED', {
        action,
        count,
        max: limits.maxPerMinute,
      }, 'medium');
    }
    
    return { allowed, count, retryAfterMs };
  }

  /**
   * Check per-second rate limit (stricter)
   */
  async checkPerSecondLimit(
    playerId: string,
    action: string
  ): Promise<RateLimitResult> {
    const limits = this.RATE_LIMITS[action as keyof typeof this.RATE_LIMITS] || this.RATE_LIMITS.default;
    const now = Date.now();
    const secondStart = now - 1000;
    
    const key = `${this.RATE_LIMIT_PREFIX}${playerId}:${action}:sec`;
    
    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(key, 0, secondStart);
    pipeline.zadd(key, now, `${now}:${randomBytes(4).toString('hex')}`);
    pipeline.zcard(key);
    pipeline.expire(key, 2);
    
    const results = await pipeline.exec();
    const count = results![2][1] as number;
    
    const allowed = count <= limits.maxPerSecond;
    const retryAfterMs = allowed ? 0 : 1000 - (now - secondStart);
    
    return { allowed, count, retryAfterMs };
  }

  // ============================================
  // Nonce-based Replay Protection
  // ============================================

  /**
   * Validate and consume a nonce
   * Returns false if nonce was already used (replay attack)
   */
  async validateNonce(
    playerId: string,
    nonce: string
  ): Promise<NonceValidation> {
    if (!nonce || typeof nonce !== 'string' || nonce.length < 8) {
      return { valid: false, error: 'Invalid nonce format' };
    }
    
    const key = `${this.NONCE_PREFIX}${playerId}:${nonce}`;
    
    // Try to set the nonce with NX (only if not exists)
    const result = await this.redis.set(key, '1', 'EX', Math.ceil(this.NONCE_EXPIRY_MS / 1000), 'NX');
    
    if (result === null) {
      // Nonce already exists - replay detected
      await this.logSuspiciousActivity(playerId, 'NONCE_REUSE', {
        nonce,
      }, 'high');
      
      return { valid: false, error: 'Nonce already used (replay detected)' };
    }
    
    return { valid: true };
  }

  /**
   * Generate a nonce for client use
   */
  generateNonce(): string {
    return randomBytes(16).toString('hex');
  }

  // ============================================
  // Idempotent Settlement
  // ============================================

  /**
   * Generate idempotency key for a settlement
   * This ensures the same settlement cannot be processed twice
   */
  generateIdempotencyKey(params: SettlementIdempotencyKey): string {
    const data = `${params.matchId}:${params.winnerId}:${params.loserId}:${params.tierId}`;
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Check if settlement has already been processed
   * Returns the existing settlement if found, null otherwise
   */
  async checkSettlementIdempotency(
    idempotencyKey: string
  ): Promise<SettlementRecord | null> {
    const key = `${this.IDEMPOTENCY_PREFIX}${idempotencyKey}`;
    const data = await this.redis.get(key);
    
    if (!data) {
      return null;
    }
    
    try {
      return JSON.parse(data) as SettlementRecord;
    } catch {
      return null;
    }
  }

  /**
   * Acquire settlement lock
   * Uses Redis SET NX to prevent race conditions
   * Returns true if lock acquired, false if already locked
   */
  async acquireSettlementLock(
    idempotencyKey: string,
    ttlMs: number = 30000
  ): Promise<boolean> {
    const lockKey = `${this.IDEMPOTENCY_PREFIX}${idempotencyKey}:lock`;
    const result = await this.redis.set(
      lockKey,
      '1',
      'EX',
      Math.ceil(ttlMs / 1000),
      'NX'
    );
    
    return result === 'OK';
  }

  /**
   * Release settlement lock
   */
  async releaseSettlementLock(idempotencyKey: string): Promise<void> {
    const lockKey = `${this.IDEMPOTENCY_PREFIX}${idempotencyKey}:lock`;
    await this.redis.del(lockKey);
  }

  /**
   * Record settlement as processing
   * This is the first step of idempotent settlement
   */
  async recordSettlementProcessing(
    record: SettlementRecord
  ): Promise<boolean> {
    const key = `${this.IDEMPOTENCY_PREFIX}${record.idempotencyKey}`;
    const settlementKey = `${this.SETTLEMENT_PREFIX}${record.id}`;
    
    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(record), 'EX', Math.ceil(this.IDEMPOTENCY_EXPIRY_MS / 1000));
    pipeline.set(settlementKey, JSON.stringify(record), 'EX', Math.ceil(this.SETTLEMENT_EXPIRY_MS / 1000));
    
    await pipeline.exec();
    return true;
  }

  /**
   * Update settlement record
   */
  async updateSettlementRecord(
    idempotencyKey: string,
    updates: Partial<SettlementRecord>
  ): Promise<void> {
    const key = `${this.IDEMPOTENCY_PREFIX}${idempotencyKey}`;
    const existing = await this.redis.get(key);
    
    if (!existing) {
      throw new Error('Settlement record not found');
    }
    
    const record = JSON.parse(existing) as SettlementRecord;
    const updated = { ...record, ...updates, completedAt: updates.state === 'completed' ? Date.now() : record.completedAt };
    
    await this.redis.set(key, JSON.stringify(updated), 'EX', Math.ceil(this.IDEMPOTENCY_EXPIRY_MS / 1000));
    
    // Also update the settlement record
    const settlementKey = `${this.SETTLEMENT_PREFIX}${record.id}`;
    await this.redis.set(settlementKey, JSON.stringify(updated), 'EX', Math.ceil(this.SETTLEMENT_EXPIRY_MS / 1000));
  }

  /**
   * Get settlement record by match ID
   */
  async getSettlementByMatchId(matchId: string): Promise<SettlementRecord | null> {
    // Search through settlement records
    const pattern = `${this.SETTLEMENT_PREFIX}*`;
    const keys = await this.redis.keys(pattern);
    
    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const record = JSON.parse(data) as SettlementRecord;
        if (record.matchId === matchId) {
          return record;
        }
      }
    }
    
    return null;
  }

  // ============================================
  // Input Validation
  // ============================================

  /**
   * Validate player ID format
   */
  validatePlayerId(playerId: string): boolean {
    return typeof playerId === 'string' && /^[a-zA-Z0-9]{8,64}$/.test(playerId);
  }

  /**
   * Validate match ID format
   */
  validateMatchId(matchId: string): boolean {
    return typeof matchId === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(matchId);
  }

  /**
   * Validate wallet address format (Nimiq)
   */
  validateWalletAddress(address: string): boolean {
    // Nimiq addresses start with NQ and are 40 characters
    return typeof address === 'string' && /^NQ[0-9A-Z]{38}$/.test(address);
  }

  /**
   * Validate transaction hash
   */
  validateTxHash(hash: string): boolean {
    return typeof hash === 'string' && /^[a-fA-F0-9]{64}$/.test(hash);
  }

  /**
   * Sanitize string input
   */
  sanitizeString(input: string, maxLength: number = 100): string {
    if (typeof input !== 'string') return '';
    return input
      .replace(/[<>]/g, '') // Remove HTML tags
      .replace(/['"`]/g, '') // Remove quotes
      .trim()
      .slice(0, maxLength);
  }

  /**
   * Validate shot parameters
   */
  validateShotParams(angle: number, power: number): { valid: boolean; error?: string } {
    if (typeof angle !== 'number' || isNaN(angle)) {
      return { valid: false, error: 'Invalid angle' };
    }
    if (typeof power !== 'number' || isNaN(power)) {
      return { valid: false, error: 'Invalid power' };
    }
    if (angle < -Math.PI || angle > Math.PI) {
      return { valid: false, error: 'Angle out of range' };
    }
    if (power < 0 || power > 1) {
      return { valid: false, error: 'Power out of range' };
    }
    return { valid: true };
  }

  // ============================================
  // Session Management
  // ============================================

  /**
   * Create a new session
   */
  async createSession(playerId: string): Promise<string> {
    const sessionId = randomBytes(32).toString('hex');
    const key = `${this.SESSION_PREFIX}${sessionId}`;
    
    const session = {
      playerId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    
    await this.redis.set(key, JSON.stringify(session), 'EX', Math.ceil(this.SESSION_EXPIRY_MS / 1000));
    
    return sessionId;
  }

  /**
   * Validate and refresh session
   */
  async validateSession(sessionId: string): Promise<{ valid: boolean; playerId?: string }> {
    if (!sessionId) {
      return { valid: false };
    }
    
    const key = `${this.SESSION_PREFIX}${sessionId}`;
    const data = await this.redis.get(key);
    
    if (!data) {
      return { valid: false };
    }
    
    try {
      const session = JSON.parse(data);
      
      // Check if session expired (inactive for too long)
      if (Date.now() - session.lastActivity > this.SESSION_EXPIRY_MS) {
        await this.redis.del(key);
        return { valid: false };
      }
      
      // Refresh session
      session.lastActivity = Date.now();
      await this.redis.set(key, JSON.stringify(session), 'EX', Math.ceil(this.SESSION_EXPIRY_MS / 1000));
      
      return { valid: true, playerId: session.playerId };
    } catch {
      return { valid: false };
    }
  }

  /**
   * Destroy session
   */
  async destroySession(sessionId: string): Promise<void> {
    const key = `${this.SESSION_PREFIX}${sessionId}`;
    await this.redis.del(key);
  }

  // ============================================
  // Suspicious Activity Detection
  // ============================================

  /**
   * Log suspicious activity
   */
  async logSuspiciousActivity(
    playerId: string,
    type: string,
    details: Record<string, unknown>,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ): Promise<void> {
    const activity: SuspiciousActivity = {
      timestamp: Date.now(),
      playerId,
      type,
      details,
      severity,
    };
    
    const key = `${this.SUSPICIOUS_PREFIX}${playerId}:${Date.now()}`;
    await this.redis.set(key, JSON.stringify(activity), 'EX', Math.ceil(this.SUSPICIOUS_EXPIRY_MS / 1000));
    
    // If critical, also flag the player
    if (severity === 'critical') {
      await this.flagPlayer(playerId, 'CRITICAL_SUSPICIOUS_ACTIVITY');
    }
  }

  /**
   * Flag a player for suspicious activity
   */
  async flagPlayer(playerId: string, reason: string): Promise<void> {
    const key = `flagged:${playerId}`;
    await this.redis.set(key, JSON.stringify({
      reason,
      flaggedAt: Date.now(),
    }), 'EX', Math.ceil(3600000 / 1000)); // 1 hour
  }

  /**
   * Check if player is flagged
   */
  async isPlayerFlagged(playerId: string): Promise<boolean> {
    const key = `flagged:${playerId}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * Get suspicious activity for a player
   */
  async getPlayerSuspiciousActivity(playerId: string): Promise<SuspiciousActivity[]> {
    const pattern = `${this.SUSPICIOUS_PREFIX}${playerId}:*`;
    const keys = await this.redis.keys(pattern);
    
    const activities: SuspiciousActivity[] = [];
    
    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        activities.push(JSON.parse(data));
      }
    }
    
    return activities.sort((a, b) => b.timestamp - a.timestamp);
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Cleanup expired data
   */
  async cleanup(): Promise<void> {
    // Cleanup is handled by Redis TTL
    // But we can manually cleanup if needed
    const now = Date.now();
    
    // Cleanup old rate limits
    const rateLimitPattern = `${this.RATE_LIMIT_PREFIX}*`;
    const rateLimitKeys = await this.redis.keys(rateLimitPattern);
    
    for (const key of rateLimitKeys) {
      const ttl = await this.redis.ttl(key);
      if (ttl <= 0) {
        await this.redis.del(key);
      }
    }
  }
}

export default SecurityService;
