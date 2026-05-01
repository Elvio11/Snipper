const PRICE_CACHE = new Map();
const CACHE_TTL   = 5000;

/**
 * Get current token price in SOL via multiple price sources.
 * Fallback chain: DexScreener → Jupiter Price v2 → RPC vault calc → Raydium v3 → (Birdeye removed)
 */
import { getConnection } from './wallet.js';
import { PublicKey } from '@solana/web3.js';
import { dexService } from './src/services/dexscreener-service.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_PRICE_V3 = 'https://api.jup.ag/price/v3';

export async function getTokenPriceInSOL(mintAddress, poolId = null) {
  const cacheKey = poolId || mintAddress;
  const cached = PRICE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.price;
  }

  // 1. Primary: DexScreener - returns priceNative in SOL
  const dexPrice = await getPriceFromDexscreener(mintAddress);
  if (dexPrice) {
    PRICE_CACHE.set(cacheKey, { price: dexPrice, ts: Date.now() });
    return dexPrice;
  }

  // 2. Secondary: Jupiter Price API v2 (replaced deprecated v6)
  const jupPrice = await getJupiterPriceInSOL(mintAddress);
  if (jupPrice) {
    PRICE_CACHE.set(cacheKey, { price: jupPrice, ts: Date.now() });
    return jupPrice;
  }

  // 3. Tertiary: RPC vault calc (most reliable for new tokens with known pool)
  if (poolId) {
    const price = await getPriceFromPoolRPC(poolId);
    if (price && price > 0 && price < 100) {
      PRICE_CACHE.set(cacheKey, { price, ts: Date.now() });
      return price;
    }
  }

  // 4. Quaternary: Raydium v3 API
  if (poolId) {
    const price = await getPriceFromPool(poolId, 2, 2000);
    if (price && price > 0 && price < 100) {
      PRICE_CACHE.set(cacheKey, { price, ts: Date.now() });
      return price;
    }
    
    const cpmmPrice = await getCPMMPriceFromPool(poolId);
    if (cpmmPrice && cpmmPrice > 0 && cpmmPrice < 100) {
      PRICE_CACHE.set(cacheKey, { price: cpmmPrice, ts: Date.now() });
      return cpmmPrice;
    }
  }

  // 5. Last resort: search Raydium pools by mint
  return await getPriceFromRaydium(mintAddress);
}

/**
 * Get token price in SOL using Jupiter Price API v2.
 * Replaces deprecated price.jup.ag/v6.
 */
async function getJupiterPriceInSOL(mintAddress) {
  try {
    // Jupiter v2 supports vsToken parameter for direct SOL-denominated price
    const url = `${JUPITER_PRICE_V3}?ids=${mintAddress}&vsToken=${SOL_MINT}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    // V3 uses direct mint properties and usdPrice/price
    const price = data?.[mintAddress]?.price || data?.[mintAddress]?.usdPrice;
    if (price && price > 0) {
      return parseFloat(price);
    }
  } catch {}

  // Fallback: get both USD prices and divide
  try {
    const [tokenRes, solRes] = await Promise.all([
      fetch(`${JUPITER_PRICE_V3}?ids=${mintAddress}`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${JUPITER_PRICE_V3}?ids=${SOL_MINT}`, { signal: AbortSignal.timeout(5000) }),
    ]);
    const [tokenData, solData] = await Promise.all([tokenRes.json(), solRes.json()]);
    const tokenUSD = tokenData?.[mintAddress]?.price || tokenData?.[mintAddress]?.usdPrice;
    const solUSD = solData?.[SOL_MINT]?.price || solData?.[SOL_MINT]?.usdPrice;
    if (tokenUSD && solUSD && solUSD > 0) {
      return parseFloat(tokenUSD) / parseFloat(solUSD);
    }
  } catch {}

  return null;
}

/**
 * Get SOL price in USD using Jupiter Price v2.
 */
