/**
 * MatchReplayLogger - Records full match data for reconstruction
 * 
 * Every action, state change, and event is logged with:
 * - Timestamp
 * - Sequence number
 * - Player ID
 * - Action type
 * - Input parameters
 * - Resulting state
 * - Hash of previous entry (tamper detection)
 * 
 * This allows complete game reconstruction for:
 * - Dispute resolution
 * - Anti-cheat verification
 * - Game analysis
 * - Legal compliance
 */

import { createHash } from 'crypto';

export class MatchReplayLogger {
  /**
   * @param {string} matchId
   * @param {Object} config - Match configuration
   */
  constructor(matchId, config) {
    this.matchId = matchId;
    this.config = config;
    this.entries = [];
    this.sequence = 0;
    this.previousHash = '0000000000000000'; // Genesis hash
    this.startTime = Date.now();
    this.finalState = null;
  }

  /**
   * Log an entry
   * @param {string} eventType - Type of event
   * @param {string} playerId - Player who caused the event
   * @param {Object} input - Input parameters
   * @param {Object} result - Resulting state
   * @returns {Object} - The logged entry
   */
  log(eventType, playerId, input, result) {
    this.sequence++;

    const entry = {
      seq: this.sequence,
      ts: Date.now(),
      type: eventType,
      pid: playerId,
      input: this._sanitize(input),
      result: this._sanitize(result),
      prevHash: this.previousHash,
      hash: null,
    };

    // Calculate hash for tamper detection
    entry.hash = this._calculateHash(entry);
    this.previousHash = entry.hash;

    this.entries.push(entry);
    return entry;
  }

  /**
   * Log match creation
   */
  logMatchCreated(player1Id, player2Id, tier) {
    return this.log('MATCH_CREATED', 'SYSTEM', {
      player1: player1Id,
      player2: player2Id,
      tier: tier?.id || 'free',
    }, {
      state: 'created',
      ballCount: 16,
    });
  }

  /**
   * Log shot execution
   */
  logShot(playerId, angle, power, ballsBefore, ballsAfter, rulesBefore, rulesAfter) {
    const pocketed = ballsAfter
      .filter(b => b.pocketed && !ballsBefore.find(bb => bb.id === b.id && bb.pocketed))
      .map(b => b.id);

    return this.log('SHOT', playerId, {
      angle: Math.round(angle * 1000) / 1000,
      power: Math.round(power * 100) / 100,
      cueBallStart: ballsBefore.find(b => b.id === 0),
    }, {
      cueBallEnd: ballsAfter.find(b => b.id === 0),
      pocketed,
      turn: rulesAfter.turn,
      state: rulesAfter.state,
      foul: rulesAfter.foul,
      foulReason: rulesAfter.foulReason || null,
    });
  }

  /**
   * Log cue ball placement
   */
  logCueBallPlacement(playerId, x, y, balls) {
    return this.log('CUE_BALL_PLACEMENT', playerId, { x, y }, {
      cueBall: balls.find(b => b.id === 0),
    });
  }

  /**
   * Log foul
   */
  logFoul(playerId, reason, rulesState) {
    return this.log('FOUL', playerId, { reason }, {
      rules: rulesState,
    });
  }

  /**
   * Log turn change
   */
  logTurnChange(fromPlayer, toPlayer, reason) {
    return this.log('TURN_CHANGE', 'SYSTEM', {
      from: fromPlayer,
      to: toPlayer,
      reason,
    }, {});
  }

  /**
   * Log match end
   */
  logMatchEnd(winnerId, loserId, reason) {
    this.finalState = {
      winnerId,
      loserId,
      reason,
      endTime: Date.now(),
      duration: Date.now() - this.startTime,
      totalShots: this.entries.filter(e => e.type === 'SHOT').length,
      totalFouls: this.entries.filter(e => e.type === 'FOUL').length,
    };

    return this.log('MATCH_END', 'SYSTEM', {
      winnerId,
      loserId,
      reason,
    }, this.finalState);
  }

  /**
   * Log settlement
   */
  logSettlement(winnerId, loserId, amount, txHash) {
    return this.log('SETTLEMENT', 'SYSTEM', {
      winnerId,
      loserId,
      amount,
      txHash,
    }, {
      settled: true,
    });
  }

  /**
   * Log disconnect
   */
  logDisconnect(playerId, gracePeriodMs) {
    return this.log('DISCONNECT', playerId, {
      gracePeriodMs,
    }, {
      disconnected: true,
    });
  }

  /**
   * Log reconnection
   */
  logReconnect(playerId) {
    return this.log('RECONNECT', playerId, {}, {
      reconnected: true,
    });
  }

  /**
   * Log suspicious activity
   */
  logSuspiciousActivity(playerId, reason, details) {
    return this.log('SUSPICIOUS', playerId, {
      reason,
      details,
    }, {
      flagged: true,
    });
  }

  /**
   * Calculate hash for entry
   * @private
   */
  _calculateHash(entry) {
    const data = JSON.stringify({
      seq: entry.seq,
      ts: entry.ts,
      type: entry.type,
      pid: entry.pid,
      input: entry.input,
      result: entry.result,
      prevHash: entry.prevHash,
    });
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  /**
   * Sanitize data for logging (remove circular refs, etc)
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
   * Get full replay data
   */
  getReplay() {
    return {
      matchId: this.matchId,
      config: this.config,
      startTime: this.startTime,
      endTime: this.finalState?.endTime || null,
      duration: this.finalState?.duration || (Date.now() - this.startTime),
      entryCount: this.entries.length,
      finalState: this.finalState,
      entries: [...this.entries],
    };
  }

  /**
   * Get summary for storage
   */
  getSummary() {
    return {
      matchId: this.matchId,
      config: this.config,
      startTime: this.startTime,
      endTime: this.finalState?.endTime || null,
      duration: this.finalState?.duration || 0,
      totalShots: this.entries.filter(e => e.type === 'SHOT').length,
      totalFouls: this.entries.filter(e => e.type === 'FOUL').length,
      finalState: this.finalState,
      entryCount: this.entries.length,
      lastHash: this.previousHash,
    };
  }

  /**
   * Verify replay integrity
   * @returns {{ valid: boolean, errors: string[] }}
   */
  verifyIntegrity() {
    const errors = [];
    let expectedPrevHash = '0000000000000000';

    for (const entry of this.entries) {
      if (entry.prevHash !== expectedPrevHash) {
        errors.push(`Entry ${entry.seq}: prevHash mismatch`);
      }

      const expectedHash = this._calculateHash({ ...entry, hash: null });
      if (entry.hash !== expectedHash) {
        errors.push(`Entry ${entry.seq}: hash mismatch`);
      }

      expectedPrevHash = entry.hash;
    }

    return { valid: errors.length === 0, errors };
  }
}

export default MatchReplayLogger;
