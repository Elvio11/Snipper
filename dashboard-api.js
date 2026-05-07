import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.DASHBOARD_PORT || 3001;

// Store for last few events to show on dashboard load
let eventHistory = [];
const MAX_HISTORY = 50;
let lastWallet = { signer: 0, vault: 0 };
let lastSummary = { totalTrades: 0, wins: 0, losses: 0, winRate: 0, totalPnLSOL: 0, openTrades: 0 };
let positionManager = null;
let walletProvider = null;

export function setPositionManager(pm) {
  positionManager = pm;
}

export function setWalletProvider(fn) {
  walletProvider = fn;
}

io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id);
  
  // Send initial history
  socket.emit('history', eventHistory);
  
  socket.on('disconnect', () => {
    console.log('Dashboard disconnected');
  });
});

/**
 * Broadcast a message to the dashboard
 */
export function broadcast(type, data) {
  const event = {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    type,
    data
  };
  
  eventHistory.push(event);
  if (eventHistory.length > MAX_HISTORY) eventHistory.shift();
  
  if (type === 'wallet') lastWallet = data;
  if (type === 'stats') lastSummary = data;
  
  io.emit('event', event);
  // Also emit specific type for easier client handling
  io.emit(type, data);
}

/**
 * Start the dashboard bridge
 */
export function startDashboard() {
  httpServer.listen(PORT, () => {
    console.log(`🚀 Dashboard Bridge active on port ${PORT}`);
  });
}

// REST endpoints for data snapshots
app.get('/api/status', (req, res) => {
  // Logic to read current bot status
  res.json({ status: 'running', uptime: process.uptime() });
});

app.get('/api/positions', (req, res) => {
  try {
    if (positionManager) {
      return res.json(Array.from(positionManager.positions.values()));
    }
    const data = fs.readFileSync('./logs/positions.json', 'utf8');
    res.json(JSON.parse(data || '[]'));
  } catch (e) {
    res.status(500).json({ error: 'Failed to read positions' });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    if (positionManager) {
      return res.json(positionManager.getSummary());
    }
    
    // Fallback to file read if PM not yet attached
    const data = fs.readFileSync('./logs/positions.json', 'utf8');
    const positions = JSON.parse(data || '[]');
    const closed = positions.filter(p => p.status === 'closed');
    const wins = closed.filter(p => (p.pnlSOL || 0) > 0).length;
    const losses = closed.filter(p => (p.pnlSOL || 0) < 0).length;
    const totalPnL = closed.reduce((acc, p) => acc + (p.pnlSOL || 0), 0);
    
    res.json({
      totalTrades: closed.length,
      wins,
      losses,
      winRate: closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0,
      totalPnLSOL: totalPnL,
      openTrades: positions.filter(p => p.status === 'open').length
    });
  } catch (e) {
    res.json({ totalTrades: 0, wins: 0, losses: 0, winRate: 0, totalPnLSOL: 0, openTrades: 0 });
  }
});

app.get('/api/wallet', async (req, res) => {
  if (walletProvider && (lastWallet.signer === 0)) {
    try {
      const balances = await walletProvider();
      lastWallet = balances;
    } catch (e) {}
  }
  res.json(lastWallet);
});

app.get('/api/summary', (req, res) => {
  if (positionManager) {
    return res.json(positionManager.getSummary());
  }
  res.json(lastSummary);
});
