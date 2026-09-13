/**
 * NetworkState - Multiplayer state synchronization
 * 
 * Handles:
 * - Client-side state interpolation
 * - Server state updates
 * - Shot requests and responses
 * - Match state tracking
 * - Reconnection handling
 * 
 * This is the ONLY way the client receives game state.
 * The client NEVER generates authoritative state.
 */

export const NETWORK_EVENTS = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  MATCH_FOUND: 'matchFound',
  MATCH_START: 'matchStart',
  SHOT_EXECUTED: 'shotExecuted',
  STATE_UPDATE: 'stateUpdate',
  SHOT_REJECTED: 'shotRejected',
  MATCH_RESULT: 'matchResult',
  OPPONENT_DISCONNECTED: 'opponentDisconnected',
  OPPONENT_RECONNECTED: 'opponentReconnected',
  REMATCH_REQUEST: 'rematchRequest',
  REMATCH_STARTED: 'rematchStarted',
  QUEUE_UPDATE: 'queueUpdate',
  ERROR: 'error',
};

export class NetworkState {
  constructor(networkClient) {
    this.client = networkClient;
    this.connected = false;
    this.matchId = null;
    this.playerId = null;
    this.playerNumber = null;
    this.playerName = null;
    this.opponentName = null;
    this.opponentAvatar = null;
    this.matchType = null;
    this.tierData = null;

    // State
    this.balls = [];
    this.rules = null;
    this.isMyTurn = false;
    this.gameOver = false;

    // Pending actions
    this.pendingShot = null;
    this.lastShotTime = 0;

    // Listeners
    this.listeners = new Map();

    this._setupListeners();
  }

  /**
   * Set up network event listeners
   * @private
   */
  _setupListeners() {
    this.client.on('welcome', (msg) => {
      this.playerId = msg.playerId;
      this.playerName = msg.playerName;
      this.connected = true;
      this._emit(NETWORK_EVENTS.CONNECTED, msg);
    });

    this.client.on('matchFound', (msg) => {
      this._handleMatchFound(msg);
    });

    this.client.on('reconnected', (msg) => {
      this._handleMatchFound(msg);
      this._emit(NETWORK_EVENTS.STATE_UPDATE, {
        balls: msg.balls,
        rules: msg.rules,
      });
    });

    this.client.on('shotExecuted', (msg) => {
      this._handleShotExecuted(msg);
    });

    this.client.on('serverStateUpdate', (msg) => {
      this._handleStateUpdate(msg);
    });

    this.client.on('cueBallPlaced', (msg) => {
      this._handleCueBallPlaced(msg);
    });

    this.client.on('shotRejected', (msg) => {
      this.pendingShot = null;
      this._emit(NETWORK_EVENTS.SHOT_REJECTED, msg);
    });

    this.client.on('matchResult', (msg) => {
      this._handleMatchResult(msg);
    });

    this.client.on('opponentDisconnected', (msg) => {
      this._emit(NETWORK_EVENTS.OPPONENT_DISCONNECTED, msg);
    });

    this.client.on('opponentReconnected', (msg) => {
      this._emit(NETWORK_EVENTS.OPPONENT_RECONNECTED, msg);
    });

    this.client.on('rematchRequest', (msg) => {
      this._emit(NETWORK_EVENTS.REMATCH_REQUEST, msg);
    });

    this.client.on('rematchStarted', (msg) => {
      this._handleRematchStarted(msg);
    });

    this.client.on('queueUpdate', (msg) => {
      this._emit(NETWORK_EVENTS.QUEUE_UPDATE, msg);
    });

    this.client.on('disconnected', () => {
      this.connected = false;
      this._emit(NETWORK_EVENTS.DISCONNECTED);
    });

    this.client.on('error', (msg) => {
      this._emit(NETWORK_EVENTS.ERROR, msg);
    });
  }

  /**
   * Handle match found
   * @private
   */
  _handleMatchFound(msg) {
    this.matchId = msg.matchId;
    this.playerNumber = msg.playerNumber;
    this.opponentName = msg.opponentName;
    this.opponentAvatar = msg.opponentAvatar;
    this.matchType = msg.matchType;
    this.tierData = msg.tier || null;
    this.balls = msg.balls;
    this.rules = msg.rules;
    this.gameOver = false;
    this.isMyTurn = msg.rules.turn === this.playerNumber;

    this._emit(NETWORK_EVENTS.MATCH_FOUND, {
      matchId: this.matchId,
      opponentName: this.opponentName,
      opponentAvatar: this.opponentAvatar,
      playerNumber: this.playerNumber,
      matchType: this.matchType,
      tierData: this.tierData,
      balls: this.balls,
      rules: this.rules,
      balance: msg.balance,
    });
  }

