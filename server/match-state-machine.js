/**
 * MatchStateMachine - Server-side state machine for match lifecycle
 * 
 * Every state transition is validated server-side.
 * The client NEVER dictates state - it requests actions,
 * and the server validates whether those actions are legal
 * in the current state.
 * 
 * State Flow:
 *   CREATED
 *   → WAITING_FOR_PLAYER_1
 *   → WAITING_FOR_PLAYER_2
 *   → PAYMENT_PENDING
 *   → PAYMENTS_CONFIRMED
 *   → MATCH_READY
 *   → MATCH_STARTED
 *   → MATCH_FINISHED
 *   → SETTLEMENT_PENDING
 *   → SETTLEMENT_CONFIRMED
 *   → COMPLETED
 * 
 *   DISPUTED (from any active state)
 *   CANCELLED (from pre-match states)
 *   REFUNDED (after PAYMENTS_CONFIRMED if cancelled)
 */

export const MATCH_STATES = {
  CREATED: 'CREATED',
  WAITING_FOR_PLAYER_1: 'WAITING_FOR_PLAYER_1',
  WAITING_FOR_PLAYER_2: 'WAITING_FOR_PLAYER_2',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENTS_CONFIRMED: 'PAYMENTS_CONFIRMED',
  MATCH_READY: 'MATCH_READY',
  MATCH_STARTED: 'MATCH_STARTED',
  MATCH_FINISHED: 'MATCH_FINISHED',
  SETTLEMENT_PENDING: 'SETTLEMENT_PENDING',
  SETTLEMENT_CONFIRMED: 'SETTLEMENT_CONFIRMED',
  COMPLETED: 'COMPLETED',
  DISPUTED: 'DISPUTED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
};

/**
 * Valid state transitions - server validates against this map
 * Key: current state, Value: array of allowed next states
 */
const VALID_TRANSITIONS = {
  [MATCH_STATES.CREATED]: [
    MATCH_STATES.WAITING_FOR_PLAYER_1,
    MATCH_STATES.CANCELLED,
  ],
  [MATCH_STATES.WAITING_FOR_PLAYER_1]: [
    MATCH_STATES.WAITING_FOR_PLAYER_2,
    MATCH_STATES.CANCELLED,
  ],
  [MATCH_STATES.WAITING_FOR_PLAYER_2]: [
    MATCH_STATES.PAYMENT_PENDING,
    MATCH_STATES.CANCELLED,
  ],
  [MATCH_STATES.PAYMENT_PENDING]: [
    MATCH_STATES.PAYMENTS_CONFIRMED,
    MATCH_STATES.CANCELLED,
    MATCH_STATES.DISPUTED,
  ],
  [MATCH_STATES.PAYMENTS_CONFIRMED]: [
    MATCH_STATES.MATCH_READY,
    MATCH_STATES.REFUNDED,
    MATCH_STATES.DISPUTED,
  ],
  [MATCH_STATES.MATCH_READY]: [
    MATCH_STATES.MATCH_STARTED,
    MATCH_STATES.REFUNDED,
    MATCH_STATES.CANCELLED,
    MATCH_STATES.DISPUTED,
  ],
  [MATCH_STATES.MATCH_STARTED]: [
    MATCH_STATES.MATCH_FINISHED,
    MATCH_STATES.DISPUTED,
  ],
  [MATCH_STATES.MATCH_FINISHED]: [
    MATCH_STATES.SETTLEMENT_PENDING,
    MATCH_STATES.DISPUTED,
  ],
  [MATCH_STATES.SETTLEMENT_PENDING]: [
    MATCH_STATES.SETTLEMENT_CONFIRMED,
    MATCH_STATES.DISPUTED,
  ],
  [MATCH_STATES.SETTLEMENT_CONFIRMED]: [
    MATCH_STATES.COMPLETED,
  ],
  [MATCH_STATES.COMPLETED]: [],
  [MATCH_STATES.DISPUTED]: [],
  [MATCH_STATES.CANCELLED]: [],
  [MATCH_STATES.REFUNDED]: [],
};

