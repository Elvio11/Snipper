/**
 * Unified Pool Service - single source of truth for all pool data.
 * Replaces fragmented price.js, safety.js, and manual parsing in monitor.js.
 */
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getConnection } from '../../wallet.js';
import { log } from '../../logger.js';
import { dexService } from './dexscreener-service.js';

const RAYDIUM_API = 'https://api-v3.raydium.io';
const JUPITER_PRICE = 'https://api.jup.ag/price/v2';
const JUPITER_QUOTE = 'https://api.jup.ag';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const RAYDIUM_CLMM_PROGRAM = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const RAYDIUM_AMM_PROGRAM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

const _cache = new Map();
const CACHE_TTL = 5000;
const PRICE_RETRY_COUNT = 3;
const PRICE_RETRY_DELAY_MS = 500;
const MAX_CACHE_SIZE = 1000;
const CACHE_EVICT_THRESHOLD = 800;
const CACHE_STALE_TTL = 3000; // Match monitoring interval (3s) - fresh for decisions

function _evictCacheIfNeeded() {
  if (_cache.size >= MAX_CACHE_SIZE) {
    const now = Date.now();
    for (const [key, entry] of _cache) {
      if (now - entry.ts > CACHE_TTL * 2) {
        _cache.delete(key);
      }
    }
    if (_cache.size > CACHE_EVICT_THRESHOLD) {
      const entries = [..._cache.entries()];
      entries.sort((a, b) => a[1].ts - b[1].ts);
      for (let i = 0; i < 200 && i < entries.length; i++) {
        _cache.delete(entries[i][0]);
      }
    }
  }
}

// Periodic cache cleanup every 60s
setInterval(_evictCacheIfNeeded, 60000);

export class PoolService {
  static async getPoolState(poolAddress, tokenMint) {
    const cacheKey = `poolState:${poolAddress}`;
    const cached = _cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return cached.data;
    }

    const [raydiumData, dexData, onchainData] = await Promise.all([
      PoolService._getRaydiumPoolInfo(poolAddress),
      PoolService._getDexScreenerData(tokenMint),
      PoolService._getOnchainPoolData(poolAddress),
    ]);

    const state = {
      poolAddress,
      tokenMint,
      program: onchainData?.program || 'unknown',
      tvlUSD: PoolService._mergeTvl(raydiumData, dexData),
      liquidityUSD: dexData?.liquidityUSD || raydiumData?.tvl || 0,
      price: PoolService._mergePrice(raydiumData, dexData, onchainData),
      mints: onchainData?.mints || {},
      vaults: onchainData?.vaults || {},
      ts: Date.now(),
    };

    _cache.set(cacheKey, { data: state, ts: Date.now() });
    return state;
  }

  /**
   * Get token price in SOL from multiple sources (prioritized).
   * Priority: Jupiter Quote (actual swap price) > DexScreener > Jupiter Price > Raydium
   */
  static async getTokenPrice(tokenMint, poolAddress = null) {
    const cacheKey = `price:${tokenMint}`;
    const cached = _cache.get(cacheKey);
    // Cache for one monitoring cycle (3s) - reduces API spam but stays fresh
    if (cached && Date.now() - cached.ts < CACHE_STALE_TTL) {
      return cached.price;
    }
    
    _evictCacheIfNeeded();
    // Fire-and-forget refresh for next cycle
    PoolService._fetchPriceWithFallback(tokenMint, poolAddress).then(price => {
      if (price) _cache.set(cacheKey, { price, ts: Date.now() });
    }).catch(() => {});
    
    return cached?.price || null;
  }

  /**
   * Batch fetch prices for multiple tokens.
   */
  static async getTokenPricesBatch(tokenMints) {
    const results = new Map();
    const uncached = [];
    
    // Check cache first
    for (const mint of tokenMints) {
      const cacheKey = `price:${mint}`;
      const cached = _cache.get(cacheKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        results.set(mint, cached.price);
      } else {
        uncached.push(mint);
      }
    }
    
    // Batch fetch uncached
    if (uncached.length > 0) {
      await Promise.all(uncached.map(mint => 
        PoolService._fetchPriceWithFallback(mint).then(price => {
          if (price) results.set(mint, price);
        }).catch(() => {})
      ));
    }
    
    return results;
  }

