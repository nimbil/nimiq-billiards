import { WalletService, WALLET_EVENTS } from './wallet-service.js';

/**
 * MockWalletAdapter - Simulated wallet for testnet/development
 * 
 * Provides a fake wallet with testnet NIM for development and testing.
 * Mimics the behavior of a real Nimiq wallet without actual blockchain interaction.
 */

const MOCK_ADDRESSES = [
  'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
  'NQ07 0000 0000 0000 0000 0000 0000 0000 0001',
  'NQ07 TEST MOCK ADDRESS FOR DEVELOPMENT 0000',
  'NQ07 DEMO WALLET ADDRESS FOR TESTING ONLY 0000',
];

const DEFAULT_BALANCE = 100000; // 1 NIM = 100,000 Luna, so 1 NIM default
const MOCK_STORAGE_KEY = 'nimiq_mock_wallet';

export class MockWalletAdapter extends WalletService {
  constructor() {
    super();
    this.isTestnet = true;
    this.mockBalances = new Map();
    this._loadFromStorage();
  }

  /**
   * Load mock data from localStorage if available
   * @private
   */
  _loadFromStorage() {
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(MOCK_STORAGE_KEY);
        if (stored) {
          const data = JSON.parse(stored);
          if (data.balances) {
            Object.entries(data.balances).forEach(([addr, bal]) => {
              this.mockBalances.set(addr, bal);
            });
          }
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Save mock data to localStorage
   * @private
   */
  _saveToStorage() {
    try {
      if (typeof localStorage !== 'undefined') {
        const data = {
          balances: Object.fromEntries(this.mockBalances),
        };
        localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(data));
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Connect to mock wallet
   * @returns {Promise<boolean>}
   */
  async connect() {
    // Simulate connection delay
    await new Promise(r => setTimeout(r, 500));

    // Pick a random mock address
    const addr = MOCK_ADDRESSES[Math.floor(Math.random() * MOCK_ADDRESSES.length)];
    this.address = addr;
    this.connected = true;

    // Initialize balance if not set
    if (!this.mockBalances.has(addr)) {
      this.mockBalances.set(addr, DEFAULT_BALANCE);
    }
    this.balance = this.mockBalances.get(addr);

    this._saveToStorage();

    this.emit(WALLET_EVENTS.CONNECTED, {
      address: this.address,
      balance: this.balance,
      isTestnet: true,
    });

    console.log(`[MOCK WALLET] Connected: ${this.address} | Balance: ${this.formatBalance(this.balance)}`);
    return true;
  }

  /**
   * Disconnect mock wallet
   */
  async disconnect() {
    this.connected = false;
    this.address = null;
    this.balance = 0;
    this.emit(WALLET_EVENTS.DISCONNECTED);
  }

  /**
   * Get wallet info
   * @returns {Promise<WalletInfo>}
   */
  async getWalletInfo() {
    if (!this.connected) {
      throw new Error('Wallet not connected');
    }
    return {
      address: this.address,
      balance: this.balance,
      isTestnet: true,
    };
  }

  /**
   * Refresh balance (mock always returns stored balance)
   * @returns {Promise<number>}
   */
  async refreshBalance() {
    if (!this.connected) return 0;
    this.balance = this.mockBalances.get(this.address) || 0;
    this.emit(WALLET_EVENTS.BALANCE_UPDATED, this.balance);
    return this.balance;
  }

  /**
   * Send a mock transaction
   * @param {string} recipient
   * @param {number} value - Amount in Luna
   * @returns {Promise<TransactionResult>}
   */
  async sendTransaction(recipient, value) {
    if (!this.connected) throw new Error('Wallet not connected');
    if (this.balance < value) throw new Error('Insufficient balance');

    // Deduct from sender
    this.balance -= value;
    this.mockBalances.set(this.address, this.balance);

    // Add to recipient if it's a known mock address
    if (MOCK_ADDRESSES.includes(recipient) || this.mockBalances.has(recipient)) {
      const recipientBal = this.mockBalances.get(recipient) || 0;
      this.mockBalances.set(recipient, recipientBal + value);
    }

    this._saveToStorage();

    const tx = {
      hash: 'mock-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      from: this.address,
      to: recipient,
      value,
      fee: 0,
      status: 'confirmed',
      timestamp: Date.now(),
    };

    this.emit(WALLET_EVENTS.BALANCE_UPDATED, this.balance);
    this.emit(WALLET_EVENTS.TRANSACTION, tx);

    return tx;
  }

  /**
   * Sign a message (mock signature)
   * @param {string} message
   * @returns {Promise<{publicKey: string, signature: string}>}
   */
  async signMessage(message) {
    if (!this.connected) throw new Error('Wallet not connected');

    // Generate a deterministic mock signature
    const encoder = new TextEncoder();
    const data = encoder.encode(message + this.address);
    
    // Simple hash for mock (not cryptographically secure)
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data[i];
      hash = hash & hash;
    }

    const mockSignature = Math.abs(hash).toString(16).padStart(16, '0') +
      Date.now().toString(16).padStart(16, '0');

    return {
      publicKey: 'mock-pub-' + this.address.slice(-4),
      signature: mockSignature,
    };
  }

  /**
   * Deposit entry fee for a match (mock)
   * @param {number} entryFee - Amount in Luna
   * @returns {Promise<TransactionResult>}
   */
  async depositToMatch(entryFee) {
    if (!this.connected) throw new Error('Wallet not connected');
    if (this.balance < entryFee) throw new Error('Insufficient balance');

    const escrowAddress = 'NQ07 ESCROW MOCK ADDRESS FOR TESTING';
    return this.sendTransaction(escrowAddress, entryFee);
  }

  /**
   * Receive winnings (mock)
   * @param {number} amount - Amount in Luna
   * @param {string} matchId
   * @returns {Promise<TransactionResult>}
   */
  async receiveWinnings(amount, matchId) {
    if (!this.connected) throw new Error('Wallet not connected');

    this.balance += amount;
    this.mockBalances.set(this.address, this.balance);

    this._saveToStorage();

    const tx = {
      hash: 'mock-winnings-' + Date.now(),
      from: 'ESCROW',
      to: this.address,
      amount,
      status: 'confirmed',
      timestamp: Date.now(),
    };

    this.emit(WALLET_EVENTS.BALANCE_UPDATED, this.balance);
    this.emit(WALLET_EVENTS.TRANSACTION, tx);

    return tx;
  }

  /**
   * Add testnet NIM to wallet (for development)
   * @param {number} amount - Amount in Luna
   */
  addTestTokens(amount) {
    if (!this.connected) return;
    this.balance += amount;
    this.mockBalances.set(this.address, this.balance);
    this._saveToStorage();
    this.emit(WALLET_EVENTS.BALANCE_UPDATED, this.balance);
  }
}

export default MockWalletAdapter;
