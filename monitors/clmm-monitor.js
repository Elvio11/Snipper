import { PublicKey } from '@solana/web3.js';
import { getConnection } from '../wallet.js';
import { log } from '../logger.js';
import { 
  RAYDIUM_CLMM_PROGRAM, 
  RAYDIUM_AMM_PROGRAM, 
  parseCLMMPoolAccount 
} from '../src/services/raydium.js';
import { dexService } from '../src/services/dexscreener-service.js';
import { EventEmitter } from 'events';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const POOL_QUEUE = [];
let _processing = false;

export class CLMMPoolMonitor extends EventEmitter {
  constructor() {
    super();
    this._subscriptionId = null;
    this._seenPools = new Set();
  }

  async start() {
    const conn = getConnection();
    log('info', 'Starting CLMM pool monitor...');

    this._subscriptionId = conn.onLogs(
      RAYDIUM_CLMM_PROGRAM,
      async (logs, ctx) => {
        try {
          await this._handleLogs(logs, ctx);
        } catch (err) {
          log('error', `Log handler error: ${err.message}`);
        }
      },
      'confirmed'
    );

    log('success', 'CLMM monitor active');
  }

  async _handleLogs(logs, ctx) {
    if (this._seenPools.has(logs.signature)) return;
    if (logs.err) return;

    const isInit = logs.logs.some(line => 
      line.includes('initialize') || 
      line.includes('InitializeInstruction')
    );

    if (!isInit) return;
    this._seenPools.add(logs.signature);
    log('snipe', `New pool detected! TX: ${logs.signature}`);

    POOL_QUEUE.push(logs.signature);
    this._processQueue();
  }

  async _processQueue() {
    if (_processing || POOL_QUEUE.length === 0) return;
    _processing = true;

    while (POOL_QUEUE.length > 0) {
      const sig = POOL_QUEUE.shift();
      try {
        const poolInfo = await this._extractPoolInfo(sig);
        if (poolInfo) {
          this.emit('newPool', poolInfo);
        }
      } catch (err) {
        log('warn', `Pool extract error: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    _processing = false;
  }

  async _extractPoolInfo(signature) {
    const conn = getConnection();
    const tx = await conn.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx?.transaction?.message?.accountKeys) return null;

    const accounts = tx.transaction.message.accountKeys.map(k => 
      typeof k === 'string' ? k : k.pubkey?.toString()
    );

    let poolAccount = null;
    let poolIdx = -1;
    
    for (let i = 0; i < accounts.length; i++) {
      try {
        const pubkey = new PublicKey(accounts[i]);
        const info = await conn.getAccountInfo(pubkey, { commitment: 'confirmed' });
        
        if (info?.owner?.toString() === RAYDIUM_CLMM_PROGRAM.toString() && 
            info?.data?.length >= 400) {
          poolAccount = info;
          poolIdx = i;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!poolAccount) return null;

    const poolData = parseCLMMPoolAccount(poolAccount.data);
    if (!poolData) return null;

    const tokenMint = poolData.mintA === SOL_MINT ? poolData.mintB : poolData.mintA;

    // Get real liquidity from DexScreener
    let liquidityUSD = 0;
    try {
      const result = await dexService.getTokenPairs(tokenMint);
      if (result.success && result.data?.length) {
        liquidityUSD = result.data[0].liquidity?.usd || 0;
      }
    } catch {}

    log('info', `Pool parsed: ${tokenMint.slice(0,8)}... ($${liquidityUSD.toLocaleString()})`);

    return {
      signature,
      poolId: accounts[poolIdx],
      tokenMint,
      baseMint: poolData.mintA,
      quoteMint: poolData.mintB,
      vaultA: poolData.vaultA,
      vaultB: poolData.vaultB,
      program: 'CLMM',
      liquidityUSD: liquidityUSD,
      liquiditySOL: 0,
      priceNative: 0,
      timestamp: (tx.blockTime || 0) * 1000,
    };
  }

  async stop() {
    if (this._subscriptionId !== null) {
      const conn = getConnection();
      await conn.removeOnLogsListener(this._subscriptionId);
      this._subscriptionId = null;
    }
  }
}