async function getSOLPriceUSD() {
  try {
    const res = await fetch(`${JUPITER_PRICE_V3}?ids=${SOL_MINT}`, {
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    const price = data?.[SOL_MINT]?.price || data?.[SOL_MINT]?.usdPrice;
    return parseFloat(price) || 140;
  } catch {
    return 140;
  }
}

async function getPriceFromPoolRPC(poolId) {
  try {
    const conn = getConnection();
    const poolPubkey = new PublicKey(poolId);
    const accountInfo = await conn.getAccountInfo(poolPubkey, { commitment: 'confirmed' });
    
    if (!accountInfo?.data) return null;
    
    const data = accountInfo.data;
    const PUBKEY_LEN = 32;
    
    // Raydium V4/CLOBBER/METEORA pool structure
    const offsets = [
      { base: 72, quote: 104 },   // Standard V4
      { base: 64, quote: 96 },    // Alternative
      { base: 40, quote: 72 },    // CLMM
    ];
    
    for (const offset of offsets) {
      try {
        const baseVault = data.slice(offset.base, offset.base + PUBKEY_LEN);
        const quoteVault = data.slice(offset.quote, offset.quote + PUBKEY_LEN);
        
        if (baseVault.length !== PUBKEY_LEN || quoteVault.length !== PUBKEY_LEN) continue;
        
        const baseVaultKey = new PublicKey(baseVault);
        const quoteVaultKey = new PublicKey(quoteVault);
        
        const baseVaultInfo = await conn.getAccountInfo(baseVaultKey, { commitment: 'confirmed' });
        const quoteVaultInfo = await conn.getAccountInfo(quoteVaultKey, { commitment: 'confirmed' });
        
        if (!baseVaultInfo?.data || !quoteVaultInfo?.data) continue;
        
        // Parse token account data (mint + amount at offset 0 and 64)
        const baseAmount = baseVaultInfo.data.readBigUInt64LE(64);
        const quoteAmount = quoteVaultInfo.data.readBigUInt64LE(64);
        
        if (baseAmount > 0n && quoteAmount > 0n) {
          const price = Number(quoteAmount) / Number(baseAmount);
          if (price > 0 && price < 1000000) {
            return price;
          }
        }
      } catch {
        continue;
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

export async function getPriceFromPool(poolId, retries = 3, delayMs = 3000) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`https://api-v3.raydium.io/pools/info/ids?ids=${poolId}`, {
        signal: AbortSignal.timeout(8000)
      });
      const data = await res.json();
      const pool = data?.data?.[0];
      const usdPrice = pool?.price ? parseFloat(pool.price) : null;
      if (!usdPrice) {
        if (attempt < retries - 1) {
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        }
        return null;
      }
      
      // Convert USD to SOL using Jupiter v2
      const solUSD = await getSOLPriceUSD();
      return usdPrice / solUSD;
    } catch {
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  return null;
}

export async function getCPMMPriceFromPool(poolId) {
  try {
    const conn = getConnection();
    const poolPubkey = new PublicKey(poolId);
    const RAYDIUM_PROGRAM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
    
    const seedVariations = [
      ['vault_a', 'vault_b'],
      ['mint_a', 'mint_b'],
      [Buffer.from('vault_a'), Buffer.from('vault_b')],
    ];
    
    for (const seeds of seedVariations) {
      try {
        const [vaultA] = await PublicKey.findProgramAddress(
          [poolPubkey.toBuffer(), seeds[0]],
          RAYDIUM_PROGRAM
        );
        const [vaultB] = await PublicKey.findProgramAddress(
          [poolPubkey.toBuffer(), seeds[1]],
          RAYDIUM_PROGRAM
        );
        
        const vaultAInfo = await conn.getAccountInfo(vaultA, { commitment: 'confirmed' });
        const vaultBInfo = await conn.getAccountInfo(vaultB, { commitment: 'confirmed' });
        
        if (!vaultAInfo?.data || !vaultBInfo?.data) continue;
        
        const mintA = new PublicKey(vaultAInfo.data.slice(0, 32)).toString();
        const mintB = new PublicKey(vaultBInfo.data.slice(0, 32)).toString();
        const amountA = vaultAInfo.data.readBigUInt64LE(64);
        const amountB = vaultBInfo.data.readBigUInt64LE(64);
        
        if (amountA === 0n || amountB === 0n) continue;
        
        // Determine which token is SOL/USDC and calculate price
        let priceInSOL;
        if (mintA === SOL_MINT || mintA === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
          priceInSOL = Number(amountB) / Number(amountA);
        } else if (mintB === SOL_MINT || mintB === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
          priceInSOL = Number(amountA) / Number(amountB);
        } else {
          continue;
        }
        
        if (priceInSOL > 0 && priceInSOL < 1000000) {
          return priceInSOL;
        }
      } catch {
        continue;
      }
    }
  } catch {}
  return null;
}

async function getPriceFromRaydium(mintAddress) {
  try {
    const res = await fetch(
      `https://api-v3.raydium.io/pools/info/mint?mint1=${mintAddress}&mint2=${SOL_MINT}&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=20&page=1`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    const pools = data?.data || [];
    
    // Get SOL price for conversion (using v2 API)
    const solUSD = await getSOLPriceUSD();
    
    for (const pool of pools) {
      const usdPrice = parseFloat(pool.price || 0);
      if (usdPrice > 0) {
        const priceInSOL = usdPrice / solUSD;
        if (priceInSOL > 0 && priceInSOL < 1) {
          PRICE_CACHE.set(mintAddress, { price: priceInSOL, ts: Date.now() });
          return priceInSOL;
        }
      }
    }
    return null;
  } catch {
    // Final fallback: DexScreener (retry if not tried yet)
    try { return await getPriceFromDexscreener(mintAddress); } catch {}
    return null;
  }
}

async function getPriceFromDexscreener(mintAddress) {
  try {
    const result = await dexService.getTokenPrice(mintAddress);
    if (result.success && result.data?.priceNative) {
      const price = result.data.priceNative;
      if (price > 0) {
        PRICE_CACHE.set(mintAddress, { price, ts: Date.now() });
        return price;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get token price from Raydium pools directly
 */
export async function getTokenPriceFromRaydium(poolId) {
  try {
    const res = await fetch(`https://api-v3.raydium.io/pools/info/ids?ids=${poolId}`, {
      signal: AbortSignal.timeout(8000)
    });
    const data = await res.json();
    const pool = data?.data?.[0];
    return pool?.price ? parseFloat(pool.price) : null;
  } catch {
    return null;
  }
}

/**
 * Get liquidity in USD for a pool
 */
export async function getPoolLiquidityUSD(poolId) {
  try {
    const res = await fetch(`https://api-v3.raydium.io/pools/info/ids?ids=${poolId}`, {
      signal: AbortSignal.timeout(8000)
    });
    const data = await res.json();
    const pool = data?.data?.[0];
    return pool?.tvl ? parseFloat(pool.tvl) : 0;
  } catch {
    return 0;
  }
}
