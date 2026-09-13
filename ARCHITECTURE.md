# Nimiq Billiards - Secure Architecture

## Core Principle: Server Is Authoritative

**The client is NEVER trusted for:**
- Game state (ball positions, turns, scores)
- Winner determination
- Financial operations (payments, settlements)
- State transitions

**The client ONLY:**
- Renders the game
- Sends input (aim, power)
- Displays wallet UI
- Receives and displays results

---

## Transaction State Machine

Every match follows this state flow. ALL transitions are validated server-side.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MATCH LIFECYCLE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐    ┌──────────────────┐    ┌──────────────────┐              │
│  │ CREATED  │───▶│WAITING_FOR_P1    │───▶│WAITING_FOR_P2    │              │
│  └──────────┘    └──────────────────┘    └──────────────────┘              │
│       │                                      │                             │
│       │                                      ▼                             │
│       │                               ┌──────────────────┐                 │
│       │                               │ PAYMENT_PENDING  │                 │
│       │                               └──────────────────┘                 │
│       │                                      │                             │
│       │                                      ▼                             │
│       │                               ┌──────────────────┐                 │
│       │                               │PAYMENTS_CONFIRMED│                 │
│       │                               └──────────────────┘                 │
│       │                                      │                             │
│       │                                      ▼                             │
│       │                               ┌──────────────────┐                 │
│       │                               │   MATCH_READY    │                 │
│       │                               └──────────────────┘                 │
│       │                                      │                             │
│       │                                      ▼                             │
│       │                               ┌──────────────────┐                 │
│       │                               │  MATCH_STARTED   │                 │
│       │                               └──────────────────┘                 │
│       │                                      │                             │
│       │                                      ▼                             │
│       │                               ┌──────────────────┐                 │
│       │                               │  MATCH_FINISHED  │                 │
│       │                               └──────────────────┘                 │
│       │                                      │                             │
│       │                                      ▼                             │
│       │                               ┌──────────────────┐                 │
│       │                               │SETTLEMENT_PENDING│                 │
│       │                               └──────────────────┘                 │
│       │                                      │                             │
│       │                                      ▼                             │
│       │                               ┌──────────────────┐                 │
│       │                               │SETTLEMENT_CONFIRM│                 │
│       │                               └──────────────────┘                 │
│       │                                      │                             │
│       │                                      ▼                             │
│       │                               ┌──────────────────┐                 │
│       │                               │    COMPLETED     │                 │
│       │                               └──────────────────┘                 │
│       │                                                                     │
│       │              ┌──────────────────┐                                  │
│       └─────────────▶│    CANCELLED     │◀──────── (from pre-match)       │
│                      └──────────────────┘                                  │
│                                                                             │
│                      ┌──────────────────┐                                  │
│                      │    REFUNDED      │◀──────── (after payment)         │
│                      └──────────────────┘                                  │
│                                                                             │
│                      ┌──────────────────┐                                  │
│                      │    DISPUTED      │◀──────── (from any active state) │
│                      └──────────────────┘                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
server/
├── match-state-machine.js   # State machine with validated transitions
├── settlement-service.js    # Prize distribution logic
├── validation.js            # Server-side input validation
└── index.js                 # Main server (to be refactored)

src/nimiq/
├── wallet-service.js        # Wallet interface abstraction
├── nimiq-provider-adapter.js # Real Nimiq wallet adapter
├── mock-wallet-adapter.js   # Testnet mock wallet
└── wallet.js                # Factory for wallet adapters
```

---

## Detailed State Descriptions

| State | Description | Allowed Next States |
|-------|-------------|---------------------|
| `CREATED` | Match instance created | `WAITING_FOR_PLAYER_1`, `CANCELLED` |
| `WAITING_FOR_PLAYER_1` | Awaiting player 1 connection/wallet | `WAITING_FOR_PLAYER_2`, `CANCELLED` |
| `WAITING_FOR_PLAYER_2` | Player 1 ready, awaiting opponent | `PAYMENT_PENDING`, `CANCELLED` |
| `PAYMENT_PENDING` | Both players matched, awaiting payment | `PAYMENTS_CONFIRMED`, `CANCELLED`, `DISPUTED` |
| `PAYMENTS_CONFIRMED` | Both payments verified | `MATCH_READY`, `REFUNDED`, `DISPUTED` |
| `MATCH_READY` | Escrow locked, ready to start | `MATCH_STARTED`, `REFUNDED`, `CANCELLED`, `DISPUTED` |
| `MATCH_STARTED` | Game in progress | `MATCH_FINISHED`, `DISPUTED` |
| `MATCH_FINISHED` | Winner determined | `SETTLEMENT_PENDING`, `DISPUTED` |
| `SETTLEMENT_PENDING` | Prize calculation in progress | `SETTLEMENT_CONFIRMED`, `DISPUTED` |
| `SETTLEMENT_CONFIRMED` | Payout transaction verified | `COMPLETED` |
| `COMPLETED` | Match fully settled | *(terminal)* |
| `CANCELLED` | Match cancelled | *(terminal)* |
| `REFUNDED` | Payments returned | *(terminal)* |
| `DISPUTED` | Requires manual review | *(terminal)* |

---

## Player Flow

### Player A (Host)
```
1. Connect wallet → WalletService.connect()
2. Select tier (e.g., 500 NIM)
3. Request match creation
   → Server validates:
     - Player not in match/queue
     - Tier exists
     - Wallet connected
     - Sufficient balance
   → Server creates MatchStateMachine
   → State: CREATED → WAITING_FOR_PLAYER_1 → WAITING_FOR_PLAYER_2
