/**
 * User Messages
 * 
 * Centralized message constants for consistent, clear user feedback.
 * 
 * RULE: Never tell the user they won money until the settlement has actually been verified.
 */

// ============================================
// Message Types
// ============================================

export const MessageType = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  LOADING: 'loading',
};

// ============================================
// Wallet Messages
// ============================================

export const WalletMessages = {
  NOT_CONNECTED: {
    type: MessageType.WARNING,
    title: 'Wallet Not Connected',
    message: 'Please connect your Nimiq wallet to continue.',
  },
  
  CONNECTING: {
    type: MessageType.LOADING,
    title: 'Connecting...',
    message: 'Connecting to your wallet.',
  },
  
  CONNECTED: {
    type: MessageType.SUCCESS,
    title: 'Wallet Connected',
    message: 'Your wallet is now connected.',
  },
  
  DISCONNECTED: {
    type: MessageType.INFO,
    title: 'Wallet Disconnected',
    message: 'Your wallet has been disconnected.',
  },
  
  CONNECTION_FAILED: {
    type: MessageType.ERROR,
    title: 'Connection Failed',
    message: 'Unable to connect to your wallet. Please try again.',
  },

  CONNECTION_CANCELLED: {
    type: MessageType.WARNING,
    title: 'Connection Cancelled',
    message: 'You cancelled the wallet connection.',
  },

  WALLET_NOT_FOUND: {
    type: MessageType.ERROR,
    title: 'Wallet Not Found',
    message: 'No Nimiq wallet detected. Install Nimiq Wallet extension or open in Nimiq Pay.',
  },
  
  INSUFFICIENT_BALANCE: (required, available) => ({
    type: MessageType.ERROR,
    title: 'Insufficient Balance',
    message: `You need ${required} NIM but only have ${available} NIM available.`,
  }),
  
  BALANCE_CHECK_FAILED: {
    type: MessageType.WARNING,
    title: 'Unable to Check Balance',
    message: 'Could not verify your balance. Please try again.',
  },
};

// ============================================
// Transaction Messages
// ============================================

export const TransactionMessages = {
  PENDING: {
    type: MessageType.LOADING,
    title: 'Transaction Pending',
    message: 'Your transaction is being processed. Please wait.',
  },
  
  SUBMITTED: {
    type: MessageType.INFO,
    title: 'Transaction Submitted',
    message: 'Your transaction has been submitted to the network.',
  },
  
  CONFIRMED: {
    type: MessageType.SUCCESS,
    title: 'Transaction Confirmed',
    message: 'Your transaction has been confirmed.',
  },
  
  REJECTED: {
    type: MessageType.ERROR,
    title: 'Transaction Rejected',
    message: 'You rejected the transaction in your wallet.',
  },
  
  FAILED: {
    type: MessageType.ERROR,
    title: 'Transaction Failed',
    message: 'Your transaction could not be completed. Please try again.',
  },
  
  CANCELLED: {
    type: MessageType.WARNING,
    title: 'Transaction Cancelled',
    message: 'The transaction was cancelled.',
  },
  
  VERIFICATION_PENDING: {
    type: MessageType.LOADING,
    title: 'Verifying Transaction',
    message: 'Waiting for blockchain confirmation.',
  },
  
  VERIFICATION_FAILED: {
    type: MessageType.ERROR,
    title: 'Unable to Verify Transaction',
    message: 'Could not verify the transaction status. Please check your wallet.',
  },
  
  TIMEOUT: {
    type: MessageType.ERROR,
    title: 'Transaction Timeout',
    message: 'The transaction is taking too long. Please check your wallet for status.',
  },
};

// ============================================
// Match Messages
// ============================================

export const MatchMessages = {
  SEARCHING: {
    type: MessageType.LOADING,
    title: 'Finding Opponent',
    message: 'Searching for a match...',
  },
  
  FOUND: {
    type: MessageType.SUCCESS,
    title: 'Match Found',
    message: 'Your opponent has been found.',
  },
  
  STARTING: {
    type: MessageType.LOADING,
    title: 'Starting Match',
    message: 'Preparing the game...',
  },
  
  CANCELLED: {
    type: MessageType.WARNING,
    title: 'Match Cancelled',
    message: 'The match has been cancelled.',
  },
  
  OPPONENT_DISCONNECTED: {
    type: MessageType.WARNING,
    title: 'Opponent Disconnected',
    message: 'Your opponent has disconnected. Waiting for reconnection...',
  },
  
  OPPONENT_RECONNECTED: {
    type: MessageType.SUCCESS,
    title: 'Opponent Reconnected',
    message: 'Your opponent has reconnected.',
  },
  
  OPPONENT_LEFT: {
    type: MessageType.INFO,
    title: 'Opponent Left',
    message: 'Your opponent has left the match.',
  },
  
  REMATCH_REQUESTED: {
    type: MessageType.INFO,
    title: 'Rematch Requested',
    message: 'A rematch has been requested.',
  },
  
  REMATCH_ACCEPTED: {
    type: MessageType.SUCCESS,
    title: 'Rematch Accepted',
    message: 'Starting rematch...',
  },
  
  REMATCH_DECLINED: {
    type: MessageType.INFO,
    title: 'Rematch Declined',
    message: 'The rematch was declined.',
  },
};

// ============================================
// Settlement Messages
// ============================================

