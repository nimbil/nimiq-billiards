/**
 * BilliardsRulesEngine - Standard 8-Ball Rules
 * 
 * Implements official WPA/BCA 8-ball rules:
 * - Break shot rules
 * - Open table rules
 * - Solids/stripes assignment
 * - Legal shot requirements
 * - Foul detection and penalties
 * - Scratch handling
 * - 8-ball win/loss conditions
 * - Turn switching
 * 
 * This engine is PURELY LOGICAL - no physics, no rendering, no networking.
 * It can be tested independently.
 * 
 * Reference: WPA 8-Ball Rules
 */

export const GAME_STATE = {
  NOT_STARTED: 'not_started',
  BREAK: 'break',
  OPEN_TABLE: 'open_table',
  solids: 'solids',
  stripes: 'stripes',
  SHOOTING: 'shooting',
  BALL_IN_HAND: 'ball_in_hand',
  GAME_OVER: 'game_over',
};

export const BALL_GROUP = {
  CUE: 'cue',
  SOLIDS: 'solids',
  STRIPES: 'stripes',
  EIGHT: 'eight',
};

export const FOUL = {
  NONE: 'none',
  SCRATCH: 'scratch',
  WRONG_BALL_FIRST: 'wrong_ball_first',
  NO_BALL_HIT: 'no_ball_hit',
  NO_RAIL_AFTER_HIT: 'no_rail_after_hit',
  EIGHT_BALL_EARLY: 'eight_ball_early',
  EIGHT_BALL_SCRATCH: 'eight_ball_scratch',
  CUE_BALL_OFF_TABLE: 'cue_ball_off_table',
  OBJECT_BALL_OFF_TABLE: 'object_ball_off_table',
  DOUBLE_HIT: 'double_hit',
  PUSH_SHOT: 'push_shot',
};

export const SHOT_RESULT = {
  CONTINUE_TURN: 'continue_turn',
  SWITCH_TURN: 'switch_turn',
  FOUL_BALL_IN_HAND: 'foul_ball_in_hand',
  WIN: 'win',
  LOSE: 'lose',
};

/**
 * Helper: get ball group from ID
 */
export function getBallGroup(ballId) {
  if (ballId === 0) return BALL_GROUP.CUE;
  if (ballId === 8) return BALL_GROUP.EIGHT;
  if (ballId >= 1 && ballId <= 7) return BALL_GROUP.SOLIDS;
  if (ballId >= 9 && ballId <= 15) return BALL_GROUP.STRIPES;
  return null;
}

/**
 * Helper: check if ball is in group
 */
export function isBallInGroup(ballId, group) {
  return getBallGroup(ballId) === group;
}

export class BilliardsRulesEngine {
  constructor() {
    this.reset();
  }

  /**
   * Reset to initial state
   */
  reset() {
    this.gameState = GAME_STATE.NOT_STARTED;
    this.turn = 1;
    this.player1Group = null;
    this.player2Group = null;
    this.tableOpen = true;

    // Shot tracking
    this.shotFoul = FOUL.NONE;
    this.foulDetails = '';
    this.firstContactBall = null;
    this.ballsPocketedThisTurn = [];
    this.cushionHitsThisTurn = 0;
    this.cueBallPocketed = false;
    this.eightBallPocketed = false;

    // History
    this.turnHistory = [];
    this.shotCount = 0;
  }

  /**
   * Start the game with break
   */
  startBreak() {
    this.reset();
    this.gameState = GAME_STATE.BREAK;
    this.turn = 1;
  }

  /**
   * Begin a new shot
   * @param {Object[]} balls - All balls with { id, pocketed }
   */
  beginShot(balls) {
    this.shotFoul = FOUL.NONE;
    this.foulDetails = '';
    this.firstContactBall = null;
    this.ballsPocketedThisTurn = [];
    this.cushionHitsThisTurn = 0;
    this.cueBallPocketed = false;
    this.eightBallPocketed = false;

    // Snapshot balls at turn start
    this.turnStartBalls = balls.map(b => ({ ...b }));
    this.turnStartPocketed = balls.filter(b => b.pocketed).map(b => b.id);

    // Preserve BREAK state for special handling
    if (this.gameState !== GAME_STATE.BREAK) {
      this.gameState = GAME_STATE.SHOOTING;
    }
    this.shotCount++;
  }

