import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { CONFIG } from './config.js';
import { log } from './logger.js';

const WS_URL = 'wss://ws.shinobi.trade/trades';
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;
const PING_INTERVAL = 30000;

class ShinobiWebSocket extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.reconnectAttempts = 0;
    this.pingTimer = null;
    this.volumeHistory = new Map();
    this.lastTrades = new Map();
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    log('info', 'Connecting to Shinobi WebSocket...');
    this.ws = new WebSocket(WS_URL);

    this.ws.on('open', () => {
      log('success', 'Shinobi WebSocket connected');
      this.reconnectAttempts = 0;
      this.startPing();
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const trade = JSON.parse(data.toString());
        this.processTrade(trade);
      } catch (err) {
        // Ignore non-JSON messages (pings, etc.)
      }
    });

    this.ws.on('close', () => {
      log('warn', 'Shinobi WebSocket closed, reconnecting...');
      this.stopPing();
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      log('error', `Shinobi WebSocket error: ${err.message}`);
    });
  }

  processTrade(trade) {
    const tokenAddress = trade.token;
    if (!tokenAddress) return;

    const now = Date.now();
    const volume = trade.volume || 0;
    const price = trade.price || 0;

    const recentTrades = this.lastTrades.get(tokenAddress) || [];
    recentTrades.push({ price, volume, time: now });
    
    const cutoff = now - 60000;
    const filtered = recentTrades.filter(t => t.time > cutoff);
    this.lastTrades.set(tokenAddress, filtered);

    const totalVolume = filtered.reduce((sum, t) => sum + (t.volume || 0), 0);
    this.volumeHistory.set(tokenAddress, {
      currentVolume: volume,
      volume1m: totalVolume,
      price,
      time: now
    });

    const isGrowing = this.isVolumeGrowing(tokenAddress);
    const meetsLiquidity = volume >= CONFIG.MIN_TRADE_VOLUME_SOL;

    this.emit('trade', {
      tokenAddress,
      price,
      volume,
      dex: trade.dex || 'unknown',
      side: trade.side || 'unknown',
      timestamp: trade.timestamp,
      isGrowing,
      meetsLiquidity,
      volume1m: totalVolume
    });

    if (isGrowing && meetsLiquidity) {
      this.emit('opportunity', {
        tokenAddress,
        price,
        volume,
        dex: trade.dex || 'unknown',
        volume1m: totalVolume,
        timestamp: trade.timestamp
      });
    }
  }

  isVolumeGrowing(tokenAddress) {
    const history = this.volumeHistory.get(tokenAddress);
    if (!history) return false;

    const now = Date.now();
    const oldTrades = this.lastTrades.get(tokenAddress)?.filter(t => t.time > now - 120000 && t.time < now - 60000) || [];
    const oldVolume = oldTrades.reduce((sum, t) => sum + (t.volume || 0), 0);
    
    const currentVolume = history.volume1m;
    
    if (oldVolume === 0) {
      return currentVolume >= CONFIG.MIN_TRADE_VOLUME_SOL * 2;
    }

    const growthRate = (currentVolume - oldVolume) / oldVolume;
    return growthRate >= CONFIG.VOLUME_GROWTH_RATE;
  }

  startPing() {
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, PING_INTERVAL);
  }

  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  scheduleReconnect() {
    const delay = Math.min(RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts), MAX_RECONNECT_DELAY);
    this.reconnectAttempts++;
    log('info', `Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connect(), delay);
  }

  disconnect() {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const shinobiWS = new ShinobiWebSocket();