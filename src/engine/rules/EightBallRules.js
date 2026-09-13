/**
 * EightBallRules - 8-ball pool game rules engine
 * 
 * Separated from physics - handles only game logic:
 * - Turn management
 * - Ball type assignment (solids/stripes)
 * - Foul detection
 * - Win/loss conditions
 * - Ball-in-hand rules
 * 
 * This engine is purely logical - it doesn't know about physics,
 * rendering, or networking. It just evaluates game state.
 */

import { CUE_BALL_ID, EIGHT_BALL_ID } from '../constants.js';

/**
 * Game states
 */
export const GAME_STATES = {
  WAITING_FOR_BREAK: 'waiting_for_break',
  AIMING: 'aiming',
  SHOOTING: 'shooting',
  BALL_IN_HAND: 'ball_in_hand',
  GAME_OVER: 'game_over',
};

/**
 * Player ball types
 */
export const PLAYER_TYPES = {
  SOLIDS: 'solids',
  STRIPES: 'stripes',
  UNASSIGNED: 'unassigned',
};

/**
 * Foul types
 */
export const FOUL_TYPES = {
  SCRATCH: 'scratch',
  EIGHT_BALL_EARLY: 'eight_ball_early',
  EIGHT_BALL_FOUL: 'eight_ball_foul',
  WRONG_BALL_FIRST: 'wrong_ball_first',
  NO_BALL_HIT: 'no_ball_hit',
  NO_RAIL: 'no_rail',
  BALL_OFF_TABLE: 'ball_off_table',
  DOUBLE_HIT: 'double_hit',
  PUSH_SHOT: 'push_shot',
  TURN_TIMEOUT: 'turn_timeout',
};

export class EightBallRules {
  constructor() {
    this.reset();
  }

  /**
   * Reset game state
   */
  reset() {
    this.turn = 1;
    this.player1Type = PLAYER_TYPES.UNASSIGNED;
    this.player2Type = PLAYER_TYPES.UNASSIGNED;
    this.state = GAME_STATES.WAITING_FOR_BREAK;
    this.foul = false;
    this.foulType = null;
    this.foulReason = '';
    this.winner = null;
    this.winReason = '';
    this.pocketedThisTurn = [];
    this.turnStartPocketed = [];
    this.firstBallPocketedThisTurn = null;
    this.firstBallHitThisTurn = null;
    this.railHitsThisTurn = 0;
    this.turnStartTime = null;
  }

  /**
   * Start the break
   */
  startBreak() {
    this.state = GAME_STATES.AIMING;
    this.turn = 1;
    this.turnStartTime = Date.now();
  }

  /**
   * Called when a shot begins
   * @param {Ball[]} balls - Current ball positions
   */
  onShotStart(balls) {
    this.foul = false;
    this.foulType = null;
    this.foulReason = '';
    this.firstBallPocketedThisTurn = null;
    this.firstBallHitThisTurn = null;
    this.pocketedThisTurn = [];
    this.railHitsThisTurn = 0;
    this.turnStartPocketed = balls.filter(b => b.pocketed).map(b => b.id);
    this.state = GAME_STATES.SHOOTING;
  }

  /**
   * Called when cue ball hits first object ball
   * @param {number} ballId - ID of ball hit
   */
  onFirstBallHit(ballId) {
    if (ballId === CUE_BALL_ID) return;
    if (this.firstBallHitThisTurn === null) {
      this.firstBallHitThisTurn = ballId;
    }
  }

  /**
   * Called when a ball is pocketed
   * @param {Ball} ball - Pocketed ball
   */
  onBallPocketed(ball) {
    if (ball.id === CUE_BALL_ID) {
      this.foul = true;
      this.foulType = FOUL_TYPES.SCRATCH;
      this.foulReason = 'Cue ball scratched!';
      return;
    }

    this.pocketedThisTurn.push(ball.id);

    if (!this.firstBallPocketedThisTurn) {
      this.firstBallPocketedThisTurn = ball.id;
    }
  }

