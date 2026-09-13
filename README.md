# Nimiq Billiards

A multiplayer 8-ball billiards game built with Nimiq blockchain integration. Play against AI or compete head-to-head with real players for NIM tokens.

## Features

- **Real-time multiplayer** — Play 8-ball pool against other players via WebSocket
- **AI opponents** — Practice against AI with 4 difficulty levels (Easy, Medium, Hard, Expert)
- **NIM wallet integration** — Connect your Nimiq wallet, top up balance, withdraw winnings
- **Competitive matches** — wager NIM in ranked matches (100 / 500 / 1,000 / 5,000 NIM tiers)
- **XP & leveling** — Earn XP from wins (+100) and losses (+30)
- **Leaderboard** — Weekly and all-time rankings
- **Nimiq Pay support** — Works with Nimiq Pay Mini App and Nimiq Wallet browser extension
- **Mobile responsive** — Touch controls for mobile play

## Tech Stack

- **Frontend:** Vanilla JavaScript (ES modules), HTML5 Canvas
- **Backend:** Node.js, Express, WebSocket (ws)
- **Wallet:** @nimiq/mini-app-sdk, @nimiq/hub-api
- **Network:** Nimiq mainnet

## Prerequisites

- **Node.js** v18 or higher
- **npm** v9 or higher
- A Nimiq wallet (Nimiq Pay app or Nimiq Wallet browser extension)

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/axeatacks1/nimiq-billiards.git
cd nimiq-billiards
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env` file in the project root:

```env
# Platform wallet mnemonic (24 words) for signing auto-withdraw transactions
PLATFORM_SEED=your twenty four word mnemonic phrase goes here

# Server port (default: 3001)
PORT=3001

# Nimiq RPC endpoint (default: https://rpc.nimiqwatch.com/)
NIMIQ_RPC=https://rpc.nimiqwatch.com/
```

> **Important:** The `PLATFORM_SEED` is the mnemonic for the platform wallet that holds funds for auto-withdraw. Fund this wallet with NIM before using the game.

### 4. Run the development server

```bash
npm run dev
```

This starts both the backend server (port 3001) and the Vite dev client (port 3000).

- **Game URL:** `http://localhost:3001`
- **Dev URL (with HMR):** `http://localhost:3000`

### 5. Build for production

```bash
npm run build
```

### 6. Run production server

```bash
npm start
```

## How to Play

### Connecting Your Wallet

1. Click **"Connect Wallet"** in the lobby
2. If using **Nimiq Pay** (mobile): the wallet connects natively
3. If using **Nimiq Wallet** (desktop): a popup opens to hub.nimiq.com for signing
4. Your wallet address and balance appear in the lobby

### Game Modes

| Mode | Description | Entry Fee |
|------|-------------|-----------|
| **Play with AI** | Practice against computer opponent | Free |
| **Normal Match** | 8-ball pool against a real player | Free |
| **Nimiq Match** | Competitive match with NIM wager | 100 / 500 / 1K / 5K NIM |

### Controls

- **Mouse:** Click and drag to aim, release to shoot
- **Mobile:** Touch and drag to aim, lift finger (keeps aim), tap "Shoot" button
- **Power:** Drag further from the cue ball for more power

### 8-Ball Rules

- Pocket all your balls (solids 1-7 or stripes 9-15) then the 8-ball
- First ball pocketed determines your group
- Scratching (pocketing the cue ball) gives opponent ball-in-hand
- Pocketing the 8-ball early loses the game

## Project Structure

```
nimiq-billiards/
├── server/
│   ├── index.js              # Express + WebSocket server
│   ├── match-state-machine.js # Match state management
│   ├── settlement-service.js  # Transaction settlement
│   ├── validation.js          # Shot validation
│   ├── security.js            # Rate limiting & abuse prevention
│   └── match-replay.js        # Match replay logging
├── src/
│   ├── main.js                # Client entry point
│   ├── nimiq/
│   │   ├── wallet.js          # Wallet factory
│   │   ├── nimiq-provider-adapter.js  # Mini App + Hub API adapter
│   │   ├── hub-adapter.js     # Hub API adapter
│   │   └── wallet-service.js  # Base wallet service
│   ├── engine/
│   │   ├── physics.js         # Ball physics
│   │   ├── renderer.js        # Canvas rendering
│   │   ├── rules.js           # 8-ball rule engine
│   │   ├── input.js           # Mouse/touch input
│   │   └── constants.js       # Game constants
│   ├── ai/
│   │   └── ai-player.js       # AI opponent logic
│   ├── network/
│   │   └── client.js          # WebSocket client
│   └── ui/
│       ├── messages.js        # Toast notifications
│       ├── leaderboard.js     # Leaderboard display
│       └── admin.js           # Admin panel
├── public/
│   ├── favicon.svg            # Favicon
│   ├── logo.svg               # Logo
│   ├── background.svg         # Lobby background
│   └── avatars/               # Player avatars (6 SVGs)
├── index.html                 # Main HTML file
├── package.json
├── .env                       # Environment variables (not committed)
└── LICENSE                    # MIT License
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/nonce` | Get authentication nonce |
| POST | `/api/auth/login` | Login with wallet signature |
| GET | `/api/profile` | Get player profile |
| POST | `/api/profile` | Update player profile |
| POST | `/api/topup` | Top up game balance |
| POST | `/api/withdraw` | Withdraw NIM to wallet |
| GET | `/api/leaderboard` | Get leaderboard data |
| GET | `/api/health` | Server health check |
| POST | `/api/game-result` | Record AI game result |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PLATFORM_SEED` | Yes | — | 24-word mnemonic for platform wallet |
| `PORT` | No | `3001` | Server port |
| `NIMIQ_RPC` | No | `https://rpc.nimiqwatch.com/` | Nimiq RPC endpoint |

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
