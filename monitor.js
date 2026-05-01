import { PublicKey }            from '@solana/web3.js';
import WebSocket               from 'ws';
import { getConnection }       from './wallet.js';
import { log }                  from './logger.js';
import { EventEmitter }         from 'events';
import { CONFIG }               from './config.js';
import { PoolService }          from './src/services/pool.js';
import { dexService }           from './src/services/dexscreener-service.js';

const SOL_MINT       = 'So11111111111111111111111111111111111111112';
const USDC_MINT      = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT      = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const QUOTE_MINTS    = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);

// Pump.fun migration account (handles BOTH PumpSwap and Raydium migrations)
const PUMP_MIGRATION_ACCOUNT = '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg';
const PUMPSWAP_PROGRAM_ID = 'PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP';
const RAYDIUM_AMM_V4 = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

export class PoolMonitor extends EventEmitter {
  constructor() {
    super();
    this._seen           = new Set();
    this._paused         = false;
    this._running        = false;
    this._pollTimer      = null;
    this._pollCounter    = 0;
    this._pumpWs         = null;
    this._pumpPingTimer  = null;
    this._pumpReconnect  = 2000;
    this._pumpLastCheck  = {};
    this._lastPoolEmit   = null;
  }

  pause()      { this._paused = true;  log('info', 'Pool monitor paused'); }
  resume()     { this._paused = false; log('info', 'Pool monitor resumed'); }
  isPaused()   { return this._paused; }
  isListening(){ return this._running; }

  async start() {
    this._running = true;
    log('info', '══════════════════════════════════════════════════');
    log('info', '  POOL MONITOR v8 — PUMP WS + ONLOGS + DEXSCREENER');
    log('info', '  A: PumpPortal WS (migration + newToken)');
    log('info', '  B: Migration account onLogs (PumpSwap + Raydium)');
    log('info', '  C: DexScreener search (new pairs)');
    log('info', '══════════════════════════════════════════════════');
    log('info', '[MON] Starting detection layers...');

    // Layer 1: PumpPortal WebSocket (subscribeMigration + subscribeNewToken)
    this._startPumpLayer();

    // Layer 2: Direct onLogs for pump.fun migration account (catches BOTH PumpSwap + Raydium)
    this._startMigrationAccountLayer();
    
    // Layer 3: DexScreener search for new pairs (enrichment/backup)
    this._startPollLayer();
  }