static async _fetchPriceWithFallback(tokenMint, poolAddress = null, retries = PRICE_RETRY_COUNT) {
    let lastError = null;
    const cacheKey = `price:${tokenMint}`;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        log('debug', `Price fetch retry ${attempt}/${retries} for ${tokenMint.slice(0,8)}`);
        await new Promise(r => setTimeout(r, PRICE_RETRY_DELAY_MS * attempt));
      }

      // PRIORITY 1: Jupiter Quote (most accurate - actual executable price)
      try {
        const quotePrice = await PoolService.getPriceFromJupiterQuote(tokenMint);
        if (quotePrice && quotePrice > 0 && quotePrice < 100) {
          _cache.set(cacheKey, { price: quotePrice, ts: Date.now() });
          return quotePrice;
        }
      } catch (e) { lastError = e; }

      // FALLBACK: Other sources
      const sources = await Promise.allSettled([
        PoolService._getPriceFromDexScreener(tokenMint),
        PoolService._getPriceFromJupiter(tokenMint),
        poolAddress ? PoolService._getPriceFromRaydium(poolAddress) : Promise.resolve(null),
        poolAddress ? PoolService._getPriceFromVaults(poolAddress) : Promise.resolve(null),
      ]);

      const failedSources = [];
      for (const result of sources) {
        if (result.status === 'fulfilled' && result.value && result.value > 0 && result.value < 100) {
          _cache.set(cacheKey, { price: result.value, ts: Date.now() });
          return result.value;
        } else if (result.status === 'rejected') {
          failedSources.push(result.reason?.message || 'rejected');
        }
      }
      
      lastError = new Error(failedSources.join('; ') || lastError?.message);
    }
    
    log('warn', `All price sources failed for ${tokenMint.slice(0,8)} after ${retries + 1} attempts: ${lastError?.message}`);
    return null;
  }

  /**
   * Get token price using Jupiter Quote endpoint (actual swap price).
   */
  static async getPriceFromJupiterQuote(tokenMint, tokenAmount = 1000000) {
    try {
      const url = `${JUPITER_QUOTE}/swap/v1/quote?inputMint=${tokenMint}&outputMint=${SOL_MINT}&amount=${tokenAmount}&slippageBps=50`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      if (data.outAmount) {
        return Number(data.outAmount) / LAMPORTS_PER_SOL / (tokenAmount / 1e6);
      }
return null;
    } catch (e) {
      log('debug', `DexScreener fetch failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Get liquidity in USD - DexScreener is authoritative, Raydium as fallback.
   */
  static async getLiquidity(tokenMint, poolAddress = null) {
    const cacheKey = `liq:${tokenMint}`;
    const cached = _cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return cached.liquidity;
    }

    const [dexData, raydiumData] = await Promise.allSettled([
      this._getDexScreenerData(tokenMint),
      poolAddress ? PoolService._getRaydiumPoolInfo(poolAddress) : Promise.resolve(null),
    ]);

    const dexLiq = dexData.status === 'fulfilled' ? dexData.value?.liquidityUSD : 0;
    const rayLiq = raydiumData.status === 'fulfilled' ? raydiumData.value?.tvl : 0;

    const liquidity = Math.max(dexLiq || 0, rayLiq || 0);
    _cache.set(cacheKey, { liquidity, ts: Date.now() });
    return liquidity;
  }

  static async getLiquidityUSD(tokenMint, poolId) {
    try {
      if (poolId) {
        const pairResult = await dexService.getPair(poolId);
        if (pairResult.success && pairResult.data) {
          return pairResult.data.liquidity?.usd || 0;
        }
      }
      
      const tokenResult = await dexService.getTokenPairs(tokenMint);
      if (tokenResult.success && tokenResult.data && tokenResult.data.length > 0) {
        return tokenResult.data[0].liquidity?.usd || 0;
      }
      
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get token security data (liquidity, volume, honeypot check).
   */
  static async getTokenSecurity(tokenMint) {
    const [dexData, mintData, honeypot] = await Promise.allSettled([
      PoolService._getDexScreenerData(tokenMint),
      PoolService._getMintInfo(tokenMint),
      PoolService._checkHoneypot(tokenMint),
    ]);

    return {
      liquidityUSD: dexData.status === 'fulfilled' ? dexData.value?.liquidityUSD || 0 : 0,
      volume24h: dexData.status === 'fulfilled' ? dexData.value?.volume24h || 0 : 0,
      txns24h: dexData.status === 'fulfilled' ? dexData.value?.txns24h || 0 : 0,
      mintAuthority: mintData.status === 'fulfilled' ? mintData.value?.mintAuthority : null,
      freezeAuthority: mintData.status === 'fulfilled' ? mintData.value?.freezeAuthority : null,
      supply: mintData.status === 'fulfilled' ? mintData.value?.supply : 0,
      decimals: mintData.status === 'fulfilled' ? mintData.value?.decimals : 0,
      isHoneypot: honeypot.status === 'fulfilled' ? honeypot.value?.isHoneypot : null,
      honeypotReason: honeypot.status === 'fulfilled' ? honeypot.value?.reason : null,
    };
  }

  /**
   * Parse CLMM pool from on-chain account data.
   * Uses the CORRECT byte offsets from SDK docs.
   */
  static parseCLMMPool(data) {
    const DISCRIMINATOR = 8;
    const PUBKEY_LEN = 32;

    if (!data || data.length < DISCRIMINATOR + PUBKEY_LEN * 4) {
      return null;
    }

    return {
      mintA: new PublicKey(data.slice(DISCRIMINATOR, DISCRIMINATOR + PUBKEY_LEN)).toString(),
      mintB: new PublicKey(data.slice(DISCRIMINATOR + PUBKEY_LEN, DISCRIMINATOR + PUBKEY_LEN * 2)).toString(),
      vaultA: new PublicKey(data.slice(DISCRIMINATOR + PUBKEY_LEN * 2, DISCRIMINATOR + PUBKEY_LEN * 3)).toString(),
      vaultB: new PublicKey(data.slice(DISCRIMINATOR + PUBKEY_LEN * 3, DISCRIMINATOR + PUBKEY_LEN * 4)).toString(),
      liquidity: data.readBigUInt64LE(DISCRIMINATOR + PUBKEY_LEN * 4),
      sqrtPriceX64: data.readBigUInt64LE(DISCRIMINATOR + PUBKEY_LEN * 4 + 8),
    };
  }

  // ─── Private methods ─────────────────────────────────────────────────────────

  static async _getRaydiumPoolInfo(poolAddress) {
    try {
      const res = await fetch(`${RAYDIUM_API}/pools/info/ids?ids=${poolAddress}`, {
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      return data?.data?.[0] || null;
    } catch {
      return null;
    }
  }

static async _getDexScreenerData(tokenMint) {
    try {
      const result = await dexService.getTokenPairs(tokenMint);
      if (result.success && result.data && result.data.length > 0) {
        result.data.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
        const pair = result.data[0];
        return {
          liquidityUSD: pair.liquidity?.usd || 0,
          volume24h: pair.volume?.h24 || 0,
          txns24h: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
          priceNative: parseFloat(pair.priceNative || 0),
          priceUSD: parseFloat(pair.priceUsd || 0),
        };
      }
      return null;
    } catch (e) {
      log('debug', `DexScreener fetch failed: ${e.message}`);
      return null;
}
  }

  static async _getOnchainPoolData(poolAddress) {
    try {
      const conn = getConnection();
      const info = await conn.getAccountInfo(new PublicKey(poolAddress), {
        commitment: 'confirmed',
      });
      if (!info?.data) return null;

      const program = info.owner?.toString();
      if (program === RAYDIUM_CLMM_PROGRAM.toString()) {
        const parsed = this.parseCLMMPool(info.data);
        return {
          program: 'CLMM',
          mints: { mintA: parsed?.mintA, mintB: parsed?.mintB },
          vaults: { vaultA: parsed?.vaultA, vaultB: parsed?.vaultB },
        };
      }
      return { program: 'AMM' };
    } catch {
      return null;
    }
  }

  static async _getPriceFromDexScreener(tokenMint) {
    const data = await PoolService._getDexScreenerData(tokenMint);
    return data?.priceNative || null;
  }

  static async _getPriceFromJupiter(tokenMint) {
    try {
      const [solRes, tokenRes] = await Promise.all([
        fetch(`${JUPITER_PRICE}?ids=${SOL_MINT}`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${JUPITER_PRICE}?ids=${tokenMint}`, { signal: AbortSignal.timeout(5000) }),
      ]);
      const [solData, tokenData] = await Promise.all([solRes.json(), tokenRes.json()]);
      const solUSD = solData?.data?.[SOL_MINT]?.price;
      const tokenUSD = tokenData?.data?.[tokenMint]?.price;
      return solUSD && tokenUSD ? tokenUSD / solUSD : null;
    } catch {
      return null;
    }
  }

  static async _getPriceFromRaydium(poolAddress) {
    const pool = await PoolService._getRaydiumPoolInfo(poolAddress);
    if (!pool?.price) return null;
    try {
      const solRes = await fetch(`${JUPITER_PRICE}?ids=${SOL_MINT}`, {
        signal: AbortSignal.timeout(3000),
      });
      const solData = await solRes.json();
      const solUSD = solData?.data?.[SOL_MINT]?.price || 140;
      return parseFloat(pool.price) / solUSD;
    } catch {
      return null;
    }
  }

  static async _getPriceFromVaults(poolAddress) {
    try {
      const conn = getConnection();
      const poolInfo = await conn.getAccountInfo(new PublicKey(poolAddress), {
        commitment: 'confirmed',
      });
      if (!poolInfo?.data) return null;

      const parsed = this.parseCLMMPool(poolInfo.data);
      if (!parsed) return null;

      const [vaultAInfo, vaultBInfo] = await Promise.all([
        conn.getAccountInfo(new PublicKey(parsed.vaultA), { commitment: 'confirmed' }),
        conn.getAccountInfo(new PublicKey(parsed.vaultB), { commitment: 'confirmed' }),
      ]);

      if (!vaultAInfo?.data || !vaultBInfo?.data) return null;

      const amountA = vaultAInfo.data.readBigUInt64LE(64);
      const amountB = vaultBInfo.data.readBigUInt64LE(64);
      if (amountA === 0n || amountB === 0n) return null;

      const mintA = new PublicKey(vaultAInfo.data.slice(0, 32)).toString();
      const mintB = new PublicKey(vaultBInfo.data.slice(0, 32)).toString();

      if (mintA === SOL_MINT) return Number(amountB) / Number(amountA);
      if (mintB === SOL_MINT) return Number(amountA) / Number(amountB);
      return null;
    } catch {
      return null;
    }
  }

  static async _getMintInfo(tokenMint) {
    try {
      const conn = getConnection();
      const { getMint } = await import('@solana/spl-token');
      const mintInfo = await getMint(conn, new PublicKey(tokenMint));
      return {
        mintAuthority: mintInfo.mintAuthority?.toString() || null,
        freezeAuthority: mintInfo.freezeAuthority?.toString() || null,
        supply: Number(mintInfo.supply),
        decimals: mintInfo.decimals,
      };
    } catch {
      return null;
    }
  }

  static async _checkHoneypot(tokenMint) {
    try {
      const res = await fetch(
      `${JUPITER_QUOTE}/swap/v1/quote?inputMint=${tokenMint}&outputMint=${SOL_MINT}&amount=1000000&slippageBps=5000`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) {
        return { isHoneypot: true, reason: `API error: ${res.status}` };
      }
      const data = await res.json();
      if (data.error || !data.outAmount) {
        return { isHoneypot: true, reason: data.error || 'No sell route' };
      }
      return { isHoneypot: false, reason: null };
    } catch (err) {
      return { isHoneypot: true, reason: `API unreachable: ${err.message}` };
    }
  }

  static _mergeTvl(raydiumData, dexData) {
    if (dexData?.liquidityUSD > 0) return dexData.liquidityUSD;
    if (raydiumData?.tvl) return parseFloat(raydiumData.tvl);
    return 0;
  }

  static _mergePrice(raydiumData, dexData, onchainData) {
    if (dexData?.priceNative > 0) return dexData.priceNative;
    if (raydiumData?.price) {
      return parseFloat(raydiumData.price) / 140;
    }
    return null;
  }

  static clearCache() {
    _cache.clear();
  }
}