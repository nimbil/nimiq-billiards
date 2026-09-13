import { createRack, TABLE, CUE_BALL_ID, MAX_POWER } from './engine/constants.js';
import { PhysicsEngine } from './engine/physics.js';
import { Renderer } from './engine/renderer.js';
import { InputHandler } from './engine/input.js';
import { GameRules, GAME_STATES, PLAYER_TYPES } from './engine/rules.js';
import { NimiqWallet } from './nimiq/wallet.js';
import { NetworkClient } from './network/client.js';
import { AIPlayer } from './ai/ai-player.js';
import { MATCH_TIERS, formatNim, nimToLamports, canEnterTier, getTierById, calculatePrizePool } from './nimiq/economy.js';
import { 
  createToast, 
  MessageType,
  WalletMessages, 
  TransactionMessages, 
  MatchMessages, 
  SettlementMessages,
  GameMessages,
  ServerMessages 
} from './ui/messages.js';
import { loadLeaderboardPreview, setupLobbyLeaderboardTabs, setCurrentPlayerName } from './ui/leaderboard.js';


class NimiqBilliards {
  constructor() {
    this.canvas = document.getElementById('pool-table');
    this.renderer = new Renderer(this.canvas);
    this.physics = new PhysicsEngine();
    this.input = new InputHandler(this.canvas, this.renderer);
    this.rules = new GameRules();
    this.wallet = new NimiqWallet();
    this.network = new NetworkClient();
    this.ai = null;

    this.balls = [];
    this.mode = null;
    this.selectedDifficulty = 'medium';
    this.selectedTier = null;
    this.myPlayerNumber = 0;
    this.isMyTurn = false;
    this.animFrame = null;
    this.gameOver = false;
    this.matchId = null;
    this.opponentName = '';
    this.opponentAvatar = '';
    this.rematchRequested = false;
    this.reconnecting = false;
    this.currentTierData = null;
    this.authToken = localStorage.getItem('bil_auth_token');
    this.gameLoop = this.gameLoop.bind(this);
    this._aiThinking = false;
    this._shotIsMine = false;

    this._restoreWalletFromStorage();
    this._updateWalletUI();

    this._setupScreens();
    this._setupWallet();
    this._setupNameEdit();
    this._setupAvatar();
    this._setupNetwork();
    this._setupInput();
    setupLobbyLeaderboardTabs();
    loadLeaderboardPreview();

    this._loadProfileFromServer();

    this._showScreen('loading-screen');
    setTimeout(() => this._showScreen('main-menu'), 1200);
  }