  /**
   * Record first ball contacted by cue ball
   * @param {number} ballId - ID of first ball hit
   */
  recordFirstContact(ballId) {
    if (this.firstContactBall === null && ballId !== 0) {
      this.firstContactBall = ballId;
    }
  }

  /**
   * Record a ball being pocketed
   * @param {number} ballId - ID of pocketed ball
   */
  recordBallPocketed(ballId) {
    this.ballsPocketedThisTurn.push(ballId);

    if (ballId === 0) this.cueBallPocketed = true;
    if (ballId === 8) this.eightBallPocketed = true;
  }

  /**
   * Record a cushion hit
   */
  recordCushionHit() {
    this.cushionHitsThisTurn++;
  }

  /**
   * End the current shot and evaluate result
   * @param {Object[]} balls - Final ball states after shot
   * @returns {Object} - Shot evaluation result
   */
  endShot(balls) {
    const result = {
      shotResult: null,
      foul: FOUL.NONE,
      foulDetails: '',
      switchTurn: false,
      continueTurn: false,
      winner: null,
      loser: null,
      winReason: '',
      newGameState: null,
      player1Group: this.player1Group,
      player2Group: this.player2Group,
    };

    // Evaluate fouls
    this._evaluateFouls(balls);

    // Handle break shot
    if (this.gameState === GAME_STATE.BREAK) {
      return this._evaluateBreak(balls, result);
    }

    // Handle 8-ball pocketed
    if (this.eightBallPocketed) {
      return this._evaluateEightBall(balls, result);
    }

    // Handle foul
    if (this.shotFoul !== FOUL.NONE) {
      result.foul = this.shotFoul;
      result.foulDetails = this.foulDetails;
      result.shotResult = SHOT_RESULT.FOUL_BALL_IN_HAND;
      result.switchTurn = true;
      this.turn = this.turn === 1 ? 2 : 1;
      this.gameState = GAME_STATE.BALL_IN_HAND;
      result.newGameState = this.gameState;
      this._recordTurn(result);
      return result;
    }

    // Open table - assign groups on first legal pocket
    if (this.tableOpen && this.ballsPocketedThisTurn.length > 0) {
      const assigned = this._assignGroups();
      if (assigned) {
        this.tableOpen = false;
        result.player1Group = this.player1Group;
        result.player2Group = this.player2Group;
      }
    }

    // Check if player pocketed their own balls
    const currentGroup = this._getCurrentGroup();
    const pocketedOwn = this._getPocketedInGroup(this.ballsPocketedThisTurn, currentGroup);
    const pocketedOpponent = this._getPocketedInGroup(this.ballsPocketedThisTurn, this._getOpponentGroup());

    if (pocketedOwn.length > 0) {
      // Player continues
      result.shotResult = SHOT_RESULT.CONTINUE_TURN;
      result.continueTurn = true;
      this.gameState = this.tableOpen ? GAME_STATE.OPEN_TABLE : this._getGameStateForGroup(currentGroup);
    } else {
      // Switch turns
      result.shotResult = SHOT_RESULT.SWITCH_TURN;
      result.switchTurn = true;
      this.turn = this.turn === 1 ? 2 : 1;
      this.gameState = this.tableOpen ? GAME_STATE.OPEN_TABLE : this._getGameStateForGroup(this._getCurrentGroup());
    }

    result.newGameState = this.gameState;
    this._recordTurn(result);
    return result;
  }

  /**
   * Evaluate break shot
   * @private
   */
  _evaluateBreak(balls, result) {
    const cueBall = balls.find(b => b.id === 0);
    const eightBall = balls.find(b => b.id === 8);

    // Scratch on break
    if (this.cueBallPocketed) {
      result.foul = FOUL.SCRATCH;
      result.foulDetails = 'Scratch on break';
      result.shotResult = SHOT_RESULT.FOUL_BALL_IN_HAND;
      result.switchTurn = true;
      this.turn = 2;
      this.gameState = GAME_STATE.BALL_IN_HAND;
      result.newGameState = this.gameState;
      this._recordTurn(result);
      return result;
    }

    // 8-ball pocketed on break - win (unless scratch)
    if (this.eightBallPocketed) {
      result.shotResult = SHOT_RESULT.WIN;
      result.winner = this.turn;
      result.winReason = '8-ball pocketed on break';
      this.gameState = GAME_STATE.GAME_OVER;
      result.newGameState = this.gameState;
      this._recordTurn(result);
      return result;
    }

    // No balls pocketed or foul - switch turn
    if (this.ballsPocketedThisTurn.length === 0 || this.shotFoul !== FOUL.NONE) {
      result.switchTurn = true;
      this.turn = 2;
    }

    // Assign groups if balls were pocketed
    if (this.ballsPocketedThisTurn.length > 0) {
      const assigned = this._assignGroups();
      if (assigned) {
        this.tableOpen = false;
        result.player1Group = this.player1Group;
        result.player2Group = this.player2Group;
        result.continueTurn = true;
        result.switchTurn = false;
        this.turn = 1;
      }
    }

    this.gameState = this.tableOpen ? GAME_STATE.OPEN_TABLE : this._getGameStateForGroup(this._getCurrentGroup());
    result.newGameState = this.gameState;
    result.shotResult = result.continueTurn ? SHOT_RESULT.CONTINUE_TURN : SHOT_RESULT.SWITCH_TURN;
    this._recordTurn(result);
    return result;
  }

