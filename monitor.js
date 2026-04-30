import { PublicKey }            from '@solana/web3.js';
import WebSocket               from 'ws';
import { getConnection, withRetry } from './wallet.js';
import { log }                  from './logger.js';
import { EventEmitter }         from 'events';
import { CONFIG }               from './config.js';
import { PoolService }          from './src/services/pool.js';
import { dexService }           from './src/services/dexscreener-service.js';

const RAYDIUM_CLMM   = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';
const RAYDIUM_CPMM   = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
const RAYDIUM_AMM_V4 = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const SOL_MINT       = 'So11111111111111111111111111111111111111112';
const USDC_MINT      = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT      = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const QUOTE_MINTS    = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);

const DISC_CLMM_CREATE = Buffer.from([233, 146, 209, 142, 207, 104,  64, 188]);
const DISC_CPMM_INIT   = Buffer.from([175, 175, 109,  31,  13, 152, 155, 237]);
const AMM_V4_INIT2_BYTE = 1;

export class PoolMonitor extends EventEmitter {
  constructor() {
    super();
    this._subscriptionId = null;
    this._seen           = new Set();
    this._rateLimitCount = 0;
    this._paused         = false;
    this._feeSubIds      = [];
    this._clmmSubId      = null;
    this._cpmmSubId      = null;
    this._running        = false;
    this._queue          = [];
    this._processing    = false;
    this._pollTimer     = null;
    this._pollCounter   = 0;
    this._pumpWs        = null;
    this._pumpPingTimer = null;
    this._pumpReconnect = 2000;
    this._pumpLastCheck = {};
  }

  pause()      { this._paused = true;  log('info', 'Pool monitor paused'); }
  resume()     { this._paused = false; log('info', 'Pool monitor resumed'); }
  isPaused()   { return this._paused; }
  isListening(){ return this._running; }

  async start() {
    this._running = true;
    log('info', '══════════════════════════════════════════════════');
    log('info', '  POOL MONITOR v4 — PUMPPORTAL + HYBRID');
    log('info', '  A: PumpPortal migration (instant)');
    log('info', '  B: onLogs on CLMM/CPMM (backup)');
    log('info', '  C: DexScreener polling (safety net)');
    log('info', '══════════════════════════════════════════════════');

    this._startPumpLayer();
    this._startCLMMLayer();
    this._startCPMMLayer();
    this._startPollLayer();
  }

  async stop() {
    this._running = false;
    clearInterval(this._pollTimer);
    clearInterval(this._pumpPingTimer);
    if (this._pumpWs) { try { this._pumpWs.close(); } catch {} }
    const conn = getConnection();
    for (const id of [this._clmmSubId, this._cpmmSubId, ...this._feeSubIds]) {
      if (id) try { await conn.removeOnLogsListener(id); } catch {}
    }
    this._subscriptionId = null;
    log('info', 'Pool monitor stopped');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUMPPORTAL LAYER — Real-time pump.fun → Raydium migration (instant signal)
  // ═══════════════════════════════════════════════════════════════════════════
  _startPumpLayer() {
    const uri = 'wss://pumpportal.fun/api/data';

    const connect = () => {
      if (!this._running) return;
      log('info', `[PUMP] Connecting: ${uri}`);

      this._pumpWs = new WebSocket(uri);

      this._pumpWs.on('open', () => {
        log('success', '[PUMP] Connected — subscribing to migration events');
        
        // Subscribe to migration events (pump.fun → Raydium)
        this._pumpWs.send(JSON.stringify({ method: 'subscribeMigration' }));
        
        // Subscribe to new token creation (extra signal)
        this._pumpWs.send(JSON.stringify({ method: 'subscribeNewToken' }));

        this._pumpPingTimer = setInterval(() => {
          if (this._pumpWs?.readyState === WebSocket.OPEN) this._pumpWs.ping();
        }, 25_000);
      });

      this._pumpWs.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this._handlePumpMessage(msg);
        } catch (e) {
          log('warn', `[PUMP] Parse error: ${e.message}`);
        }
      });

      this._pumpWs.on('error', (err) =>
        log('warn', `[PUMP] WS error: ${err.message}`)
      );

      this._pumpWs.on('pong', () => { this._pumpReconnect = 2000; });

