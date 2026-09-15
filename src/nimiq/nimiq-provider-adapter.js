/**
 * NimiqProviderAdapter - Dual-method wallet integration
 *
 * Two connection methods:
 * 1. Nimiq Pay Mini App: Uses @nimiq/mini-app-sdk
 *    - Native wallet UI inside Nimiq Pay app
 *    - provider.listAccounts() to get address
 *    - provider.sendBasicTransaction() for payments
 *    - provider.sign() for message signing
 * 2. Hub API fallback: Uses @nimiq/hub-api
 *    - Desktop browser with Nimiq Wallet extension
 *    - Opens popup to hub.nimiq.com
 *    - hubApi.signMessage() for auth
 *    - hubApi.checkout() for payments
 *
 * Pattern from: nimiq-nft-marketplace/src/lib/wallet/nimiq-adapter.ts
 */

import { WalletService, WALLET_EVENTS } from './wallet-service.js';

const MAINNET_RPC = 'https://api.nimiq.com';
const HUB_ENDPOINT = 'https://hub.nimiq.com';
const LUNA_PER_NIM = 100_000;

// ─── Mini App SDK (Nimiq Pay native) ───────────────────────

let miniAppProvider = null;
let miniAppAttempted = false;

async function tryInitMiniApp() {
  if (miniAppAttempted) return miniAppProvider;
  miniAppAttempted = true;

  try {
    const { init } = await import('@nimiq/mini-app-sdk');
    const provider = await init({ timeout: 5000 });
    miniAppProvider = provider;
    console.log('[NIMIQ] Mini App SDK detected');
    return miniAppProvider;
  } catch {
    console.log('[NIMIQ] Mini App SDK not available');
    return null;
  }
}

// ─── Hub API (desktop fallback) ─────────────────────────────

let hubApiModule = null;
let hubLoadPromise = null;

function preloadHubApi() {
  if (hubLoadPromise) return hubLoadPromise;
  hubLoadPromise = (async () => {
    try {
      const mod = await import('@nimiq/hub-api');
      const HubApi = mod.default;
      hubApiModule = new HubApi(HUB_ENDPOINT);
      console.log('[NIMIQ] Hub API pre-loaded');
    } catch (e) {
      console.warn('[NIMIQ] Hub API preload failed:', e);
    }
  })();
  return hubLoadPromise;
}

async function ensureHubApi() {
  if (hubApiModule) return hubApiModule;
  if (hubLoadPromise) {
    await hubLoadPromise;
    return hubApiModule;
  }
  await preloadHubApi();
  return hubApiModule;
}

// ─── Error classification ───────────────────────────────────

function classifyError(error) {
  const msg = (error?.message || error?.toString() || '').toLowerCase();
  const code = error?.code;

  if (code === 4001 || code === -32002 || msg.includes('reject') || msg.includes('cancel') || msg.includes('abort')) {
    return 'USER_REJECTED';
  }
  if (msg.includes('not found') || msg.includes('not installed') || msg.includes('not available')) {
    return 'WALLET_NOT_FOUND';
  }
  if (msg.includes('insufficient') || msg.includes('not enough') || msg.includes('balance')) {
    return 'INSUFFICIENT_BALANCE';
  }
  if (msg.includes('transaction') || msg.includes('send') || msg.includes('broadcast')) {
    return 'TRANSACTION_FAILED';
  }
  if (msg.includes('sign') || msg.includes('signature')) {
    return 'SIGNING_FAILED';
  }
  return 'UNKNOWN';
}

// ─── Adapter ────────────────────────────────────────────────

export class NimiqProviderAdapter extends WalletService {
  constructor() {
    super();
    this.provider = null;
    this.hubApi = null;
    this.connectionMethod = null; // 'miniapp' | 'hub'
    this.isTestnet = false;
    this.connectedAddress = null;
    // Pre-load Hub API eagerly so first-click popup isn't blocked
    if (typeof window !== 'undefined') preloadHubApi();
  }

  /**
   * Detect available connection method
   * Try Mini App SDK first, then Hub API
   */
  static async detectMethod() {
    const miniProvider = await tryInitMiniApp();
    if (miniProvider) return 'miniapp';

    try {
      await ensureHubApi();
      return 'hub';
    } catch {
      return null;
    }
  }

  static isNimiqProviderAvailable() {
    if (typeof window === 'undefined') return false;
    return !!(window.nimiq || window.nimiqPay);
  }

