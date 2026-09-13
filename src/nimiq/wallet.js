/**
 * NimiqWallet - Factory for wallet adapters
 * 
 * Provides a unified interface for wallet operations.
 * Automatically detects the best adapter based on environment.
 * 
 * Usage:
 *   import { NimiqWallet } from './nimiq/wallet.js';
 *   const wallet = new NimiqWallet();
 *   await wallet.connect();
 *   const balance = await wallet.refreshBalance();
 */

import { NimiqProviderAdapter } from './nimiq-provider-adapter.js';
import { MockWalletAdapter } from './mock-wallet-adapter.js';
import { WALLET_EVENTS } from './wallet-service.js';

export { WALLET_EVENTS };

export const NETWORK_MODE = {
  TESTNET: 'testnet',
  MAINNET: 'mainnet',
};

export class NimiqWallet {
  /**
   * @param {Object} options
   * @param {string} [options.mode='testnet'] - NETWORK_MODE.TESTNET or NETWORK_MODE.MAINNET
   * @param {boolean} [options.forceMock=false] - Force mock wallet even if real provider available
   */
  constructor(options = {}) {
    this.mode = options.mode || NETWORK_MODE.MAINNET;
    this.forceMock = options.forceMock || false;
    this.adapter = null;
    this.listeners = new Map();
    this.connected = false;
    this.address = null;
    this.balance = 0;
  }

  /**
   * Create the appropriate adapter based on environment
   * @private
   */
  _createAdapter() {
    if (this.forceMock) {
      return new MockWalletAdapter();
    }

    // NimiqProviderAdapter handles both Mini App SDK and Hub API
    // It auto-detects the best method (Mini App first, Hub fallback)
    console.log('[WALLET] Using Nimiq Provider Adapter (auto-detect)');
    return new NimiqProviderAdapter();
  }

  /**
   * Register an event listener
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
   * Remove an event listener
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    const cbs = this.listeners.get(event) || [];
    const idx = cbs.indexOf(callback);
    if (idx !== -1) cbs.splice(idx, 1);
  }

  /**
   * Emit an event to all listeners
   * @private
   * @param {string} event
   * @param {*} data
   */
  _emit(event, data) {
    const cbs = this.listeners.get(event) || [];
    cbs.forEach(cb => cb(data));
  }

  /**
   * Connect to the wallet
   * @returns {Promise<boolean>}
   */
  async connect() {
    this.adapter = this._createAdapter();

    // Forward adapter events
    Object.values(WALLET_EVENTS).forEach(event => {
      this.adapter.on(event, (data) => {
        this._emit(event, data);
      });
    });

    return this.adapter.connect();
  }

  /**
   * Disconnect from the wallet
   */
  async disconnect() {
    if (this.adapter) {
      await this.adapter.disconnect();
      this.adapter = null;
    }
    this.address = null;
    this.connected = false;
    this.balance = 0;
  }

  /**
   * Check if wallet is connected
   * @returns {boolean}
   */
  isConnected() {
    return this.adapter ? this.adapter.isConnected() : false;
  }

  /**
   * Get current address
   * @returns {string|null}
   */
  getAddress() {
    return this.adapter ? this.adapter.getAddress() : null;
  }

  /**
   * Get current balance (cached)
   * @returns {number}
   */
  getBalance() {
    return this.adapter ? this.adapter.getBalance() : 0;
  }

  /**
   * Refresh balance from network
   * @returns {Promise<number>}
   */
  async refreshBalance() {
    if (!this.adapter) return 0;
    return this.adapter.refreshBalance();
  }

  /**
   * Send a NIM transaction
   * @param {string} recipient
   * @param {number} value - Amount in Luna
   * @param {string} [data]
   * @returns {Promise<TransactionResult>}
   */
  async sendTransaction(recipient, value, data) {
    if (!this.adapter) throw new Error('Wallet not connected');
    return this.adapter.sendTransaction(recipient, value, data);
  }