4. Join matchmaking queue
   → Server adds to tier-specific queue
5. Wait for opponent
```

### Player B (Joiner)
```
1. Connect wallet → WalletService.connect()
2. Select same tier
3. Request match join
   → Server validates same as above
   → Server finds waiting match
   → Server assigns Player B to match
   → State: WAITING_FOR_PLAYER_2 → PAYMENT_PENDING
4. Both players prompted to pay
```

### Payment Phase
```
1. Server sends payment request to both players
2. Each player's wallet signs transaction
   → Wallet sends transaction to Nimiq network
   → Returns txHash to server
3. Server validates payment:
   → Player in match? ✓
   → Correct amount? ✓
   → Not already paid? ✓
   → Rate limit OK? ✓
4. Server records payment
5. When both payments verified:
   → State: PAYMENT_PENDING → PAYMENTS_CONFIRMED → MATCH_READY
6. Server locks escrow
```

### Game Phase
```
1. Server validates match can start:
   → Both players connected? ✓
   → Both in match? ✓
   → State is MATCH_READY? ✓
2. Server starts match
   → State: MATCH_READY → MATCH_STARTED
3. Game runs server-authoritative:
   → Player sends shoot(angle, power)
   → Server validates shot
   → Server runs physics
   → Server determines outcome
   → Server broadcasts result
4. Match ends:
   → Winner determined by server rules
   → State: MATCH_STARTED → MATCH_FINISHED
```

### Settlement Phase
```
1. Match finished → settlement initiated
   → State: MATCH_FINISHED → SETTLEMENT_PENDING
2. SettlementService processes:
   → Verifies winner/loser
   → Calculates prize (entryFee × 2 - platformFee)
   → Processes payout from ledger
   → Records transaction hashes
3. Settlement confirmed
   → State: SETTLEMENT_PENDING → SETTLEMENT_CONFIRMED → COMPLETED
4. Players notified with results
```

---

## Security Model

### What Server Validates

| Action | Validation |
|--------|-----------|
| Match creation | Player connected, not in match, tier valid, balance sufficient |
| Payment | Player in match, correct amount, not duplicate, rate limit |
| Shot | Match started, player's turn, no shot in progress, valid angle/power |
| Settlement | Match finished, valid winner/loser, competitive match |

### What Client Cannot Do

- Change ball positions
- Declare themselves winner
- Modify balances
- Skip payment
- Force state transitions
- Bypass validation

### Audit Trail

Every state transition is logged with:
- Timestamp
- From state
- To state
- Reason
- Player ID
- Additional data

---

## Refactoring Plan

To integrate this architecture into the existing server:

1. **Replace `GameMatch.state`** with `MatchStateMachine`
2. **Replace `findMatchCompetitive`** logic with proper state transitions
3. **Replace `endMatch`** with `SettlementService.processSettlement()`
4. **Add validation** before every action handler
5. **Remove client-side balance tracking** from server (use ledger only)
6. **Add proper escrow** using `MatchEscrow` from state machine

---

## Environment Modes

| Mode | Wallet | Ledger | Blockchain |
|------|--------|--------|------------|
| `development` | MockWalletAdapter | In-memory Map | None |
| `testnet` | MockWalletAdapter or NimiqProviderAdapter | In-memory Map | Nimiq Testnet |
| `mainnet` | NimiqProviderAdapter only | Persistent DB | Nimiq Mainnet |

---

## Legal Disclaimer Required

Before mainnet deployment, the following must be addressed:

1. **Gambling regulations** - Check local laws for cryptocurrency gambling
2. **KYC/AML** - May be required depending on jurisdiction
3. **Smart contract audit** - If using on-chain escrow
4. **Terms of service** - User agreement required
5. **Responsible gambling** - Self-exclusion options, limits
6. **Tax reporting** - Winnings may be taxable
