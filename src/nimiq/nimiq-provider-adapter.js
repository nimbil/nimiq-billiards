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

async function ensureHubApi() {
  if (hubApiModule) return hubApiModule;
  if (hubLoadPromise) return hubLoadPromise;

  hubLoadPromise = (async () => {
    const mod = await import('@nimiq/hub-api');
    const HubApi = mod.default;
    hubApiModule = new HubApi(HUB_ENDPOINT);
    return hubApiModule;
  })();

  return hubLoadPromise;
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

    // Check for error response
    if (result && typeof result === 'object' && 'error' in result) {
      throw new Error(result.error.message || 'User rejected connection');
    }

    const accounts = result;
    if (!accounts || !accounts.length) {
      throw new Error('No accounts found. User may have rejected the request.');
    }

    this.address = accounts[0];
    this.connectedAddress = accounts[0];
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
      // If running inside Nimiq Pay, use Mini App SDK
      if (NimiqProviderAdapter.isNimiqProviderAvailable()) {
        return await this._connectMiniApp();
      }

      // Auto-detect best method
      if (!this.connectionMethod) {
        this.connectionMethod = await NimiqProviderAdapter.detectMethod();
      }

      if (this.connectionMethod === 'miniapp') {
        return await this._connectMiniApp();
      }

      if (this.connectionMethod === 'hub') {
        return await this._connectHub(appName);
      }

      throw new Error('No Nimiq wallet detected. Install Nimiq Wallet extension or open in Nimiq Pay.');
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
      // Mini App SDK: sign directly
      if (this.connectionMethod === 'miniapp' || NimiqProviderAdapter.isNimiqProviderAvailable()) {
        if (!this.provider) {
          this.provider = await tryInitMiniApp();
        }
        if (this.provider) {
          this.connectionMethod = 'miniapp';
          console.log('[NIMIQ] Connected via Mini App SDK');

          // First get account
          const accounts = await this.provider.listAccounts();
          console.log('[NIMIQ] listAccounts result:', JSON.stringify(accounts));
          if (accounts && typeof accounts !== 'object' && accounts.length > 0) {
            this.address = accounts[0];
            this.connected = true;
          } else if (accounts && typeof accounts === 'object' && !('error' in accounts) && accounts.length > 0) {
            this.address = accounts[0];
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

          // Handle different signature formats from Mini App SDK
          let sigBytes;
          if (sigResult instanceof Uint8Array) {
            sigBytes = sigResult;
          } else if (sigResult && typeof sigResult === 'object' && sigResult.signature) {
            sigBytes = sigResult.signature instanceof Uint8Array ? sigResult.signature : new Uint8Array(sigResult.signature);
          } else if (sigResult && typeof sigResult === 'object' && sigResult.buffer) {
            sigBytes = new Uint8Array(sigResult);
          } else {
            sigBytes = new Uint8Array(sigResult);
          }

          const signature = Array.from(sigBytes)
            .map(b => b.toString(16).padStart(2, '0')).join('');

          this.emit(WALLET_EVENTS.CONNECTED, {
            address: this.address,
            balance: 0,
            isTestnet: this.isTestnet,
          });

          console.log('[NIMIQ] Mini App auth:', { address: this.address?.slice(0,12)+'...', sigLen: signature.length });
          return { address: this.address, signature };
        }
      }

      // Hub API fallback
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
        return {
          publicKey: this.address,
          signature: Array.from(
            result instanceof Uint8Array ? result : new Uint8Array(result)
          ).map(b => b.toString(16).padStart(2, '0')).join(''),
        };
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