  /**
   * Sign a message
   * @param {string} message
   * @returns {Promise<{publicKey: string, signature: string}>}
   */
  async signMessage(message) {
    if (!this.adapter) throw new Error('Wallet not connected');
    return this.adapter.signMessage(message);
  }

  /**
   * Connect wallet via sign message (Hub API auth flow)
   * @param {string} message - Message containing server nonce
   * @returns {Promise<{address: string, signature: string} | null>}
   */
  async connectAndSign(message) {
    if (!this.adapter) this.adapter = this._createAdapter();

    // Forward adapter events to wrapper
    Object.values(WALLET_EVENTS).forEach(event => {
      this.adapter.on(event, (data) => this._emit(event, data));
    });

    if (this.adapter.connectAndSign) {
      const result = await this.adapter.connectAndSign('NimiqBilliards', message);
      if (result) {
        this.address = result.address;
        this.connected = true;
      }
      return result;
    }
    // Fallback: just connect
    const ok = await this.adapter.connect();
    if (ok) {
      this.address = this.adapter.address;
      this.connected = true;
    }
    return ok ? { address: this.adapter.address, signature: 'mock' } : null;
  }

  /**
   * Top up game balance via wallet checkout
   * @param {string} platformWallet
   * @param {number} amountNim
   * @returns {Promise<{hash, sender, recipient, value} | null>}
   */
  async topUp(platformWallet, amountNim) {
    if (!this.adapter) throw new Error('Wallet not connected');
    if (this.adapter.topUp) {
      return this.adapter.topUp(platformWallet, amountNim);
    }
    throw new Error('Top-up not supported with current wallet');
  }

  /**
   * Deposit entry fee for a match
   * @param {number} entryFee - Amount in Luna
   * @param {string} [escrowAddress]
   * @returns {Promise<TransactionResult>}
   */
  async depositToMatch(entryFee, escrowAddress) {
    if (!this.adapter) throw new Error('Wallet not connected');
    if (this.adapter.depositToMatch) {
      return this.adapter.depositToMatch(entryFee, escrowAddress);
    }
    // Fallback to generic sendTransaction
    return this.adapter.sendTransaction(escrowAddress || 'NQ07 ESCROW', entryFee);
  }

  /**
   * Receive winnings
   * @param {number} amount - Amount in Luna
   * @param {string} matchId
   * @returns {Promise<TransactionResult>}
   */
  async receiveWinnings(amount, matchId) {
    if (!this.adapter) throw new Error('Wallet not connected');
    if (this.adapter.receiveWinnings) {
      return this.adapter.receiveWinnings(amount, matchId);
    }
    // Mock receipt
    const tx = {
      hash: 'receipt-' + Date.now(),
      from: 'ESCROW',
      to: this.getAddress(),
      amount,
      status: 'confirmed',
      timestamp: Date.now(),
    };
    this.adapter.balance += amount;
    this._emit(WALLET_EVENTS.BALANCE_UPDATED, this.adapter.balance);
    return tx;
  }

  /**
   * Format address for display
   * @param {string} addr
   * @returns {string}
   */
  formatAddress(addr) {
    return this.adapter ? this.adapter.formatAddress(addr) : '';
  }

  /**
   * Format balance from Luna to NIM
   * @param {number} lamports
   * @returns {string}
   */
  formatBalance(lamports) {
    const nim = lamports / 100000;
    return `${nim.toFixed(2)} NIM`;
  }

  /**
   * Add testnet tokens (mock wallet only)
   * @param {number} amount
   */
  addTestTokens(amount) {
    if (this.adapter && this.adapter.addTestTokens) {
      this.adapter.addTestTokens(amount);
    }
  }
}

export const TESTNET_CONFIG = {
  network: 'test',
  networkId: '10e1',
  coin: 'NIM',
  symbol: 'NIM',
  explorerUrl: 'https://test.nimiqscan.com',
  rpcUrl: 'https://test.nimiq.com',
};

export default NimiqWallet;
