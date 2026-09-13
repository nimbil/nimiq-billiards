import { WalletService, WALLET_EVENTS } from './wallet-service.js';

/**
 * HubAdapter - Nimiq Hub API wallet integration
 *
 * Uses @nimiq/hub-api for:
 *   - signMessage() for authentication (like nimiqstake-pro)
 *   - checkout() for payments (top-up, entry fees)
 *
 * Pattern from: nimiqstake-pro/apps/web/src/lib/nimiq-wallet.ts
 */

const HUB_ENDPOINT = 'https://hub.nimiq.com';
const LUNA_PER_NIM = 100_000;

let hubInstance = null;
let hubApiModule = null;

async function getHubApi() {
  if (!hubApiModule) {
    hubApiModule = await import('@nimiq/hub-api');
  }
  return hubApiModule.default;
}

async function getHub() {
  if (!hubInstance) {
    const HubApi = await getHubApi();
    hubInstance = new HubApi(HUB_ENDPOINT);
  }
  return hubInstance;
}

export class HubAdapter extends WalletService {
  constructor() {
    super();
    this.isTestnet = false;
    this.connectedAddress = null;
  }

  /**
   * Connect via Hub sign message (auth flow)
   * @param {string} appName
   * @param {string} message - Message to sign (should contain nonce from server)
   * @returns {Promise<{address: string, signature: string} | null>}
   */
  async connectAndSign(appName, message) {
    if (typeof window === 'undefined') return null;

    try {
      const hub = await getHub();
      const result = await hub.signMessage({ appName, message });

      if (!result?.signer || !result?.signature) return null;

      const sigBytes = result.signature;
      const signature = Array.from(
        sigBytes instanceof Uint8Array ? sigBytes : new Uint8Array(sigBytes)
      ).map(b => b.toString(16).padStart(2, '0')).join('');

      this.connectedAddress = result.signer;
      this.address = result.signer;
      this.connected = true;

      this.emit(WALLET_EVENTS.CONNECTED, {
        address: this.address,
        balance: 0,
        isTestnet: this.isTestnet,
      });

      return { address: result.signer, signature };
    } catch (e) {
      console.error('[HUB] Connect/sign failed:', e);
      this.emit(WALLET_EVENTS.ERROR, e.message);
      return null;
    }
  }

  async connect() {
    return true;
  }

  async disconnect() {
    this.connected = false;
    this.address = null;
    this.connectedAddress = null;
    this.balance = 0;
    this.emit(WALLET_EVENTS.DISCONNECTED);
  }

  /**
   * Top up game balance via Hub checkout
   * Sends NIM from user wallet to platform wallet
   *
   * @param {string} platformWallet - Platform wallet address
   * @param {number} amountNim - Amount in NIM (will be converted to Luna)
   * @returns {Promise<{hash: string, sender: string, recipient: string, value: number} | null>}
   */
  async topUp(platformWallet, amountNim) {
    if (typeof window === 'undefined') throw new Error('Not in browser');

    try {
      const hub = await getHub();
      const valueLuna = Math.round(amountNim * LUNA_PER_NIM);

      const result = await hub.checkout({
        appName: 'NimiqBilliards',
        recipient: platformWallet,
        value: valueLuna,
      });

      if (!result?.hash || !result?.raw) {
        throw new Error('Transaction was cancelled or failed');
      }

      const txProof = {
        hash: result.hash,
        sender: result.raw.sender,
        recipient: result.raw.recipient,
        value: result.raw.value,
      };

      this.emit(WALLET_EVENTS.TRANSACTION, {
        hash: txProof.hash,
        from: this.address,
        to: platformWallet,
        value: valueLuna,
        status: 'confirmed',
        timestamp: Date.now(),
      });

      return txProof;
    } catch (e) {
      console.error('[HUB] Top-up failed:', e);
      this.emit(WALLET_EVENTS.ERROR, e.message);
      throw e;
    }
  }

  /**
   * Send a basic transaction via Hub checkout
   */
  async sendTransaction(recipient, value) {
    if (typeof window === 'undefined') throw new Error('Not in browser');

    const hub = await getHub();
    const result = await hub.checkout({
      appName: 'NimiqBilliards',
      recipient,
      value,
    });

    if (!result?.hash) throw new Error('Transaction failed');

    return {
      hash: result.hash,
      from: this.address,
      to: recipient,
      value,
      status: 'confirmed',
      timestamp: Date.now(),
    };
  }

  async signMessage(message) {
    const hub = await getHub();
    const result = await hub.signMessage({
      appName: 'NimiqBilliards',
      message,
    });

    if (!result?.signer || !result?.signature) throw new Error('Signing failed');

    const sigBytes = result.signature;
    const signature = Array.from(
      sigBytes instanceof Uint8Array ? sigBytes : new Uint8Array(sigBytes)
    ).map(b => b.toString(16).padStart(2, '0')).join('');

    return { publicKey: result.signer, signature };
  }

  async refreshBalance() {
    return this.balance;
  }

  getBalance() {
    return this.balance;
  }
}

export default HubAdapter;
