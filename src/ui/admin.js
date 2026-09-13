/**
 * Admin Dashboard
 * 
 * Read-only monitoring dashboard for:
 * - Users, matches, transactions, settlements, disputes
 * - Suspicious matches, player statistics, revenue
 * - Match replay / event history viewer
 * 
 * SECURITY: No functionality to modify or move user funds.
 */

const API_BASE = '/api/admin';

// ============================================
// State
// ============================================

let adminToken = null;
let currentSection = 'overview';
let overviewData = null;
let usersData = null;
let matchesData = null;
let transactionsData = null;
let settlementsData = null;
let disputesData = null;
let suspiciousData = null;
let statsData = null;
let revenueData = null;
let withdrawData = null;

// ============================================
// API Client
// ============================================

async function adminFetch(endpoint, params = {}) {
  const url = new URL(`${API_BASE}${endpoint}`, window.location.origin);
  if (adminToken) url.searchParams.set('token', adminToken);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  });
  
  const res = await fetch(url.toString(), {
    headers: adminToken ? { 'X-Admin-Token': adminToken } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// ============================================
// Navigation
// ============================================

function initAdminNav() {
  document.querySelectorAll('.admin-nav-item[data-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      navigateTo(section);
    });
  });
}

function navigateTo(section) {
  currentSection = section;
  
  document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.remove('active'));
  const activeBtn = document.querySelector(`.admin-nav-item[data-section="${section}"]`);
  if (activeBtn) activeBtn.classList.add('active');
  
  document.querySelectorAll('.admin-section').forEach(el => el.classList.remove('active'));
  const activeSection = document.getElementById(`admin-section-${section}`);
  if (activeSection) activeSection.classList.add('active');
  
  loadSection(section);
}

async function loadSection(section) {
  switch (section) {
    case 'overview': return loadOverview();
    case 'users': return loadUsers();
    case 'matches': return loadMatches();
    case 'active-matches': return loadActiveMatches();
    case 'completed-matches': return loadCompletedMatches();
    case 'transactions': return loadTransactions();
    case 'settlements-pending': return loadSettlements('pending');
    case 'settlements-failed': return loadSettlements('failed');
    case 'disputes': return loadDisputes();
    case 'suspicious': return loadSuspicious();
    case 'player-stats': return loadPlayerStats();
    case 'revenue': return loadRevenue();
    case 'withdraw-requests': return loadWithdrawRequests();
  }
}

// ============================================
// Overview
// ============================================

async function loadOverview() {
  const container = document.getElementById('admin-overview');
  container.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div> Loading...</div>';
  
  try {
    overviewData = await adminFetch('/overview');
    renderOverview(container, overviewData);
  } catch (err) {
    container.innerHTML = `<div class="admin-empty"><p>Failed to load: ${err.message}</p></div>`;
  }
}

