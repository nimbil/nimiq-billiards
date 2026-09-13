import { CUE_BALL_ID, EIGHT_BALL_ID } from './constants.js';

export const GAME_STATES = {
  WAITING_FOR_BREAK: 'waiting_for_break',
  AIMING: 'aiming',
  SHOOTING: 'shooting',
  BALL_IN_HAND: 'ball_in_hand',
  GAME_OVER: 'game_over',
};

export const PLAYER_TYPES = {
  SOLIDS: 'solids',
  STRIPES: 'stripes',
  UNASSIGNED: 'unassigned',
};

export class GameRules {
  constructor() {
    this.reset();
  }

  reset() {
    this.turn = 1;
    this.player1Type = PLAYER_TYPES.UNASSIGNED;
    this.player2Type = PLAYER_TYPES.UNASSIGNED;
    this.state = GAME_STATES.WAITING_FOR_BREAK;
    this.foul = false;
    this.foulReason = '';
    this.winner = null;
    this.winReason = '';
    this.justAssignedTypes = false;
    this.firstBallPocketedThisTurn = null;
    this.pocketedThisTurn = [];
    this.turnStartPocketed = [];
    this.rerack = false;
  }

  startBreak() {
    this.state = GAME_STATES.AIMING;
    this.turn = 1;
  }

  onShotStart(balls) {
    this.foul = false;
    this.foulReason = '';
    this.firstBallPocketedThisTurn = null;
    this.pocketedThisTurn = [];
    this.turnStartPocketed = balls.filter(b => b.pocketed).map(b => b.id);
    this.state = GAME_STATES.SHOOTING;
  }

  onBallPocketed(ball) {
    if (ball.id === CUE_BALL_ID) return;
    this.pocketedThisTurn.push(ball.id);
    if (!this.firstBallPocketedThisTurn) {
      this.firstBallPocketedThisTurn = ball.id;
    }
  }

  onShotEnd(balls, currentPlayer) {
    const cueBall = balls.find(b => b.id === CUE_BALL_ID);
    const eightBall = balls.find(b => b.id === EIGHT_BALL_ID);
    const cuePocketed = cueBall && cueBall.pocketed;
    const eightPocketed = eightBall && eightBall.pocketed;
    const solidsPocketed = this.pocketedThisTurn.filter(id => id >= 1 && id <= 7);
    const stripesPocketed = this.pocketedThisTurn.filter(id => id >= 9 && id <= 15);

    if (cuePocketed) {
      this.foul = true;
      this.foulReason = 'Cue ball scratched!';
    }

    if (this.player1Type === PLAYER_TYPES.UNASSIGNED && !eightPocketed) {
      if (solidsPocketed.length > 0 && !this.foul) {
        if (this.turn === 1) {
          this.player1Type = PLAYER_TYPES.SOLIDS;
          this.player2Type = PLAYER_TYPES.STRIPES;
        } else {
          this.player2Type = PLAYER_TYPES.SOLIDS;
          this.player1Type = PLAYER_TYPES.STRIPES;
        }
        this.justAssignedTypes = true;
      } else if (stripesPocketed.length > 0 && !this.foul) {
        if (this.turn === 1) {
          this.player1Type = PLAYER_TYPES.STRIPES;
          this.player2Type = PLAYER_TYPES.SOLIDS;
        } else {
          this.player2Type = PLAYER_TYPES.STRIPES;
          this.player1Type = PLAYER_TYPES.SOLIDS;
        }
        this.justAssignedTypes = true;
      }
    }

    if (eightPocketed) {
      const currentType = this.turn === 1 ? this.player1Type : this.player2Type;
      const allOwnPocketed = this._allOwnBallsPocketed(balls, currentType);

      if (this.foul || !allOwnPocketed) {
        const loser = this.turn;
        this.winner = loser === 1 ? 2 : 1;
        this.winReason = this.foul
          ? 'Pocketed 8-ball on a foul!'
          : 'Pocketed 8-ball before clearing own balls!';
        this.state = GAME_STATES.GAME_OVER;
        return this.winner;
      } else {
        this.winner = this.turn;
        this.winReason = 'Legally pocketed the 8-ball!';
        this.state = GAME_STATES.GAME_OVER;
        return this.winner;
      }
    }

    if (this.foul) {
      this.turn = this.turn === 1 ? 2 : 1;
      this.state = GAME_STATES.BALL_IN_HAND;
      return null;
    }

    const currentType = this.turn === 1 ? this.player1Type : this.player2Type;
    const pocketedOwn = this._pocketedOwnBalls(currentType);

    if (pocketedOwn.length > 0 && !this.foul) {
      this.state = GAME_STATES.AIMING;
      return null;
    } else {
      this.turn = this.turn === 1 ? 2 : 1;
      this.state = GAME_STATES.AIMING;
      return null;
    }
  }

  _allOwnBallsPocketed(balls, type) {
    if (type === PLAYER_TYPES.UNASSIGNED) return false;
    const range = type === PLAYER_TYPES.SOLIDS ? [1, 7] : [9, 15];
    return balls
      .filter(b => b.id >= range[0] && b.id <= range[1])
      .every(b => b.pocketed);
  }

  _pocketedOwnBalls(type) {
    if (type === PLAYER_TYPES.UNASSIGNED) return [];
    return this.pocketedThisTurn.filter(id => {
      if (type === PLAYER_TYPES.SOLIDS) return id >= 1 && id <= 7;
      return id >= 9 && id <= 15;
    });
  }

  getCurrentPlayerType() {
    return this.turn === 1 ? this.player1Type : this.player2Type;
  }
}