  /**
   * Called when a ball hits a cushion
   */
  onRailHit() {
    this.railHitsThisTurn++;
  }

  /**
   * Called when shot ends (all balls stopped)
   * @param {Ball[]} balls - Current ball positions
   * @returns {Object} - Shot result
   */
  onShotEnd(balls) {
    const cueBall = balls.find(b => b.id === CUE_BALL_ID);
    const eightBall = balls.find(b => b.id === EIGHT_BALL_ID);
    const cuePocketed = cueBall && cueBall.pocketed;
    const eightPocketed = eightBall && eightBall.pocketed;

    // Check for fouls
    this._checkFouls(balls, cuePocketed);

    // Assign ball types on first legal pocket (turn 1)
    if (this.turn === 1 && this.player1Type === PLAYER_TYPES.UNASSIGNED && !eightPocketed) {
      this._assignBallTypes();
    }

    // Check for 8-ball pocketed
    if (eightPocketed) {
      return this._handleEightBallPocketed();
    }

    // Handle foul
    if (this.foul) {
      this.state = GAME_STATES.BALL_IN_HAND;
      return { winner: null, foul: true, foulType: this.foulType, foulReason: this.foulReason };
    }

    // Check if current player pocketed their balls
    const currentType = this._getCurrentPlayerType();
    const pocketedOwn = this._pocketedOwnBalls(currentType);

    if (pocketedOwn.length > 0) {
      // Player continues
      this.state = GAME_STATES.AIMING;
      return { winner: null, foul: false, continueTurn: true };
    } else {
      // Switch turns
      this.turn = this.turn === 1 ? 2 : 1;
      this.state = GAME_STATES.AIMING;
      return { winner: null, foul: false, switchTurn: true };
    }
  }

  /**
   * Check for fouls
   * @private
   */
  _checkFouls(balls, cuePocketed) {
    // Scratch is already handled in onBallPocketed

    // Check if first ball hit was legal
    if (this.firstBallHitThisTurn !== null) {
      const currentType = this._getCurrentPlayerType();
      
      if (currentType !== PLAYER_TYPES.UNASSIGNED) {
        const firstHitBall = balls.find(b => b.id === this.firstBallHitThisTurn);
        
        if (firstHitBall && !firstHitBall.pocketed) {
          const isOwnBall = this._isOwnBall(this.firstBallHitThisTurn, currentType);
          const isEightBall = this.firstBallHitThisTurn === EIGHT_BALL_ID;
          
          // Must hit own balls first (unless shooting at 8-ball)
          const allOwnPocketed = this._allOwnBallsPocketed(balls, currentType);
          
          if (!isOwnBall && !isEightBall && !allOwnPocketed) {
            this.foul = true;
            this.foulType = FOUL_TYPES.WRONG_BALL_FIRST;
            this.foulReason = 'Must hit own balls first!';
          }
        }
      }
    }

    // Check if any ball was hit
    if (this.firstBallHitThisTurn === null) {
      this.foul = true;
      this.foulType = FOUL_TYPES.NO_BALL_HIT;
      this.foulReason = 'No ball was hit!';
    }

    // Check for rail hit (at least one ball must hit rail or be pocketed)
    if (this.railHitsThisTurn === 0 && this.pocketedThisTurn.length === 0) {
      this.foul = true;
      this.foulType = FOUL_TYPES.NO_RAIL;
      this.foulReason = 'No rail contact!';
    }
  }

