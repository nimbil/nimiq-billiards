/**
 * Server-Side Validation Layer
 * 
 * ALL validation happens here. The client is NEVER trusted.
 * Every action request from a client goes through these validators
 * before any state change occurs.
 * 
 * Principles:
 *   1. Client requests actions, server validates and executes
 *   2. All game state changes are server-authoritative
 *   3. Financial operations require cryptographic verification
 *   4. Every validation failure is logged for audit
 */

import { MATCH_STATES, TRANSITION_REASONS } from './match-state-machine.js';

/**
 * Validation error types
 */
export const VALIDATION_ERRORS = {
  INVALID_STATE: 'INVALID_STATE',
  INVALID_PLAYER: 'INVALID_PLAYER',
  INVALID_ACTION: 'INVALID_ACTION',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_TIER: 'INVALID_TIER',
  ALREADY_IN_QUEUE: 'ALREADY_IN_QUEUE',
  ALREADY_IN_MATCH: 'ALREADY_IN_MATCH',
  NOT_IN_MATCH: 'NOT_IN_MATCH',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  INVALID_SHOT: 'INVALID_SHOT',
  TIMEOUT: 'TIMEOUT',
  DUPLICATE_ACTION: 'DUPLICATE_ACTION',
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
};

export class ValidationService {
  constructor() {
    // Rate limiting
    this.actionLimits = new Map(); // playerId -> { action: count }
    this.rateLimitWindow = 60000; // 1 minute
    this.maxActionsPerMinute = 100;

    // Duplicate action tracking
    this.recentActions = new Map(); // playerId -> Set of recent action hashes
  }