  _showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
  }

  _setupScreens() {
    document.querySelectorAll('.mode-card, .mode-card-v2, .menu-card').forEach(btn => {
      btn.addEventListener('click', () => this._handleMenuAction(btn.dataset.action));
    });

    document.getElementById('btn-tutorial')?.addEventListener('click', () => this._showScreen('tutorial-screen'));

    // Difficulty modal
    document.querySelectorAll('.difficulty-card-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedDifficulty = btn.dataset.difficulty;
        document.getElementById('difficulty-modal')?.classList.add('hidden');
        this._launchAIGame();
      });
    });

    document.getElementById('btn-cancel-match').addEventListener('click', () => {
      if (this._matchmakingTimeout) { clearTimeout(this._matchmakingTimeout); this._matchmakingTimeout = null; }
      if (this._matchmakingToast) { this._matchmakingToast.remove(); this._matchmakingToast = null; }
      this.network.leaveQueue();
      this._showScreen('main-menu');
    });
    document.getElementById('btn-leave-game').addEventListener('click', () => this._leaveGame());
    document.getElementById('btn-leave-game-mobile')?.addEventListener('click', () => this._leaveGame());
    
    // Mobile controls
    const mobilePowerSlider = document.getElementById('mobile-power-slider');
    if (mobilePowerSlider) {
      mobilePowerSlider.addEventListener('input', (e) => {
        const power = parseInt(e.target.value) / 100;
        const mobilePowerValue = document.getElementById('mobile-power-value');
        if (mobilePowerValue) mobilePowerValue.textContent = `${Math.round(power * 100)}%`;
        if (this.input) this.input.setExternalPower(power);
      });
    }
    
    document.getElementById('btn-mobile-shoot')?.addEventListener('click', () => {
      if (this.input) this.input.triggerShoot();
    });
    
    document.getElementById('btn-mobile-cancel')?.addEventListener('click', () => {
      if (this.input) this.input.cancelAim();
    });
    
    document.getElementById('btn-restart-game')?.addEventListener('click', () => this._restartGame());
    document.getElementById('btn-restart').addEventListener('click', () => this._restartGame());
    document.getElementById('btn-lobby').addEventListener('click', () => { this._hideGameOver(); this._leaveGame(); });
    document.getElementById('btn-back-tutorial').addEventListener('click', () => this._showScreen('main-menu'));
  }

  _handleMenuAction(action) {
    switch (action) {
      case 'play-ai':
        if (!this.wallet.connected) {
          createToast({ message: 'Connect your wallet first to play', type: 'error' });
          return;
        }
        this._showDifficultyModal();
        break;
      case 'play-free':
        if (!this.wallet.connected) {
          createToast({ message: 'Connect your wallet first to play online matches', type: 'error' });
          return;
        }
        this._startOnlineMatch('free');
        break;
      case 'play-competitive': this._showCompetitiveModal(); break;
      case 'tutorial': this._showScreen('tutorial-screen'); break;
    }
  }

  _showDifficultyModal() {
    const modal = document.getElementById('difficulty-modal');
    if (modal) modal.classList.remove('hidden');
  }

  _showCompetitiveModal() {
    if (!this.wallet.connected) {
      createToast({ message: 'Connect your wallet first to play competitive matches', type: 'error' });
      return;
    }
    this._renderTierCardsModal();
    const modal = document.getElementById('competitive-modal');
    if (modal) modal.classList.remove('hidden');
  }

  _renderTierCardsModal() {
    const container = document.getElementById('tier-grid-modal');
    if (!container) return;
    const balance = this.wallet.balance;
    const balanceEl = document.getElementById('competitive-balance-modal');
    if (balanceEl) balanceEl.textContent = formatNim(balance);
    
    const summaryEl = document.getElementById('transaction-summary-modal');
    if (summaryEl) summaryEl.classList.add('hidden');
    
    container.innerHTML = MATCH_TIERS.map(tier => {
      const prize = calculatePrizePool(tier);
      const check = canEnterTier(balance, tier.id);
      const disabled = !check.allowed;
      return `
        <button class="tier-card-modal ${disabled ? 'tier-disabled-modal' : ''}" data-tier="${tier.id}" ${disabled ? 'disabled' : ''}>
          <div class="tier-icon-modal" style="color:${tier.color}">${tier.icon}</div>
          <h3>${tier.name}</h3>
          <div class="tier-entry-modal">${formatNim(tier.entryFee)} entry</div>
          <div class="tier-prize-modal">Win ${formatNim(prize.winnerPrize)}</div>
          ${disabled ? '' : '<div class="tier-available-modal">Available</div>'}
        </button>
      `;
    }).join('');

    container.querySelectorAll('.tier-card-modal:not(.tier-disabled-modal)').forEach(card => {
      card.addEventListener('click', () => {
        container.querySelectorAll('.tier-card-modal').forEach(c => c.classList.remove('selected-modal'));
        card.classList.add('selected-modal');
        this.selectedTier = card.dataset.tier;
        this._showTransactionSummaryModal(card.dataset.tier);
      });
    });
  }

  _showTransactionSummaryModal(tierId) {
    const tier = getTierById(tierId);
    if (!tier) return;
    
    const prize = calculatePrizePool(tier);
    const summaryEl = document.getElementById('transaction-summary-modal');
    if (!summaryEl) return;
    
    document.getElementById('tx-tier-name-modal').textContent = `${tier.name} Entry`;
    document.getElementById('tx-entry-fee-modal').textContent = formatNim(tier.entryFee);
    document.getElementById('tx-platform-fee-modal').textContent = formatNim(prize.platformFeeLamports);
    document.getElementById('tx-total-modal').textContent = formatNim(tier.entryFee);
    document.getElementById('tx-prize-modal').textContent = formatNim(prize.winnerPrize);
    
    summaryEl.classList.remove('hidden');
    
    const findMatchBtn = document.getElementById('btn-find-match-modal');
    if (findMatchBtn) {
      const newBtn = findMatchBtn.cloneNode(true);
      findMatchBtn.parentNode.replaceChild(newBtn, findMatchBtn);
      
      newBtn.addEventListener('click', () => {
        this._showTransactionApproval(tier);
      });
    }
  }

  _showTransactionApproval(tier) {
    const modal = document.getElementById('tx-approval-modal');
    if (!modal) return;
    
    document.getElementById('modal-amount').textContent = formatNim(tier.entryFee);
    
    document.getElementById('competitive-modal')?.classList.add('hidden');
    modal.classList.remove('hidden');
    
    // Setup buttons
    const cancelBtn = document.getElementById('btn-cancel-tx');
    const confirmBtn = document.getElementById('btn-confirm-tx');
    const closeBtn = document.getElementById('btn-close-modal');
    
    // Remove old listeners by cloning
    const newCancelBtn = cancelBtn.cloneNode(true);
    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCloseBtn = closeBtn.cloneNode(true);
    
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
    
    newCancelBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
    
    newCloseBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
    
    newConfirmBtn.addEventListener('click', async () => {
      // Hide modal and start match
      modal.classList.add('hidden');
      this._startOnlineMatch('competitive');
    });
  }

  _launchAIGame() {
    this.mode = 'ai';
    this.ai = new AIPlayer(this.selectedDifficulty);
    this._initGame();
  }

  _initGame() {
    this.myPlayerNumber = this.myPlayerNumber || 1;
    this.balls = createRack();
    this.rules.reset();
    this.rules.startBreak();
    this.isMyTurn = true;
    this.gameOver = false;
    this.rematchRequested = false;

    this._hideGameOver();
    this._hideRematchRequest();
    this._showScreen('game-screen');

    const aiLabel = this.mode === 'ai'
      ? `AI (${this.selectedDifficulty.charAt(0).toUpperCase() + this.selectedDifficulty.slice(1)})`
      : this.opponentName || 'Opponent';
    this._updatePlayerPanels('You', aiLabel);
    this._startGameLoop();
    this.input.enable();
    this._setMessage('Your break! Click and drag to shoot.');
    this._updateTurnIndicator();
    this._updateStats();
  }

  _initGameFromServer(balls, rules, playerNumber) {
    this.myPlayerNumber = playerNumber;
    this.balls = balls.map(b => ({
      ...b,
      stripe: b.id >= 9,
      solid: b.id >= 1 && b.id <= 7,
      isEight: b.id === 8,
    }));
    this.rules.turn = rules.turn;
    this.rules.state = rules.state;
    this.rules.player1Type = rules.player1Type;
    this.rules.player2Type = rules.player2Type;
    this.rules.foul = rules.foul;
    this.rules.foulReason = rules.foulReason;
    this.gameOver = false;
    this.isMyTurn = this.rules.turn === this.myPlayerNumber;

    this._hideGameOver();
    this._hideRematchRequest();
    this._showScreen('game-screen');
    this._updatePlayerPanels('You', this.opponentName || 'Opponent');
    this._startGameLoop();
    this._updateTurnIndicator();
    this._updateStats();
    this._updateMatchInfo();

    if (this.isMyTurn) {
      this.input.enable();
      if (this.rules.state === 'ball_in_hand') {
        this.input.setBallInHandMode(this.input.onBallInHand);
        this._setMessage('Ball in hand - click to place cue ball');
      } else {
        this._setMessage('Your break! Click and drag to shoot.');
      }
    } else {
      this.input.disable();
      this._setMessage('Opponent breaks first...');
    }
  }

  _updateTierInfo() {
    const el = document.getElementById('turn-indicator');
    if (this.currentTierData) {
      const tierName = getTierById(this.currentTierData.tierId)?.name || this.currentTierData.tierId;
      el.setAttribute('data-tier', `${tierName} | Entry: ${this.currentTierData.entryFeeFormatted} | Prize: ${this.currentTierData.winnerPrizeFormatted}`);
    } else {
      el.removeAttribute('data-tier');
    }
  }

  _restartGame() {
    this._hideGameOver();
    this._hideRematchRequest();
    if (this.mode === 'ai') {
      this._launchAIGame();
    } else {
      this._leaveGame();
    }
  }

  async _startOnlineMatch(matchType) {
    this.mode = 'online';
    this.ai = null;
    this._showScreen('matchmaking-screen');

    const savedName = localStorage.getItem('bil_player_name');
    this._matchmakingToast = createToast(MatchMessages.SEARCHING, 0);

    const statusEl = document.getElementById('matchmaking-status');
    if (matchType === 'competitive' && this.selectedTier) {
      const tier = getTierById(this.selectedTier);
      if (statusEl) statusEl.textContent = `Waiting for ${tier.name} opponent (${formatNim(tier.entryFee)} entry)...`;
    } else {
      if (statusEl) statusEl.textContent = 'Waiting for opponent...';
    }

    this._matchmakingTimeout = null;

    try {
      const wsUrl = `ws://${window.location.hostname}:3001/ws`;
      await this.network.connect(wsUrl);
      const savedName = localStorage.getItem('bil_player_name');
      if (savedName) this.network.setName(savedName);
      await new Promise(r => setTimeout(r, 100));
      if (matchType === 'competitive' && this.selectedTier) {
        this.network.joinQueueCompetitive(this.selectedTier);
      } else {
        this.network.joinQueue(matchType);
      }
    } catch (err) {
      clearTimeout(this._matchmakingTimeout);
      createToast(ServerMessages.SERVER_ERROR);
      this._showScreen('main-menu');
    }
  }

  _restoreWalletFromStorage() {
    const savedAddress = localStorage.getItem('bil_wallet_address');
    const savedBalance = parseInt(localStorage.getItem('bil_wallet_balance') || '0', 10);

    let _balance = 0;
    Object.defineProperty(this.wallet, 'balance', {
      get() { return _balance; },
      set(val) {
        _balance = val;
        if (this.connected && this.address) {
          localStorage.setItem('bil_wallet_balance', String(val));
        }
      },
      enumerable: true,
      configurable: true,
    });

    if (savedAddress) {
      this.wallet.connected = true;
      this.wallet.address = savedAddress;
      this.wallet.balance = savedBalance;
      if (!this.wallet.adapter) {
        this.wallet.adapter = this.wallet._createAdapter();
      }
      this.wallet.adapter.connected = true;
      this.wallet.adapter.address = savedAddress;
      this.wallet.adapter.connectedAddress = savedAddress;
      console.log('[WALLET] Restored from storage:', savedAddress);
    }
  }

  _persistWalletAddress() {
    if (this.wallet.connected && this.wallet.address) {
      localStorage.setItem('bil_wallet_address', this.wallet.address);
    } else {
      localStorage.removeItem('bil_wallet_address');
      localStorage.removeItem('bil_wallet_balance');
    }
  }

  _setupWallet() {
    const btnConnect = document.getElementById('btn-connect-wallet');
    const btnDisconnect = document.getElementById('btn-disconnect-wallet');
    const btnTopUp = document.getElementById('btn-topup');

    btnConnect?.addEventListener('click', async () => {
      const connectingToast = createToast(WalletMessages.CONNECTING, 0);
      try {
        // Step 1: Get nonce from server
        const nR = await fetch('/api/auth/nonce', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        if (!nR.ok) throw new Error('Auth server unavailable');
        const { nonce } = await nR.json();

        // Step 2: Sign nonce via wallet
        const msg = `Sign this message to authenticate with Nimiq Billiards.\n\nNonce: ${nonce}`;
        const res = await this.wallet.connectAndSign(msg);

        // connectAndSign now throws on cancel/failure instead of returning null
        if (!res) {
          connectingToast.remove();
          createToast(WalletMessages.CONNECTION_FAILED);
          return;
        }

        // Step 3: Send to server for login
        const lR = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: res.address, message: msg, signature: res.signature }),
        });
        if (!lR.ok) throw new Error('Login failed');
        const data = await lR.json();

        // Step 4: Store auth token and balance
        localStorage.setItem('bil_auth_token', data.token);
        this.authToken = data.token;
        this.wallet.balance = data.balance;
        this._persistWalletAddress();
        this._updateWalletUI();
        this._updateBalanceDisplay(data.balance);
        connectingToast.remove();
        createToast(WalletMessages.CONNECTED);

        // Step 5: Load profile from server
        if (data.profile) {
          const nameEl = document.getElementById('profile-name');
          if (nameEl && data.profile.name) nameEl.textContent = data.profile.name;
          if (data.profile.name) {
            this.network.playerName = data.profile.name;
            setCurrentPlayerName(data.profile.name);
            localStorage.setItem('bil_player_name', data.profile.name);
          }
          if (data.profile.avatar) {
            this._applyAvatar(data.profile.avatar);
            localStorage.setItem('bil_player_avatar', data.profile.avatar);
          }
        }

        // Step 6: Send address to game server
        this.network.send('setNimAddress', { address: res.address });
      } catch (e) {
        connectingToast.remove();
        console.error('[AUTH] Login failed:', e);
        // Show specific message based on error type
        if (e.type === 'USER_REJECTED' || e.message?.includes('cancel') || e.message?.includes('reject') || e.message?.includes('abort')) {
          createToast(WalletMessages.CONNECTION_CANCELLED);
        } else if (e.type === 'WALLET_NOT_FOUND' || e.message?.includes('not found') || e.message?.includes('not detected')) {
          createToast(WalletMessages.WALLET_NOT_FOUND);
        } else {
          createToast({ message: 'Connection failed: ' + e.message, type: 'error' });
        }
      }
    });

    btnDisconnect?.addEventListener('click', async () => {
      localStorage.removeItem('bil_auth_token');
      this.authToken = null;
      await this.wallet.disconnect();
      this._persistWalletAddress();
      this._updateWalletUI();
      const nameEl = document.getElementById('profile-name');
      if (nameEl) nameEl.textContent = 'Guest';
      this._applyAvatar('man1');
      setCurrentPlayerName('');
    });

    btnTopUp?.addEventListener('click', async () => {
      if (!this.wallet.connected) {
        createToast({ message: 'Connect your wallet first', type: 'error' });
        return;
      }
      this._showTopUpModal();
    });

    const btnWithdraw = document.getElementById('btn-withdraw');
    btnWithdraw?.addEventListener('click', async () => {
      if (!this.wallet.connected) {
        createToast({ message: 'Connect your wallet first', type: 'error' });
        return;
      }
      this._showWithdrawModal();
    });

    this.wallet.on('connected', () => {
      this._updateWalletUI();
    });
    
    this.wallet.on('disconnected', () => {
      this._updateWalletUI();
      createToast(WalletMessages.DISCONNECTED);
    });
    
    this.wallet.on('balanceUpdated', (balance) => {
      this._updateBalanceDisplay(balance);
    });
  }

  _updateBalanceDisplay(balance) {
    const el = document.getElementById('wallet-balance');
    if (el) el.textContent = this.wallet.formatBalance(balance);
    const headerBal = document.getElementById('header-balance');
    if (headerBal) headerBal.textContent = this.wallet.formatBalance(balance);
    const sidebarBal = document.getElementById('sidebar-balance');
    if (sidebarBal) sidebarBal.textContent = this.wallet.formatBalance(balance);
    const compBal = document.getElementById('competitive-balance-modal');
    if (compBal) compBal.textContent = formatNim(balance);
  }

  _setupNameEdit() {
    const btnEdit = document.getElementById('btn-edit-name');
    const row = document.getElementById('name-input-row');
    const input = document.getElementById('name-input');
    const btnSave = document.getElementById('btn-save-name');
    const btnCancel = document.getElementById('btn-cancel-name');
    const nameEl = document.getElementById('profile-name');
    const avatarPicker = document.getElementById('avatar-picker');
    const avatarRing = document.getElementById('btn-edit-avatar');

    if (!btnEdit || !row || !input) return;

    btnEdit.addEventListener('click', () => {
      if (!this.wallet.connected) {
        createToast({ message: 'Connect your wallet first', type: 'error' });
        return;
      }
      row.classList.remove('hidden');
      if (avatarPicker) avatarPicker.classList.add('hidden');
      input.value = nameEl?.textContent || '';
      input.focus();
    });

    if (avatarRing) {
      avatarRing.addEventListener('click', () => {
        if (!this.wallet.connected) {
          createToast({ message: 'Connect your wallet first', type: 'error' });
          return;
        }
        if (avatarPicker) avatarPicker.classList.toggle('hidden');
        row.classList.add('hidden');
      });
    }

    const hide = () => {
      row.classList.add('hidden');
      if (avatarPicker) avatarPicker.classList.add('hidden');
    };
    btnCancel.addEventListener('click', hide);

    const save = async () => {
      const name = input.value.trim();
      if (!name || name.length < 2 || name.length > 20) {
        createToast({ message: 'Name must be 2-20 characters', type: 'error' });
        return;
      }
      localStorage.setItem('bil_player_name', name);
      localStorage.setItem('bil_player_avatar', this.network.avatar || 'man1');
      hide();
      if (this.network) this.network.setName(name);
      setCurrentPlayerName(name);
      const nameEl = document.getElementById('profile-name');
      if (nameEl) nameEl.textContent = name;
      try {
        const res = await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.authToken}` },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) {
          console.warn('[PROFILE] Server save failed, name stored locally');
        }
      } catch (e) {
        console.warn('[PROFILE] Server save failed, name stored locally');
      }
      createToast({ message: `Name changed to "${name}"`, type: 'success' });
    };

    btnSave.addEventListener('click', save);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') hide(); });
  }

  _setupAvatar() {
    this._applyAvatar('man1');

    document.querySelectorAll('.avatar-option').forEach(opt => {
      opt.addEventListener('click', () => {
        if (!this.wallet.connected) {
          createToast({ message: 'Connect your wallet first', type: 'error' });
          return;
        }
        document.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        const avatarId = opt.dataset.avatar;
        this._applyAvatar(avatarId);
        try {
          fetch('/api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.authToken}` },
            body: JSON.stringify({ avatar: avatarId }),
          });
        } catch (e) {}
      });
    });
  }

  _applyAvatar(avatarId) {
    const img = document.getElementById('avatar-img');
    if (img) img.src = `/avatars/${avatarId}.svg`;
    // Update in-game avatars
    const p1 = document.getElementById('p1-avatar');
    if (p1) p1.style.backgroundImage = `url(/avatars/${avatarId}.svg)`;
  }

  async _showTopUpModal() {
    const amounts = [100, 500, 1000, 5000];
    const container = document.getElementById('topup-amounts');
    if (!container) return;
    container.innerHTML = amounts.map(nim => `
      <button class="btn btn-primary topup-option" data-amount="${nim}">
        ${nim} NIM
      </button>
    `).join('');

    const modal = document.getElementById('topup-modal');
    if (modal) modal.classList.remove('hidden');

    container.querySelectorAll('.topup-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        const amountNim = parseInt(btn.dataset.amount);
        await this._executeTopUp(amountNim);
      });
    });
  }

  async _executeTopUp(amountNim) {
    try {
      createToast({ message: `Opening wallet to top up ${amountNim} NIM...`, type: 'info' });

      // Get platform wallet address
      const pR = await fetch('/api/platform-balance');
      const pData = await pR.json();
      const platformWallet = pData.wallet;
      console.log('[TOPUP] Platform wallet:', platformWallet);

      // Execute checkout via Hub API
      const proof = await this.wallet.topUp(platformWallet, amountNim);
      console.log('[TOPUP] Hub proof:', proof);
      if (!proof) throw new Error('Transaction cancelled');

      // Verify with server
      console.log('[TOPUP] Sending to server:', { txHash: proof.hash, sender: proof.sender, recipient: proof.recipient, value: proof.value });
      const tR = await fetch('/api/topup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({
          txHash: proof.hash,
          sender: proof.sender,
          recipient: proof.recipient,
          value: proof.value,
        }),
      });
      console.log('[TOPUP] Server response:', tR.status, await tR.clone().text());
      if (!tR.ok) throw new Error('Top-up verification failed');
      const tData = await tR.json();

      this.wallet.balance = tData.balance;
      this._updateBalanceDisplay(tData.balance);
      createToast({ message: `Successfully topped up ${amountNim} NIM!`, type: 'success' });

      // Close modal
      document.getElementById('topup-modal')?.classList.add('hidden');
    } catch (e) {
      console.error('[TOPUP] Failed:', e);
      createToast({ message: e.message || 'Top-up failed', type: 'error' });
    }
  }

  _showWithdrawModal() {
    const modal = document.getElementById('withdraw-modal');
    if (!modal) return;
    const avail = document.getElementById('withdraw-available');
    const input = document.getElementById('withdraw-amount');
    const btnConfirm = document.getElementById('btn-confirm-withdraw');
    if (avail) avail.textContent = this.wallet.formatBalance(this.wallet.balance);
    if (input) { input.value = ''; input.max = this.wallet.balance / 100000; }
    modal.classList.remove('hidden');

    if (btnConfirm) btnConfirm.onclick = async () => {
      const nimVal = parseFloat(input?.value);
      if (!nimVal || nimVal <= 0) {
        createToast({ message: 'Enter a valid amount', type: 'error' });
        return;
      }
      const lamports = Math.round(nimVal * 100000);
      if (lamports > this.wallet.balance) {
        createToast({ message: 'Insufficient balance', type: 'error' });
        return;
      }
      await this._executeWithdraw(lamports, nimVal);
    };
  }

  async _executeWithdraw(lamports, nimVal) {
    try {
      createToast({ message: `Withdrawing ${nimVal} NIM...`, type: 'info' });
      const res = await fetch('/api/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({ amount: lamports }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Withdrawal failed');
      }
      const data = await res.json();
      this.wallet.balance = data.balance;
      this._updateBalanceDisplay(data.balance);
      this._updateWalletUI();
      createToast({ message: `Withdrew ${nimVal} NIM successfully!`, type: 'success' });
      document.getElementById('withdraw-modal')?.classList.add('hidden');
    } catch (e) {
      console.error('[WITHDRAW] Failed:', e);
      createToast({ message: e.message || 'Withdrawal failed', type: 'error' });
    }
  }

  _updateWalletUI() {
    const d = document.getElementById('wallet-disconnected');
    const c = document.getElementById('wallet-connected');
    const a = document.getElementById('wallet-address');
    const b = document.getElementById('wallet-balance');
    const btnConnect = document.getElementById('btn-connect-wallet');
    const badge = document.getElementById('wallet-connected-badge');
    const addrShort = document.getElementById('wallet-address-short');
    const btnTopUp = document.getElementById('btn-topup');
    const btnWithdraw = document.getElementById('btn-withdraw');
    if (this.wallet.connected) {
      d?.classList.add('hidden'); c?.classList.remove('hidden');
      if (a) a.textContent = this.wallet.formatAddress(this.wallet.address);
      if (b) b.textContent = this.wallet.formatBalance(this.wallet.balance);
      if (btnConnect) btnConnect.classList.add('hidden');
      if (badge) {
        badge.classList.remove('hidden');
        if (addrShort) addrShort.textContent = this.wallet.formatAddress(this.wallet.address);
      }
      if (btnTopUp) btnTopUp.classList.remove('hidden');
      if (btnWithdraw) btnWithdraw.classList.remove('hidden');
    } else {
      d?.classList.remove('hidden'); c?.classList.add('hidden');
      if (btnConnect) btnConnect.classList.remove('hidden');
      if (badge) badge.classList.add('hidden');
      if (btnTopUp) btnTopUp.classList.add('hidden');
      if (btnWithdraw) btnWithdraw.classList.add('hidden');
    }
  }

  _setupNetwork() {
    this.network.on('welcome', (msg) => {
      this.network.playerName = msg.playerName || 'Guest';
      this.network.avatar = msg.avatar;
      this.network.stats = msg.stats;
      if (msg.balance !== undefined) {
        this.wallet.balance = msg.balance;
        this._updateBalanceDisplay(msg.balance);
      }

      const token = localStorage.getItem('bil_auth_token');

      if (this.wallet.connected && this.wallet.address) {
        this.network.send('setNimAddress', { address: this.wallet.address });
      }
      if (token) {
        this.network.send('authenticate', { token });
      }

      const savedName = localStorage.getItem('bil_player_name');
      const savedAvatar = localStorage.getItem('bil_player_avatar');
      const savedStats = localStorage.getItem('bil_player_stats');
      if (savedName) {
        this.network.playerName = savedName;
        const nameEl = document.getElementById('profile-name');
        if (nameEl) nameEl.textContent = savedName;
        setCurrentPlayerName(savedName);
      }
      if (savedAvatar) {
        this._applyAvatar(savedAvatar);
        this.network.avatar = savedAvatar;
      }
      if (savedStats) {
        try { this._updateProfileStats(JSON.parse(savedStats)); } catch(e) {}
      }

      this._loadProfileFromServer();
    });

    this.network.on('profileUpdated', (msg) => {
      if (msg.name && msg.name !== 'Guest' && msg.name !== 'Guest Player') {
        this.network.playerName = msg.name;
        const nameEl = document.getElementById('profile-name');
        if (nameEl) nameEl.textContent = msg.name;
        setCurrentPlayerName(msg.name);
        localStorage.setItem('bil_player_name', msg.name);
      }
      if (msg.avatar) {
        this._applyAvatar(msg.avatar);
        localStorage.setItem('bil_player_avatar', msg.avatar);
      }
      if (msg.balance !== undefined) {
        this.wallet.balance = msg.balance;
        this._updateBalanceDisplay(msg.balance);
      }
      const s = msg.stats || {};
      localStorage.setItem('bil_player_stats', JSON.stringify(s));
      const el = (id) => document.getElementById(id);
      if (el('profile-wins')) el('profile-wins').textContent = s.wins || 0;
      if (el('profile-games')) el('profile-games').textContent = s.gamesPlayed || 0;
      if (el('profile-winrate')) {
        el('profile-winrate').textContent = s.gamesPlayed > 0 ? Math.round((s.wins / s.gamesPlayed) * 1000) / 10 + '%' : '0%';
      }
      if (el('profile-level')) el('profile-level').textContent = s.level || 1;
      if (el('profile-rating')) el('profile-rating').textContent = `${(s.xp || 0) % 800} / 800 XP`;
      const fill = document.getElementById('xp-bar-fill');
      if (fill) fill.style.width = `${((s.xp || 0) % 800 / 800) * 100}%`;
    });

    this.network.on('matchFound', (msg) => {
      clearTimeout(this._matchmakingTimeout);
      if (this._matchmakingToast) { this._matchmakingToast.remove(); this._matchmakingToast = null; }
      this.mode = 'online';
      this.matchId = msg.matchId;
      this.opponentName = msg.opponentName;
      this.opponentAvatar = msg.opponentAvatar;
      this.network.currentMatchId = msg.matchId;
      this.currentTierData = msg.tier || null;
      if (msg.balance !== undefined) this.wallet.balance = msg.balance;
      this._updateWalletUI();
      this._initGameFromServer(msg.balls, msg.rules, msg.playerNumber);
    });

    this.network.on('reconnected', (msg) => {
      this.reconnecting = false;
      this.mode = 'online';
      this.matchId = msg.matchId;
      this.opponentName = msg.opponentName;
      this.opponentAvatar = msg.opponentAvatar;
      this.network.currentMatchId = msg.matchId;
      this.currentTierData = msg.tier || null;
      if (msg.balance !== undefined) this.wallet.balance = msg.balance;
      this._updateWalletUI();
      this._initGameFromServer(msg.balls, msg.rules, msg.playerNumber);
      createToast(MatchMessages.OPPONENT_RECONNECTED);
    });

    this.network.on('shotExecuted', (msg) => {
      if (msg.playerId !== this.network.playerId) {
        this._shotIsMine = false;
        this.balls = msg.balls.map(b => ({
          ...b,
          stripe: b.id >= 9,
          solid: b.id >= 1 && b.id <= 7,
          isEight: b.id === 8,
        }));
        this.rules.onShotStart(this.balls);
        const cueBall = this.balls.find(b => b.id === CUE_BALL_ID);
        if (cueBall && !cueBall.pocketed && msg.angle !== undefined && msg.power !== undefined) {
          cueBall.vx = Math.cos(msg.angle) * msg.power;
          cueBall.vy = Math.sin(msg.angle) * msg.power;
        }
        this.rules.state = 'shooting';
        this._setMessage('Opponent is shooting...');
      }
    });

    this.network.on('serverStateUpdate', (msg) => {
      this._applyServerState(msg.balls, msg.rules, msg.message);
    });

    this.network.on('cueBallPlaced', (msg) => {
      this._applyServerState(msg.balls, msg.rules);
    });

    this.network.on('shotRejected', (msg) => {
      this._setMessage('Shot rejected: ' + msg.reason);
      this.isMyTurn = true;
      this.input.enable();
      this._updateTurnIndicator();
    });

    this.network.on('matchResult', (msg) => {
      // IMPORTANT: Only show "match won" - never show prize amount until settlement is verified
      if (msg.won) {
        this._showGameOver(true, msg.reason);
        // If there's settlement info, show it after a delay
        if (msg.prize && msg.prize.settled) {
          createToast(SettlementMessages.WIN_VERIFIED(msg.prize.winnerPrizeFormatted));
          if (msg.prize.balance !== undefined) {
            this.wallet.balance = msg.prize.balance;
            this._updateWalletUI();
          }
        } else {
          createToast(SettlementMessages.WIN_PENDING);
        }
      } else {
        this._showGameOver(false, msg.reason);
        createToast(SettlementMessages.LOSS);
      }
      this._updateStatsFromResult(msg);
      loadLeaderboardPreview();
    });

    this.network.on('opponentDisconnected', (msg) => {
      this._showDisconnectNotice(msg.gracePeriodMs);
      createToast(MatchMessages.OPPONENT_DISCONNECTED);
    });

    this.network.on('opponentReconnected', () => {
      this._hideDisconnectNotice();
      createToast(MatchMessages.OPPONENT_RECONNECTED);
    });

    this.network.on('rematchRequest', (msg) => {
      this._showRematchRequest(msg.from);
      createToast(MatchMessages.REMATCH_REQUESTED);
    });

    this.network.on('rematchStarted', (msg) => {
      this._hideRematchRequest();
      this._hideGameOver();
      this.rematchRequested = false;
      if (msg.balls && msg.rules) {
        this._initGameFromServer(msg.balls, msg.rules, this.myPlayerNumber);
      } else {
        this._initGame();
      }
      createToast(MatchMessages.REMATCH_ACCEPTED);
    });

    this.network.on('queueUpdate', (msg) => {
      const el = document.getElementById('matchmaking-status');
      if (el) el.textContent = msg.position > 0 ? `Position in queue: ${msg.position}` : 'Searching...';
      if (msg.refunded) {
        createToast({ message: msg.message || 'Entry fee refunded', type: 'info' });
        this._renderTierCardsModal();
        document.getElementById('competitive-modal')?.classList.remove('hidden');
      }
    });

    this.network.on('balanceUpdate', (msg) => {
      if (msg.balance !== undefined) {
        this.wallet.balance = msg.balance;
        this._updateBalanceDisplay(msg.balance);
      }
      if (msg.refunded) {
        createToast({ message: `Refunded ${formatNim(msg.refunded)} - no opponent found`, type: 'info' });
      }
      if (msg.deducted) {
        createToast({ message: `Deducted ${formatNim(msg.deducted)} entry fee`, type: 'info' });
      }
    });

    this.network.on('error', (msg) => {
      if (msg.code === 'INSUFFICIENT_BALANCE') {
        createToast({ message: msg.message, type: 'error', duration: 6000 });
        this._showInsufficientBalanceModal(msg.need, msg.have);
      } else {
        createToast({ message: msg.message || 'Server error', type: 'error' });
      }
    });

    this.network.on('disconnected', () => {
      if (this.mode === 'online' && !this.reconnecting) {
        this._showDisconnectNotice(30000);
        createToast(ServerMessages.DISCONNECTED);
      }
    });

    this.network.on('reconnectFailed', () => {
      createToast(ServerMessages.RECONNECT_FAILED);
      setTimeout(() => this._leaveGame(), 2000);
    });
  }

  _applyServerShot(balls, rules, shooterId) {
    if (shooterId !== this.network.playerId) {
      this.balls = balls.map(b => ({
        ...b,
        stripe: b.id >= 9,
        solid: b.id >= 1 && b.id <= 7,
        isEight: b.id === 8,
      }));
      this.rules.turn = rules.turn;
      this.rules.state = rules.state;
      this.rules.player1Type = rules.player1Type;
      this.rules.player2Type = rules.player2Type;
      this.rules.foul = rules.foul;
      this.rules.foulReason = rules.foulReason;
      this._updateTurnIndicator();
    }
  }

  _applyServerState(balls, rules, message) {
    this.balls = balls.map(b => ({
      ...b,
      stripe: b.id >= 9,
      solid: b.id >= 1 && b.id <= 7,
      isEight: b.id === 8,
    }));
    this.rules.turn = rules.turn;
    this.rules.state = rules.state;
    this.rules.player1Type = rules.player1Type;
    this.rules.player2Type = rules.player2Type;
    this.rules.foul = rules.foul;
    this.rules.foulReason = rules.foulReason;

    this.isMyTurn = this.rules.turn === this.myPlayerNumber;

    if (this.isMyTurn && !this.gameOver) {
      this.input.enable();
      if (this.rules.state === 'ball_in_hand') {
        this.input.setBallInHandMode(this.input.onBallInHand);
        this._setMessage('Ball in hand - click to place cue ball');
      } else {
        this._setMessage('Your turn!');
      }
    } else {
      this.input.disable();
    }

    if (message) this._setMessage(message);
    this._updateTurnIndicator();
  }

  _setupInput() {
    this.input.onShoot = (angle, power) => this._executeShot(angle, power);
    this.input.onBallInHand = (x, y) => this._placeCueBall(x, y);
  }

  _executeShot(angle, power) {
    if (!this.isMyTurn || this.gameOver) return;

    const cueBall = this.balls.find(b => b.id === CUE_BALL_ID);
    if (!cueBall || cueBall.pocketed) return;

    this.rules.onShotStart(this.balls);
    cueBall.vx = Math.cos(angle) * power;
    cueBall.vy = Math.sin(angle) * power;

    this._shotIsMine = true;

    if (this.mode === 'online') {
      this.network.send('shoot', { matchId: this.matchId, angle, power });
    }

    this.isMyTurn = false;
    this.input.disable();
    this._updateTurnIndicator();
  }

  _placeCueBall(x, y) {
    const cueBall = this.balls.find(b => b.id === CUE_BALL_ID);
    if (!cueBall) return;

    const minX = TABLE.RAIL_WIDTH + 12, maxX = TABLE.WIDTH - TABLE.RAIL_WIDTH - 12;
    const minY = TABLE.RAIL_WIDTH + 12, maxY = TABLE.HEIGHT - TABLE.RAIL_WIDTH - 12;
    cueBall.x = Math.max(minX, Math.min(maxX, x));
    cueBall.y = Math.max(minY, Math.min(maxY, y));
    cueBall.pocketed = false;

    this.input.disableBallInHandMode();
    this.rules.state = GAME_STATES.AIMING;
    this.input.enable();
    this._setMessage('Aim and shoot!');

    if (this.mode === 'online') {
      this.network.send('placeCueBall', { matchId: this.matchId, x: cueBall.x, y: cueBall.y });
    }
  }

  _requestRematch() {}

  _showRematchRequest(from) {}

  _hideRematchRequest() {}

  _showDisconnectNotice(graceMs) {
    const el = document.getElementById('disconnect-notice');
    el.classList.remove('hidden');
    const timer = document.getElementById('disconnect-timer');
    let remaining = Math.ceil(graceMs / 1000);
    timer.textContent = remaining;
    const interval = setInterval(() => {
      remaining--;
      timer.textContent = remaining;
      if (remaining <= 0) {
        clearInterval(interval);
        el.classList.add('hidden');
      }
    }, 1000);
    this._disconnectInterval = interval;
  }

  _hideDisconnectNotice() {
    if (this._disconnectInterval) clearInterval(this._disconnectInterval);
    document.getElementById('disconnect-notice').classList.add('hidden');
  }

  _startGameLoop() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.animFrame = requestAnimationFrame(this.gameLoop);
  }

  gameLoop() {
    this.renderer.cueBall = this.balls.find(b => b.id === CUE_BALL_ID && !b.pocketed);
    this.renderer.playerTurn = this.isMyTurn && !this.gameOver;

    if (!this.renderer.mouseX && this.renderer.cueBall) {
      this.renderer.mouseX = this.renderer.cueBall.x + 100;
      this.renderer.mouseY = this.renderer.cueBall.y;
    }

    if (this.gameOver) {
      this.renderer.render(this.balls, { foul: false });
      this.animFrame = requestAnimationFrame(this.gameLoop);
      return;
    }

    this.physics.step(this.balls);

    if (this.rules.state === GAME_STATES.SHOOTING) {
      const newlyPocketed = this.balls.filter(
        b => b.pocketed && !this.rules.turnStartPocketed.includes(b.id)
      );
      for (const ball of newlyPocketed) {
        this.rules.onBallPocketed(ball);
      }
      if (this.physics.allBallsStopped(this.balls)) {
        this._onShotComplete();
      }
    }

    const cueBall = this.balls.find(b => b.id === CUE_BALL_ID);
    if (this.rules.state === GAME_STATES.BALL_IN_HAND && cueBall) {
      cueBall.pocketed = false;
      if (this.mode === 'ai' && this.rules.turn !== this.myPlayerNumber) {
        this._aiPlaceCueBall();
      } else if (this.rules.turn === this.myPlayerNumber) {
        this.input.setBallInHandMode(this.input.onBallInHand);
        this._setMessage('Click to place the cue ball');
      }
    }

    this.renderer.render(this.balls, { foul: this.rules.foul });
    this._updateUI();

    if (this.isMyTurn && !this.gameOver) {
      this._updateAimAngle(this.renderer.aimAngle);
      this._updatePowerMeter(this.renderer.aimPower);
    }

    if (this.mode === 'ai' && this.rules.state === GAME_STATES.AIMING && !this.isMyTurn && !this.gameOver && !this._aiThinking) {
      this._aiThinking = true;
      this._aiTurn().finally(() => { this._aiThinking = false; });
    }

    this.animFrame = requestAnimationFrame(this.gameLoop);
  }

  _onShotComplete() {
    const winner = this.rules.onShotEnd(this.balls, this.myPlayerNumber);

    if (this.rules.justAssignedTypes) {
      this.rules.justAssignedTypes = false;
      const myType = this.myPlayerNumber === 1 ? this.rules.player1Type : this.rules.player2Type;
      const isSolids = myType === PLAYER_TYPES.SOLIDS;
      createToast({
        message: isSolids ? 'You got Solids (1-7)!' : 'You got Stripes (9-15)!',
        type: 'success',
        duration: 4000,
      });
    }

    if (this.mode === 'online' && this._shotIsMine) {
      this.network.send('shotResult', {
        matchId: this.matchId,
        balls: this.balls.map(b => ({ id: b.id, x: b.x, y: b.y, vx: 0, vy: 0, pocketed: b.pocketed })),
        rules: { turn: this.rules.turn, state: this.rules.state, player1Type: this.rules.player1Type, player2Type: this.rules.player2Type, foul: this.rules.foul, foulReason: this.rules.foulReason },
      });
    }

    if (winner !== null || this.rules.state === GAME_STATES.GAME_OVER) {
      const winPlayer = winner || this.rules.winner;
      this._showGameOver(winPlayer === this.myPlayerNumber, this.rules.winReason || 'Game over');
      return;
    }

    if (this.rules.state === GAME_STATES.BALL_IN_HAND) {
      this._setMessage(this.rules.foulReason);
      if (this.mode === 'ai' && this.rules.turn !== this.myPlayerNumber) {
        this._aiPlaceCueBall();
      } else if (this.rules.turn === this.myPlayerNumber) {
        this.input.setBallInHandMode(this.input.onBallInHand);
        this._setMessage('Ball in hand. Click to place cue ball.');
      } else if (this.mode === 'online') {
        this.input.disable();
      }
      return;
    }

    if (this.rules.state === GAME_STATES.AIMING) {
      this.isMyTurn = this.rules.turn === this.myPlayerNumber;
      this._updateTurnIndicator();
      if (this.isMyTurn) {
        this.input.enable();
        this._setMessage('Your turn!');
      } else {
        this.input.disable();
        this._setMessage(this.mode === 'online' ? 'Opponent\'s turn' : 'AI is thinking...');
      }
    }
  }

  async _aiTurn() {
    try {
      this.input.disable();
      this._setMessage(this.mode === 'online' ? 'Opponent is thinking...' : 'AI is thinking...');
      const playerType = this.rules.getCurrentPlayerType();
      const shot = await this.ai.getShot(this.balls, playerType, {
        turn: this.rules.turn, playerType,
      });
      if (shot && !this.gameOver) {
        this.rules.onShotStart(this.balls);
        const cueBall = this.balls.find(b => b.id === CUE_BALL_ID);
        if (cueBall && !cueBall.pocketed) {
          cueBall.vx = Math.cos(shot.angle) * shot.power;
          cueBall.vy = Math.sin(shot.angle) * shot.power;
        }
      } else {
        this.rules.turn = this.rules.turn === 1 ? 2 : 1;
        this.rules.state = GAME_STATES.AIMING;
        this.isMyTurn = this.rules.turn === this.myPlayerNumber;
        this._updateTurnIndicator();
        if (this.isMyTurn) {
          this.input.enable();
          this._setMessage('Your turn!');
        }
      }
    } catch (err) {
      console.error('AI error:', err);
      this.rules.turn = this.rules.turn === 1 ? 2 : 1;
      this.rules.state = GAME_STATES.AIMING;
      this.isMyTurn = this.rules.turn === this.myPlayerNumber;
      this._updateTurnIndicator();
      if (this.isMyTurn) {
        this.input.enable();
        this._setMessage('Your turn!');
      }
    }
  }

  _aiPlaceCueBall() {
    const cueBall = this.balls.find(b => b.id === CUE_BALL_ID);
    if (!cueBall) return;
    const targets = this.rules.getCurrentPlayerType() === 'solids'
      ? this.balls.filter(b => b.id >= 1 && b.id <= 7 && !b.pocketed)
      : this.rules.getCurrentPlayerType() === 'stripes'
      ? this.balls.filter(b => b.id >= 9 && b.id <= 15 && !b.pocketed)
      : this.balls.filter(b => b.id !== CUE_BALL_ID && !b.pocketed);

    let bx = TABLE.WIDTH * 0.25, by = TABLE.HEIGHT / 2;
    if (targets.length > 0) {
      let best = Infinity;
      for (const t of targets) {
        const d = Math.sqrt((t.x - TABLE.WIDTH / 2) ** 2 + (t.y - TABLE.HEIGHT / 2) ** 2);
        if (d < best) { best = d; bx = t.x - 80; by = t.y; }
      }
    }

    cueBall.x = Math.max(TABLE.RAIL_WIDTH + 20, Math.min(TABLE.WIDTH - TABLE.RAIL_WIDTH - 20, bx + (Math.random() - 0.5) * 20));
    cueBall.y = Math.max(TABLE.RAIL_WIDTH + 20, Math.min(TABLE.HEIGHT - TABLE.RAIL_WIDTH - 20, by + (Math.random() - 0.5) * 20));
    cueBall.pocketed = false;

    this.input.disableBallInHandMode();
    this.rules.state = GAME_STATES.AIMING;
    this.isMyTurn = this.rules.turn === this.myPlayerNumber;

    if (this.isMyTurn) {
      this.input.enable();
      this._setMessage('Your turn! Place cue ball then shoot.');
    } else {
      this.input.disable();
      this._setMessage('AI placing cue ball...');
    }
    this._updateTurnIndicator();
  }

  _showGameOver(won, reason) {
    this.gameOver = true;
    this.input.disable();
    const overlay = document.getElementById('game-over-overlay');
    const title = document.getElementById('game-over-title');
    const reasonEl = document.getElementById('game-over-reason');
    title.textContent = won ? 'You Win!' : 'You Lose!';
    title.className = won ? 'win' : 'lose';
    reasonEl.textContent = reason;
    overlay.classList.remove('hidden');

    if (this.mode === 'ai' && this.wallet.connected) {
      fetch('/api/game-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.authToken}` },
        body: JSON.stringify({ won, matchType: 'ai' }),
      }).then(r => r.json()).then(data => {
        if (data.stats) {
          this._updateProfileStats(data.stats);
        }
      }).catch(() => {});
    }
  }

  _hideGameOver() {
    document.getElementById('game-over-overlay').classList.add('hidden');
  }

  _leaveGame() {
    clearTimeout(this._matchmakingTimeout);
    if (this._matchmakingToast) { this._matchmakingToast.remove(); this._matchmakingToast = null; }
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
    this.input.disable();
    if (this.matchId) this.network.send('leaveMatch', { matchId: this.matchId });
    this.network.leaveQueue();
    this.mode = null; this.ai = null; this.balls = [];
    this.gameOver = false; this.matchId = null;
    this.rematchRequested = false;
    this._hideGameOver();
    this._hideRematchRequest();
    this._hideDisconnectNotice();
    this._showScreen('main-menu');
  }

  _updatePlayerPanels(name1, name2) {
    document.getElementById('p1-name').textContent = name1;
    document.getElementById('p2-name').textContent = name2;
    document.getElementById('p1-avatar').textContent = name1.charAt(0).toUpperCase();
    document.getElementById('p2-avatar').textContent = name2.charAt(0).toUpperCase();
    
    // Update ratings
    const p1Rating = document.getElementById('p1-rating-value');
    const p2Rating = document.getElementById('p2-rating-value');
    if (p1Rating) p1Rating.textContent = this.network.stats?.rating || '1000';
    if (p2Rating) p2Rating.textContent = this.opponentRating || '1000';
  }

  _updateTurnIndicator() {
    const turnIndicator = document.getElementById('turn-indicator');
    const turnText = document.getElementById('turn-text');
    const mobileTurnIndicator = document.getElementById('mobile-turn-indicator');
    const mobileTurnText = document.getElementById('mobile-turn-text');
    const p1Panel = document.getElementById('player1-panel');
    const p2Panel = document.getElementById('player2-panel');
    
    if (this.gameOver) {
      turnIndicator.className = 'turn-indicator';
      turnText.textContent = '';
      if (mobileTurnIndicator) mobileTurnIndicator.className = 'turn-indicator';
      if (mobileTurnText) mobileTurnText.textContent = '';
      p1Panel?.classList.remove('active');
      p2Panel?.classList.remove('active');
      return;
    }
    
    const isYours = this.isMyTurn;
    const turnLabel = isYours ? 'Your turn' : (this.mode === 'ai' ? 'AI turn' : "Opponent's turn");
    
    if (isYours) {
      turnIndicator.className = 'turn-indicator your-turn';
      if (mobileTurnIndicator) mobileTurnIndicator.className = 'turn-indicator your-turn';
    } else {
      turnIndicator.className = 'turn-indicator';
      if (mobileTurnIndicator) mobileTurnIndicator.className = 'turn-indicator';
    }
    turnText.textContent = turnLabel;
    if (mobileTurnText) mobileTurnText.textContent = turnLabel;
    
    // Update player panels
    if (this.rules.turn === 1) {
      p1Panel?.classList.add('active');
      p2Panel?.classList.remove('active');
    } else {
      p1Panel?.classList.remove('active');
      p2Panel?.classList.add('active');
    }
  }

  _updateMatchInfo() {
    const matchInfoBar = document.getElementById('match-info-bar');
    if (this.currentTierData && this.mode === 'online') {
      matchInfoBar?.classList.remove('hidden');
      const entryEl = document.getElementById('match-entry');
      const prizeEl = document.getElementById('match-prize');
      const matchIdEl = document.getElementById('match-id');
      if (entryEl) entryEl.textContent = this.currentTierData.entryFeeFormatted || '0 NIM';
      if (prizeEl) prizeEl.textContent = this.currentTierData.winnerPrizeFormatted || '0 NIM';
      if (matchIdEl) matchIdEl.textContent = this.matchId?.substring(0, 8) || '---';
    } else {
      matchInfoBar?.classList.add('hidden');
    }
  }

  _updatePowerMeter(power) {
    const powerFill = document.getElementById('power-fill-game');
    const powerMarker = document.getElementById('power-marker');
    const powerValue = document.getElementById('power-value');
    if (powerFill) powerFill.style.width = `${power * 100}%`;
    if (powerMarker) powerMarker.style.left = `${power * 100}%`;
    if (powerValue) powerValue.textContent = `${Math.round(power * 100)}%`;
    
    // Mobile power display (not slider, just the label)
    const mobilePowerValue = document.getElementById('mobile-power-value');
    if (mobilePowerValue) mobilePowerValue.textContent = `${Math.round(power * 100)}%`;
  }

  _updateAimAngle(angle) {
    const aimAngle = document.getElementById('aim-angle');
    if (aimAngle) {
      const degrees = Math.round((angle * 180) / Math.PI);
      aimAngle.textContent = `${degrees}°`;
    }
  }

  _showFoul(reason) {
    const foulNotice = document.getElementById('foul-notice');
    const foulReason = document.getElementById('foul-reason');
    if (foulNotice && foulReason) {
      foulReason.textContent = reason;
      foulNotice.classList.remove('hidden');
      setTimeout(() => foulNotice.classList.add('hidden'), 3000);
    }
  }

  _updateOpponentStatus(connected) {
    const status = document.getElementById('opponent-status');
    const statusText = document.getElementById('opponent-status-text');
    if (status && statusText) {
      status.classList.remove('hidden', 'disconnected');
      if (connected) {
        statusText.textContent = 'Opponent connected';
      } else {
        status.classList.add('disconnected');
        statusText.textContent = 'Opponent disconnected';
      }
    }
  }

  _updateStats() {
    const el = document.getElementById('player-stats');
    if (el && this.network.stats) {
      const s = this.network.stats;
      el.textContent = `W: ${s.wins} | L: ${s.losses} | Streak: ${s.streak}`;
    }
    this._updateXP();
  }

  _updateXP() {
    const s = this.network?.stats;
    if (!s) return;
    const xp = s.xp || 0;
    const level = s.level || 1;
    const xpInLevel = xp % 800;
    const el = (id) => document.getElementById(id);
    if (el('profile-level')) el('profile-level').textContent = level;
    if (el('profile-rating')) el('profile-rating').textContent = `${xpInLevel} / 800 XP`;
    const fill = el('xp-bar-fill');
    if (fill) fill.style.width = `${(xpInLevel / 800) * 100}%`;
  }

  _updateStatsFromResult(msg) {
    if (msg.winnerStats) this.network.stats = msg.won ? msg.winnerStats : msg.loserStats;
    this._updateStats();
    const s = this.network.stats;
    const el = (id) => document.getElementById(id);
    if (el('profile-wins')) el('profile-wins').textContent = s.wins || 0;
    if (el('profile-losses')) el('profile-losses').textContent = s.losses || 0;
    if (el('profile-games')) el('profile-games').textContent = (s.wins || 0) + (s.losses || 0);
    if (el('profile-winrate')) {
      const total = (s.wins || 0) + (s.losses || 0);
      el('profile-winrate').textContent = total > 0 ? Math.round((s.wins / total) * 100) + '%' : '0%';
    }
  }

  _loadProfileFromServer() {
    const token = localStorage.getItem('bil_auth_token');
    if (!token) return;
    fetch('/api/profile', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        if (data.name && data.name !== 'Guest' && data.name !== 'Guest Player') {
          this.network.playerName = data.name;
          const nameEl = document.getElementById('profile-name');
          if (nameEl) nameEl.textContent = data.name;
          setCurrentPlayerName(data.name);
          localStorage.setItem('bil_player_name', data.name);
        }
        if (data.avatar) {
          this._applyAvatar(data.avatar);
          this.network.avatar = data.avatar;
          localStorage.setItem('bil_player_avatar', data.avatar);
        }
        if (data.balance !== undefined) {
          this.wallet.balance = data.balance;
          this._updateBalanceDisplay(data.balance);
        }
        if (data.stats) {
          this.network.stats = data.stats;
          this._updateProfileStats(data.stats);
          localStorage.setItem('bil_player_stats', JSON.stringify(data.stats));
        }
      })
      .catch(() => {});
  }

  _updateProfileStats(s) {
    const el = (id) => document.getElementById(id);
    if (el('profile-wins')) el('profile-wins').textContent = s.wins || 0;
    if (el('profile-games')) el('profile-games').textContent = s.gamesPlayed || 0;
    if (el('profile-winrate')) {
      el('profile-winrate').textContent = s.winRate !== undefined ? s.winRate + '%' : '0%';
    }
    if (el('profile-level')) el('profile-level').textContent = s.level || 1;
    if (el('profile-rating')) el('profile-rating').textContent = s.xp || 0;
    const xpBar = document.getElementById('xp-bar-fill');
    if (xpBar) xpBar.style.width = ((s.xp || 0) % 800 / 800 * 100) + '%';
  }

  _updateUI() { this._updateBallRacks(); }

  _updateBallRacks() {
    const p1 = document.getElementById('p1-balls');
    const p2 = document.getElementById('p2-balls');
    const t1 = this.rules.player1Type;
    const t2 = this.rules.player2Type;
    this._renderBallRack(p1, t1, this.balls);
    this._renderBallRack(p2, t2, this.balls);
    this._updateBallLabels(t1, t2);
  }

  _updateBallLabels(t1, t2) {
    const lbl1 = document.getElementById('p1-ball-label');
    const lbl2 = document.getElementById('p2-ball-label');
    if (lbl1) lbl1.textContent = t1 === PLAYER_TYPES.SOLIDS ? 'Solids (1-7)' : t1 === PLAYER_TYPES.STRIPES ? 'Stripes (9-15)' : 'Open Table';
    if (lbl2) lbl2.textContent = t2 === PLAYER_TYPES.SOLIDS ? 'Solids (1-7)' : t2 === PLAYER_TYPES.STRIPES ? 'Stripes (9-15)' : 'Open Table';
  }

  _renderBallRack(container, type, balls) {
    if (type === PLAYER_TYPES.UNASSIGNED) { container.innerHTML = ''; return; }
    const [lo, hi] = type === PLAYER_TYPES.SOLIDS ? [1, 7] : [9, 15];
    const nums = [];
    for (let i = lo; i <= hi; i++) nums.push(i);
    container.innerHTML = nums.map(id => {
      const ball = balls.find(b => b.id === id);
      const pocketed = ball && ball.pocketed;
      return `<div class="ball-dot ${pocketed ? 'pocketed' : ''}" style="background:${this._getBallColor(id)}"></div>`;
    }).join('');
  }

  _getBallColor(id) {
    const c = {
      1: '#f5d033', 2: '#1a5fb4', 3: '#d32f2f', 4: '#6a1b9a',
      5: '#e65100', 6: '#1b5e20', 7: '#5d4037', 8: '#212121',
      9: '#ffeb3b', 10: '#42a5f5', 11: '#ef5350', 12: '#ab47bc',
      13: '#ffa726', 14: '#66bb6a', 15: '#8d6e63',
    };
    return c[id] || '#888';
  }

  _showInsufficientBalanceModal(need, have) {
    const needNim = formatNim(need);
    const haveNim = formatNim(have);
    const deficit = formatNim(need - have);

    const modal = document.getElementById('topup-modal');
    if (!modal) return;

    const body = document.getElementById('topup-body');
    if (body) {
      body.innerHTML = `
        <div style="text-align:center;margin-bottom:16px;">
          <div style="font-size:1.1rem;color:var(--text-primary);margin-bottom:8px;">Insufficient Balance</div>
          <div style="color:var(--text-secondary);font-size:0.9rem;">
            You need <strong>${needNim}</strong> to enter this tier.<br>
            Current balance: <strong>${haveNim}</strong><br>
            You need <strong>${deficit}</strong> more.
          </div>
        </div>
        <div id="topup-amounts" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button class="btn btn-primary topup-option" data-amount="${Math.ceil((need - have) / 100000) * 100 || 100}">${Math.ceil((need - have) / 100000) * 100 || 100} NIM</button>
          <button class="btn btn-primary topup-option" data-amount="${Math.ceil((need - have) / 100000) * 200 || 500}">${Math.ceil((need - have) / 100000) * 200 || 500} NIM</button>
          <button class="btn btn-primary topup-option" data-amount="1000">1000 NIM</button>
          <button class="btn btn-primary topup-option" data-amount="5000">5000 NIM</button>
        </div>
      `;
      body.querySelectorAll('.topup-option').forEach(btn => {
        btn.addEventListener('click', async () => {
          const amountNim = parseInt(btn.dataset.amount);
          await this._executeTopUp(amountNim);
        });
      });
    }
    modal.classList.remove('hidden');
  }

  _setMessage(msg) {
    const el = document.getElementById('game-message');
    el.textContent = msg; el.classList.remove('hidden');
    clearTimeout(this._msgTimeout);
    this._msgTimeout = setTimeout(() => el.classList.add('hidden'), 1500);
  }
}

document.addEventListener('DOMContentLoaded', () => { 
  window.game = new NimiqBilliards();
});
