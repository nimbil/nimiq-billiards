/**
 * Nimiq Billiards - Match Economy Configuration
 *
 * All monetary values are in the smallest unit (lamports: 1 NIM = 100,000 lamports).
 * The UI displays NIM (value / 100000).
 *
 * SECURITY NOTICE:
 * This system is configured for TESTNET/MOCK transactions only.
 * Before enabling real-money functionality on mainnet, verify:
 *   - Applicable gambling/gaming regulations in all target jurisdictions
 *   - Consumer protection laws
 *   - Tax reporting obligations
 *   - Nimiq ecosystem integration requirements
 *   - Platform liability and escrow legal requirements
 *   - Anti-money laundering (AML) compliance
 *   - Know Your Customer (KYC) requirements if applicable
 *
 * DO NOT deploy with real funds until legal review is complete.
 */

export const NETWORK_MODE = {
  TESTNET: 'testnet',
  MAINNET: 'mainnet',
};

export const CURRENCY = {
  symbol: 'NIM',
  name: 'Nimiq',
  decimals: 5,
  baseUnit: 'lamports',
};

/**
 * Convert NIM to lamports
 */
export function nimToLamports(nim) {
  return Math.round(nim * 100000);
}

/**
 * Convert lamports to NIM
 */
export function lamportsToNim(lamports) {
  return lamports / 100000;
}

/**
 * Format lamports as NIM string
 */
export function formatNim(lamports) {
  const nim = lamportsToNim(lamports);
  if (nim >= 1000) return `${(nim / 1000).toFixed(1)}K NIM`;
  if (nim >= 100) return `${Math.round(nim)} NIM`;
  return `${nim.toFixed(2)} NIM`;
}

/**
 * Match Tier Configuration
 *
 * Each tier defines the economics for a competitive match:
 *   - id: unique tier identifier
 *   - name: display name
 *   - entryFee: lamports each player deposits
 *   - platformFeePercent: percentage of total pot taken as platform fee (0-100)
 *   - minimumBalance: lamports required to enter this tier
 *   - description: short description for UI
 *   - color: UI accent color
 *   - icon: emoji or icon identifier
 */
export const MATCH_TIERS = [
  {
    id: 'bronze',
    name: 'Bronze',
    entryFee: nimToLamports(100),
    platformFeePercent: 5,
    minimumBalance: nimToLamports(100),
    description: '100 NIM entry, casual competitive',
    color: '#cd7f32',
    icon: '\u{1F7E4}',
  },
  {
    id: 'silver',
    name: 'Silver',
    entryFee: nimToLamports(500),
    platformFeePercent: 5,
    minimumBalance: nimToLamports(500),
    description: '500 NIM entry, serious matches',
    color: '#c0c0c0',
    icon: '\u{1FA99}',
  },
  {
    id: 'gold',
    name: 'Gold',
    entryFee: nimToLamports(1000),
    platformFeePercent: 5,
    minimumBalance: nimToLamports(1000),
    description: '1000 NIM entry, high stakes',
    color: '#ffd700',
    icon: '\u{1FA99}',
  },
  {
    id: 'diamond',
    name: 'Diamond',
    entryFee: nimToLamports(5000),
    platformFeePercent: 3,
    minimumBalance: nimToLamports(5000),
    description: '5000 NIM entry, elite competition',
    color: '#b9f2ff',
    icon: '\u{1F48E}',
  },
];

/**
 * Calculate prize pool and platform fee for a given tier
 */
export function calculatePrizePool(tier) {
  const totalPot = tier.entryFee * 2;
  const platformFeeLamports = Math.round(totalPot * (tier.platformFeePercent / 100));
  const winnerPrize = totalPot - platformFeeLamports;

  return {
    entryFee: tier.entryFee,
    totalPot,
    platformFeeLamports,
    platformFeePercent: tier.platformFeePercent,
    winnerPrize,
  };
}

/**
 * Get a tier by ID
 */
export function getTierById(tierId) {
  return MATCH_TIERS.find(t => t.id === tierId);
}

/**
 * Get all tier summaries for UI display
 */
export function getTierSummaries() {
  return MATCH_TIERS.map(tier => {
    const prize = calculatePrizePool(tier);
    return {
      id: tier.id,
      name: tier.name,
      entryFee: tier.entryFee,
      entryFeeFormatted: formatNim(tier.entryFee),
      winnerPrize: prize.winnerPrize,
      winnerPrizeFormatted: formatNim(prize.winnerPrize),
      platformFee: prize.platformFeeLamports,
      platformFeeFormatted: formatNim(prize.platformFeeLamports),
      minimumBalance: tier.minimumBalance,
      minimumBalanceFormatted: formatNim(tier.minimumBalance),
      description: tier.description,
      color: tier.color,
      icon: tier.icon,
    };
  });
}

/**
 * Validate if a player can enter a given tier
 */
export function canEnterTier(playerBalance, tierId) {
  const tier = getTierById(tierId);
  if (!tier) return { allowed: false, reason: 'Unknown tier' };
  if (playerBalance < tier.minimumBalance) {
    return {
      allowed: false,
      reason: `Need ${formatNim(tier.minimumBalance)} minimum (have ${formatNim(playerBalance)})`,
    };
  }
  return { allowed: true };
}

/**
 * Server-side escrow record
 */
export class MatchEscrow {
  constructor(matchId, tierId, player1Id, player2Id) {
    this.matchId = matchId;
    this.tierId = tierId;
    this.tier = getTierById(tierId);
    this.player1Id = player1Id;
    this.player2Id = player2Id;
    this.player1Deposited = false;
    this.player2Deposited = false;
    this.prize = calculatePrizePool(this.tier);
    this.state = 'pending';
    this.createdAt = Date.now();
    this.settledAt = 0;
    this.depositTxIds = [];
    this.payoutTxId = null;
  }

  deposit(playerId, txId) {
    if (playerId === this.player1Id) this.player1Deposited = true;
    if (playerId === this.player2Id) this.player2Deposited = true;
    this.depositTxIds.push(txId);

    if (this.player1Deposited && this.player2Deposited) {
      this.state = 'escrowed';
    }
  }

  get isFullyFunded() {
    return this.player1Deposited && this.player2Deposited;
  }

  settle(winnerId) {
    this.state = 'settled';
    this.settledAt = Date.now();
    return {
      winnerId,
      winnerPrize: this.prize.winnerPrize,
      platformFee: this.prize.platformFeeLamports,
      loserId: winnerId === this.player1Id ? this.player2Id : this.player1Id,
    };
  }

  getPublicData() {
    return {
      matchId: this.matchId,
      tierId: this.tierId,
      entryFee: this.prize.entryFee,
      entryFeeFormatted: formatNim(this.prize.entryFee),
      winnerPrize: this.prize.winnerPrize,
      winnerPrizeFormatted: formatNim(this.prize.winnerPrize),
      platformFee: this.prize.platformFeeLamports,
      platformFeeFormatted: formatNim(this.prize.platformFeeLamports),
      state: this.state,
    };
  }
}

/**
 * Global economy configuration
 * Can be adjusted for different deployments
 */
export const ECONOMY_CONFIG = {
  networkMode: NETWORK_MODE.MAINNET,
  currency: CURRENCY,
  tiers: MATCH_TIERS,
  escrowTimeoutMs: 60 * 1000,
  maxActiveCompetitiveMatches: 100,
  requireWalletForCompetitive: true,
};