export const SettlementMessages = {
  PENDING: {
    type: MessageType.LOADING,
    title: 'Settlement Pending',
    message: 'Finalizing match results...',
  },
  
  PROCESSING: {
    type: MessageType.LOADING,
    title: 'Processing Settlement',
    message: 'Your winnings are being processed.',
  },
  
  COMPLETED: (amount) => ({
    type: MessageType.SUCCESS,
    title: 'Settlement Complete',
    message: `Your winnings of ${amount} NIM have been credited to your wallet.`,
  }),
  
  FAILED: {
    type: MessageType.ERROR,
    title: 'Settlement Failed',
    message: 'There was an issue with the settlement. Please contact support.',
  },
  
  DISPUTED: {
    type: MessageType.WARNING,
    title: 'Settlement Disputed',
    message: 'This match is under review. We will resolve it shortly.',
  },
  
  // IMPORTANT: Never show win amount until settlement is verified
  WIN_PENDING: {
    type: MessageType.INFO,
    title: 'Match Won',
    message: 'You won the match! Waiting for settlement confirmation...',
  },
  
  WIN_VERIFIED: (amount) => ({
    type: MessageType.SUCCESS,
    title: 'Congratulations!',
    message: `You won ${amount} NIM! The funds have been added to your balance.`,
  }),
  
  LOSS: {
    type: MessageType.INFO,
    title: 'Match Lost',
    message: 'Better luck next time!',
  },
};

// ============================================
// Game Messages
// ============================================

export const GameMessages = {
  YOUR_TURN: {
    type: MessageType.INFO,
    title: 'Your Turn',
    message: 'It\'s your turn to shoot.',
  },
  
  OPPONENT_TURN: {
    type: MessageType.INFO,
    title: 'Opponent\'s Turn',
    message: 'Waiting for opponent to shoot...',
  },
  
  BREAK: {
    type: MessageType.INFO,
    title: 'Break Shot',
    message: 'Click and drag to break.',
  },
  
  BALL_IN_HAND: {
    type: MessageType.INFO,
    title: 'Ball in Hand',
    message: 'Click to place the cue ball.',
  },
  
  FOUL: (reason) => ({
    type: MessageType.WARNING,
    title: 'Foul',
    message: reason || 'A foul has been committed.',
  }),
  
  INVALID_SHOT: (reason) => ({
    type: MessageType.ERROR,
    title: 'Invalid Shot',
    message: reason || 'Your shot was invalid.',
  }),
  
  TURN_TIMEOUT: {
    type: MessageType.WARNING,
    title: 'Turn Timeout',
    message: 'You ran out of time. Turn passed to opponent.',
  },
  
  GAME_OVER_WIN: {
    type: MessageType.SUCCESS,
    title: 'Game Over',
    message: 'You won the game!',
  },
  
  GAME_OVER_LOSE: {
    type: MessageType.INFO,
    title: 'Game Over',
    message: 'You lost the game.',
  },
};

// ============================================
// Server Messages
// ============================================

export const ServerMessages = {
  CONNECTING: {
    type: MessageType.LOADING,
    title: 'Connecting',
    message: 'Connecting to server...',
  },
  
  CONNECTED: {
    type: MessageType.SUCCESS,
    title: 'Connected',
    message: 'Connected to server.',
  },
  
  DISCONNECTED: {
    type: MessageType.ERROR,
    title: 'Connection Lost',
    message: 'Lost connection to server.',
  },
  
  RECONNECTING: {
    type: MessageType.LOADING,
    title: 'Reconnecting',
    message: 'Attempting to reconnect...',
  },
  
  RECONNECT_FAILED: {
    type: MessageType.ERROR,
    title: 'Reconnection Failed',
    message: 'Unable to reconnect. Please refresh the page.',
  },
  
  SERVER_ERROR: {
    type: MessageType.ERROR,
    title: 'Server Error',
    message: 'An error occurred on the server. Please try again.',
  },
  
  RATE_LIMITED: {
    type: MessageType.WARNING,
    title: 'Too Many Requests',
    message: 'Please wait a moment before trying again.',
  },
  
  INVALID_ACTION: {
    type: MessageType.ERROR,
    title: 'Invalid Action',
    message: 'This action is not allowed.',
  },
  
  MATCH_NOT_FOUND: {
    type: MessageType.ERROR,
    title: 'Match Not Found',
    message: 'The match could not be found.',
  },
  
  ALREADY_IN_MATCH: {
    type: MessageType.WARNING,
    title: 'Already in Match',
    message: 'You are already in a match.',
  },
  
  QUEUE_FULL: {
    type: MessageType.WARNING,
    title: 'Queue Full',
    message: 'The matchmaking queue is currently full. Please try again.',
  },
};

// ============================================
// Network Messages
// ============================================

export const NetworkMessages = {
  HIGH_LATENCY: {
    type: MessageType.WARNING,
    title: 'High Latency',
    message: 'Your connection is slow. This may affect gameplay.',
  },
  
  PACKET_LOSS: {
    type: MessageType.WARNING,
    title: 'Connection Unstable',
    message: 'Experiencing packet loss. Some actions may be delayed.',
  },
  
  SYNC_ERROR: {
    type: MessageType.ERROR,
    title: 'Sync Error',
    message: 'Game state sync failed. Refreshing...',
  },
};

// ============================================
// Helper Functions
// ============================================

/**
 * Create a toast message element
 */
export function createToast(message, duration = 5000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${message.type}`;
  
  const icon = getToastIcon(message.type);
  const title = message.title || '';
  const text = message.message || message;
  
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">
      ${title ? `<div class="toast-title">${title}</div>` : ''}
      <div class="toast-message">${text}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;
  
  // Add to container
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  
  container.appendChild(toast);
  
  // Auto remove
  if (duration > 0) {
    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
  
  return toast;
}

/**
 * Get icon for toast type
 */
function getToastIcon(type) {
  switch (type) {
    case MessageType.SUCCESS:
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>`;
    case MessageType.ERROR:
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>`;
    case MessageType.WARNING:
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>`;
    case MessageType.LOADING:
      return `<div class="toast-spinner"></div>`;
    case MessageType.INFO:
    default:
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>`;
  }
}