      this._pumpWs.on('close', () => {
        clearInterval(this._pumpPingTimer);
        if (!this._running) return;
        log('warn', `[PUMP] Disconnected — reconnecting in ${this._pumpReconnect}ms`);
        setTimeout(connect, this._pumpReconnect);
        this._pumpReconnect = Math.min(this._pumpReconnect * 2, 30_000);
      });
    };

    connect();
  }

  _handlePumpMessage(msg) {
    const method = msg.method;
    const data = msg.data;

    // ── Trade event (from pump.fun trading) ────────────────────────────────
    // This fires for EVERY trade on pump.fun - use to detect early migration
    if (data?.mint && !method) {
      const mint = data.mint;
      if (this._seen.has('pump_' + mint)) return;
      
      // Only check if we haven't seen this token recently
      // Rate limit: max 1 check per token per 60 seconds
      const lastCheck = this._pumpLastCheck?.[mint] ?? 0;
      if (Date.now() - lastCheck < 60_000) return;
      
      this._pumpLastCheck = this._pumpLastCheck || {};
      this._pumpLastCheck[mint] = Date.now();
      
      this._seen.add('pump_' + mint);
      
      // Check if token migrated to Raydium
      this._checkMigration(mint);
      return;
    }

    // ── Migration event (token graduating to Raydium) ─────────────────────
    if (method === 'subscribeMigration' && data) {
      const mint = data.mint;
      const poolId = data.RaydiumPair;

      if (!mint || !poolId) return;
      if (this._seen.has(mint)) return;
      this._seen.add(mint);

      log('snipe', `[PUMP] Migration: ${mint.slice(0,10)}... → ${poolId.slice(0,10)}...`);

      const pool = {
        signature: 'mig_' + mint,
        poolId,
        tokenMint: mint,
        baseMint: mint,
        quoteMint: SOL_MINT,
        vaultA: data.tokenVaultA ?? null,
        vaultB: data.tokenVaultB ?? null,
        program: 'pump_migration',
        liquidityUSD: this._calcPumpLiq(data),
        timestamp: Date.now(),
        source: 'pumpportal',
        pumpData: data,
      };

      this._onPool(pool, 'PUMP');
      return;
    }

    // ── New token creation event ────────────────────────────────────────
    if (method === 'subscribeNewToken' && data?.mint) {
      const mint = data.mint;
      if (this._seen.has('new_' + mint)) return;
      this._seen.add('new_' + mint);

      log('info', `[PUMP] New token: ${mint.slice(0,10)}...`);
      
      // Check for migration immediately
      this._checkMigration(mint);
      return;
    }
  }

  async _checkMigration(mint) {
    try {
      const pool = await this._fetchDexScreenerPool(mint);
      if (pool) {
        log('snipe', `[PUMP] Migrated: ${mint.slice(0,10)}... → pool found`);
        this._onPool(pool, 'PUMP');
      }
    } catch (e) {
      log('warn', `[PUMP] Migration check failed: ${e.message}`);
    }
  }

  _calcPumpLiq(data) {
    // Estimate liquidity from pump.fun migration data
    // virtualSolReserves is in lamports, divide by 1e9 for SOL
    const solReserve = parseFloat(data.virtualSolReserves ?? 0) / 1e9;
    const price = parseFloat(data.marketCap ?? 0);
    const liqUSD = solReserve * 150; // SOL price estimate
    return liqUSD;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLMM LAYER — onLogs on CLMM program + discriminator check
  // ═══════════════════════════════════════════════════════════════════════════
  _startCLMMLayer() {
    const conn = getConnection();
    log('info', `[L1] Subscribing to CLMM program logs: ${RAYDIUM_CLMM.slice(0,8)}...`);
    
    this._clmmSubId = conn.onLogs(
      new PublicKey(RAYDIUM_CLMM),
      async ({ signature, err }) => {
        if (err) return;
        if (this._seen.has(signature)) return;
        
        try {
          this._queue.push({ signature, program: 'CLMM', retries: 0 });
          this._processQueue();
        } catch (e) {
          log('warn', `[L1-CLMM] Queue error: ${e.message}`);
        }
      },
      'confirmed'
    );
    log('success', '[L1] CLMM program listener active');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CPMM LAYER — onLogs on CPMM program + discriminator check
  // ═══════════════════════════════════════════════════════════════════════════
  _startCPMMLayer() {
    const conn = getConnection();
    log('info', `[L2] Subscribing to CPMM program logs: ${RAYDIUM_CPMM.slice(0,8)}...`);
    
    this._cpmmSubId = conn.onLogs(
      new PublicKey(RAYDIUM_CPMM),
      async ({ signature, err }) => {
        if (err) return;
        if (this._seen.has(signature)) return;
        
        try {
          this._queue.push({ signature, program: 'CPMM', retries: 0 });
          this._processQueue();
        } catch (e) {
          log('warn', `[L2-CPMM] Queue error: ${e.message}`);
        }
      },
      'confirmed'
    );
    log('success', '[L2] CPMM program listener active');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POLL LAYER — DexScreener as safety net every 30s
  // ═══════════════════════════════════════════════════════════════════════════
  _startPollLayer() {
    const poll = async () => {
      this._pollCounter++;
      try {
        // Use dexService (with 3-API routing and rate limiting)
        const result = await dexService.getNewPairs('solana', 20);
        if (!result.success || !result.data) {
          return;
        }
        
        for (const pair of result.data) {
          if (pair.chainId !== 'solana') continue;
          const mint = pair.baseToken?.address;
          if (!mint || this._seen.has('ds_' + mint)) continue;
          
          // Only process recent pairs (within last 5 minutes)
          const pairAge = Date.now() - (pair.pairCreatedAt || 0);
          if (pairAge > 300000) continue;
          
          // Check liquidity - lower threshold to catch new tokens
          const liquidity = pair.liquidity?.usd || 0;
          if (liquidity < 50) continue;
          
          this._seen.add('ds_' + mint);
          
          const pool = {
            signature: 'ds_' + mint,
            poolId: pair.pairAddress,
            tokenMint: mint,
            baseMint: mint,
            quoteMint: 'So11111111111111111111111111111111111111112',
            vaultA: null,
            vaultB: null,
            program: 'dexscreener',
            liquidityUSD: liquidity,
            timestamp: Date.now(),
            source: 'dexscreener',
          };
          
          log('snipe', `[L3] DexScreener: ${mint.slice(0,10)}... liq:$${liquidity.toFixed(0)}`);
          this._onPool(pool, 'L3');
        }
      } catch (e) {
        log('warn', `[L3] Poll error: ${e.message}`);
      }
    };

    poll();
    this._pollTimer = setInterval(poll, 10_000); // Reduced to 10s for faster detection
    log('success', '[L3] DexScreener polling active (10s interval)');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUEUE PROCESSING — fetch tx, check discriminator, emit if valid pool
  // ═══════════════════════════════════════════════════════════════════════════
  async _processQueue() {
    if (this._processing || this._paused) return;
    if (this._queue.length === 0) return;
    
    this._processing = true;
    while (this._queue.length > 0) {
      const item = this._queue.shift();
      if (this._seen.has(item.signature)) continue;
      
      try {
        const pool = await withRetry(
          () => this._parsePoolTx(item.signature, item.program),
          3, 500
        );
        if (pool) {
          this._seen.add(item.signature);
          log('snipe', `[${item.program}] NEW POOL: ${pool.tokenMint.slice(0,10)}... | $${pool.liquidityUSD?.toLocaleString() ?? '?'}`);
          this._onPool(pool, item.program);
        }
      } catch (e) {
        if (e.message?.includes('429')) {
          this._rateLimitCount++;
          this._queue.unshift(item);
          await new Promise(r => setTimeout(r, 2000));
        } else {
          log('warn', `[${item.program}] Parse failed: ${e.message}`);
        }
      }
      
      if (this._queue.length > 100) break;
    }
    this._processing = false;
  }

  async _parsePoolTx(signature, program) {
    const conn = getConnection();
    const tx   = await conn.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!tx?.transaction?.message?.accountKeys) return null;

    const meta     = tx.meta;
    const accounts = tx.transaction.message.accountKeys.map(k =>
      k.pubkey?.toString() ?? k.toString()
    );

    const ixList = tx.transaction.message.instructions || [];
    
    for (const ix of ixList) {
      const prog = ix.programId?.toString() ?? accounts[ix.programIdIndex];
      if (program === 'CLMM' && prog !== RAYDIUM_CLMM) continue;
      if (program === 'CPMM' && prog !== RAYDIUM_CPMM) continue;

      if (!ix.data) continue;
      const data = Buffer.from(ix.data, 'base64');

      if (program === 'CLMM') {
        if (data.length >= 8 && data.subarray(0, 8).equals(DISC_CLMM_CREATE)) {
          return this._buildCLMMPool(ix, accounts, meta, signature);
        }
      } else if (program === 'CPMM') {
        if (data.length >= 8 && data.subarray(0, 8).equals(DISC_CPMM_INIT)) {
          return this._buildCPMMPool(ix, accounts, meta, signature);
        }
      }
    }
    return null;
  }

  _buildCLMMPool(ix, accounts, meta, signature) {
    const ixAccs = (ix.accounts || []).map(a => 
      typeof a === 'string' ? a : accounts[a]
    );
    const g = i => ixAccs[i] ?? null;
    
    const poolId = g(2);
    const mint0 = g(3);
    const mint1 = g(4);
    if (!poolId || !mint0 || !mint1) return null;

    const pair = this._resolvePair(mint0, mint1);
    if (!pair) return null;
    const { tokenMint, quoteMint } = pair;

    return {
      signature, poolId, tokenMint, baseMint: mint0, quoteMint,
      vaultA: g(5), vaultB: g(6),
      program: 'CLMM',
      liquidityUSD: this._estimateLiq(meta),
      timestamp: (meta?.blockTime || 0) * 1000,
      source: 'clmm_logs',
    };
  }

  _buildCPMMPool(ix, accounts, meta, signature) {
    const ixAccs = (ix.accounts || []).map(a =>
      typeof a === 'string' ? a : accounts[a]
    );
    const g = i => ixAccs[i] ?? null;

    const poolId = g(3);
    const mint0 = g(4);
    const mint1 = g(5);
    if (!poolId || !mint0 || !mint1) return null;

    const pair = this._resolvePair(mint0, mint1);
    if (!pair) return null;
    const { tokenMint, quoteMint } = pair;

    return {
      signature, poolId, tokenMint, baseMint: mint0, quoteMint,
      vaultA: g(10), vaultB: g(11),
      program: 'CPMM',
      liquidityUSD: this._estimateLiq(meta),
      timestamp: (meta?.blockTime || 0) * 1000,
      source: 'cpmm_logs',
    };
  }

  async _fetchDexScreenerPool(mint) {
    try {
      const result = await dexService.getTokenPairs(mint);
      if (!result.success || !result.data?.length) return null;
      
      const pair = result.data.find(p =>
        p.chainId === 'solana' && (p.dexId?.includes('raydium') || p.dexId?.includes('pump'))
      );
      if (!pair) return null;

      return {
        signature: 'ds_' + mint,
        poolId: pair.pairAddress,
        tokenMint: pair.baseToken?.address === SOL_MINT ? pair.quoteToken?.address : pair.baseToken?.address,
        baseMint: pair.baseToken?.address,
        quoteMint: pair.quoteToken?.address,
        vaultA: null, vaultB: null,
        program: pair.dexId,
        liquidityUSD: pair.liquidity?.usd ?? 0,
        timestamp: Date.now(),
        source: 'dexscreener',
      };
    } catch { return null; }
  }

  _resolvePair(mint0, mint1) {
    const QUOTE_MINTS = new Set([
      'So11111111111111111111111111111111111111112',
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
    ]);
    const hasSOL = QUOTE_MINTS.has(mint0) || QUOTE_MINTS.has(mint1);
    
    if (!hasSOL) {
      log('warn', `Skipping non-SOL pair: ${mint0.slice(0,8)}/${mint1.slice(0,8)}`);
      return null;
    }
    
    if (QUOTE_MINTS.has(mint1) && !QUOTE_MINTS.has(mint0))
      return { tokenMint: mint0, quoteMint: mint1 };
    if (QUOTE_MINTS.has(mint0) && !QUOTE_MINTS.has(mint1))
      return { tokenMint: mint1, quoteMint: mint0 };
    return { tokenMint: mint0, quoteMint: mint1 };
  }

  _estimateLiq(meta) {
    if (!meta?.postBalances || !meta?.preBalances) return 0;
    const solAdded = meta.postBalances.reduce((sum, bal, i) =>
      sum + Math.max(0, bal - (meta.preBalances[i] ?? 0)), 0
    ) / 1e9;
    return solAdded * 150;
  }

  async _onPool(pool, layer) {
    if (!pool?.tokenMint) return;
    if (this._paused) return;

    try {
      if (!pool.liquidityUSD && pool.poolId) {
        pool.liquidityUSD = await PoolService.getLiquidityUSD(pool.tokenMint, pool.poolId);
      }
    } catch {}

    this.emit('newPool', pool);
  }
}