/**
 * Reasons for state transitions - logged for audit trail
 */
export const TRANSITION_REASONS = {
  // Created -> Waiting
  MATCH_CREATED: 'MATCH_CREATED',
  PLAYER_JOINED: 'PLAYER_JOINED',
  
  // Waiting -> Payment
  BOTH_PLAYERS_READY: 'BOTH_PLAYERS_READY',
  
  // Payment -> Confirmed
  PAYMENT_VERIFIED: 'PAYMENT_VERIFIED',
  PAYMENT_TIMEOUT: 'PAYMENT_TIMEOUT',
  
  // Confirmed -> Ready
  ESCROW_LOCKED: 'ESCROW_LOCKED',
  
  // Ready -> Started
  GAME_START: 'GAME_START',
  
  // Started -> Finished
  WINNER_DETERMINED: 'WINNER_DETERMINED',
  TIMEOUT: 'TIMEOUT',
  OPPONENT_DISCONNECTED: 'OPPONENT_DISCONNECTED',
  FORFEIT: 'FORFEIT',
  
  // Finished -> Settlement
  SETTLEMENT_INITIATED: 'SETTLEMENT_INITIATED',
  
  // Settlement -> Confirmed
  PAYOUT_SUCCESS: 'PAYOUT_SUCCESS',
  
  // Confirmed -> Completed
  ALL_SETTLED: 'ALL_SETTLED',
  
  // Cancellation/Refund
  PLAYER_CANCELLED: 'PLAYER_CANCELLED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  REFUND_PROCESSED: 'REFUND_PROCESSED',
  
  // Dispute
  DISPUTE_RAISED: 'DISPUTE_RAISED',
  FAULT_DETECTED: 'FAULT_DETECTED',
};

export class MatchStateMachine {
  /**
   * @param {string} matchId
   * @param {Object} config - Match configuration
   * @param {string} config.tierId - Tier ID for competitive matches
   * @param {Object} config.tier - Full tier object
   * @param {string} config.matchType - 'free' or 'competitive'
   */
  constructor(matchId, config) {
    this.matchId = matchId;
    this.state = MATCH_STATES.CREATED;
    this.config = config;
    
    // Player tracking
    this.player1 = null;
    this.player2 = null;
    
    // Payment tracking
    this.payments = {
      player1: { status: 'pending', txHash: null, amount: 0, timestamp: null },
      player2: { status: 'pending', txHash: null, amount: 0, timestamp: null },
    };
    
    // Escrow tracking
    this.escrow = {
      status: 'pending', // pending, locked, released, refunded
      totalPot: 0,
      platformFee: 0,
      winnerPrize: 0,
      lockedAt: null,
      releasedAt: null,
    };
    
    // Settlement tracking
    this.settlement = {
      winnerId: null,
      loserId: null,
      payoutTxHash: null,
      feeTxHash: null,
      settledAt: null,
    };
    
    // Audit trail
    this.history = [];
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    
    // Timeouts
    this.paymentTimeout = null;
    this.matchTimeout = null;
    this.settlementTimeout = null;
  }

  /**
   * Attempt a state transition
   * @param {string} newState - Target state
   * @param {string} reason - Reason for transition
   * @param {Object} data - Additional data for the transition
   * @returns {{ success: boolean, error?: string }}
   */
  transition(newState, reason, data = {}) {
    // Validate transition is allowed
    const allowed = VALID_TRANSITIONS[this.state];
    if (!allowed || !allowed.includes(newState)) {
      const error = `Invalid transition: ${this.state} → ${newState} (reason: ${reason})`;
      console.error(`[MATCH ${this.matchId}] ${error}`);
      return { success: false, error };
    }

    // Record transition in history
    const transitionRecord = {
      from: this.state,
      to: newState,
      reason,
      timestamp: Date.now(),
      data: { ...data },
    };

    // Execute pre-transition logic
    const preResult = this._onPreTransition(this.state, newState, reason, data);
    if (!preResult.success) {
      return preResult;
    }

    // Apply state change
    const oldState = this.state;
    this.state = newState;
    this.updatedAt = Date.now();
    this.history.push(transitionRecord);

    // Execute post-transition logic
    this._onPostTransition(oldState, newState, reason, data);

    console.log(`[MATCH ${this.matchId}] ${oldState} → ${newState} (${reason})`);
    return { success: true };
  }