function renderOverview(container, data) {
  const s = data.stats;
  container.innerHTML = `
    <div class="admin-stats-grid">
      <div class="admin-stat-card">
        <div class="admin-stat-label">Total Users</div>
        <div class="admin-stat-value">${s.totalUsers}</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-label">Active Players</div>
        <div class="admin-stat-value accent">${s.activePlayers}</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-label">Matches Today</div>
        <div class="admin-stat-value">${s.matchesToday}</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-label">Active Matches</div>
        <div class="admin-stat-value success">${s.activeMatches}</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-label">Pending Settlements</div>
        <div class="admin-stat-value warning">${s.pendingSettlements}</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-label">Failed Settlements</div>
        <div class="admin-stat-value danger">${s.failedSettlements}</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-label">Open Disputes</div>
        <div class="admin-stat-value warning">${s.openDisputes}</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-label">Suspicious Matches</div>
        <div class="admin-stat-value danger">${s.suspiciousMatches}</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-label">Today Revenue</div>
        <div class="admin-stat-value success">${formatNim(s.todayRevenue)}</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-label">Total Revenue</div>
        <div class="admin-stat-value purple">${formatNim(s.totalRevenue)}</div>
      </div>
    </div>
    
    <div class="admin-table-container">
      <div class="admin-table-header">
        <h3>Recent Activity</h3>
      </div>
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Description</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            ${data.recentActivity.map(a => `
              <tr>
                <td><span class="admin-badge admin-badge-info">${a.type}</span></td>
                <td>${a.description}</td>
                <td>${renderStatusBadge(a.status)}</td>
                <td class="mono">${formatTime(a.timestamp)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ============================================
// Users
// ============================================

async function loadUsers(page = 1, search = '') {
  const container = document.getElementById('admin-users');
  container.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div> Loading...</div>';
  
  try {
    usersData = await adminFetch('/users', { page, limit: 20, search });
    renderUsers(container, usersData, search);
  } catch (err) {
    container.innerHTML = `<div class="admin-empty"><p>Failed to load: ${err.message}</p></div>`;
  }
}

function renderUsers(container, data, search = '') {
  container.innerHTML = `
    <div class="admin-filters">
      <div class="admin-filter-group">
        <label>Search:</label>
        <input type="text" class="admin-input" id="user-search" placeholder="Username or wallet..." value="${search}">
      </div>
    </div>
    
    <div class="admin-table-container">
      <div class="admin-table-header">
        <h3>Users (${data.total})</h3>
      </div>
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Wallet</th>
              <th>Rating</th>
              <th>W / L</th>
              <th>Win Rate</th>
              <th>Streak</th>
              <th>Status</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            ${data.users.map(u => `
              <tr>
                <td>
                  <div style="font-weight:600">${u.username}</div>
                  <div class="mono" style="font-size:11px;color:var(--admin-text-dim)">${u.id}</div>
                </td>
                <td class="mono truncate" title="${u.walletAddress}">${u.walletAddress.slice(0, 8)}...${u.walletAddress.slice(-6)}</td>
                <td class="mono">${u.rating}</td>
                <td class="mono">${u.wins} / ${u.losses}</td>
                <td class="mono">${u.gamesPlayed > 0 ? ((u.wins / u.gamesPlayed) * 100).toFixed(1) : 0}%</td>
                <td class="mono" style="color:${u.currentStreak > 0 ? 'var(--admin-success)' : u.currentStreak < 0 ? 'var(--admin-danger)' : 'var(--admin-text-dim)'}">
                  ${u.currentStreak > 0 ? '+' : ''}${u.currentStreak}
                </td>
                <td>${u.isBanned ? '<span class="admin-badge admin-badge-danger">Banned</span>' : '<span class="admin-badge admin-badge-success">Active</span>'}</td>
                <td class="mono">${formatDate(u.createdAt)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${renderPagination(data.page, data.totalPages, (p) => loadUsers(p, search))}
    </div>
  `;
  
  document.getElementById('user-search')?.addEventListener('input', debounce((e) => {
    loadUsers(1, e.target.value);
  }, 300));
}

// ============================================
// Matches
// ============================================

async function loadMatches(page = 1, status = '', mode = '') {
  const container = document.getElementById('admin-matches');
  container.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div> Loading...</div>';
  
  try {
    matchesData = await adminFetch('/matches', { page, limit: 20, status, mode });
    renderMatches(container, matchesData, status, mode);
  } catch (err) {
    container.innerHTML = `<div class="admin-empty"><p>Failed to load: ${err.message}</p></div>`;
  }
}

function renderMatches(container, data, status = '', mode = '') {
  container.innerHTML = `
    <div class="admin-filters">
      <div class="admin-filter-group">
        <label>Status:</label>
        <select class="admin-select" id="match-status-filter">
          <option value="">All</option>
          <option value="in_progress" ${status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="finished" ${status === 'finished' ? 'selected' : ''}>Finished</option>
          <option value="cancelled" ${status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
        </select>
      </div>
      <div class="admin-filter-group">
        <label>Mode:</label>
        <select class="admin-select" id="match-mode-filter">
          <option value="">All</option>
          <option value="free" ${mode === 'free' ? 'selected' : ''}>Free</option>
          <option value="competitive" ${mode === 'competitive' ? 'selected' : ''}>Competitive</option>
          <option value="ranked" ${mode === 'ranked' ? 'selected' : ''}>Ranked</option>
          <option value="tournament" ${mode === 'tournament' ? 'selected' : ''}>Tournament</option>
        </select>
      </div>
    </div>
    
    <div class="admin-table-container">
      <div class="admin-table-header">
        <h3>Matches (${data.total})</h3>
      </div>
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Mode</th>
              <th>Tier</th>
              <th>Player 1</th>
              <th>Player 2</th>
              <th>Winner</th>
              <th>Entry</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Replay</th>
            </tr>
          </thead>
          <tbody>
            ${data.matches.map(m => `
              <tr>
                <td class="mono clickable" onclick="viewMatchReplay('${m.id}')">${m.id.slice(0, 16)}</td>
                <td><span class="admin-badge admin-badge-${m.mode === 'free' ? 'neutral' : 'info'}">${m.mode}</span></td>
                <td class="mono">${m.tierId}</td>
                <td>${m.player1Name}</td>
                <td>${m.player2Name}</td>
                <td>${m.winnerId ? m.winnerId.slice(0, 12) : '-'}</td>
                <td class="mono">${formatNim(m.entryFee)}</td>
                <td>${renderStatusBadge(m.status)}</td>
                <td class="mono">${m.duration ? formatDuration(m.duration) : '-'}</td>
                <td><button class="admin-btn admin-btn-ghost admin-btn-sm" onclick="viewMatchReplay('${m.id}')">View</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${renderPagination(data.page, data.totalPages, (p) => loadMatches(p, status, mode))}
    </div>
  `;
  
  document.getElementById('match-status-filter')?.addEventListener('change', (e) => {
    loadMatches(1, e.target.value, mode);
  });
  document.getElementById('match-mode-filter')?.addEventListener('change', (e) => {
    loadMatches(1, status, e.target.value);
  });
}

// ============================================
// Active Matches
// ============================================

async function loadActiveMatches() {
  const container = document.getElementById('admin-active-matches');
  container.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div> Loading...</div>';
  
  try {
    const data = await adminFetch('/matches/active');
    renderActiveMatches(container, data);
  } catch (err) {
    container.innerHTML = `<div class="admin-empty"><p>Failed to load: ${err.message}</p></div>`;
  }
}

function renderActiveMatches(container, data) {
  if (data.matches.length === 0) {
    container.innerHTML = '<div class="admin-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg><p>No active matches</p></div>';
    return;
  }
  
  container.innerHTML = `
    <div class="admin-table-container">
      <div class="admin-table-header">
        <h3>Active Matches (${data.total})</h3>
        <button class="admin-btn admin-btn-ghost admin-btn-sm" onclick="loadActiveMatches()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Refresh
        </button>
      </div>
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Player 1</th>
              <th>Player 2</th>
              <th>Mode</th>
              <th>Tier</th>
              <th>Entry</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Replay</th>
            </tr>
          </thead>
          <tbody>
            ${data.matches.map(m => `
              <tr>
                <td class="mono clickable" onclick="viewMatchReplay('${m.id}')">${m.id.slice(0, 16)}</td>
                <td>${m.player1Name}</td>
                <td>${m.player2Name}</td>
                <td><span class="admin-badge admin-badge-info">${m.mode}</span></td>
                <td class="mono">${m.tierId}</td>
                <td class="mono">${formatNim(m.entryFee)}</td>
                <td class="mono">${formatTime(m.startedAt)}</td>
                <td class="mono">${m.startedAt ? formatDuration(Date.now() - new Date(m.startedAt).getTime()) : '-'}</td>
                <td><button class="admin-btn admin-btn-ghost admin-btn-sm" onclick="viewMatchReplay('${m.id}')">View</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ============================================
// Completed Matches
// ============================================

async function loadCompletedMatches(page = 1) {
  const container = document.getElementById('admin-completed-matches');
  container.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div> Loading...</div>';
  
  try {
    const data = await adminFetch('/matches/completed', { page, limit: 20 });
    renderCompletedMatches(container, data);
  } catch (err) {
    container.innerHTML = `<div class="admin-empty"><p>Failed to load: ${err.message}</p></div>`;
  }
}

function renderCompletedMatches(container, data) {
  container.innerHTML = `
    <div class="admin-table-container">
      <div class="admin-table-header">
        <h3>Completed Matches (${data.total})</h3>
      </div>
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Player 1</th>
              <th>Player 2</th>
              <th>Winner</th>
              <th>How</th>
              <th>Shots</th>
              <th>Prize</th>
              <th>Duration</th>
              <th>Replay</th>
            </tr>
          </thead>
          <tbody>
            ${data.matches.map(m => `
              <tr>
                <td class="mono clickable" onclick="viewMatchReplay('${m.id}')">${m.id.slice(0, 16)}</td>
                <td>${m.player1Name}</td>
                <td>${m.player2Name}</td>
                <td style="color:var(--admin-success)">${m.winnerId === m.player1Id ? m.player1Name : m.player2Name}</td>
                <td><span class="admin-badge admin-badge-purple">${m.winnerBy}</span></td>
                <td class="mono">${m.totalShots}</td>
                <td class="mono">${formatNim(m.prizeAmount)}</td>
                <td class="mono">${formatDuration(m.duration)}</td>
                <td><button class="admin-btn admin-btn-ghost admin-btn-sm" onclick="viewMatchReplay('${m.id}')">View</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${renderPagination(data.page, data.totalPages, (p) => loadCompletedMatches(p))}
    </div>
  `;
}

// ============================================
// Transactions
// ============================================

async function loadTransactions(page = 1, type = '', status = '') {
  const container = document.getElementById('admin-transactions');
  container.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div> Loading...</div>';
  
  try {
    transactionsData = await adminFetch('/transactions', { page, limit: 20, type, status });
    renderTransactions(container, transactionsData, type, status);
  } catch (err) {
    container.innerHTML = `<div class="admin-empty"><p>Failed to load: ${err.message}</p></div>`;
  }
}

function renderTransactions(container, data, type = '', status = '') {
  container.innerHTML = `
    <div class="admin-filters">
      <div class="admin-filter-group">
        <label>Type:</label>
        <select class="admin-select" id="tx-type-filter">
          <option value="">All</option>
          <option value="deposit" ${type === 'deposit' ? 'selected' : ''}>Deposit</option>
          <option value="withdrawal" ${type === 'withdrawal' ? 'selected' : ''}>Withdrawal</option>
          <option value="entry_fee" ${type === 'entry_fee' ? 'selected' : ''}>Entry Fee</option>
          <option value="prize_payout" ${type === 'prize_payout' ? 'selected' : ''}>Prize Payout</option>
          <option value="platform_fee" ${type === 'platform_fee' ? 'selected' : ''}>Platform Fee</option>
          <option value="refund" ${type === 'refund' ? 'selected' : ''}>Refund</option>
        </select>
      </div>
      <div class="admin-filter-group">
        <label>Status:</label>
        <select class="admin-select" id="tx-status-filter">
          <option value="">All</option>
          <option value="confirmed" ${status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
          <option value="pending" ${status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="failed" ${status === 'failed' ? 'selected' : ''}>Failed</option>
        </select>
      </div>
    </div>
    
    <div class="admin-table-container">
      <div class="admin-table-header">
        <h3>Transactions (${data.total})</h3>
      </div>
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>User</th>
              <th>Amount</th>
              <th>Status</th>
              <th>TX Hash</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${data.transactions.map(t => `
              <tr>
                <td class="mono">${t.id.slice(0, 16)}</td>
                <td>${renderTxTypeBadge(t.type)}</td>
                <td class="mono">${t.userId.slice(0, 12)}</td>
                <td class="mono" style="color:${t.type === 'prize_payout' ? 'var(--admin-success)' : t.type === 'entry_fee' ? 'var(--admin-warning)' : 'var(--admin-text)'}">
                  ${t.type === 'prize_payout' ? '+' : t.type === 'entry_fee' ? '-' : ''}${formatNim(t.amount)}
                </td>
                <td>${renderStatusBadge(t.status)}</td>
                <td class="mono truncate" title="${t.blockchainTxHash || ''}">${t.blockchainTxHash ? t.blockchainTxHash.slice(0, 12) + '...' : '-'}</td>
                <td class="mono">${formatDate(t.createdAt)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${renderPagination(data.page, data.totalPages, (p) => loadTransactions(p, type, status))}
    </div>
  `;
  
  document.getElementById('tx-type-filter')?.addEventListener('change', (e) => {
    loadTransactions(1, e.target.value, status);
  });
  document.getElementById('tx-status-filter')?.addEventListener('change', (e) => {
    loadTransactions(1, type, e.target.value);
  });
}

// ============================================
// Settlements
// ============================================

async function loadSettlements(status = 'pending', page = 1) {
  const containerId = status === 'pending' ? 'admin-settlements-pending' : 'admin-settlements-failed';
  const container = document.getElementById(containerId);
  container.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div> Loading...</div>';
  
  try {
    const endpoint = status === 'pending' ? '/settlements/pending' : '/settlements/failed';
    const data = await adminFetch(endpoint);
    renderSettlements(container, data, status);
  } catch (err) {
    container.innerHTML = `<div class="admin-empty"><p>Failed to load: ${err.message}</p></div>`;
  }
}

function renderSettlements(container, data, status) {
  container.innerHTML = `
    <div class="admin-table-container">
      <div class="admin-table-header">
        <h3>${status === 'pending' ? 'Pending' : 'Failed'} Settlements (${data.total})</h3>
      </div>
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Match</th>
              <th>Winner</th>
              <th>Loser</th>
              <th>Tier</th>
              <th>Prize</th>
              <th>Platform Fee</th>
              <th>Status</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            ${data.settlements.length === 0 ? `
              <tr><td colspan="9" style="text-align:center;color:var(--admin-text-dim);padding:24px">No ${status} settlements</td></tr>
            ` : data.settlements.map(s => `
              <tr>
                <td class="mono">${s.id.slice(0, 16)}</td>
                <td class="mono clickable" onclick="viewMatchReplay('${s.matchId}')">${s.matchId.slice(0, 12)}</td>
                <td class="mono">${s.winnerId.slice(0, 12)}</td>
                <td class="mono">${s.loserId.slice(0, 12)}</td>
                <td class="mono">${s.tierId}</td>
                <td class="mono" style="color:var(--admin-success)">${formatNim(s.winnerPrize)}</td>
                <td class="mono" style="color:var(--admin-accent)">${formatNim(s.platformFee)}</td>
                <td>${renderStatusBadge(s.status)}</td>
                <td style="color:var(--admin-danger);font-size:12px">${s.error || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ============================================
// Disputes
// ============================================

async function loadDisputes(status = '') {
  const container = document.getElementById('admin-disputes');
  container.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div> Loading...</div>';
  
  try {
    disputesData = await adminFetch('/disputes', { status });
    renderDisputes(container, disputesData, status);
  } catch (err) {
    container.innerHTML = `<div class="admin-empty"><p>Failed to load: ${err.message}</p></div>`;
  }
}

function renderDisputes(container, data, status = '') {
  container.innerHTML = `
    <div class="admin-filters">
      <div class="admin-filter-group">
        <label>Status:</label>
        <select class="admin-select" id="dispute-status-filter">
          <option value="">All</option>
          <option value="open" ${status === 'open' ? 'selected' : ''}>Open</option>
          <option value="investigating" ${status === 'investigating' ? 'selected' : ''}>Investigating</option>
          <option value="resolved" ${status === 'resolved' ? 'selected' : ''}>Resolved</option>
          <option value="rejected" ${status === 'rejected' ? 'selected' : ''}>Rejected</option>
        </select>
      </div>
    </div>
    
    <div class="admin-table-container">
      <div class="admin-table-header">
        <h3>Disputes (${data.total})</h3>
      </div>
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Match</th>
              <th>Reporter</th>
              <th>Reason</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${data.disputes.map(d => `
              <tr>
                <td class="mono">${d.id.slice(0, 16)}</td>
                <td class="mono clickable" onclick="viewMatchReplay('${d.matchId}')">${d.matchId.slice(0, 12)}</td>
                <td class="mono">${d.reporterId.slice(0, 12)}</td>
                <td style="max-width:200px">${d.reason}</td>
                <td>${renderSeverityBadge(d.severity)}</td>
                <td>${renderDisputeStatusBadge(d.status)}</td>
                <td class="mono">${formatDate(d.createdAt)}</td>
                <td><button class="admin-btn admin-btn-ghost admin-btn-sm" onclick="viewDisputeDetail('${d.id}')">View</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  
  document.getElementById('dispute-status-filter')?.addEventListener('change', (e) => {
    loadDisputes(e.target.value);
  });
}

// ============================================
// Suspicious Matches
// ============================================

async function loadSuspicious() {
  const container = document.getElementById('admin-suspicious');
  container.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div> Loading...</div>';
  
  try {
    suspiciousData = await adminFetch('/suspicious');
    renderSuspicious(container, suspiciousData);
  } catch (err) {
    container.innerHTML = `<div class="admin-empty"><p>Failed to load: ${err.message}</p></div>`;
  }
}

function renderSuspicious(container, data) {
  container.innerHTML = `
    <div class="admin-table-container">
      <div class="admin-table-header">
        <h3>Suspicious Matches (${data.total})</h3>
      </div>
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Match</th>
              <th>Player 1</th>
              <th>Player 2</th>
              <th>Reason</th>
              <th>Severity</th>
              <th>Confidence</th>
              <th>Detected</th>
              <th>Replay</th>
            </tr>
          </thead>
          <tbody>
            ${data.matches.map(s => `
              <tr>
                <td class="mono clickable" onclick="viewMatchReplay('${s.matchId}')">${s.matchId.slice(0, 16)}</td>
                <td class="mono">${s.player1Id.slice(0, 12)}</td>
                <td class="mono">${s.player2Id.slice(0, 12)}</td>
                <td style="max-width:240px">${s.reason}</td>
                <td>${renderSeverityBadge(s.severity)}</td>
                <td class="mono">${(parseFloat(s.details.confidence) * 100).toFixed(0)}%</td>
                <td class="mono">${formatTime(s.detectedAt)}</td>
                <td><button class="admin-btn admin-btn-ghost admin-btn-sm" onclick="viewMatchReplay('${s.matchId}')">View</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ============================================
// Player Statistics
// ============================================

async function loadPlayerStats(sort = 'wins') {
  const container = document.getElementById('admin-player-stats');
  container.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div> Loading...</div>';
  
  try {
    statsData = await adminFetch('/stats/players', { sort, limit: 50 });
    renderPlayerStats(container, statsData, sort);
  } catch (err) {
    container.innerHTML = `<div class="admin-empty"><p>Failed to load: ${err.message}</p></div>`;
  }
}

function renderPlayerStats(container, data, sort) {
  container.innerHTML = `
    <div class="admin-filters">
      <div class="admin-filter-group">
        <label>Sort by:</label>
        <select class="admin-select" id="stats-sort">
          <option value="wins" ${sort === 'wins' ? 'selected' : ''}>Wins</option>
          <option value="winRate" ${sort === 'winRate' ? 'selected' : ''}>Win Rate</option>
          <option value="rating" ${sort === 'rating' ? 'selected' : ''}>Rating</option>
          <option value="winnings" ${sort === 'winnings' ? 'selected' : ''}>Winnings</option>
        </select>
      </div>
    </div>
    
    <div class="admin-table-container">
      <div class="admin-table-header">
        <h3>Player Statistics (Top 50)</h3>
      </div>
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Wallet</th>
              <th>Rating</th>
              <th>Games</th>
              <th>Wins</th>
              <th>Losses</th>
              <th>Win Rate</th>
              <th>Winnings</th>
              <th>Streak</th>
            </tr>
          </thead>
          <tbody>
            ${data.stats.map((s, i) => `
              <tr>
                <td class="mono" style="color:var(--admin-text-dim)">${i + 1}</td>
                <td style="font-weight:600">${s.username}</td>
                <td class="mono truncate" title="${s.walletAddress}">${s.walletAddress.slice(0, 8)}...</td>
                <td class="mono">${s.rating}</td>
                <td class="mono">${s.gamesPlayed}</td>
                <td class="mono" style="color:var(--admin-success)">${s.wins}</td>
                <td class="mono" style="color:var(--admin-danger)">${s.losses}</td>
                <td class="mono">${s.winRate}%</td>
                <td class="mono" style="color:var(--admin-success)">${formatNim(s.totalWinnings)}</td>
                <td class="mono" style="color:${s.currentStreak > 0 ? 'var(--admin-success)' : s.currentStreak < 0 ? 'var(--admin-danger)' : 'var(--admin-text-dim)'}">
                  ${s.currentStreak > 0 ? '+' : ''}${s.currentStreak}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  
  document.getElementById('stats-sort')?.addEventListener('change', (e) => {
    loadPlayerStats(e.target.value);
  });
}

// ============================================
// Revenue
// ============================================

async function loadRevenue() {
  const container = document.getElementById('admin-revenue');
  container.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div> Loading...</div>';
  
  try {
    revenueData = await adminFetch('/stats/revenue');
    renderRevenue(container, revenueData);
  } catch (err) {
    container.innerHTML = `<div class="admin-empty"><p>Failed to load: ${err.message}</p></div>`;
  }
}

function renderRevenue(container, data) {
  const maxDaily = Math.max(...data.daily.map(d => d.revenue), 1);
  
  container.innerHTML = `
    <div class="admin-stats-grid">
      <div class="admin-stat-card">
        <div class="admin-stat-label">Today</div>
        <div class="admin-stat-value success">${formatNim(data.summary.today)}</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-label">This Week</div>
        <div class="admin-stat-value accent">${formatNim(data.summary.thisWeek)}</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-label">This Month</div>
        <div class="admin-stat-value purple">${formatNim(data.summary.thisMonth)}</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-label">All Time</div>
        <div class="admin-stat-value warning">${formatNim(data.summary.total)}</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-label">Total Settlements</div>
        <div class="admin-stat-value">${data.totalSettlements}</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-label">Avg Platform Fee</div>
        <div class="admin-stat-value">${formatNim(data.avgPlatformFee)}</div>
      </div>
    </div>
    
    <div class="admin-card" style="margin-bottom:16px">
      <div class="admin-card-header">
        <h3>Revenue (Last 7 Days)</h3>
      </div>
      <div class="admin-card-body">
        <div class="admin-chart">
          ${data.daily.map(d => `
            <div class="admin-chart-bar">
              <div class="admin-chart-bar-value">${formatNim(d.revenue)}</div>
              <div class="admin-chart-bar-fill" style="height:${Math.max((d.revenue / maxDaily) * 80, 2)}px"></div>
              <div class="admin-chart-bar-label">${d.date.split('-').slice(1).join('/')}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    
    <div class="admin-card">
      <div class="admin-card-header">
        <h3>Revenue by Tier</h3>
      </div>
      <div class="admin-card-body">
        <div class="admin-detail-grid">
          ${Object.entries(data.byTier).map(([tier, revenue]) => `
            <div class="admin-detail-item">
              <div class="admin-detail-label">${tier}</div>
              <div class="admin-detail-value" style="color:var(--admin-success)">${formatNim(revenue)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// ============================================
// Withdraw Requests
// ============================================

async function loadWithdrawRequests() {
  const container = document.getElementById('admin-withdraw-requests');
  if (!container) return;
  container.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div> Loading...</div>';

  try {
    withdrawData = await adminFetch('/withdraw-requests');
    renderWithdrawRequests(container, withdrawData);
  } catch (err) {
    container.innerHTML = `<div class="admin-empty"><p>Failed to load: ${err.message}</p></div>`;
  }
}

function renderWithdrawRequests(container, data) {
  if (!data.requests || data.requests.length === 0) {
    container.innerHTML = '<div class="admin-empty"><p>No withdraw requests</p></div>';
    return;
  }
  container.innerHTML = `
    <div class="admin-table-container">
      <div class="admin-table-header">
        <h3>Withdraw Requests (${data.total})</h3>
      </div>
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Wallet</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${data.requests.map(w => `
              <tr>
                <td class="mono" style="font-size:11px">${w.id}</td>
                <td class="mono truncate" title="${w.wallet}">${w.wallet.slice(0, 12)}...${w.wallet.slice(-6)}</td>
                <td class="mono" style="color:var(--admin-warning)">${formatNim(w.amount)}</td>
                <td>${renderStatusBadge(w.status)}</td>
                <td class="mono">${formatTime(w.createdAt)}</td>
                <td>
                  ${w.status === 'pending' ? `
                    <button class="admin-btn admin-btn-sm admin-btn-success" onclick="window._adminApproveWithdraw('${w.id}')">Approve</button>
                    <button class="admin-btn admin-btn-sm admin-btn-danger" onclick="window._adminRejectWithdraw('${w.id}')">Reject</button>
                  ` : '—'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

window._adminApproveWithdraw = async (id) => {
  try {
    await adminFetch(`/withdraw/${id}/approve`);
    loadWithdrawRequests();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
};

window._adminRejectWithdraw = async (id) => {
  try {
    await adminFetch(`/withdraw/${id}/reject`);
    loadWithdrawRequests();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
};

// ============================================
// Match Replay Viewer
// ============================================

async function viewMatchReplay(matchId) {
  const overlay = document.getElementById('admin-modal-overlay');
  const modalBody = document.getElementById('admin-modal-body');
  const modalTitle = document.getElementById('admin-modal-title');
  
  modalTitle.textContent = `Match Replay: ${matchId.slice(0, 16)}`;
  modalBody.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div> Loading replay...</div>';
  overlay.classList.add('active');
  
  try {
    const data = await adminFetch(`/matches/${matchId}/replay`);
    renderReplayViewer(modalBody, data);
  } catch (err) {
    modalBody.innerHTML = `<div class="admin-empty"><p>Failed to load replay: ${err.message}</p></div>`;
  }
}

function renderReplayViewer(container, data) {
  const { match, events } = data;
  
  container.innerHTML = `
    <div class="admin-detail-grid" style="margin-bottom:16px">
      <div class="admin-detail-item">
        <div class="admin-detail-label">Mode</div>
        <div class="admin-detail-value">${match.mode}</div>
      </div>
      <div class="admin-detail-item">
        <div class="admin-detail-label">Tier</div>
        <div class="admin-detail-value">${match.tierId}</div>
      </div>
      <div class="admin-detail-item">
        <div class="admin-detail-label">Player 1</div>
        <div class="admin-detail-value">${match.player1Name}</div>
      </div>
      <div class="admin-detail-item">
        <div class="admin-detail-label">Player 2</div>
        <div class="admin-detail-value">${match.player2Name}</div>
      </div>
      <div class="admin-detail-item">
        <div class="admin-detail-label">Winner</div>
        <div class="admin-detail-value" style="color:var(--admin-success)">${match.winnerId ? (match.winnerId === match.player1Id ? match.player1Name : match.player2Name) : '-'}</div>
      </div>
      <div class="admin-detail-item">
        <div class="admin-detail-label">How</div>
        <div class="admin-detail-value">${match.winnerBy || '-'}</div>
      </div>
      <div class="admin-detail-item">
        <div class="admin-detail-label">Shots</div>
        <div class="admin-detail-value">${match.totalShots}</div>
      </div>
      <div class="admin-detail-item">
        <div class="admin-detail-label">Duration</div>
        <div class="admin-detail-value">${match.duration ? formatDuration(match.duration) : '-'}</div>
      </div>
    </div>
    
    <div class="admin-replay-container">
      <div class="admin-replay-canvas">
        <div class="admin-empty" style="padding:24px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="48" height="48">
            <circle cx="12" cy="12" r="10"/>
            <polygon points="10 8 16 12 10 16 10 8"/>
          </svg>
          <p style="margin-top:12px">Match state visualization</p>
          <p style="font-size:11px;color:var(--admin-text-dim)">Canvas rendering of ball positions at each event</p>
        </div>
        <div class="admin-replay-controls">
          <button class="admin-btn admin-btn-ghost admin-btn-icon" id="replay-prev" title="Previous event">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button class="admin-btn admin-btn-primary admin-btn-icon" id="replay-play" title="Play/Pause">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
          <button class="admin-btn admin-btn-ghost admin-btn-icon" id="replay-next" title="Next event">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div class="admin-replay-timeline" id="replay-timeline">
            <div class="admin-replay-timeline-fill" id="replay-timeline-fill" style="width:0%"></div>
          </div>
          <span style="font-size:11px;color:var(--admin-text-dim);font-family:'JetBrains Mono',monospace" id="replay-counter">0 / ${events.length}</span>
        </div>
      </div>
      
      <div class="admin-replay-event-list">
        <div class="admin-replay-event-list-header">Event History (${events.length})</div>
        <div class="admin-replay-events" id="replay-event-list">
          ${events.map((evt, i) => `
            <div class="admin-replay-event" data-index="${i}" onclick="replayJumpTo(${i})">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span class="event-type">${renderEventType(evt.type)}</span>
                <span class="event-time">${formatTime(evt.timestamp)}</span>
              </div>
              ${evt.player ? `<div class="event-player">${evt.player === match.player1Id ? match.player1Name : match.player2Name}</div>` : ''}
              <div style="font-size:11px;color:var(--admin-text-dim);margin-top:2px;font-family:'JetBrains Mono',monospace">${evt.hash.slice(0, 16)}...</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  
  // Replay state
  let currentEventIndex = 0;
  let isPlaying = false;
  let playInterval = null;
  
  window.replayJumpTo = (index) => {
    currentEventIndex = index;
    updateReplayUI();
  };
  
  document.getElementById('replay-prev')?.addEventListener('click', () => {
    if (currentEventIndex > 0) {
      currentEventIndex--;
      updateReplayUI();
    }
  });
  
  document.getElementById('replay-next')?.addEventListener('click', () => {
    if (currentEventIndex < events.length - 1) {
      currentEventIndex++;
      updateReplayUI();
    }
  });
  
  document.getElementById('replay-play')?.addEventListener('click', () => {
    isPlaying = !isPlaying;
    const btn = document.getElementById('replay-play');
    
    if (isPlaying) {
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
      playInterval = setInterval(() => {
        if (currentEventIndex < events.length - 1) {
          currentEventIndex++;
          updateReplayUI();
        } else {
          isPlaying = false;
          btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
          clearInterval(playInterval);
        }
      }, 800);
    } else {
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
      clearInterval(playInterval);
    }
  });
  
  document.getElementById('replay-timeline')?.addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    currentEventIndex = Math.floor(pct * (events.length - 1));
    updateReplayUI();
  });
  
  function updateReplayUI() {
    const pct = events.length > 1 ? (currentEventIndex / (events.length - 1)) * 100 : 0;
    document.getElementById('replay-timeline-fill').style.width = `${pct}%`;
    document.getElementById('replay-counter').textContent = `${currentEventIndex + 1} / ${events.length}`;
    
    document.querySelectorAll('.admin-replay-event').forEach((el, i) => {
      el.classList.toggle('active', i === currentEventIndex);
    });
    
    const activeEvent = document.querySelector(`.admin-replay-event[data-index="${currentEventIndex}"]`);
    if (activeEvent) {
      activeEvent.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  
  updateReplayUI();
}

function renderEventType(type) {
  const map = {
    match_created: 'Match Created',
    player_joined: 'Player Joined',
    game_start: 'Game Start',
    shot_taken: 'Shot',
    ball_pocketed: 'Ball Pocketed',
    foul_committed: 'Foul',
    turn_changed: 'Turn Change',
    game_over: 'Game Over',
    disconnection: 'Disconnect',
    reconnection: 'Reconnect',
  };
  return map[type] || type;
}

// ============================================
// Dispute Detail
// ============================================

async function viewDisputeDetail(disputeId) {
  const overlay = document.getElementById('admin-modal-overlay');
  const modalBody = document.getElementById('admin-modal-body');
  const modalTitle = document.getElementById('admin-modal-title');
  
  modalTitle.textContent = `Dispute: ${disputeId}`;
  modalBody.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div> Loading...</div>';
  overlay.classList.add('active');
  
  try {
    const data = await adminFetch(`/disputes/${disputeId}`);
    renderDisputeDetailModal(modalBody, data);
  } catch (err) {
    modalBody.innerHTML = `<div class="admin-empty"><p>Failed to load: ${err.message}</p></div>`;
  }
}

function renderDisputeDetailModal(container, data) {
  const { dispute, match } = data;
  
  container.innerHTML = `
    <div class="admin-detail-grid" style="margin-bottom:16px">
      <div class="admin-detail-item">
        <div class="admin-detail-label">Status</div>
        <div class="admin-detail-value">${renderDisputeStatusBadge(dispute.status)}</div>
      </div>
      <div class="admin-detail-item">
        <div class="admin-detail-label">Severity</div>
        <div class="admin-detail-value">${renderSeverityBadge(dispute.severity)}</div>
      </div>
      <div class="admin-detail-item" style="grid-column:1/-1">
        <div class="admin-detail-label">Reason</div>
        <div class="admin-detail-value" style="font-family:inherit;font-size:13px">${dispute.reason}</div>
      </div>
      ${dispute.notes ? `
        <div class="admin-detail-item" style="grid-column:1/-1">
          <div class="admin-detail-label">Notes</div>
          <div class="admin-detail-value" style="font-family:inherit;font-size:13px">${dispute.notes}</div>
        </div>
      ` : ''}
    </div>
    
    ${match ? `
      <h4 style="margin:0 0 12px;font-size:13px;color:var(--admin-text-dim)">Related Match</h4>
      <div class="admin-detail-grid" style="margin-bottom:16px">
        <div class="admin-detail-item">
          <div class="admin-detail-label">Match ID</div>
          <div class="admin-detail-value">${match.id}</div>
        </div>
        <div class="admin-detail-item">
          <div class="admin-detail-label">Mode</div>
          <div class="admin-detail-value">${match.mode}</div>
        </div>
        <div class="admin-detail-item">
          <div class="admin-detail-label">Player 1</div>
          <div class="admin-detail-value">${match.player1Name}</div>
        </div>
        <div class="admin-detail-item">
          <div class="admin-detail-label">Player 2</div>
          <div class="admin-detail-value">${match.player2Name}</div>
        </div>
        <div class="admin-detail-item">
          <div class="admin-detail-label">Status</div>
          <div class="admin-detail-value">${renderStatusBadge(match.status)}</div>
        </div>
        <div class="admin-detail-item">
          <div class="admin-detail-label">Winner</div>
          <div class="admin-detail-value">${match.winnerId ? (match.winnerId === match.player1Id ? match.player1Name : match.player2Name) : '-'}</div>
        </div>
      </div>
      <button class="admin-btn admin-btn-ghost" onclick="viewMatchReplay('${match.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        View Match Replay
      </button>
    ` : '<p style="color:var(--admin-text-dim)">Match data unavailable</p>'}
    
    <div style="margin-top:16px;padding:12px;background:var(--admin-surface-2);border-radius:var(--admin-radius);font-size:12px;color:var(--admin-text-dim)">
      <strong>Note:</strong> This dashboard is read-only. Refunds and dispute resolution must be handled through the proper settlement flow with blockchain transactions. No funds can be directly modified.
    </div>
  `;
}

// ============================================
// Helpers
// ============================================

function formatNim(lamports) {
  if (lamports === 0) return '0 NIM';
  const nim = lamports / 100000;
  if (nim >= 1000000) return `${(nim / 1000000).toFixed(2)}M NIM`;
  if (nim >= 1000) return `${(nim / 1000).toFixed(1)}K NIM`;
  return `${nim.toFixed(2)} NIM`;
}

function formatTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms) {
  if (!ms) return '-';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min >= 60) {
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    return `${hr}h ${remMin}m`;
  }
  return `${min}m ${remSec}s`;
}

function renderStatusBadge(status) {
  const map = {
    finished: 'success',
    completed: 'success',
    confirmed: 'success',
    resolved: 'success',
    in_progress: 'info',
    processing: 'info',
    investigating: 'info',
    created: 'neutral',
    pending: 'warning',
    open: 'warning',
    cancelled: 'neutral',
    failed: 'danger',
    disputed: 'danger',
    rejected: 'danger',
  };
  return `<span class="admin-badge admin-badge-${map[status] || 'neutral'}">${status}</span>`;
}

function renderTxTypeBadge(type) {
  const map = {
    deposit: 'info',
    withdrawal: 'warning',
    entry_fee: 'danger',
    prize_payout: 'success',
    platform_fee: 'purple',
    refund: 'info',
  };
  return `<span class="admin-badge admin-badge-${map[type] || 'neutral'}">${type.replace('_', ' ')}</span>`;
}

function renderSeverityBadge(severity) {
  const map = {
    low: 'neutral',
    medium: 'warning',
    high: 'danger',
    critical: 'danger',
  };
  return `<span class="admin-badge admin-badge-${map[severity] || 'neutral'}">${severity}</span>`;
}

function renderDisputeStatusBadge(status) {
  const map = {
    open: 'warning',
    investigating: 'info',
    resolved: 'success',
    rejected: 'danger',
  };
  return `<span class="admin-badge admin-badge-${map[status] || 'neutral'}">${status}</span>`;
}

function renderPagination(page, totalPages, onChange) {
  if (totalPages <= 1) return '';
  
  return `
    <div class="admin-pagination">
      <div class="admin-pagination-info">Page ${page} of ${totalPages}</div>
      <div class="admin-pagination-buttons">
        <button class="admin-btn admin-btn-ghost admin-btn-sm" ${page <= 1 ? 'disabled' : ''} onclick="window._adminPageChange(${page - 1})">Prev</button>
        <button class="admin-btn admin-btn-ghost admin-btn-sm" ${page >= totalPages ? 'disabled' : ''} onclick="window._adminPageChange(${page + 1})">Next</button>
      </div>
    </div>
  `;
}

window._adminPageChange = (page) => {
  if (currentSection === 'users') loadUsers(page);
  else if (currentSection === 'matches') loadMatches(page);
  else if (currentSection === 'completed-matches') loadCompletedMatches(page);
  else if (currentSection === 'transactions') loadTransactions(page);
};

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ============================================
// Modal
// ============================================

function initAdminModal() {
  document.getElementById('admin-modal-close')?.addEventListener('click', () => {
    document.getElementById('admin-modal-overlay').classList.remove('active');
  });
  
  document.getElementById('admin-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      e.currentTarget.classList.remove('active');
    }
  });
}

// ============================================
// Init
// ============================================

export function initAdmin() {
  initAdminNav();
  initAdminModal();
  initAdminLogin();
}

export function showAdmin() {
  document.getElementById('app').style.display = 'none';
  document.querySelector('.admin-root').classList.add('active');
  const loginScreen = document.getElementById('admin-login');
  if (adminToken) {
    loginScreen?.classList.add('hidden');
    loadSection(currentSection);
  } else {
    loginScreen?.classList.remove('hidden');
  }
}

export function hideAdmin() {
  document.querySelector('.admin-root').classList.remove('active');
  document.getElementById('app').style.display = '';
}

function initAdminLogin() {
  const loginBtn = document.getElementById('admin-login-btn');
  const emailInput = document.getElementById('admin-email');
  const passInput = document.getElementById('admin-password');
  const errorEl = document.getElementById('admin-login-error');

  loginBtn?.addEventListener('click', async () => {
    const email = emailInput?.value?.trim();
    const pass = passInput?.value;
    if (!email || !pass) {
      errorEl.textContent = 'Enter email and password';
      errorEl.style.display = 'block';
      return;
    }
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Login failed');
      }
      const data = await res.json();
      adminToken = data.token;
      document.getElementById('admin-login')?.classList.add('hidden');
      loadSection(currentSection);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    }
  });

  passInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginBtn?.click();
  });
}
