/**
 * WalletService - Abstraction layer for Nimiq wallet operations
 * 
 * Interface that all wallet adapters must implement.
 * The game uses this interface to interact with wallets,
 * regardless of whether it's a real Nimiq wallet or a mock.
 */

export const WALLET_EVENTS = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  BALANCE_UPDATED: 'balanceUpdated',
  TRANSACTION: 'transaction',
  ERROR: 'error',
};

/**
 * @typedef {Object} WalletInfo
 * @property {string} address - User-friendly Nimiq address
 * @property {number} balance - Balance in Luna (1 NIM = 100,000 Luna)
 * @property {boolean} isTestnet - Whether connected to testnet
 */

/**
 * @typedef {Object} TransactionResult
 * @property {string} hash - Transaction hash
 * @property {string} from - Sender address
 * @property {string} to - Recipient address
 * @property {number} value - Amount in Luna
 * @property {number} fee - Fee in Luna
 * @property {string} status - 'pending' | 'confirmed' | 'failed'
 * @property {number} timestamp - Unix timestamp
 */

export class WalletService {
  constructor() {
    this.connected = false;
    this.address = null;
    this.balance = 0;
    this.listeners = new Map();
    this.isTestnet = false;
  }

  /**
   * Register an event listener
   * @param {string} event - Event name from WALLET_EVENTS
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
   * @param {string} event
   * @param {*} data
   */
  emit(event, data) {
    const cbs = this.listeners.get(event) || [];
    cbs.forEach(cb => cb(data));
  }

  /**
   * Connect to the wallet
   * @abstract
   * @returns {Promise<boolean>} - true if connected successfully
   */
  async connect() {
    throw new Error('connect() must be implemented by adapter');
  }

  /**
   * Disconnect from the wallet
   * @abstract
   */
  async disconnect() {
    throw new Error('disconnect() must be implemented by adapter');
  }

  /**
   * Get current wallet info
   * @abstract
   * @returns {Promise<WalletInfo>}
   */
  async getWalletInfo() {
    throw new Error('getWalletInfo() must be implemented by adapter');
  }

  /**
   * Refresh balance from network
   * @abstract
   * @returns {Promise<number>} - Balance in Luna
   */
  async refreshBalance() {
    throw new Error('refreshBalance() must be implemented by adapter');
  }

  /**
   * Send a NIM transaction
   * @abstract
   * @param {string} recipient - Recipient address
   * @param {number} value - Amount in Luna
   * @param {string} [data] - Optional data/memo
   * @returns {Promise<TransactionResult>}
   */
  async sendTransaction(recipient, value, data) {
    throw new Error('sendTransaction() must be implemented by adapter');
  }

  /**
   * Sign a message (for match verification)
   * @abstract
   * @param {string} message
   * @returns {Promise<{publicKey: string, signature: string}>}
   */
  async signMessage(message) {
    throw new Error('signMessage() must be implemented by adapter');
  }

  /**
   * Check if wallet is connected
   * @returns {boolean}
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Get current address
   * @returns {string|null}
   */
  getAddress() {
    return this.address;
  }

  /**
   * Get current balance (cached)
   * @returns {number}
   */
  getBalance() {
    return this.balance;
  }

  /**
   * Format address for display
   * @param {string} addr
   * @returns {string}
   */
  formatAddress(addr) {
    if (!addr) return '';
    const clean = addr.replace(/\s/g, '');
    if (clean.length > 16) {
      return clean.slice(0, 8) + '...' + clean.slice(-4);
    }
    return addr;
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
}

export default WalletService;