  /**
   * Evaluate 8-ball pocketed
   * @private
   */
  _evaluateEightBall(balls, result) {
    // 8-ball on break is always a win (unless scratch)
    if (this.gameState === GAME_STATE.BREAK) {
      if (this.cueBallPocketed) {
        result.foul = FOUL.EIGHT_BALL_SCRATCH;
        result.foulDetails = 'Scratch on 8-ball break';
        result.shotResult = SHOT_RESULT.LOSE;
        result.loser = this.turn;
        result.winner = this.turn === 1 ? 2 : 1;
        result.winReason = 'Scratch on 8-ball break';
        this.gameState = GAME_STATE.GAME_OVER;
        result.newGameState = this.gameState;
        this._recordTurn(result);
        return result;
      }
      result.shotResult = SHOT_RESULT.WIN;
      result.winner = this.turn;
      result.winReason = '8-ball pocketed on break';
      this.gameState = GAME_STATE.GAME_OVER;
      result.newGameState = this.gameState;
      this._recordTurn(result);
      return result;
    }

    const currentGroup = this._getCurrentGroup();

    // Check if player cleared all their balls
    const allOwnCleared = this._allBallsInGroupCleared(balls, currentGroup);

    // Scratch while shooting 8-ball = lose
    if (this.cueBallPocketed) {
      result.foul = FOUL.EIGHT_BALL_SCRATCH;
      result.foulDetails = 'Scratch while shooting 8-ball';
      result.shotResult = SHOT_RESULT.LOSE;
      result.loser = this.turn;
      result.winner = this.turn === 1 ? 2 : 1;
      result.winReason = 'Opponent scratched on 8-ball shot';
      this.gameState = GAME_STATE.GAME_OVER;
      result.newGameState = this.gameState;
      this._recordTurn(result);
      return result;
    }

    // Pocketed 8-ball before clearing all own balls = lose
    if (!allOwnCleared) {
      result.shotResult = SHOT_RESULT.LOSE;
      result.loser = this.turn;
      result.winner = this.turn === 1 ? 2 : 1;
      result.winReason = '8-ball pocketed before clearing own balls';
      this.gameState = GAME_STATE.GAME_OVER;
      result.newGameState = this.gameState;
      this._recordTurn(result);
      return result;
    }

    // Legal 8-ball pocket = win
    result.shotResult = SHOT_RESULT.WIN;
    result.winner = this.turn;
    result.winReason = 'Legally pocketed 8-ball';
    this.gameState = GAME_STATE.GAME_OVER;
    result.newGameState = this.gameState;
    this._recordTurn(result);
    return result;
  }

  /**
   * Evaluate fouls for current shot
   * @private
   */
  _evaluateFouls(balls) {
    // Scratch (cue ball pocketed)
    if (this.cueBallPocketed) {
      this.shotFoul = FOUL.SCRATCH;
      this.foulDetails = 'Cue ball pocketed';
      return;
    }

    // No ball hit
    if (this.firstContactBall === null) {
      this.shotFoul = FOUL.NO_BALL_HIT;
      this.foulDetails = 'Cue ball did not contact any ball';
      return;
    }

    // Check if first contact was legal
    if (!this.tableOpen) {
      const currentGroup = this._getCurrentGroup();
      const firstContactGroup = getBallGroup(this.firstContactBall);

      // Must hit own balls first (unless all own balls are cleared, then must hit 8-ball)
      const allOwnCleared = this._allBallsInGroupCleared(balls, currentGroup);

      if (allOwnCleared) {
        // Shooting at 8-ball - must hit 8-ball first
        if (this.firstContactBall !== 8) {
          this.shotFoul = FOUL.WRONG_BALL_FIRST;
          this.foulDetails = 'Must hit 8-ball first when shooting for 8-ball';
          return;
        }
      } else {
        // Must hit own group first
        if (firstContactGroup !== currentGroup) {
          this.shotFoul = FOUL.WRONG_BALL_FIRST;
          this.foulDetails = `Must hit ${currentGroup} first, hit ${firstContactGroup} first`;
          return;
        }
      }
    }

    // No rail after hit (at least one ball must hit cushion or be pocketed)
    // Exclude cue ball pocketed from satisfying this requirement
    const nonCuePocketed = this.ballsPocketedThisTurn.filter(id => id !== 0);
    if (this.cushionHitsThisTurn === 0 && nonCuePocketed.length === 0) {
      this.shotFoul = FOUL.NO_RAIL_AFTER_HIT;
      this.foulDetails = 'No ball hit cushion and no ball pocketed';
      return;
    }
  }