  async stop() {
    this._running = false;
    clearInterval(this._pollTimer);
    clearInterval(this._pumpPingTimer);
    if (this._pumpWs) { try { this._pumpWs.close(); } catch {} }
    // Remove onLogs listener
    if (this._migrationSubId) {
      try {
        const conn = getConnection();
        await conn.removeOnLogsListener(this._migrationSubId);
      } catch {}
    }
    log('info', '[MON] Pool monitor stopped');
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MIGRATION ACCOUNT LAYER — Direct onLogs for pump.fun migrations
  // Catches BOTH PumpSwap AND Raydium migrations (covers 100% of graduated tokens)
  // ═══════════════════════════════════════════════════════════════════════════
  _startMigrationAccountLayer() {
    const conn = getConnection();
    log('info', `[PUMP-MIG] Subscribing to migration account: ${PUMP_MIGRATION_ACCOUNT.slice(0,8)}...`);
    
    this._migrationSubId = conn.onLogs(
      new PublicKey(PUMP_MIGRATION_ACCOUNT),
      async ({ signature, err, logs }) => {
        if (err) return;
        if (this._seen.has('mig_' + signature)) return;
        
        // Quick check: only process if logs mention a migrate-like instruction
        if (logs) {
          const logStr = logs.join(' ');
          if (!logStr.includes('migrate') && !logStr.includes('Migrate') && !logStr.includes('Initialize')) {
            return;
          }
        }
        
        this._seen.add('mig_' + signature);
        log('snipe', `[PUMP-MIG] Migration detected: ${signature.slice(0,10)}... — fetching full tx`);
        
        // Fetch full parsed transaction for reliable mint extraction
        await this._processMigrationTransaction(signature);
      },
      'confirmed'
    );
    log('success', '[PUMP-MIG] Migration account listener active');
  }
  
  /**
   * Fetch full parsed transaction and extract token mint from postTokenBalances.
   * Distinguishes PumpSwap vs Raydium by checking which program is invoked.
   */
  async _processMigrationTransaction(signature) {
    const conn = getConnection();
    
    // Retry getParsedTransaction (may take a moment to be indexed)
    let tx = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        tx = await conn.getParsedTransaction(signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        });
        if (tx) break;
      } catch (e) {
        log('debug', `[PUMP-MIG] getParsedTransaction attempt ${attempt + 1} failed: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
    
    if (!tx || !tx.meta) {
      log('warn', `[PUMP-MIG] Could not fetch tx: ${signature.slice(0,10)}...`);
      return;
    }
    
    // Determine program: PumpSwap or Raydium
    const accountKeys = tx.transaction?.message?.accountKeys || [];
    const programIds = accountKeys.map(k => (typeof k === 'string' ? k : k.pubkey?.toString?.() || k.toString()));
    
    let program = 'unknown';
    let poolId = null;
    
    if (programIds.includes(PUMPSWAP_PROGRAM_ID)) {
      program = 'pumpswap';
    } else if (programIds.includes(RAYDIUM_AMM_V4)) {
      program = 'raydium_v4';
    }
    
    // Extract token mint from postTokenBalances
    // The non-SOL, non-USDC, non-USDT mint that appears is the new token
    const postBalances = tx.meta.postTokenBalances || [];
    let tokenMint = null;
    
    for (const bal of postBalances) {
      const mint = bal.mint;
      if (!mint) continue;
      if (QUOTE_MINTS.has(mint)) continue;
      tokenMint = mint;
      break;
    }
    
    // Also try preTokenBalances if post didn't have it
    if (!tokenMint) {
      const preBalances = tx.meta.preTokenBalances || [];
      for (const bal of preBalances) {
        const mint = bal.mint;
        if (!mint) continue;
        if (QUOTE_MINTS.has(mint)) continue;
        tokenMint = mint;
        break;
      }
    }
    
    if (!tokenMint) {
      log('warn', `[PUMP-MIG] No token mint found in tx: ${signature.slice(0,10)}...`);
      return;
    }
    
    // Skip if already seen this token
    if (this._seen.has(tokenMint)) return;
    this._seen.add(tokenMint);
    
    // Try to find pool ID from inner instructions or DexScreener
    const dexPool = await this._fetchDexScreenerPool(tokenMint);
    poolId = dexPool?.poolId || `mig_${tokenMint.slice(0, 8)}`;
    
    log('snipe', `[PUMP-MIG] 🚀 ${program.toUpperCase()} migration: ${tokenMint.slice(0,8)}... (pool: ${poolId.slice(0,8)}...)`);
    
    const pool = {
      signature,
      poolId,
      tokenMint,
      quoteMint: SOL_MINT,
      program,
      liquidityUSD: dexPool?.liquidityUSD || 0,
      timestamp: Date.now(),
      source: 'migration_onlogs',
    };
    
    this._onPool(pool, 'PUMP-MIG');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUMPPORTAL LAYER — Real-time pump.fun → Raydium migration (instant signal)
  // ═══════════════════════════════════════════════════════════════════════════
  _startPumpLayer() {
    log('info', '[MON] Starting PumpPortal WebSocket');
    const uri = 'wss://pumpportal.fun/api/data';

    const connect = () => {
      if (!this._running) return;
      log('info', `[PUMP] Connecting: ${uri}`);

      this._pumpWs = new WebSocket(uri);

      this._pumpWs.on('open', () => {
        log('success', '[PUMP] ✅ Connected — subscribing to migration events');
        log('info', '[PUMP] 📡 Subscribed to: subscribeMigration, subscribeNewToken');
        
        this._pumpWs.send(JSON.stringify({ method: 'subscribeMigration' }));
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
        log('warn', `[PUMP] 🔌 Disconnected — reconnecting in ${this._pumpReconnect}ms`);
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
      
      // Skip if migration token is a quote mint (SOL, USDC, USDT)
      if (QUOTE_MINTS.has(mint)) return;
      
      this._seen.add(mint);

      log('snipe', `[PUMP] 🚀 MIGRATION: ${mint.slice(0,8)}... → ${poolId.slice(0,8)}... (mc: $${(data.marketCap/1000).toFixed(1)}k)`);

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

      log('info', `[PUMP] ✨ NEW TOKEN: ${mint.slice(0,8)}... (checking for migration...)`);
      
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
    const solReserve = parseFloat(data.virtualSolReserves ?? 0) / 1e9;
    const price = parseFloat(data.marketCap ?? 0);
    const liqUSD = solReserve * 150;
    return liqUSD;
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

  // ═══════════════════════════════════════════════════════════════════════════
  // POLL LAYER — DexScreener search for truly new pairs (not profile feed)
  // ═══════════════════════════════════════════════════════════════════════════
  _startPollLayer() {
    log('info', '[MON] Starting DexScreener search (5s interval) - using /latest/dex/search');
    
    const poll = async () => {
      this._pollCounter++;
      try {
        // Use getTrendingPairs which uses /latest/dex/search (not profile feed)
        const result = await dexService.getTrendingPairs('solana', 30);
        if (!result.success || !result.data) {
          return;
        }
        
        for (const pair of result.data) {
          const mint = pair.baseToken?.address;
          if (!mint || this._seen.has('ds_' + mint)) continue;
          
          // Skip if base token is a quote mint (SOL, USDC, USDT)
          if (QUOTE_MINTS.has(mint)) continue;
          
          const pairAge = Date.now() - (pair.pairCreatedAt || 0);
          // No age limit - show all tokens from search
          // (pairAge > 86400000) continue; // Disabled age filter for search endpoint
          
          // Handle undefined liquidity - allow pumpfun tokens if they're recent
          const liquidity = pair.liquidity?.usd || 0;
          const isPumpFun = pair.dexId === 'pumpfun';
          const isRecent = pairAge < 1800000; // < 30 min
          const minLiq = CONFIG.MIN_LIQUIDITY_USD || 100;
          const maxLiq = CONFIG.MAX_LIQUIDITY_USD || 500000;
          
          // Filter by liquidity range from config ($100 – $500K per flowchart)
          if (liquidity > maxLiq) continue; // Skip mega-cap tokens
          if (liquidity < minLiq && !(isPumpFun && isRecent)) continue;
          
          this._seen.add('ds_' + mint);
          
          const pool = {
            signature: 'ds_' + mint,
            poolId: pair.pairAddress,
            tokenMint: mint,
            baseMint: mint,
            quoteMint: pair.quoteToken?.address || SOL_MINT,
            vaultA: null,
            vaultB: null,
            program: pair.dexId || 'dexscreener',
            liquidityUSD: liquidity,
            timestamp: Date.now(),
            source: 'dexscreener',
          };
          
          log('snipe', `[L3] 📊 New pair: ${mint.slice(0,8)}... liq:$${liquidity.toFixed(0)} dex:${pair.dexId}`);
          this._onPool(pool, 'L3');
        }
      } catch (e) {
        log('warn', `[L3] Poll error: ${e.message}`);
      }
    };

    poll();
    this._pollTimer = setInterval(poll, 5_000);
    log('success', '[MON] DexScreener polling active (5s interval)');
  }

  _onPool(pool, layer) {
    if (!pool?.tokenMint) return;
    if (this._paused) return;

    log('info', `[MON] [${layer}] Pool detected: ${pool.tokenMint.slice(0,8)}... (liquidity: $${pool.liquidityUSD?.toFixed(0) || '?'})`);
    
    this.emit('newPool', pool);
  }
}