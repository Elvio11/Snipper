const PRICE_CACHE = new Map();
const CACHE_TTL   = 5000;

/**
 * Get current token price in SOL via Jupiter Price API v2
 */
import { getConnection } from './wallet.js';
import { PublicKey } from '@solana/web3.js';

export async function getTokenPriceInSOL(mintAddress, poolId = null) {
  const cacheKey = poolId || mintAddress;
  const cached = PRICE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.price;
  }

  // Try DexScreener first - returns priceNative in SOL
  const dexPrice = await getPriceFromDexscreener(mintAddress);
  if (dexPrice) {
    PRICE_CACHE.set(cacheKey, { price: dexPrice, ts: Date.now() });
    return dexPrice;
  }

  // Try Jupiter first - get USD price and convert to SOL
  let solPriceUSD = null;
  try {
    const solUrl = 'https://price.jup.ag/v6/price?ids=So11111111111111111111111111111111111111112';
    const solRes = await fetch(solUrl, { signal: AbortSignal.timeout(5000) });
    const solData = await solRes.json();
    solPriceUSD = solData?.data?.['So11111111111111111111111111111111111111112']?.price || null;
  } catch {}

  try {
    const url  = `https://price.jup.ag/v6/price?ids=${mintAddress}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const usdPrice = data?.data?.[mintAddress]?.price || null;

    if (usdPrice && solPriceUSD) {
      const priceInSOL = usdPrice / solPriceUSD;
      PRICE_CACHE.set(cacheKey, { price: priceInSOL, ts: Date.now() });
      return priceInSOL;
    }
  } catch {}

  // Try get price from pool account via RPC (most reliable for new tokens)
  if (poolId) {
    const price = await getPriceFromPoolRPC(poolId);
    if (price && price > 0 && price < 100) { // Accept prices up to 100 SOL (very high cap)
      PRICE_CACHE.set(cacheKey, { price, ts: Date.now() });
      return price;
    }
  }

  // Try Raydium API pool price with retries
  if (poolId) {
    const price = await getPriceFromPool(poolId, 2, 2000);
    if (price && price > 0 && price < 100) {
      PRICE_CACHE.set(cacheKey, { price, ts: Date.now() });
      return price;
    }
    
    // Try CPMM calculation from on-chain data
    const cpmmPrice = await getCPMMPriceFromPool(poolId);
    if (cpmmPrice && cpmmPrice > 0 && cpmmPrice < 100) {
      PRICE_CACHE.set(cacheKey, { price: cpmmPrice, ts: Date.now() });
      return cpmmPrice;
    }
  }

  // Fallback: search Raydium pools
  return await getPriceFromRaydium(mintAddress);
}

async function getPriceFromPoolRPC(poolId) {
  try {
    const conn = getConnection();
    const poolPubkey = new PublicKey(poolId);
    const accountInfo = await conn.getAccountInfo(poolPubkey, { commitment: 'confirmed' });
    
    if (!accountInfo?.data) return null;
    
    const data = accountInfo.data;
    const DISCRIMINATOR_LEN = 8;
    const PUBKEY_LEN = 32;
    
    // Raydium V4/CLOBBER/METEORA pool structure
    // After discriminator: baseVault(32) + quoteVault(32) + ...
    // We need to find the vault offsets which vary by pool type
    
    // Try standard Raydium V4 offset pattern
    const offsets = [
      { base: 72, quote: 104 },   // Standard V4
      { base: 64, quote: 96 },   // Alternative
      { base: 40, quote: 72 },   // CLMM
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
          if (price > 0 && price < 1000000) { // Allow very small token prices
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
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  
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
      
      // Convert USD to SOL
      let solUSD = 140;
      try {
        const solRes = await fetch(`https://price.jup.ag/v6/price?ids=${SOL_MINT}`, { signal: AbortSignal.timeout(3000) });
        const solData = await solRes.json();
        solUSD = solData?.data?.[SOL_MINT]?.price || 140;
      } catch {}
      
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
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    
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
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  try {
    const res = await fetch(
      `https://api-v3.raydium.io/pools/info/mint?mint1=${mintAddress}&mint2=${SOL_MINT}&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=20&page=1`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    const pools = data?.data || [];
    
    // Get SOL price for conversion
    let solUSD = 140;
    try {
      const solRes = await fetch('https://price.jup.ag/v6/price?ids=So11111111111111111111111111111111111111112', { signal: AbortSignal.timeout(3000) });
      const solData = await solRes.json();
      solUSD = solData?.data?.['So11111111111111111111111111111111111111112']?.price || 140;
    } catch {}
    
    for (const pool of pools) {
      const usdPrice = parseFloat(pool.price || 0);
      if (usdPrice > 0) {
        const priceInSOL = usdPrice / solUSD;
        if (priceInSOL > 0 && priceInSOL < 1) { // Sanity check
          PRICE_CACHE.set(mintAddress, { price: priceInSOL, ts: Date.now() });
          return priceInSOL;
        }
      }
    }
    return null;
  } catch {
    try { return await getPriceFromDexscreener(mintAddress); } catch {}
    try { return await getPriceFromBirdeye(mintAddress); } catch {}
    return null;
  }
}

async function getPriceFromDexscreener(mintAddress) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`, {
      signal: AbortSignal.timeout(8000)
    });
    const data = await res.json();
    const pair = data?.pairs?.[0];
    if (pair?.priceNative) {
      const price = parseFloat(pair.priceNative);
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

async function getPriceFromBirdeye(mintAddress) {
  try {
    const res = await fetch(`https://public-api.birdeye.com/defi/price?address=${mintAddress}`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();
    const price = parseFloat(data?.data?.value);
    if (price > 0) {
      PRICE_CACHE.set(mintAddress, { price, ts: Date.now() });
      return price;
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