  /**
   * Pre-transition validation hook
   * @private
   */
  _onPreTransition(from, to, reason, data) {
    switch (to) {
      case MATCH_STATES.WAITING_FOR_PLAYER_1:
        // Must have match config
        if (!this.config || !this.config.tierId) {
          return { success: false, error: 'Missing match configuration' };
        }
        break;

      case MATCH_STATES.WAITING_FOR_PLAYER_2:
        // Player 1 must be set
        if (!this.player1) {
          return { success: false, error: 'Player 1 not assigned' };
        }
        break;

      case MATCH_STATES.PAYMENT_PENDING:
        // Both players must be set
        if (!this.player1 || !this.player2) {
          return { success: false, error: 'Both players not assigned' };
        }
        break;

      case MATCH_STATES.PAYMENTS_CONFIRMED:
        // Both payments must be verified
        if (this.payments.player1.status !== 'verified' ||
            this.payments.player2.status !== 'verified') {
          return { success: false, error: 'Not all payments verified' };
        }
        break;

      case MATCH_STATES.MATCH_READY:
        // Escrow must be locked
        if (this.escrow.status !== 'locked') {
          return { success: false, error: 'Escrow not locked' };
        }
        break;

      case MATCH_STATES.MATCH_STARTED:
        // Must be in MATCH_READY
        if (this.state !== MATCH_STATES.MATCH_READY) {
          return { success: false, error: 'Match not ready to start' };
        }
        break;

      case MATCH_STATES.MATCH_FINISHED:
        // Must have winner determined
        if (!data.winnerId) {
          return { success: false, error: 'No winner specified' };
        }
        break;

      case MATCH_STATES.SETTLEMENT_PENDING:
        // Must have settlement info
        if (!this.settlement.winnerId) {
          return { success: false, error: 'No settlement info' };
        }
        break;

      case MATCH_STATES.SETTLEMENT_CONFIRMED:
        // Payout must be verified
        if (!this.settlement.payoutTxHash) {
          return { success: false, error: 'No payout transaction' };
        }
        break;

      case MATCH_STATES.CANCELLED:
        // Can only cancel from pre-match states
        if (![MATCH_STATES.CREATED, MATCH_STATES.WAITING_FOR_PLAYER_1,
              MATCH_STATES.WAITING_FOR_PLAYER_2, MATCH_STATES.PAYMENT_PENDING,
              MATCH_STATES.MATCH_READY].includes(this.state)) {
          return { success: false, error: 'Cannot cancel from current state' };
        }
        break;

      case MATCH_STATES.REFUNDED:
        // Must have payments to refund
        if (this.payments.player1.status !== 'verified' &&
            this.payments.player2.status !== 'verified') {
          return { success: false, error: 'No payments to refund' };
        }
        break;

      case MATCH_STATES.DISPUTED:
        // Can dispute from any active state
        break;
    }

    return { success: true };
  }

