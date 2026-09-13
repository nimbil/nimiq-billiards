const API_BASE = '/api/leaderboard';

let lobbyPeriod = 'weekly';

const MOCK_PLAYERS = [
  { rank: 1, username: 'CueMaster', avatar: 'C', rating: 2450, wins: 180, losses: 42, winRate: 81.1 },
  { rank: 2, username: 'PoolLegend', avatar: 'P', rating: 1890, wins: 145, losses: 55, winRate: 72.5 },
  { rank: 3, username: 'StrikeKing', avatar: 'S', rating: 1245, wins: 98, losses: 61, winRate: 61.6 },
  { rank: 4, username: 'NineBallPro', avatar: 'N', rating: 980, wins: 76, losses: 48, winRate: 61.3 },
  { rank: 5, username: 'BilliardAce', avatar: 'B', rating: 870, wins: 65, losses: 52, winRate: 55.5 },
  { rank: 6, username: 'PocketHero', avatar: 'P', rating: 765, wins: 54, losses: 45, winRate: 54.5 },
  { rank: 7, username: 'SmoothShot', avatar: 'S', rating: 640, wins: 42, losses: 38, winRate: 52.5 },
  { rank: 8, username: 'BallRunner', avatar: 'B', rating: 560, wins: 38, losses: 35, winRate: 52.1 },
];

async function fetchLeaderboard(period, sort, limit = 50) {
  const url = new URL(API_BASE, window.location.origin);
  url.searchParams.set('period', period);
  url.searchParams.set('sort', sort);
  url.searchParams.set('limit', String(limit));

  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('Failed');
    return await res.json();
  } catch {
    return { players: MOCK_PLAYERS.slice(0, limit), total: MOCK_PLAYERS.length, period, sort };
  }
}

// ============================================
// Lobby Sidebar Leaderboard
// ============================================

let currentPlayerName = '';

function setCurrentPlayerName(name) {
  currentPlayerName = name;
}

async function loadLeaderboardPreview(period) {
  const container = document.getElementById('leaderboard-list');
  if (!container) return;
  if (period) lobbyPeriod = period;

  container.innerHTML = '<div class="leaderboard-empty">Loading...</div>';

  try {
    const data = await fetchLeaderboard(lobbyPeriod, 'rating', 10);
    renderLobbyLeaderboard(container, data.players);
    updateCurrentPlayerRow(data.players);
  } catch {
    container.innerHTML = '<div class="leaderboard-empty">Leaderboard unavailable</div>';
  }
}

function renderLobbyLeaderboard(container, players) {
  if (!players || players.length === 0) {
    container.innerHTML = '<div class="leaderboard-empty">No players yet</div>';
    return;
  }

  container.innerHTML = players.map(p => {
    let rankClass = '';
    if (p.rank === 1) rankClass = 'gold';
    else if (p.rank === 2) rankClass = 'silver';
    else if (p.rank === 3) rankClass = 'bronze';

    const isCurrent = currentPlayerName && p.username === currentPlayerName;

    return `
      <div class="lb-entry${isCurrent ? ' current-player' : ''}">
        <div class="lb-rank ${rankClass}">${p.rank}</div>
        <div class="lb-avatar">${p.avatar}</div>
        <div class="lb-name">${p.username}</div>
        <div class="lb-score">${p.rating}</div>
      </div>
    `;
  }).join('');
}

function updateCurrentPlayerRow(players) {
  const row = document.getElementById('lb-current-player');
  if (!row) return;

  if (!currentPlayerName) {
    row.style.display = 'none';
    return;
  }

  const existing = players.find(p => p.username === currentPlayerName);
  if (existing) {
    row.style.display = 'none';
    return;
  }

  row.style.display = '';
  const rankEl = document.getElementById('lb-cp-rank');
  const avatarEl = document.getElementById('lb-cp-avatar');
  const nameEl = document.getElementById('lb-cp-name');
  const scoreEl = document.getElementById('lb-cp-score');

  if (rankEl) rankEl.textContent = '—';
  if (avatarEl) avatarEl.textContent = currentPlayerName.charAt(0).toUpperCase();
  if (nameEl) nameEl.textContent = currentPlayerName;
  if (scoreEl) scoreEl.textContent = '0';
}

function setupLobbyLeaderboardTabs() {
  document.querySelectorAll('#main-menu .lb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#main-menu .lb-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadLeaderboardPreview(tab.dataset.period);
    });
  });
}

export { loadLeaderboardPreview, setupLobbyLeaderboardTabs, setCurrentPlayerName };
