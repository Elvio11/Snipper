import { PublicKey } from '@solana/web3.js';
import { getConnection, withRetry } from './wallet.js';
import { log } from './logger.js';
import { EventEmitter } from 'events';
import { CONFIG } from './config.js';
import { PoolService } from './src/services/pool.js';

const RAYDIUM_CLMM = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const RAYDIUM_AMM_V4 = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const HELIUS_WS = `wss://mainnet.helius-rpc.com/?api-key=${CONFIG.HELIUS_API_KEY}`;

const POOL_QUEUE = [];
let _queueProcessing = false;
let _ws = null;
let _pingInterval = null;

export class HeliusMonitor extends EventEmitter {
  constructor() {
    super();
    this._seen = new Set();
    this._rateLimitCount = 0;
    this._paused = false;
    this._reconnectDelay = 1000;
    this._maxReconnectDelay = 30000;
  }

  pause() { this._paused = true; }
  resume() { this._paused = false; }
  isPaused() { return this._paused; }
  isListening() { return _ws !== null && _ws.readyState === 1; }

  async start() {
    log('info', 'Starting Helius Enhanced WebSocket monitor...');
    log('info', `Watching Raydium CLMM: ${RAYDIUM_CLMM.toString()}`);
    
    this._connect();
    return Promise.resolve();
  }

  _connect() {
    if (_ws) {
      _ws.removeAllListeners();
      if (_ws.readyState === 1) _ws.close();
    }
    if (_pingInterval) clearInterval(_pingInterval);

    try {
      _ws = new WebSocket(HELIUS_WS);
    } catch (err) {
      log('error', `WebSocket error: ${err.message}`);
      this._scheduleReconnect();
      return;
    }

    _ws.on('open', () => {
      log('success', 'Helius WebSocket connected');
      this._reconnectDelay = 1000;
      
      this._sendSubscribe();
      
      _pingInterval = setInterval(() => {
        if (_ws?.readyState === 1) _ws.ping();
      }, 30000);
    });

    _ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.params?.result) {
          this._handleTransaction(msg.params.result);
        }
      } catch (err) {
        if (err.message !== 'Unexpected end of JSON input') {
          log('warn', `Message parse error: ${err.message}`);
        }
      }
    });

    _ws.on('close', () => {
      log('warn', 'Helius WebSocket closed');
      this._scheduleReconnect();
    });

    _ws.on('error', (err) => {
      log('error', `WebSocket error: ${err.message}`);
    });
  }

  _scheduleReconnect() {
    if (_pingInterval) clearInterval(_pingInterval);
    log('info', `Reconnecting in ${this._reconnectDelay}ms...`);
    setTimeout(() => this._connect(), this._reconnectDelay);
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxReconnectDelay);
  }

  _sendSubscribe() {
    if (!_ws || _ws.readyState !== 1) return;

    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'transactionSubscribe',
      params: [
        {
          accountInclude: [RAYDIUM_CLMM.toString()],
          failed: false,
        },
        {
          commitment: 'confirmed',
          encoding: 'jsonParsed',
          transactionDetails: 'full',
          maxSupportedTransactionVersion: 0,
          includeRewards: false,
        }
      ]
    };

    _ws.send(JSON.stringify(request));
    log('snipe', 'Subscribed to Raydium CLMM transactions');
  }

  _handleTransaction(result) {
    const sig = result.signature;
    if (this._seen.has(sig)) return;

    const logs = result.transaction?.meta?.logMessages || [];
    const logStr = logs.join(' ');

    if (logStr.includes('SwapEvent') || logStr.includes('Dex::') || logStr.includes('swap')) return;
    if (!logStr.includes('Instruction:')) return;

    const hasCreatePool = logStr.includes('CreatePool') || logStr.includes('create_pool') || 
                          logStr.includes('Create') || logStr.includes('initialize');
    if (!hasCreatePool) return;

    this._seen.add(sig);
    log('snipe', `Pool create candidate: ${sig}`);

    POOL_QUEUE.push({ sig, result });
    this._processQueue();
  }

  async _processQueue() {
    if (_queueProcessing || POOL_QUEUE.length === 0) return;
    if (this._rateLimitCount >= 5) {
      log('warn', 'Rate limited, pausing pool processing for 10s');
      await new Promise(r => setTimeout(r, 10000));
      this._rateLimitCount = 0;
    }

    _queueProcessing = true;

    while (POOL_QUEUE.length > 0) {
      const batch = POOL_QUEUE.splice(0, 2);

      for (const { sig, result } of batch) {
        try {
          const poolInfo = await this._parsePoolFromResult(result, sig);
          if (poolInfo) {
            if (this._paused) {
              log('info', 'Pool detected but scanning paused (positions open)');
              continue;
            }
            log('info', `Pool parsed: ${poolInfo.tokenMint?.slice(0,12)}... ($${poolInfo.liquidityUSD?.toLocaleString() || '?'})`);
            this.emit('newPool', poolInfo);
          }
        } catch (err) {
          if (err.message?.includes('429')) this._rateLimitCount++;
          log('warn', `Pool parse error: ${err.message}`);
        }
      }

      await new Promise(r => setTimeout(r, 500));
    }

    _queueProcessing = false;
  }

  async _parsePoolFromResult(result, signature) {
    const message = result.transaction?.message;
    if (!message?.accountKeys) return null;

    const accounts = message.accountKeys.map(k => k.pubkey);

    let poolAccount = null;
    let poolIdx = -1;

    for (let i = 0; i < accounts.length; i++) {
      const info = result.transaction?.meta?.postTokenBalances?.find(b => b.pubkey === accounts[i]);
      if (!info) continue;

      if (info.owner === RAYDIUM_CLMM.toString()) {
        const data = result.transaction?.meta?.preTokenBalances?.find(b => b.pubkey === accounts[i]);
        if (data) {
          poolAccount = { owner: RAYDIUM_CLMM };
          poolIdx = i;
          break;
        }
      }
    }

    if (!poolAccount) return null;

    const tokenMint = accounts[poolIdx];
    const liquidityUSD = await PoolService.getLiquidityUSD(tokenMint, accounts[poolIdx]);

    return {
      signature,
      poolId: accounts[poolIdx],
      tokenMint,
      program: 'CLMM',
      liquidityUSD,
      accounts,
    };
  }

  async stop() {
    if (_pingInterval) clearInterval(_pingInterval);
    if (_ws) {
      _ws.removeAllListeners();
      if (_ws.readyState === 1) _ws.close();
      _ws = null;
    }
    log('info', 'Helius monitor stopped');
  }
}