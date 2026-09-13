/**
 * SecurityMiddleware - Rate limiting, nonce tracking, suspicious activity
 * 
 * Handles:
 * - Per-player rate limiting
 * - Nonce-based replay protection
 * - Suspicious activity detection and logging
 * - Action audit trail
 */

import { createHash } from 'crypto';

/**
 * Suspicious activity types
 */
export const SUSPICIOUS_TYPES = {
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  NONCE_REUSE: 'NONCE_REUSE',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  RAPID_ACTIONS: 'RAPID_ACTIONS',
  IMPOSSIBLE_ACTION: 'IMPOSSIBLE_ACTION',
  STATE_MISMATCH: 'STATE_MISMATCH',
  BALANCE_TAMPER: 'BALANCE_TAMPER',
  TIMING_ANOMALY: 'TIMING_ANOMALY',
};

export class SecurityMiddleware {
  constructor() {
    // Rate limiting: playerId -> { action: { count, windowStart } }
    this.rateLimits = new Map();
    
    // Nonce tracking: playerId -> Set of used nonces
    this.nonces = new Map();
    
    // Suspicious activity log
    this.suspiciousLog = [];
    
    // Action audit: playerId -> recent actions
    this.actionAudit = new Map();
    
    // Timing tracking: playerId -> last action timestamp
    this.lastActionTime = new Map();
    
    // Config
    this.rateLimitWindowMs = 60000; // 1 minute
    this.maxActionsPerMinute = 100;
    this.maxShotsPerMinute = 30;
    this.maxRapidActionMs = 100; // Minimum time between actions
    this.nonceExpirationMs = 300000; // 5 minutes
  }

  /**
   * Check rate limit for an action
   * @param {string} playerId
   * @param {string} action
   * @param {number} [maxPerMinute] - Override default limit
   * @returns {{ allowed: boolean, retryAfterMs?: number }}
   */
  checkRateLimit(playerId, action, maxPerMinute) {
    const now = Date.now();
    const key = `${playerId}:${action}`;
    
    if (!this.rateLimits.has(key)) {
      this.rateLimits.set(key, { count: 1, windowStart: now });
      return { allowed: true };
    }
    
    const limit = this.rateLimits.get(key);
    
    // Reset window if expired
    if (now - limit.windowStart > this.rateLimitWindowMs) {
      limit.count = 1;
      limit.windowStart = now;
      return { allowed: true };
    }
    
    limit.count++;
    
    const max = maxPerMinute || (action === 'shot' ? this.maxShotsPerMinute : this.maxActionsPerMinute);
    
    if (limit.count > max) {
      const retryAfterMs = this.rateLimitWindowMs - (now - limit.windowStart);
      this._logSuspicious(playerId, SUSPICIOUS_TYPES.RATE_LIMIT_EXCEEDED, {
        action,
        count: limit.count,
        max,
        retryAfterMs,
      });
      return { allowed: false, retryAfterMs };
    }
    
    return { allowed: true };
  }

  /**
   * Check for rapid actions (timing anomaly)
   * @param {string} playerId
   * @param {string} action
   * @returns {{ allowed: boolean, gapMs: number }}
   */
  checkTiming(playerId, action) {
    const now = Date.now();
    const key = `${playerId}:${action}`;
    
    if (this.lastActionTime.has(key)) {
      const lastTime = this.lastActionTime.get(key);
      const gapMs = now - lastTime;
      
      if (gapMs < this.maxRapidActionMs) {
        this._logSuspicious(playerId, SUSPICIOUS_TYPES.TIMING_ANOMALY, {
          action,
          gapMs,
          minGapMs: this.maxRapidActionMs,
        });
        return { allowed: false, gapMs };
      }
    }
    
    this.lastActionTime.set(key, now);
    return { allowed: true, gapMs: 0 };
  }

