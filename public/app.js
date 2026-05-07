const socket = io();

// UI Elements
const totalPnLElement = document.getElementById('total-pnl');
const winRateElement = document.getElementById('win-rate');
const totalTradesElement = document.getElementById('total-trades');
const activeCountElement = document.getElementById('active-count');
const positionsBody = document.getElementById('positions-body');
const terminal = document.getElementById('terminal');
const logCountElement = document.getElementById('log-count');
const signerBalanceElement = document.getElementById('signer-balance');
const vaultBalanceElement = document.getElementById('vault-balance');

let logCount = 0;

// Socket Event Listeners
socket.on('connect', () => {
    addLog('system', 'WebSocket connection established');
});

socket.on('disconnect', () => {
    addLog('error', 'WebSocket disconnected');
});

socket.on('log', (data) => {
    addLog(data.level || 'info', data.msg || data.message);
});

socket.on('stats', (summary) => {
    updateStats(summary);
});

socket.on('wallet', (data) => {
    const signer = Number(data.signer) || 0;
    const vault = Number(data.vault) || 0;
    signerBalanceElement.textContent = `${signer.toFixed(4)} SOL`;
    vaultBalanceElement.textContent = `${vault.toFixed(4)} SOL`;
});

let currentTab = 'active';
let allPositions = [];

// Tab Logic
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.dataset.tab;
        updatePositions(allPositions);
    });
});

socket.on('positions', (positions) => {
    allPositions = positions;
    updatePositions(positions);
});

// Update Functions
function updateStats(summary) {
    if (!summary) return;
    
    const pnlSOL = Number(summary.totalPnLSOL) || 0;
    const sign = pnlSOL >= 0 ? '+' : '';
    const pnlPercent = Number(summary.totalPnLPercent || summary.winRate && summary.totalPnLPercent === undefined ? 0 : summary.totalPnLPercent) || 0;
    
    totalPnLElement.innerHTML = `
        <div class="pnl-main">${sign}${pnlSOL.toFixed(4)} SOL</div>
        <div class="pnl-sub ${pnlPercent >= 0 ? 'green-text' : 'red-text'}">${sign}${pnlPercent.toFixed(2)}%</div>
    `;
    totalPnLElement.className = `metric-value ${pnlSOL >= 0 ? 'green-text' : 'red-text'}`;
    
    const winRate = Number(summary.winRate) || 0;
    winRateElement.textContent = `${winRate.toFixed(1)}%`;
    totalTradesElement.textContent = summary.totalTrades || 0;
}

function updatePositions(positions) {
    if (!Array.isArray(positions)) return;
    allPositions = positions;
    
    const filtered = currentTab === 'active' 
        ? positions.filter(p => p.status === 'open')
        : positions.filter(p => p.status === 'closed');
        
    activeCountElement.textContent = positions.filter(p => p.status === 'open').length;

    if (filtered.length === 0) {
        positionsBody.innerHTML = `
            <tr class="empty-state">
                <td colspan="5">No ${currentTab} trades found.</td>
            </tr>
        `;
        return;
    }

    positionsBody.innerHTML = filtered.map(pos => {
        const pnlSOL = Number(pos.pnlSOL) || 0;
        const pnlPercent = Number(pos.pnlPercent) || 0;
        const pnlClass = pnlPercent >= 0 ? 'pnl-positive' : 'pnl-negative';
        const sign = pnlPercent >= 0 ? '+' : '';
        const mint = pos.mint || pos.mintAddress || 'Unknown';

        return `
            <tr>
                <td><span class="token-name">${pos.symbol || mint.slice(0, 8)}</span></td>
                <td>${(Number(pos.entryPrice) || 0).toExponential(3)}</td>
                <td>${pos.status === 'open' ? (Number(pos.currentPrice || pos.entryPrice) || 0).toExponential(3) : (Number(pos.exitPrice) || 0).toExponential(3)}</td>
                <td><span class="${pnlClass}">${sign}${pnlPercent.toFixed(2)}%</span></td>
                <td><span class="status-pill ${pos.status}">${pos.status.toUpperCase()}</span></td>
            </tr>
        `;
    }).join('');
}

function addLog(type, message) {
    if (!message) return; // Ignore empty logs
    logCount++;
    logCountElement.textContent = `${logCount} logs`;

    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    const time = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
    
    terminal.appendChild(entry);
    terminal.scrollTop = terminal.scrollHeight;

    // Limit log entries
    if (terminal.childNodes.length > 500) {
        terminal.removeChild(terminal.firstChild);
    }
}

// Clear Logs
document.getElementById('clear-logs').addEventListener('click', () => {
    terminal.innerHTML = '';
    logCount = 0;
    logCountElement.textContent = '0 logs';
});

// Fetch initial data
async function fetchInitialData() {
    try {
        const [summaryRes, positionsRes, walletRes] = await Promise.all([
            fetch('/api/summary'),
            fetch('/api/positions'),
            fetch('/api/wallet')
        ]);
        
        const summary = await summaryRes.json();
        const positions = await positionsRes.json();
        const wallet = await walletRes.json();
        
        updateStats(summary);
        updatePositions(positions);
        
        const signerBal = Number(wallet.signer) || 0;
        const vaultBal = Number(wallet.vault) || 0;
        signerBalanceElement.textContent = `${signerBal.toFixed(4)} SOL`;
        vaultBalanceElement.textContent = `${vaultBal.toFixed(4)} SOL`;
        
        addLog('system', 'Initial state synchronized');
    } catch (err) {
        console.error('Fetch error:', err);
        addLog('error', 'Failed to fetch initial data: ' + err.message);
    }
}

fetchInitialData();

fetchInitialData();