  /**
   * Post-transition logic
   * @private
   */
  _onPostTransition(from, to, reason, data) {
    switch (to) {
      case MATCH_STATES.WAITING_FOR_PLAYER_1:
        // Set up payment timeout (60 seconds to connect wallet)
        this._startPaymentTimeout();
        break;

      case MATCH_STATES.PAYMENT_PENDING:
        // Notify players to pay
        this._startPaymentTimeout();
        break;

      case MATCH_STATES.PAYMENTS_CONFIRMED:
        // Lock escrow
        this.escrow.status = 'locked';
        this.escrow.lockedAt = Date.now();
        this._clearPaymentTimeout();
        break;

      case MATCH_STATES.MATCH_READY:
        // Ready to start - waiting for server to initiate
        break;

      case MATCH_STATES.MATCH_STARTED:
        // Start match timer
        this._startMatchTimer();
        break;

      case MATCH_STATES.MATCH_FINISHED:
        // Prepare settlement
        this.settlement.winnerId = data.winnerId;
        this.settlement.loserId = data.loserId;
        this._clearMatchTimer();
        break;

      case MATCH_STATES.SETTLEMENT_PENDING:
        // Settlement in progress
        this._startSettlementTimeout();
        break;

      case MATCH_STATES.SETTLEMENT_CONFIRMED:
        // Payout done
        this.escrow.status = 'released';
        this.escrow.releasedAt = Date.now();
        this._clearSettlementTimeout();
        break;

      case MATCH_STATES.COMPLETED:
        // All done - schedule cleanup
        this._scheduleCleanup();
        break;

      case MATCH_STATES.CANCELLED:
        // Handle refund if needed
        this._clearAllTimers();
        break;

      case MATCH_STATES.REFUNDED:
        this.escrow.status = 'refunded';
        this._clearAllTimers();
        break;

      case MATCH_STATES.DISPUTED:
        this._clearAllTimers();
        break;
    }
  }

  /**
   * Assign players to the match
   */
  assignPlayer1(playerId) {
    if (this.state !== MATCH_STATES.WAITING_FOR_PLAYER_1) {
      return { success: false, error: 'Cannot assign player 1 in current state' };
    }
    this.player1 = playerId;
    return this.transition(MATCH_STATES.WAITING_FOR_PLAYER_2, TRANSITION_REASONS.PLAYER_JOINED, { playerId });
  }

  assignPlayer2(playerId) {
    if (this.state !== MATCH_STATES.WAITING_FOR_PLAYER_2) {
      return { success: false, error: 'Cannot assign player 2 in current state' };
    }
    this.player2 = playerId;
    return this.transition(MATCH_STATES.PAYMENT_PENDING, TRANSITION_REASONS.BOTH_PLAYERS_READY, { playerId });
  }

  /**
   * Record a payment
   */
  recordPayment(playerId, txHash, amount) {
    if (this.state !== MATCH_STATES.PAYMENT_PENDING) {
      return { success: false, error: 'Not in payment pending state' };
    }

    const isPlayer1 = playerId === this.player1;
    const isPlayer2 = playerId === this.player2;

    if (!isPlayer1 && !isPlayer2) {
      return { success: false, error: 'Unknown player' };
    }

    const paymentKey = isPlayer1 ? 'player1' : 'player2';
    this.payments[paymentKey] = {
      status: 'verified',
      txHash,
      amount,
      timestamp: Date.now(),
    };

    // Check if both payments are in
    if (this.payments.player1.status === 'verified' &&
        this.payments.player2.status === 'verified') {
      return this.transition(MATCH_STATES.PAYMENTS_CONFIRMED, TRANSITION_REASONS.PAYMENT_VERIFIED);
    }

    return { success: true };
  }

  /**
   * Start the match
   */
  startMatch() {
    return this.transition(MATCH_STATES.MATCH_STARTED, TRANSITION_REASONS.GAME_START);
  }

  /**
   * Finish the match with a winner
   */
  finishMatch(winnerId, loserId, reason) {
    return this.transition(MATCH_STATES.MATCH_FINISHED, reason, { winnerId, loserId });
  }

  /**
   * Initiate settlement
   */
  initiateSettlement(winnerId, loserId) {
    this.settlement.winnerId = winnerId;
    this.settlement.loserId = loserId;
    return this.transition(MATCH_STATES.SETTLEMENT_PENDING, TRANSITION_REASONS.SETTLEMENT_INITIATED);
  }