  /**
   * Validate nonce for replay protection
   * @param {string} playerId
   * @param {string} nonce
   * @returns {{ valid: boolean, error?: string }}
   */
  validateNonce(playerId, nonce) {
    if (!nonce || typeof nonce !== 'string') {
      return { valid: false, error: 'Missing or invalid nonce' };
    }
    
    if (!this.nonces.has(playerId)) {
      this.nonces.set(playerId, new Map());
    }
    
    const playerNonces = this.nonces.get(playerId);
    
    // Check if nonce was already used
    if (playerNonces.has(nonce)) {
      this._logSuspicious(playerId, SUSPICIOUS_TYPES.NONCE_REUSE, {
        nonce,
        originalUse: playerNonces.get(nonce),
      });
      return { valid: false, error: 'Nonce already used (replay detected)' };
    }
    
    // Record nonce with expiration
    playerNonces.set(nonce, Date.now());
    
    // Cleanup expired nonces periodically
    this._cleanupNonces(playerId);
    
    return { valid: true };
  }

  /**
   * Generate a nonce for client use
   * @param {string} playerId
   * @returns {string}
   */
  generateNonce(playerId) {
    const data = `${playerId}:${Date.now()}:${Math.random()}`;
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  /**
   * Log an action for audit
   * @param {string} playerId
   * @param {string} action
   * @param {Object} details
   */
  auditAction(playerId, action, details) {
    if (!this.actionAudit.has(playerId)) {
      this.actionAudit.set(playerId, []);
    }
    
    const audit = this.actionAudit.get(playerId);
    audit.push({
      ts: Date.now(),
      action,
      details: this._sanitize(details),
    });
    
    // Keep only last 100 actions
    if (audit.length > 100) {
      audit.splice(0, audit.length - 100);
    }
  }

  /**
   * Log suspicious activity
   * @param {string} playerId
   * @param {string} type
   * @param {Object} details
   */
  _logSuspicious(playerId, type, details) {
    const entry = {
      ts: Date.now(),
      playerId,
      type,
      details,
    };
    
    this.suspiciousLog.push(entry);
    
    // Keep only last 1000 entries
    if (this.suspiciousLog.length > 1000) {
      this.suspiciousLog.splice(0, this.suspiciousLog.length - 1000);
    }
    
    console.warn(`[SECURITY] Suspicious: ${type} from ${playerId}`, details);
  }

  /**
   * Get suspicious activity for a player
   */
  getPlayerSuspicious(playerId) {
    return this.suspiciousLog.filter(e => e.playerId === playerId);
  }

  /**
   * Get all suspicious activity
   */
  getAllSuspicious() {
    return [...this.suspiciousLog];
  }

  /**
   * Get action audit for a player
   */
  getPlayerAudit(playerId) {
    return this.actionAudit.get(playerId) || [];
  }

  /**
   * Check if player is flagged for suspicious activity
   */
  isPlayerFlagged(playerId) {
    const recent = this.suspiciousLog.filter(
      e => e.playerId === playerId && Date.now() - e.ts < 300000 // Last 5 minutes
    );
    return recent.length >= 3; // 3+ suspicious events in 5 minutes
  }

  /**
   * Cleanup expired nonces
   * @private
   */
  _cleanupNonces(playerId) {
    if (!this.nonces.has(playerId)) return;
    
    const playerNonces = this.nonces.get(playerId);
    const now = Date.now();
    
    for (const [nonce, timestamp] of playerNonces.entries()) {
      if (now - timestamp > this.nonceExpirationMs) {
        playerNonces.delete(nonce);
      }
    }
  }

  /**
   * Sanitize data for logging
   * @private
   */
  _sanitize(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    
    const seen = new WeakSet();
    return JSON.parse(JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    }));
  }

  /**
   * Cleanup old rate limits
   */
  cleanup() {
    const now = Date.now();
    
    for (const [key, limit] of this.rateLimits.entries()) {
      if (now - limit.windowStart > this.rateLimitWindowMs * 2) {
        this.rateLimits.delete(key);
      }
    }
    
    for (const [key, timestamp] of this.lastActionTime.entries()) {
      if (now - timestamp > this.rateLimitWindowMs * 2) {
        this.lastActionTime.delete(key);
      }
    }
  }
}

export default SecurityMiddleware;