  /**
   * Handle shot executed
   * @private
   */
  _handleShotExecuted(msg) {
    this.balls = msg.balls;
    this.rules = msg.rules;
    this.isMyTurn = msg.rules.turn === this.playerNumber;

    this._emit(NETWORK_EVENTS.SHOT_EXECUTED, {
      angle: msg.angle,
      power: msg.power,
      playerId: msg.playerId,
      balls: msg.balls,
      rules: msg.rules,
      isMyShot: msg.playerId === this.playerId,
    });
  }

  /**
   * Handle state update
   * @private
   */
  _handleStateUpdate(msg) {
    this.balls = msg.balls;
    this.rules = msg.rules;
    this.isMyTurn = msg.rules.turn === this.playerNumber;

    this._emit(NETWORK_EVENTS.STATE_UPDATE, {
      balls: msg.balls,
      rules: msg.rules,
      message: msg.message,
    });
  }

  /**
   * Handle cue ball placed
   * @private
   */
  _handleCueBallPlaced(msg) {
    this.balls = msg.balls;
    this.rules = msg.rules;
    this.isMyTurn = msg.rules.turn === this.playerNumber;

    this._emit(NETWORK_EVENTS.STATE_UPDATE, {
      balls: msg.balls,
      rules: msg.rules,
      cueBallPlaced: { x: msg.x, y: msg.y },
    });
  }

  /**
   * Handle match result
   * @private
   */
  _handleMatchResult(msg) {
    this.gameOver = true;
    this.matchId = null;

    this._emit(NETWORK_EVENTS.MATCH_RESULT, {
      matchId: msg.matchId,
      won: msg.won,
      reason: msg.reason,
      winnerStats: msg.winnerStats,
      loserStats: msg.loserStats,
      prize: msg.prize,
    });
  }

  /**
   * Handle rematch started
   * @private
   */
  _handleRematchStarted(msg) {
    this.balls = msg.balls;
    this.rules = msg.rules;
    this.gameOver = false;
    this.isMyTurn = msg.rules.turn === this.playerNumber;

    this._emit(NETWORK_EVENTS.REMATCH_STARTED, {
      balls: msg.balls,
      rules: msg.rules,
    });
  }

  /**
   * Send a shot request
   * @param {number} angle - Shot angle in radians
   * @param {number} power - Shot power (1-25)
   * @returns {boolean} - Whether shot was sent
   */
  sendShot(angle, power) {
    if (!this.connected || !this.matchId) return false;
    if (!this.isMyTurn) return false;
    if (this.gameOver) return false;

    // Rate limit shots
    const now = Date.now();
    if (now - this.lastShotTime < 500) return false;
    this.lastShotTime = now;

    this.pendingShot = { angle, power, timestamp: now };
    this.client.shoot(angle, power);
    return true;
  }

  /**
   * Send cue ball placement
   * @param {number} x
   * @param {number} y
   */
  sendCueBallPlacement(x, y) {
    if (!this.connected || !this.matchId) return;
    this.client.placeCueBall(x, y);
  }

  /**
   * Send rematch request
   */
  sendRematchRequest() {
    if (!this.connected || !this.matchId) return;
    this.client.requestRematch();
  }

  /**
   * Join matchmaking queue
   * @param {string} matchType - 'free' or 'competitive'
   * @param {string} [tierId]
   */
  joinQueue(matchType, tierId) {
    if (!this.connected) return;
    if (matchType === 'competitive') {
      this.client.joinQueueCompetitive(tierId);
    } else {
      this.client.joinQueue('free');
    }
  }

  /**
   * Leave queue
   */
  leaveQueue() {
    if (!this.connected) return;
    this.client.leaveQueue();
  }

  /**
   * Reconnect to match
   * @param {string} matchId
   */
  reconnectToMatch(matchId) {
    if (!this.connected) return;
    this.client.reconnectToMatch(matchId);
  }

  /**
   * Get current state
   */
  getState() {
    return {
      connected: this.connected,
      matchId: this.matchId,
      playerId: this.playerId,
      playerNumber: this.playerNumber,
      playerName: this.playerName,
      opponentName: this.opponentName,
      matchType: this.matchType,
      tierData: this.tierData,
      balls: this.balls,
      rules: this.rules,
      isMyTurn: this.isMyTurn,
      gameOver: this.gameOver,
    };
  }

  /**
   * Register event listener
   * @param {string} event
   * @param {Function} callback
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * Remove event listener
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    const cbs = this.listeners.get(event) || [];
    const idx = cbs.indexOf(callback);
    if (idx !== -1) cbs.splice(idx, 1);
  }

  /**
   * Emit event
   * @private
   */
  _emit(event, data) {
    const cbs = this.listeners.get(event) || [];
    cbs.forEach(cb => cb(data));
  }
}

export default NetworkState;