  /**
   * Connect via Mini App SDK (Nimiq Pay native)
   * @private
   */
  async _connectMiniApp() {
    if (!this.provider) {
      this.provider = await tryInitMiniApp();
    }
    if (!this.provider) {
      throw new Error('Nimiq Pay not detected. Open this app inside Nimiq Pay.');
    }

    const result = await this.provider.listAccounts();
    console.log('[NIMIQ] _connectMiniApp listAccounts:', typeof result, JSON.stringify(result)?.slice(0, 100));

    // Check for error response
    if (result && typeof result === 'object' && 'error' in result) {
      throw new Error(result.error.message || 'User rejected connection');
    }

    let addr;
    if (typeof result === 'string') {
      addr = result;
    } else if (Array.isArray(result) && result.length > 0) {
      addr = result[0];
    } else if (result && typeof result === 'object') {
      addr = result.address || (Array.isArray(result) ? result[0] : null);
    }

    if (!addr) {
      throw new Error('No accounts found. User may have rejected the request.');
    }

    this.address = addr;
    this.connectedAddress = addr;
    this.connected = true;
    this.connectionMethod = 'miniapp';

    // Fetch balance via RPC
    this.balance = await this._fetchBalance(this.address);

    this.emit(WALLET_EVENTS.CONNECTED, {
      address: this.address,
      balance: this.balance,
      isTestnet: this.isTestnet,
    });

    console.log(`[NIMIQ] Connected via Mini App: ${this.address} | Balance: ${this.formatBalance(this.balance)}`);
    return true;
  }

  /**
   * Connect via Hub API (desktop fallback)
   * Opens a popup to hub.nimiq.com for signing
   * @private
   */
  async _connectHub(appName = 'NimiqBilliards') {
    const hub = await ensureHubApi();
    this.hubApi = hub;

    const result = await hub.signMessage({
      appName,
      message: `Connect to ${appName}`,
    });

    if (!result?.signer) {
      throw new Error('Connection rejected by user');
    }

    this.address = result.signer;
    this.connectedAddress = result.signer;
    this.connected = true;
    this.connectionMethod = 'hub';

    // Fetch balance via RPC
    this.balance = await this._fetchBalance(this.address);

    this.emit(WALLET_EVENTS.CONNECTED, {
      address: this.address,
      balance: this.balance,
      isTestnet: this.isTestnet,
    });

    console.log(`[NIMIQ] Connected via Hub API: ${this.address} | Balance: ${this.formatBalance(this.balance)}`);
    return true;
  }

  /**
   * Connect to the wallet
   * Tries Mini App SDK first, falls back to Hub API
   */
  async connect(appName) {
    try {
      // Try Mini App SDK first (works inside Nimiq Pay)
      if (!this.provider) {
        this.provider = await tryInitMiniApp();
      }
      if (this.provider) {
        return await this._connectMiniApp();
      }

      // Fall back to Hub API (desktop browser with extension)
      return await this._connectHub(appName);
    } catch (err) {
      console.error('[NIMIQ] Connection failed:', err);
      this.emit(WALLET_EVENTS.ERROR, err.message);
      return false;
    }
  }