  /**
   * Assign ball types based on first pocketed ball
   * @private
   */
  _assignBallTypes() {
    if (this.firstBallPocketedThisTurn === null) return;
    if (this.firstBallPocketedThisTurn === EIGHT_BALL_ID) return;

    const ballId = this.firstBallPocketedThisTurn;

    if (ballId >= 1 && ballId <= 7) {
      // Solids pocketed
      if (this.turn === 1) {
        this.player1Type = PLAYER_TYPES.SOLIDS;
        this.player2Type = PLAYER_TYPES.STRIPES;
      } else {
        this.player2Type = PLAYER_TYPES.SOLIDS;
        this.player1Type = PLAYER_TYPES.STRIPES;
      }
    } else if (ballId >= 9 && ballId <= 15) {
      // Stripes pocketed
      if (this.turn === 1) {
        this.player1Type = PLAYER_TYPES.STRIPES;
        this.player2Type = PLAYER_TYPES.SOLIDS;
      } else {
        this.player2Type = PLAYER_TYPES.STRIPES;
        this.player1Type = PLAYER_TYPES.SOLIDS;
      }
    }
  }

  /**
   * Handle 8-ball pocketed
   * @private
   */
  _handleEightBallPocketed() {
    const currentType = this._getCurrentPlayerType();
    const allOwnPocketed = this._allOwnBallsPocketed(
      // Create mock balls array for check
      this.pocketedThisTurn.map(id => ({ id, pocketed: true })),
      currentType
    );

    // Check if it's a foul
    if (this.foul) {
      // Foul on 8-ball = lose
      this.winner = this.turn === 1 ? 2 : 1;
      this.winReason = 'Opponent pocketed 8-ball on a foul!';
      this.state = GAME_STATES.GAME_OVER;
      return { winner: this.winner, reason: this.winReason };
    }

    // Check if all own balls are pocketed
    if (!allOwnPocketed) {
      // Pocketed 8-ball early = lose
      this.winner = this.turn === 1 ? 2 : 1;
      this.winReason = 'Opponent pocketed 8-ball before clearing own balls!';
      this.state = GAME_STATES.GAME_OVER;
      return { winner: this.winner, reason: this.winReason };
    }

    // Legal 8-ball pocket = win
    this.winner = this.turn;
    this.winReason = 'Legally pocketed the 8-ball!';
    this.state = GAME_STATES.GAME_OVER;
    return { winner: this.winner, reason: this.winReason };
  }

  /**
   * Check if ball is own ball
   * @private
   */
  _isOwnBall(ballId, type) {
    if (type === PLAYER_TYPES.SOLIDS) return ballId >= 1 && ballId <= 7;
    if (type === PLAYER_TYPES.STRIPES) return ballId >= 9 && ballId <= 15;
    return false;
  }

  /**
   * Check if all own balls are pocketed
   * @private
   */
  _allOwnBallsPocketed(balls, type) {
    if (type === PLAYER_TYPES.UNASSIGNED) return false;
    const [lo, hi] = type === PLAYER_TYPES.SOLIDS ? [1, 7] : [9, 15];
    return balls
      .filter(b => b.id >= lo && b.id <= hi)
      .every(b => b.pocketed);
  }

  /**
   * Get own balls pocketed this turn
   * @private
   */
  _pocketedOwnBalls(type) {
    if (type === PLAYER_TYPES.UNASSIGNED) return [];
    return this.pocketedThisTurn.filter(id => this._isOwnBall(id, type));
  }

  /**
   * Get current player's ball type
   * @private
   */
  _getCurrentPlayerType() {
    return this.turn === 1 ? this.player1Type : this.player2Type;
  }

  /**
   * Get public state for network sync
   */
  getPublicState() {
    return {
      turn: this.turn,
      state: this.state,
      player1Type: this.player1Type,
      player2Type: this.player2Type,
      foul: this.foul,
      foulType: this.foulType,
      foulReason: this.foulReason,
      winner: this.winner,
      winReason: this.winReason,
    };
  }

  /**
   * Load state from network update
   */
  loadState(state) {
    this.turn = state.turn;
    this.state = state.state;
    this.player1Type = state.player1Type;
    this.player2Type = state.player2Type;
    this.foul = state.foul;
    this.foulType = state.foulType;
    this.foulReason = state.foulReason;
    this.winner = state.winner;
    this.winReason = state.winReason;
  }
}

export default EightBallRules;