  /**
   * Validate a match creation request
   */
  validateMatchCreation(player, tierId, tiers) {
    // Player must be connected
    if (!player || !player.connected) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_PLAYER, message: 'Player not connected' };
    }

    // Player must not be in a match
    if (player.currentMatch) {
      return { valid: false, error: VALIDATION_ERRORS.ALREADY_IN_MATCH, message: 'Already in a match' };
    }

    // Player must not be in queue
    if (player.inQueue) {
      return { valid: false, error: VALIDATION_ERRORS.ALREADY_IN_QUEUE, message: 'Already in queue' };
    }

    // Tier must exist
    if (!tiers[tierId]) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_TIER, message: 'Invalid tier' };
    }

    const tier = tiers[tierId];

    // Player must have wallet address for competitive
    if (!player.nimAddress) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_PLAYER, message: 'Wallet not connected' };
    }

    // Player must have sufficient balance
    if (player.balance < tier.entryFeeLamports) {
      return { valid: false, error: VALIDATION_ERRORS.INSUFFICIENT_BALANCE, 
               message: `Insufficient balance: need ${tier.entryFeeLamports}, have ${player.balance}` };
    }

    // Rate limit check
    const rateLimit = this._checkRateLimit(player.id, 'matchCreation');
    if (!rateLimit.valid) {
      return rateLimit;
    }

    return { valid: true };
  }

  /**
   * Validate a payment submission
   */
  validatePayment(player, match, txHash, amount) {
    // Match must be in payment pending state
    if (match.state !== MATCH_STATES.PAYMENT_PENDING) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_STATE, 
               message: `Match not in payment state: ${match.state}` };
    }

    // Player must be in the match
    if (player.id !== match.player1 && player.id !== match.player2) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_PLAYER, message: 'Not in this match' };
    }

    // Player must not have already paid
    const paymentKey = player.id === match.player1 ? 'player1' : 'player2';
    if (match.payments[paymentKey].status === 'verified') {
      return { valid: false, error: VALIDATION_ERRORS.DUPLICATE_ACTION, message: 'Already paid' };
    }

    // Amount must match entry fee
    if (amount !== match.config.tier.entryFeeLamports) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_AMOUNT,
               message: `Amount mismatch: expected ${match.config.tier.entryFeeLamports}, got ${amount}` };
    }

    // Transaction hash must be provided
    if (!txHash || typeof txHash !== 'string') {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_ACTION, message: 'Invalid transaction hash' };
    }

    // Rate limit check
    const rateLimit = this._checkRateLimit(player.id, 'payment');
    if (!rateLimit.valid) {
      return rateLimit;
    }

    return { valid: true };
  }

  /**
   * Validate a shot request
   */
  validateShot(player, match, angle, power) {
    // Match must be started
    if (match.state !== MATCH_STATES.MATCH_STARTED) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_STATE,
               message: `Match not started: ${match.state}` };
    }

    // Player must be in the match
    if (player.id !== match.player1 && player.id !== match.player2) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_PLAYER, message: 'Not in this match' };
    }

    // It must be player's turn
    if (match.gameState && match.gameState.currentTurn !== player.id) {
      return { valid: false, error: VALIDATION_ERRORS.NOT_YOUR_TURN, message: 'Not your turn' };
    }

    // No shot already in progress
    if (match.shotInProgress) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_STATE, message: 'Shot in progress' };
    }

    // Validate angle (0-360 degrees)
    if (typeof angle !== 'number' || angle < 0 || angle >= 360) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_SHOT, message: 'Invalid angle' };
    }

    // Validate power (1-25)
    if (typeof power !== 'number' || power < 1 || power > 25) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_SHOT, message: 'Invalid power' };
    }

    // Rate limit check (shots should be limited to prevent spam)
    const rateLimit = this._checkRateLimit(player.id, 'shot', 30); // 30 shots per minute max
    if (!rateLimit.valid) {
      return rateLimit;
    }

    return { valid: true };
  }

  /**
   * Validate cue ball placement
   */
  validateCueBallPlacement(player, match, x, y) {
    // Match must be started
    if (match.state !== MATCH_STATES.MATCH_STARTED) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_STATE,
               message: `Match not started: ${match.state}` };
    }

    // Player must be in the match
    if (player.id !== match.player1 && player.id !== match.player2) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_PLAYER, message: 'Not in this match' };
    }

    // Must be in ball-in-hand state
    if (!match.rules || match.rules.state !== 'ball_in_hand') {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_STATE, message: 'Not in ball-in-hand state' };
    }

    // Validate coordinates are within table bounds
    const TABLE_WIDTH = 900;
    const TABLE_HEIGHT = 450;
    const RAIL_WIDTH = 30;
    const BALL_RADIUS = 10;

    if (x < RAIL_WIDTH + BALL_RADIUS || x > TABLE_WIDTH - RAIL_WIDTH - BALL_RADIUS ||
        y < RAIL_WIDTH + BALL_RADIUS || y > TABLE_HEIGHT - RAIL_WIDTH - BALL_RADIUS) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_SHOT, message: 'Placement out of bounds' };
    }

    return { valid: true };
  }

  /**
   * Validate match start
   */
  validateMatchStart(match, player1, player2) {
    // Match must be in MATCH_READY state
    if (match.state !== MATCH_STATES.MATCH_READY) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_STATE,
               message: `Match not ready: ${match.state}` };
    }

    // Both players must be connected
    if (!player1.connected || !player2.connected) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_PLAYER, message: 'Player not connected' };
    }

    // Both players must be in the match
    if (player1.currentMatch?.matchId !== match.matchId ||
        player2.currentMatch?.matchId !== match.matchId) {
      return { valid: false, error: VALIDATION_ERRORS.NOT_IN_MATCH, message: 'Player not in match' };
    }

    return { valid: true };
  }

  /**
   * Validate settlement
   */
  validateSettlement(match, winnerId, loserId) {
    // Match must be finished
    if (match.state !== MATCH_STATES.MATCH_FINISHED) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_STATE,
               message: `Match not finished: ${match.state}` };
    }

    // Winner and loser must be different
    if (winnerId === loserId) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_PLAYER, message: 'Same winner and loser' };
    }

    // Winner must be in the match
    if (winnerId !== match.player1 && winnerId !== match.player2) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_PLAYER, message: 'Winner not in match' };
    }

    // Loser must be in the match
    if (loserId !== match.player1 && loserId !== match.player2) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_PLAYER, message: 'Loser not in match' };
    }

    // Must be competitive match
    if (match.config.matchType === 'free') {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_ACTION, message: 'Free matches not settled' };
    }

    return { valid: true };
  }

  /**
   * Validate rematch request
   */
  validateRematch(player, match) {
    // Match must be finished
    if (match.state !== MATCH_STATES.MATCH_FINISHED) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_STATE,
               message: `Match not finished: ${match.state}` };
    }

    // Player must be in the match
    if (player.id !== match.player1 && player.id !== match.player2) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_PLAYER, message: 'Not in this match' };
    }

    // Player must be connected
    if (!player.connected) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_PLAYER, message: 'Player not connected' };
    }

    // Rate limit check
    const rateLimit = this._checkRateLimit(player.id, 'rematch', 5); // 5 rematch requests per minute
    if (!rateLimit.valid) {
      return rateLimit;
    }

    return { valid: true };
  }

  /**
   * Validate disconnect handling
   */
  validateDisconnect(player, match) {
    // Player must be in the match
    if (player.id !== match.player1 && player.id !== match.player2) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_PLAYER, message: 'Not in this match' };
    }

    // Match must be active
    if (match.state !== MATCH_STATES.MATCH_STARTED && match.state !== MATCH_STATES.MATCH_READY) {
      return { valid: false, error: VALIDATION_ERRORS.INVALID_STATE, message: 'Match not active' };
    }

    return { valid: true };
  }

  /**
   * Check rate limit
   * @private
   */
  _checkRateLimit(playerId, action, maxPerMinute = this.maxActionsPerMinute) {
    const now = Date.now();
    const key = `${playerId}:${action}`;

    if (!this.actionLimits.has(key)) {
      this.actionLimits.set(key, { count: 1, windowStart: now });
      return { valid: true };
    }

    const limit = this.actionLimits.get(key);

    // Reset window if expired
    if (now - limit.windowStart > this.rateLimitWindow) {
      limit.count = 1;
      limit.windowStart = now;
      return { valid: true };
    }

    limit.count++;

    if (limit.count > maxPerMinute) {
      console.warn(`[VALIDATION] Rate limit exceeded: ${playerId} - ${action} (${limit.count}/${maxPerMinute})`);
      return { 
        valid: false, 
        error: VALIDATION_ERRORS.SUSPICIOUS_ACTIVITY, 
        message: `Rate limit exceeded for ${action}` 
      };
    }

    return { valid: true };
  }

  /**
   * Check for duplicate actions
   */
  checkDuplicateAction(playerId, actionHash) {
    if (!this.recentActions.has(playerId)) {
      this.recentActions.set(playerId, new Set());
    }

    const recent = this.recentActions.get(playerId);
    if (recent.has(actionHash)) {
      return true; // Duplicate
    }

    recent.add(actionHash);

    // Clean up old actions after 30 seconds
    setTimeout(() => {
      recent.delete(actionHash);
    }, 30000);

    return false;
  }

  /**
   * Generate action hash for duplicate detection
   */
  generateActionHash(playerId, action, data) {
    const str = `${playerId}:${action}:${JSON.stringify(data)}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * Clear expired rate limits (call periodically)
   */
  cleanupRateLimits() {
    const now = Date.now();
    for (const [key, limit] of this.actionLimits.entries()) {
      if (now - limit.windowStart > this.rateLimitWindow * 2) {
        this.actionLimits.delete(key);
      }
    }
  }
}

export default ValidationService;