  /**
   * Connect and sign a message (used for auth flow)
   * @param {string} appName
   * @param {string} message - Message to sign (should contain server nonce)
   * @returns {Promise<{address: string, signature: string} | null>}
   */
  async connectAndSign(appName, message) {
    if (typeof window === 'undefined') return null;

    try {
      // Try Mini App SDK first (works inside Nimiq Pay)
      if (!this.provider) {
        this.provider = await tryInitMiniApp();
      }
      if (this.provider) {
        this.connectionMethod = 'miniapp';
        console.log('[NIMIQ] Connected via Mini App SDK');

        // First get account
        const accounts = await this.provider.listAccounts();
        console.log('[NIMIQ] listAccounts result:', JSON.stringify(accounts));

        // Handle string address (some SDK versions)
        if (typeof accounts === 'string') {
          this.address = accounts;
          this.connected = true;
        } else if (Array.isArray(accounts) && accounts.length > 0) {
          this.address = accounts[0];
          this.connected = true;
        } else if (accounts && typeof accounts === 'object' && !('error' in accounts)) {
          // Might be {address: '...'} or similar
          this.address = accounts.address || accounts[0];
          this.connected = true;
        }

        if (!this.address) {
          const err = new Error('No accounts found');
          err.type = 'WALLET_NOT_FOUND';
          throw err;
        }

        // Sign the message
        const sigResult = await this.provider.sign(message);
        console.log('[NIMIQ] sign result type:', typeof sigResult, sigResult instanceof Uint8Array, Array.isArray(sigResult));
        if (sigResult && typeof sigResult === 'object' && 'error' in sigResult) {
          const err = new Error('User rejected signing');
          err.type = 'USER_REJECTED';
          throw err;
        }

        // SignatureResult = { publicKey: string, signature: string }
        // signature is already a hex string from NimiqProvider
        let signature;
        if (typeof sigResult === 'string') {
          signature = sigResult;
        } else if (sigResult && typeof sigResult === 'object' && typeof sigResult.signature === 'string') {
          signature = sigResult.signature;
        } else if (sigResult instanceof Uint8Array) {
          signature = Array.from(sigResult).map(b => b.toString(16).padStart(2, '0')).join('');
        } else {
          console.error('[NIMIQ] Unexpected sign result:', sigResult);
          throw new Error('Unexpected signature format');
        }

        console.log('[NIMIQ] Mini App auth:', { address: this.address?.slice(0,12)+'...', sigLen: signature.length });
        return { address: this.address, signature };
      }

      // Hub API fallback (desktop browser with extension)
      const hub = await ensureHubApi();
      this.hubApi = hub;

      const result = await hub.signMessage({
        appName: appName || 'NimiqBilliards',
        message,
      });

      if (!result?.signer || !result?.signature) {
        const err = new Error('Connection cancelled');
        err.type = 'USER_REJECTED';
        throw err;
      }

      const sigBytes = result.signature;
      const signature = Array.from(
        sigBytes instanceof Uint8Array ? sigBytes : new Uint8Array(sigBytes)
      ).map(b => b.toString(16).padStart(2, '0')).join('');

      this.address = result.signer;
      this.connectedAddress = result.signer;
      this.connected = true;
      this.connectionMethod = 'hub';

      this.emit(WALLET_EVENTS.CONNECTED, {
        address: this.address,
        balance: 0,
        isTestnet: this.isTestnet,
      });

      return { address: result.signer, signature };
    } catch (e) {
      console.error('[NIMIQ] Connect/sign failed:', e);
      this.emit(WALLET_EVENTS.ERROR, e.message);
      throw e;
    }
  }

  async disconnect() {
    this.connected = false;
    this.address = null;
    this.connectedAddress = null;
    this.balance = 0;
    this.provider = null;
    this.hubApi = null;
    this.connectionMethod = null;
    this.emit(WALLET_EVENTS.DISCONNECTED);
  }

  async getWalletInfo() {
    if (!this.connected) throw new Error('Wallet not connected');
    return {
      address: this.address,
      balance: this.balance,
      isTestnet: this.isTestnet,
    };
  }

  async refreshBalance() {
    if (!this.connected) return 0;
    this.balance = await this._fetchBalance(this.address);
    this.emit(WALLET_EVENTS.BALANCE_UPDATED, this.balance);
    return this.balance;
  }

