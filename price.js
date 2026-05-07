const PRICE_CACHE = new Map();
const CACHE_TTL   = 5000;

/**
 * Get current token price in SOL via multiple price sources.
 * Fallback chain: DexScreener → Jupiter Price v2 → RPC vault calc → Raydium v3 → (Birdeye removed)
 */
import { getConnection } from './wallet.js';
import { PublicKey } from '@solana/web3.js';
import { dexService } from './src/services/dexscreener-service.js';
import { CONFIG } from './config.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_PRICE_V3 = 'https://api.jup.ag/price/v3';
const JUPITER_QUOTE_API = 'https://api.jup.ag/swap/v2/quote';

/**
 * Get the most accurate "executable" price using Jupiter's Quote API.
 * This accounts for liquidity depth and price impact, mimicking real trading.
 */
async function getJupiterQuotePrice(mint, amount, decimals) {
  try {
    const params = new URLSearchParams({
      inputMint: mint,
      outputMint: SOL_MINT,
      amount: String(Math.floor(amount)), 
      slippageBps: '50', 
    });
    
    const headers = { 'Accept': 'application/json' };
    if (CONFIG.JUPITER_API_KEY) headers['x-api-key'] = CONFIG.JUPITER_API_KEY;

    const res = await fetch(`${JUPITER_QUOTE_API}?${params}`, {
      headers,
      signal: AbortSignal.timeout(5000)
    });
    
    if (!res.ok) return null;
    
    const json = await res.json();
    const outAmount = json?.outAmount;
    
    if (outAmount && amount > 0) {
      const solReceived = Number(outAmount) / 1e9;
      const tokensSold = Number(amount) / Math.pow(10, decimals);
      if (tokensSold === 0) return null;
      return solReceived / tokensSold;
    }
  } catch (err) {
  }
  return null;
}

export async function getTokenPriceInSOL(mintAddress, poolId = null, forceRefresh = false, amount = null, decimals = 9) {
  if (amount && Number(amount) > 0) {
    const quotePrice = await getJupiterQuotePrice(mintAddress, amount, decimals);
    if (quotePrice) return quotePrice;
  }

  const cacheKey = poolId || mintAddress;
  if (!forceRefresh) {
    const cached = PRICE_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return cached.price;
    }
  }

  // 1. Primary: DexScreener - returns priceNative in SOL
  const dexPrice = await getPriceFromDexscreener(mintAddress);
  if (dexPrice) {
    PRICE_CACHE.set(cacheKey, { price: dexPrice, ts: Date.now() });
    return dexPrice;
  }

  // 2. Secondary: Jupiter Price API v3
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
    const url = `${JUPITER_PRICE_V3}?ids=${mintAddress}&vsToken=${SOL_MINT}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    
    // Jupiter v3 returns { data: { "MINT": { price: "..." } } }
    const data = json?.data?.[mintAddress] || json?.[mintAddress];
    const price = data?.price || data?.usdPrice;
    
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
        
        const [baseVaultInfo, quoteVaultInfo] = await Promise.all([
          conn.getAccountInfo(baseVaultKey, { commitment: 'confirmed' }),
          conn.getAccountInfo(quoteVaultKey, { commitment: 'confirmed' })
        ]);
        
        if (!baseVaultInfo?.data || !quoteVaultInfo?.data) continue;
        
        // Parse token account data (mint + amount at offset 0 and 64)
        const baseMint = new PublicKey(baseVaultInfo.data.slice(0, 32)).toString();
        const quoteMint = new PublicKey(quoteVaultInfo.data.slice(0, 32)).toString();
        const baseAmount = baseVaultInfo.data.readBigUInt64LE(64);
        const quoteAmount = quoteVaultInfo.data.readBigUInt64LE(64);
        
        if (baseAmount > 0n && quoteAmount > 0n) {
          // Identify which side is SOL to calculate price in SOL
          let price;
          const [baseDec, quoteDec] = await Promise.all([
            getMintDecimals(baseMint),
            getMintDecimals(quoteMint)
          ]);

          const baseNorm = Number(baseAmount) / Math.pow(10, baseDec);
          const quoteNorm = Number(quoteAmount) / Math.pow(10, quoteDec);

          if (quoteMint === SOL_MINT) {
            price = quoteNorm / baseNorm;
          } else if (baseMint === SOL_MINT) {
            price = baseNorm / quoteNorm;
          } else {
            // Fallback: assume quote is SOL if not explicitly known (dangerous but better than nothing)
            price = quoteNorm / baseNorm;
          }

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
        
        const [vaultAInfo, vaultBInfo] = await Promise.all([
          conn.getAccountInfo(vaultA, { commitment: 'confirmed' }),
          conn.getAccountInfo(vaultB, { commitment: 'confirmed' })
        ]);
        
        if (!vaultAInfo?.data || !vaultBInfo?.data) continue;
        
        const mintA = new PublicKey(vaultAInfo.data.slice(0, 32)).toString();
        const mintB = new PublicKey(vaultBInfo.data.slice(0, 32)).toString();
        const amountA = vaultAInfo.data.readBigUInt64LE(64);
        const amountB = vaultBInfo.data.readBigUInt64LE(64);
        
        if (amountA === 0n || amountB === 0n) continue;
        
        const [decA, decB] = await Promise.all([
          getMintDecimals(mintA),
          getMintDecimals(mintB)
        ]);

        const normA = Number(amountA) / Math.pow(10, decA);
        const normB = Number(amountB) / Math.pow(10, decB);

        // Determine which token is SOL/USDC and calculate price
        let priceInSOL;
        if (mintA === SOL_MINT || mintA === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
          priceInSOL = normA / normB; // This was wrong too, should be SOL / Token
          // Wait, if mintA is SOL, price in SOL is AmountSOL / AmountToken? 
          // No, price of token in SOL is SOL_amount / Token_amount.
          priceInSOL = normA / normB;
        } else if (mintB === SOL_MINT || mintB === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
          priceInSOL = normB / normA;
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
    if (result.success && result.data) {
      // 1. Try native SOL price (verify it's quoted in SOL)
      const isSolQuote = result.data.quoteAddress === SOL_MINT || result.data.quoteToken === 'SOL';
      if (result.data.priceNative > 0 && isSolQuote) {
        const price = result.data.priceNative;
        PRICE_CACHE.set(mintAddress, { price, ts: Date.now() });
        return price;
      }
      // 2. Try USD price fallback
      if (result.data.priceUSD > 0 && CONFIG.SOL_PRICE > 0) {
        const price = result.data.priceUSD / CONFIG.SOL_PRICE;
        PRICE_CACHE.set(mintAddress, { price, ts: Date.now() });
        return price;
      }
    }
    return null;
  } catch {
    return null;
  }
}

const DECIMAL_CACHE = new Map();

async function getMintDecimals(mint) {
  if (mint === SOL_MINT) return 9;
  if (mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') return 6; // USDC
  
  if (DECIMAL_CACHE.has(mint)) return DECIMAL_CACHE.get(mint);

  try {
    const conn = getConnection();
    const info = await conn.getParsedAccountInfo(new PublicKey(mint));
    const decimals = info.value?.data?.parsed?.info?.decimals || 6;
    DECIMAL_CACHE.set(mint, decimals);
    return decimals;
  } catch {
    return 6;
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
