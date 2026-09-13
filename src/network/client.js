export class NetworkClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.playerId = null;
    this.playerName = null;
    this.avatar = null;
    this.stats = null;
    this.currentMatchId = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this._url = null;
    this._reconnectData = null;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    const cbs = this.listeners.get(event);
    if (cbs) {
      const idx = cbs.indexOf(callback);
      if (idx > -1) cbs.splice(idx, 1);
    }
  }

  emit(event, data) {
    const cbs = this.listeners.get(event) || [];
    cbs.forEach(cb => cb(data));
  }

  connect(url) {
    this._url = url;
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          console.log('[NET] Connected');
          this.emit('connected');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this._handleMessage(msg);
          } catch (e) {
            console.error('[NET] Parse error:', e);
          }
        };

        this.ws.onclose = () => {
          const wasConnected = this.connected;
          this.connected = false;
          console.log('[NET] Disconnected');
          this.emit('disconnected');
          if (wasConnected) this._attemptReconnect();
        };

        this.ws.onerror = (err) => {
          console.error('[NET] Error');
          reject(err);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  _attemptReconnect() {
    if (!this._url) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnectFailed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[NET] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(async () => {
      try {
        await this.connect(this._url);
        if (this.currentMatchId) {
          this.send('reconnect', { matchId: this.currentMatchId });
        }
      } catch (e) {
        console.error('[NET] Reconnect failed');
      }
    }, delay);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        this.playerId = msg.playerId;
        this.playerName = msg.playerName;
        this.avatar = msg.avatar;
        this.stats = msg.stats;
        break;
      case 'profileUpdate':
        if (msg.name) this.playerName = msg.name;
        if (msg.avatar) this.avatar = msg.avatar;
        if (msg.stats) this.stats = msg.stats;
        this.emit('profileUpdated', msg);
        break;
      case 'matchFound':
        this.currentMatchId = msg.matchId;
        break;
      case 'reconnected':
        this.currentMatchId = msg.matchId;
        break;
      case 'matchResult':
        this.currentMatchId = null;
        break;
      case 'rematchStarted':
        this.currentMatchId = msg.balls ? this.currentMatchId : this.currentMatchId;
        break;
      case 'shotRejected':
        console.warn('[NET] Shot rejected:', msg.reason);
        break;
      case 'error':
        console.error('[NET] Server error:', msg.message);
        break;
    }

    this.emit(msg.type, msg);
  }

  send(type, data = {}) {
    if (!this.connected || !this.ws) return false;
    try {
      this.ws.send(JSON.stringify({ type, ...data }));
      return true;
    } catch (e) {
      console.error('[NET] Send error:', e);
      return false;
    }
  }

  setName(name) { this.send('setName', { name }); }
  joinQueue(matchType) { this.send('joinQueue', { matchType }); }
  joinQueueCompetitive(tierId) { this.send('joinQueue', { matchType: 'competitive', tierId }); }
  leaveQueue() { this.send('leaveQueue'); }
  shoot(angle, power) { this.send('shoot', { angle, power }); }
  placeCueBall(x, y) { this.send('placeCueBall', { x, y }); }
  requestRematch() { this.send('rematch'); }
  reconnectToMatch(matchId) { this.send('reconnect', { matchId }); }

  disconnect() {
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.connected = false;
    this.currentMatchId = null;
  }
}
