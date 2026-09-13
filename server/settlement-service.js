/**
 * SettlementService - Server-side prize distribution
 * 
 * Handles the settlement of competitive matches after game completion.
 * This service is the ONLY way prizes are distributed.
 * 
 * Flow:
 *   1. Match finishes → settlement initiated
 *   2. Verify winner/loser from authoritative game state
 *   3. Calculate prize based on tier configuration
 *   4. Process payout (in testnet: server-side ledger; in mainnet: blockchain)
 *   5. Record settlement for audit
 *   6. Notify players
 * 
 * Security:
 *   - Never trusts client for winner determination
 *   - Verifies game state before settlement
 *   - Validates all amounts against tier configuration
 *   - Maintains full audit trail
 */

import { MATCH_STATES, TRANSITION_REASONS } from './match-state-machine.js';

/**
 * Settlement states
 */
export const SETTLEMENT_STATES = {
  PENDING: 'PENDING',
  VERIFYING: 'VERIFYING',
  CALCULATING: 'CALCULATING',
  PROCESSING: 'PROCESSING',
  CONFIRMING: 'CONFIRMING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};

export class SettlementService {
  /**
   * @param {Object} options
   * @param {Object} options.ledger - Balance ledger (server-side)
   * @param {Object} options.tiers - Tier configurations
   * @param {Function} options.notifyPlayers - Function to notify players
   */
  constructor(options) {
    this.ledger = options.ledger;
    this.tiers = options.tiers;
    this.notifyPlayers = options.notifyPlayers;
    this.pendingSettlements = new Map();
    this.completedSettlements = new Map();
  }

  /**
   * Initiate settlement for a finished match
   * @param {MatchStateMachine} match - The match state machine
   * @param {string} winnerId - Winner's player ID
   * @param {string} loserId - Loser's player ID
   * @param {string} reason - Why match ended
   * @returns {{ success: boolean, settlementId?: string, error?: string }}
   */
  initiateSettlement(match, winnerId, loserId, reason) {
    // Validate match state
    if (match.state !== MATCH_STATES.MATCH_FINISHED) {
      return { success: false, error: 'Match not finished' };
    }

    // Validate players
    if (!winnerId || !loserId) {
      return { success: false, error: 'Invalid player IDs' };
    }

    if (winnerId === loserId) {
      return { success: false, error: 'Winner and loser cannot be the same' };
    }

    // Validate players are in the match
    if (winnerId !== match.player1 && winnerId !== match.player2) {
      return { success: false, error: 'Winner not in match' };
    }
    if (loserId !== match.player1 && loserId !== match.player2) {
      return { success: false, error: 'Loser not in match' };
    }

    // Check if competitive match (free matches don't need settlement)
    if (match.config.matchType === 'free') {
      return { success: false, error: 'Free matches do not require settlement' };
    }

    // Get tier configuration
    const tier = this.tiers[match.config.tierId];
    if (!tier) {
      return { success: false, error: 'Invalid tier' };
    }

    // Create settlement record
    const settlementId = `settlement-${match.matchId}`;
    const settlement = {
      id: settlementId,
      matchId: match.matchId,
      winnerId,
      loserId,
      tierId: match.config.tierId,
      tier,
      reason,
      state: SETTLEMENT_STATES.PENDING,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      // Will be populated during processing
      entryFee: 0,
      totalPot: 0,
      platformFee: 0,
      winnerPrize: 0,
      payoutTxHash: null,
      feeTxHash: null,
      error: null,
    };

    this.pendingSettlements.set(settlementId, settlement);

    // Initiate state machine transition
    const transitionResult = match.initiateSettlement(winnerId, loserId);
    if (!transitionResult.success) {
      this.pendingSettlements.delete(settlementId);
      return { success: false, error: transitionResult.error };
    }

    console.log(`[SETTLEMENT] Initiated: ${settlementId} for match ${match.matchId}`);
    return { success: true, settlementId };
  }

  /**
   * Process settlement - calculate and distribute prizes
   * @param {string} settlementId
   * @returns {{ success: boolean, error?: string }}
   */
  async processSettlement(settlementId) {
    const settlement = this.pendingSettlements.get(settlementId);
    if (!settlement) {
      return { success: false, error: 'Settlement not found' };
    }

    try {
      // Step 1: Verify
      settlement.state = SETTLEMENT_STATES.VERIFYING;
      settlement.updatedAt = Date.now();

      const verifyResult = this._verifySettlement(settlement);
      if (!verifyResult.success) {
        return this._failSettlement(settlement, verifyResult.error);
      }

      // Step 2: Calculate
      settlement.state = SETTLEMENT_STATES.CALCULATING;
      settlement.updatedAt = Date.now();

      const calcResult = this._calculatePrize(settlement);
      if (!calcResult.success) {
        return this._failSettlement(settlement, calcResult.error);
      }

      // Step 3: Process payout
      settlement.state = SETTLEMENT_STATES.PROCESSING;
      settlement.updatedAt = Date.now();

      const payoutResult = await this._processPayout(settlement);
      if (!payoutResult.success) {
        return this._failSettlement(settlement, payoutResult.error);
      }

      // Step 4: Confirm
      settlement.state = SETTLEMENT_STATES.CONFIRMING;
      settlement.updatedAt = Date.now();

      const confirmResult = await this._confirmSettlement(settlement);
      if (!confirmResult.success) {
        return this._failSettlement(settlement, confirmResult.error);
      }

      // Step 5: Complete
      settlement.state = SETTLEMENT_STATES.COMPLETED;
      settlement.updatedAt = Date.now();
      settlement.completedAt = Date.now();

      // Move to completed
      this.pendingSettlements.delete(settlementId);
      this.completedSettlements.set(settlementId, settlement);

      // Notify players
      this._notifySettlementComplete(settlement);

      console.log(`[SETTLEMENT] Completed: ${settlementId}`);
      return { success: true };

    } catch (err) {
      console.error(`[SETTLEMENT] Error processing ${settlementId}:`, err);
      return this._failSettlement(settlement, err.message);
    }
  }

  /**
   * Verify settlement is valid
   * @private
   */
  _verifySettlement(settlement) {
    // Verify winner has a balance
    const winnerBalance = this.ledger.get(settlement.winnerId);
    if (winnerBalance === undefined) {
      return { success: false, error: 'Winner balance not found' };
    }

    // Verify loser has a balance
    const loserBalance = this.ledger.get(settlement.loserId);
    if (loserBalance === undefined) {
      return { success: false, error: 'Loser balance not found' };
    }

    // Verify loser has enough to cover entry fee
    if (loserBalance < settlement.tier.entryFeeLamports) {
      return { success: false, error: 'Loser has insufficient balance for entry fee' };
    }

    return { success: true };
  }

  /**
   * Calculate prize distribution
   * @private
   */
  _calculatePrize(settlement) {
    const entryFee = settlement.tier.entryFeeLamports;
    const totalPot = entryFee * 2;
    const platformFeePercent = settlement.tier.platformFeePercent || 5;
    const platformFee = Math.round(totalPot * platformFeePercent / 100);
    const winnerPrize = totalPot - platformFee;

    settlement.entryFee = entryFee;
    settlement.totalPot = totalPot;
    settlement.platformFee = platformFee;
    settlement.winnerPrize = winnerPrize;

    // Validate calculations
    if (winnerPrize <= 0) {
      return { success: false, error: 'Invalid prize calculation' };
    }

    if (platformFee < 0) {
      return { success: false, error: 'Invalid fee calculation' };
    }

    return { success: true };
  }

  /**
   * Process payout from ledger
   * @private
   */
  async _processPayout(settlement) {
    // In testnet/mock: server-side ledger
    // In mainnet: would call blockchain API

    try {
      // Deduct loser's entry fee
      const loserCurrentBalance = this.ledger.get(settlement.loserId);
      this.ledger.set(settlement.loserId, loserCurrentBalance - settlement.entryFee);

      // Credit winner
      const winnerCurrentBalance = this.ledger.get(settlement.winnerId);
      this.ledger.set(settlement.winnerId, winnerCurrentBalance + settlement.winnerPrize);

      // Generate mock transaction hashes
      settlement.payoutTxHash = `payout-${settlement.matchId}-${Date.now()}`;
      settlement.feeTxHash = `fee-${settlement.matchId}-${Date.now()}`;

      console.log(`[SETTLEMENT] Payout processed: ${settlement.winnerPrize} lamports to ${settlement.winnerId}`);
      return { success: true };

    } catch (err) {
      console.error(`[SETTLEMENT] Payout failed:`, err);
      return { success: false, error: `Payout failed: ${err.message}` };
    }
  }

  /**
   * Confirm settlement on chain (or mock)
   * @private
   */
  async _confirmSettlement(settlement) {
    // In a real implementation, this would verify the transaction
    // was included in a block and is final

    // For testnet/mock, we just mark as confirmed
    settlement.confirmedAt = Date.now();
    return { success: true };
  }

  /**
   * Notify players of settlement completion
   * @private
   */
  _notifySettlementComplete(settlement) {
    if (!this.notifyPlayers) return;

    this.notifyPlayers(settlement.matchId, {
      type: 'settlementComplete',
      settlement: {
        id: settlement.id,
        winnerId: settlement.winnerId,
        loserId: settlement.loserId,
        winnerPrize: settlement.winnerPrize,
        platformFee: settlement.platformFee,
        payoutTxHash: settlement.payoutTxHash,
        completedAt: settlement.completedAt,
      },
    });
  }

  /**
   * Fail a settlement
   * @private
   */
  _failSettlement(settlement, error) {
    settlement.state = SETTLEMENT_STATES.FAILED;
    settlement.error = error;
    settlement.updatedAt = Date.now();
    console.error(`[SETTLEMENT] Failed: ${settlement.id} - ${error}`);
    return { success: false, error };
  }

  /**
   * Get settlement status
   */
  getSettlement(settlementId) {
    return this.pendingSettlements.get(settlementId) ||
           this.completedSettlements.get(settlementId) ||
           null;
  }

  /**
   * Get all pending settlements
   */
  getPendingSettlements() {
    return Array.from(this.pendingSettlements.values());
  }

  /**
   * Refund a match (before completion)
   * @param {MatchStateMachine} match
   * @returns {{ success: boolean, error?: string }}
   */
  refundMatch(match) {
    if (match.config.matchType === 'free') {
      return { success: false, error: 'Free matches do not require refund' };
    }

    // Check if payments were made
    if (match.payments.player1.status !== 'verified' &&
        match.payments.player2.status !== 'verified') {
      return { success: false, error: 'No payments to refund' };
    }

    // Refund each player
    const refunds = [];

    if (match.payments.player1.status === 'verified') {
      const balance = this.ledger.get(match.player1) || 0;
      this.ledger.set(match.player1, balance + match.payments.player1.amount);
      refunds.push({ playerId: match.player1, amount: match.payments.player1.amount });
    }

    if (match.payments.player2.status === 'verified') {
      const balance = this.ledger.get(match.player2) || 0;
      this.ledger.set(match.player2, balance + match.payments.player2.amount);
      refunds.push({ playerId: match.player2, amount: match.payments.player2.amount });
    }

    // Transition to REFUNDED
    const refundResult = match.refund(TRANSITION_REASONS.REFUND_PROCESSED);
    if (!refundResult.success) {
      return { success: false, error: refundResult.error };
    }

    console.log(`[SETTLEMENT] Refunded match ${match.matchId}:`, refunds);
    return { success: true, refunds };
  }

  /**
   * Handle dispute
   * @param {string} settlementId
   * @param {string} reason
   * @returns {{ success: boolean, error?: string }}
   */
  raiseDispute(settlementId, reason) {
    const settlement = this.pendingSettlements.get(settlementId);
    if (!settlement) {
      return { success: false, error: 'Settlement not found' };
    }

    settlement.state = SETTLEMENT_STATES.FAILED;
    settlement.error = `Disputed: ${reason}`;
    settlement.updatedAt = Date.now();

    // Move to completed (failed)
    this.pendingSettlements.delete(settlementId);
    this.completedSettlements.set(settlementId, settlement);

    console.log(`[SETTLEMENT] Dispute raised: ${settlementId} - ${reason}`);
    return { success: true };
  }
}

export default SettlementService;