  /**
   * Assign groups based on first pocketed ball
   * @returns {boolean} - Whether groups were assigned
   * @private
   */
  _assignGroups() {
    if (this.ballsPocketedThisTurn.length === 0) return false;

    // Find first pocketed ball that's not cue or 8
    for (const ballId of this.ballsPocketedThisTurn) {
      if (ballId === 0 || ballId === 8) continue;

      const group = getBallGroup(ballId);
      if (group === BALL_GROUP.SOLIDS || group === BALL_GROUP.STRIPES) {
        if (this.turn === 1) {
          this.player1Group = group;
          this.player2Group = group === BALL_GROUP.SOLIDS ? BALL_GROUP.STRIPES : BALL_GROUP.SOLIDS;
        } else {
          this.player2Group = group;
          this.player1Group = group === BALL_GROUP.SOLIDS ? BALL_GROUP.STRIPES : BALL_GROUP.SOLIDS;
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Check if all balls in a group are cleared
   * @private
   */
  _allBallsInGroupCleared(balls, group) {
    if (!group) return false;

    const groupBalls = balls.filter(b => {
      const bGroup = getBallGroup(b.id);
      return bGroup === group;
    });

    return groupBalls.every(b => b.pocketed);
  }

  /**
   * Get balls pocketed in a specific group
   * @private
   */
  _getPocketedInGroup(ballIds, group) {
    if (!group) return [];
    return ballIds.filter(id => isBallInGroup(id, group));
  }

  /**
   * Get current player's group
   * @private
   */
  _getCurrentGroup() {
    return this.turn === 1 ? this.player1Group : this.player2Group;
  }

  /**
   * Get opponent's group
   * @private
   */
  _getOpponentGroup() {
    return this.turn === 1 ? this.player2Group : this.player1Group;
  }

  /**
   * Get game state constant for a group
   * @private
   */
  _getGameStateForGroup(group) {
    if (group === BALL_GROUP.SOLIDS) return GAME_STATE.solids;
    if (group === BALL_GROUP.STRIPES) return GAME_STATE.stripes;
    return GAME_STATE.OPEN_TABLE;
  }

  /**
   * Record turn in history
   * @private
   */
  _recordTurn(result) {
    this.turnHistory.push({
      turn: this.turn === 1 ? 2 : 1, // Record the turn that just ended
      shotNumber: this.shotCount,
      ballsPocketed: [...this.ballsPocketedThisTurn],
      foul: this.shotFoul,
      foulDetails: this.foulDetails,
      result: result.shotResult,
      timestamp: Date.now(),
    });
  }

  /**
   * Get public state for network sync
   */
  getState() {
    return {
      gameState: this.gameState,
      turn: this.turn,
      player1Group: this.player1Group,
      player2Group: this.player2Group,
      tableOpen: this.tableOpen,
      shotFoul: this.shotFoul,
      foulDetails: this.foulDetails,
      shotCount: this.shotCount,
    };
  }

  /**
   * Load state from network
   */
  loadState(state) {
    this.gameState = state.gameState;
    this.turn = state.turn;
    this.player1Group = state.player1Group;
    this.player2Group = state.player2Group;
    this.tableOpen = state.tableOpen;
    this.shotFoul = state.shotFoul;
    this.foulDetails = state.foulDetails;
    this.shotCount = state.shotCount;
  }

  /**
   * Get turn history
   */
  getHistory() {
    return [...this.turnHistory];
  }
}

export default BilliardsRulesEngine;