  /**
   * Confirm settlement with payout transaction
   */
  confirmSettlement(payoutTxHash, feeTxHash) {
    this.settlement.payoutTxHash = payoutTxHash;
    this.settlement.feeTxHash = feeTxHash;
    this.settlement.settledAt = Date.now();
    return this.transition(MATCH_STATES.SETTLEMENT_CONFIRMED, TRANSITION_REASONS.PAYOUT_SUCCESS);
  }

  /**
   * Complete the match
   */
  complete() {
    return this.transition(MATCH_STATES.COMPLETED, TRANSITION_REASONS.ALL_SETTLED);
  }

  /**
   * Cancel the match
   */
  cancel(reason) {
    return this.transition(MATCH_STATES.CANCELLED, reason);
  }

  /**
   * Refund payments
   */
  refund(reason) {
    return this.transition(MATCH_STATES.REFUNDED, reason);
  }

  /**
   * Raise a dispute
   */
  dispute(reason) {
    return this.transition(MATCH_STATES.DISPUTED, reason);
  }

  /**
   * Get public data for clients
   */
  getPublicData() {
    return {
      matchId: this.matchId,
      state: this.state,
      config: this.config,
      player1: this.player1,
      player2: this.player2,
      escrow: {
        status: this.escrow.status,
        totalPot: this.escrow.totalPot,
        platformFee: this.escrow.platformFee,
        winnerPrize: this.escrow.winnerPrize,
      },
      settlement: this.settlement.winnerId ? {
        winnerId: this.settlement.winnerId,
        settled: this.state === MATCH_STATES.SETTLEMENT_CONFIRMED || 
                 this.state === MATCH_STATES.COMPLETED,
      } : null,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Get audit trail
   */
  getAuditTrail() {
    return [...this.history];
  }

  // Timeout management
  _startPaymentTimeout() {
    this._clearPaymentTimeout();
    this.paymentTimeout = setTimeout(() => {
      if (this.state === MATCH_STATES.PAYMENT_PENDING) {
        this.transition(MATCH_STATES.CANCELLED, TRANSITION_REASONS.PAYMENT_TIMEOUT);
      }
    }, 60000); // 60 seconds
  }

  _clearPaymentTimeout() {
    if (this.paymentTimeout) {
      clearTimeout(this.paymentTimeout);
      this.paymentTimeout = null;
    }
  }

  _startMatchTimer() {
    this._clearMatchTimer();
    this.matchTimeout = setTimeout(() => {
      if (this.state === MATCH_STATES.MATCH_STARTED) {
        // Auto-finish with timeout - no winner, both lose
        this.transition(MATCH_STATES.MATCH_FINISHED, TRANSITION_REASONS.TIMEOUT, {
          winnerId: null,
          loserId: null,
        });
      }
    }, 300000); // 5 minutes
  }

  _clearMatchTimer() {
    if (this.matchTimeout) {
      clearTimeout(this.matchTimeout);
      this.matchTimeout = null;
    }
  }

  _startSettlementTimeout() {
    this._clearSettlementTimeout();
    this.settlementTimeout = setTimeout(() => {
      if (this.state === MATCH_STATES.SETTLEMENT_PENDING) {
        // Settlement taking too long - raise dispute
        this.transition(MATCH_STATES.DISPUTED, TRANSITION_REASONS.TIMEOUT);
      }
    }, 120000); // 2 minutes for settlement
  }

  _clearSettlementTimeout() {
    if (this.settlementTimeout) {
      clearTimeout(this.settlementTimeout);
      this.settlementTimeout = null;
    }
  }

  _clearAllTimers() {
    this._clearPaymentTimeout();
    this._clearMatchTimer();
    this._clearSettlementTimeout();
  }

  _scheduleCleanup() {
    // Schedule cleanup after 5 minutes
    setTimeout(() => {
      this.emit('cleanup', this.matchId);
    }, 300000);
  }
}

export default MatchStateMachine;