  /**
   * Fetch balance from Nimiq mainnet RPC
   * @private
   */
  async _fetchBalance(address) {
    try {
      const response = await fetch(MAINNET_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccount',
          params: [address],
        }),
      });

      const data = await response.json();
      if (data.result && data.result.balance !== undefined) {
        return data.result.balance;
      }
      return this.balance;
    } catch (err) {
      console.warn('[NIMIQ] Balance fetch failed:', err);
      return this.balance;
    }
  }

  /**
   * Send a NIM transaction
   * Mini App: provider.sendBasicTransaction()
   * Hub API: hubApi.checkout()
   *
   * @param {string} recipient
   * @param {number} value - Amount in Luna
   * @param {string} [extraData]
   * @returns {Promise<TransactionResult>}
   */
  async sendTransaction(recipient, value, extraData) {
    if (!this.connected) throw new Error('Wallet not connected');

    try {
      // Mini App SDK
      if (this.connectionMethod === 'miniapp' && this.provider) {
        const txData = {
          recipient,
          value,
          fee: 0,
        };

        if (extraData) {
          txData.extraData = Array.from(new TextEncoder().encode(extraData));
        }

        const result = await this.provider.sendBasicTransaction(txData);

        if (result && typeof result === 'object' && 'error' in result) {
          throw new Error(result.error.message || 'Transaction failed');
        }

        const tx = {
          hash: result.hash,
          from: this.address,
          to: recipient,
          value,
          fee: 0,
          status: 'pending',
          timestamp: Date.now(),
        };

        this.balance -= value;
        this.emit(WALLET_EVENTS.BALANCE_UPDATED, this.balance);
        this.emit(WALLET_EVENTS.TRANSACTION, tx);

        return tx;
      }

      // Hub API
      if (this.connectionMethod === 'hub' || this.hubApi) {
        const hub = this.hubApi || await ensureHubApi();
        const checkoutOpts = {
          appName: 'NimiqBilliards',
          recipient,
          value,
          sender: this.address,
          fee: 0,
        };

        if (extraData) {
          checkoutOpts.extraData = extraData;
        }

        const result = await hub.checkout(checkoutOpts);

        if (!result?.hash) {
          throw new Error('Transaction was cancelled or failed');
        }

        const tx = {
          hash: result.hash,
          from: this.address,
          to: recipient,
          value,
          fee: 0,
          status: 'confirmed',
          timestamp: Date.now(),
        };

        this.balance -= value;
        this.emit(WALLET_EVENTS.BALANCE_UPDATED, this.balance);
        this.emit(WALLET_EVENTS.TRANSACTION, tx);

        return tx;
      }

      throw new Error('No wallet connection method available');
    } catch (err) {
      console.error('[NIMIQ] Transaction failed:', err);
      this.emit(WALLET_EVENTS.ERROR, err.message);
      throw err;
    }
  }

  /**
   * Top up game balance via wallet checkout
   * Sends NIM from user wallet to platform wallet
   *
   * @param {string} platformWallet - Platform wallet address
   * @param {number} amountNim - Amount in NIM (will be converted to Luna)
   * @returns {Promise<{hash: string, sender: string, recipient: string, value: number} | null>}
   */
  async topUp(platformWallet, amountNim) {
    if (!this.connected) throw new Error('Wallet not connected');

    const valueLuna = Math.round(amountNim * LUNA_PER_NIM);
    const tx = await this.sendTransaction(platformWallet, valueLuna, `topup:${Date.now()}`);

    return {
      hash: tx.hash,
      sender: this.address,
      recipient: platformWallet,
      value: valueLuna,
    };
  }

  async signMessage(message) {
    if (!this.connected) throw new Error('Wallet not connected');

    try {
      // Mini App SDK
      if (this.connectionMethod === 'miniapp' && this.provider) {
        const result = await this.provider.sign(message);
        if (result && typeof result === 'object' && 'error' in result) {
          throw new Error('Signing rejected');
        }
        let sig;
        if (typeof result === 'string') {
          sig = result;
        } else if (result && typeof result === 'object' && typeof result.signature === 'string') {
          sig = result.signature;
        } else if (result instanceof Uint8Array) {
          sig = Array.from(result).map(b => b.toString(16).padStart(2, '0')).join('');
        } else {
          throw new Error('Unexpected signature format');
        }
        return { publicKey: this.address, signature: sig };
      }

      // Hub API
      const hub = this.hubApi || await ensureHubApi();
      const result = await hub.signMessage({
        appName: 'NimiqBilliards',
        message,
        signer: this.address,
      });

      if (!result?.signer || !result?.signature) throw new Error('Signing failed');

      const sigBytes = result.signature;
      return {
        publicKey: result.signer,
        signature: Array.from(
          sigBytes instanceof Uint8Array ? sigBytes : new Uint8Array(sigBytes)
        ).map(b => b.toString(16).padStart(2, '0')).join(''),
      };
    } catch (err) {
      console.error('[NIMIQ] Signing failed:', err);
      this.emit(WALLET_EVENTS.ERROR, err.message);
      throw err;
    }
  }

  async depositToMatch(entryFee, escrowAddress) {
    if (!this.connected) throw new Error('Wallet not connected');
    if (this.balance < entryFee) throw new Error('Insufficient balance');
    return this.sendTransaction(escrowAddress, entryFee, `match-deposit:${Date.now()}`);
  }

  async receiveWinnings(amount, matchId) {
    if (!this.connected) throw new Error('Wallet not connected');
    const tx = {
      hash: 'pending-server-side',
      from: 'ESCROW',
      to: this.address,
      amount,
      status: 'pending',
      timestamp: Date.now(),
    };
    this.balance += amount;
    this.emit(WALLET_EVENTS.BALANCE_UPDATED, this.balance);
    this.emit(WALLET_EVENTS.TRANSACTION, tx);
    return tx;
  }
}

export default NimiqProviderAdapter;
